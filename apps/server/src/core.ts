import {
  AD_PLACEMENTS, COSMETIC_BY_ID, corfState, dayKey, leagueOf, newProfile, refreshQuests, REFERRAL_REWARD,
  type AdPlacement, type CosmeticKind, type PlayerView,
} from '@shellter/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { langOf, randomId, type TgUser } from './auth';
import type { Config } from './config';
import type { Db, Tx } from './db';
import { adIntents, analytics, inbox, players, referrals, type CosmeticsState, type PassState, type Reward } from './db/schema';

export type PlayerRow = typeof players.$inferSelect;

export interface Ctx {
  db: Db;
  config: Config;
  now(): number;
}

export class ApiFail extends Error {
  constructor(public code: string, public status = 400, message?: string) {
    super(message ?? code);
  }
}

export const DEFAULT_EQUIPPED: Record<CosmeticKind, string> = {
  crab: 'crab_default',
  shell: 'shell_default',
  merge: 'merge_default',
  town: 'town_default',
  title: '',
};

export function seasonKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7);
}

export async function createPlayer(tx: Tx, now: number, opts: { tg?: TgUser; guestHash?: string }): Promise<PlayerRow> {
  const id = randomId(9);
  const name = opts.tg ? (opts.tg.first_name || opts.tg.username || `Crab ${id.slice(0, 4)}`).slice(0, 24) : `Рачок ${Math.floor(1000 + Math.random() * 9000)}`;
  const row: typeof players.$inferInsert = {
    id,
    tgId: opts.tg?.id ?? null,
    guestHash: opts.guestHash ?? null,
    name,
    lang: opts.tg ? langOf(opts.tg.language_code) : 'ru',
    guest: !opts.tg,
    profile: newProfile(now),
    quests: null,
    cosmetics: { owned: [], equipped: { ...DEFAULT_EQUIPPED } },
    pass: { season: seasonKey(now), xp: 0, claimed: [] },
    perks: { noAds: false, secondChanceTokens: 0, saveSlots: 1 },
    notify: { enabled: true, corf: true, events: true, kraken: true, last: {} },
    lastBuild: null,
    trophies: 0,
    createdAt: now,
    lastSeenAt: now,
  };
  const [created] = await tx.insert(players).values(row).returning();
  return created as PlayerRow;
}

export async function lockPlayer(tx: Tx, id: string): Promise<PlayerRow> {
  const [row] = await tx.select().from(players).where(eq(players.id, id)).for('update');
  if (!row) throw new ApiFail('unauthorized', 401);
  return row;
}

export async function savePlayer(tx: Tx, row: PlayerRow): Promise<void> {
  row.trophies = row.profile.trophies;
  await tx
    .update(players)
    .set({
      tgId: row.tgId, guestHash: row.guestHash, name: row.name, lang: row.lang, guest: row.guest, profile: row.profile,
      quests: row.quests, cosmetics: row.cosmetics, pass: row.pass, perks: row.perks, notify: row.notify,
      lastBuild: row.lastBuild, trophies: row.trophies, botBlocked: row.botBlocked, referrerId: row.referrerId,
      paidStars: row.paidStars, lastSeenAt: row.lastSeenAt,
    })
    .where(eq(players.id, row.id));
}

/** Runs `fn` with the player row locked; saves the row afterwards. */
export async function withPlayer<T>(ctx: Ctx, playerId: string, fn: (tx: Tx, row: PlayerRow) => Promise<T>): Promise<T> {
  return ctx.db.transaction(async (tx) => {
    const row = await lockPlayer(tx, playerId);
    const out = await fn(tx, row);
    await savePlayer(tx, row);
    return out;
  });
}

export function ownedCosmetics(c: CosmeticsState): string[] {
  const free = [...COSMETIC_BY_ID.values()].filter((x) => x.source === 'free').map((x) => x.id);
  return [...new Set([...free, ...c.owned])];
}

export function grant(row: PlayerRow, reward: Reward | null | undefined, mult = 1): void {
  if (!reward) return;
  row.profile = {
    ...row.profile,
    coral: row.profile.coral + Math.round((reward.coral ?? 0) * mult),
    shine: row.profile.shine + Math.round((reward.shine ?? 0) * mult),
  };
  if (reward.cosmetic && !row.cosmetics.owned.includes(reward.cosmetic)) {
    row.cosmetics = { ...row.cosmetics, owned: [...row.cosmetics.owned, reward.cosmetic] };
  }
}

/** Refreshes period-bound state (quests, pass season) in place; returns true when something changed. */
export function refreshPlayer(row: PlayerRow, now: number): boolean {
  let changed = false;
  const quests = refreshQuests(row.quests, row.id, now);
  if (!row.quests || quests.day !== row.quests.day || quests.week !== row.quests.week) {
    row.quests = quests;
    changed = true;
  }
  const season = seasonKey(now);
  if (row.pass.season !== season) {
    row.pass = { season, xp: 0, claimed: [] };
    changed = true;
  } else if (!Array.isArray(row.pass.claimed)) {
    const legacy = row.pass as PassState & { claimedFree?: number[] };
    row.pass = { season: legacy.season, xp: legacy.xp, claimed: legacy.claimedFree ?? [] };
    changed = true;
  }
  return changed;
}

export async function playerView(tx: Tx | Db, row: PlayerRow, now: number): Promise<PlayerView> {
  refreshPlayer(row, now);
  const [unread] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(inbox)
    .where(and(eq(inbox.playerId, row.id), isNull(inbox.claimedAt)));
  const adRows = await tx
    .select({ placement: adIntents.placement, n: sql<number>`count(*)::int` })
    .from(adIntents)
    .where(and(eq(adIntents.playerId, row.id), eq(adIntents.day, dayKey(now)), sql`${adIntents.status} <> 'pending'`))
    .groupBy(adIntents.placement);
  const adsToday: Partial<Record<AdPlacement, number>> = {};
  for (const r of adRows) if ((AD_PLACEMENTS as readonly string[]).includes(r.placement)) adsToday[r.placement as AdPlacement] = r.n;
  const corf = corfState(row.profile, now);
  return {
    id: row.id,
    name: row.name,
    lang: row.lang === 'en' ? 'en' : 'ru',
    guest: row.guest,
    profile: row.profile,
    quests: row.quests as NonNullable<PlayerRow['quests']>,
    cosmetics: { owned: ownedCosmetics(row.cosmetics), equipped: { ...DEFAULT_EQUIPPED, ...row.cosmetics.equipped } },
    pass: row.pass,
    perks: row.perks,
    corf: { amount: corf.amount, cap: corf.cap, full: corf.full },
    league: leagueOf(row.profile.trophies),
    inboxUnread: unread?.n ?? 0,
    adsToday,
    adUnlocks: { ...(row.cosmetics.adViews ?? {}) },
    serverTime: now,
  };
}

export async function track(tx: Tx | Db, now: number, playerId: string | null, type: string, props?: Record<string, unknown>, sessionId?: string): Promise<void> {
  await tx.insert(analytics).values({ playerId, sessionId: sessionId ?? null, type, props: props ?? null, ts: now });
}

/** `ref_<playerId>` start parameter: rewards both sides once, never for self-invites. */
export async function applyReferral(tx: Tx, now: number, invitee: PlayerRow, startParam: string | undefined): Promise<void> {
  const m = /^ref_([\w-]{6,32})$/.exec(startParam ?? '');
  if (!m || m[1] === invitee.id) return;
  const [referrer] = await tx.select().from(players).where(eq(players.id, m[1] as string)).for('update');
  if (!referrer) return;
  const inserted = await tx.insert(referrals).values({ inviteeId: invitee.id, referrerId: referrer.id, createdAt: now }).onConflictDoNothing().returning();
  if (inserted.length === 0) return;
  invitee.referrerId = referrer.id;
  grant(invitee, REFERRAL_REWARD);
  grant(referrer, REFERRAL_REWARD);
  await savePlayer(tx, referrer);
  await tx.insert(inbox).values({
    id: randomId(), playerId: referrer.id, kind: 'referral',
    title: { ru: 'Друг пришёл на риф', en: 'A friend joined the reef' },
    body: { ru: `${invitee.name} начал играть по твоей ссылке. Награда уже у тебя.`, en: `${invitee.name} joined with your link. The reward is already yours.` },
    reward: null, createdAt: now, claimedAt: now,
  });
  await track(tx, now, invitee.id, 'referral', { referrer: referrer.id });
}

export async function addInbox(tx: Tx, now: number, playerId: string, kind: string, title: { ru: string; en: string }, body: { ru: string; en: string }, reward: Reward | null): Promise<void> {
  await tx.insert(inbox).values({ id: randomId(), playerId, kind, title, body, reward, createdAt: now, claimedAt: null });
}
