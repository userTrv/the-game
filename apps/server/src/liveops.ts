import {
  buildFighter, DEFAULT_EVENTS, eventModifier, KRAKEN_ATTACKS_PER_DAY, KRAKEN_DEFAULT_THRESHOLDS, krakenFighter, dayKey, leagueOf,
  LEAGUES, seasonResetTrophies, simulateBattle, applyQuestDeltas,
  type EventModifier, type EventView, type KrakenAttackResponse, type KrakenConfig, type KrakenView, type LeagueView,
  type LiveEventConfig, type LiveopsView,
} from '@shellter/shared';
import { and, desc, eq, gt, lte, sql } from 'drizzle-orm';
import { randomId } from './auth';
import { addInbox, ApiFail, grant, playerView, refreshPlayer, track, withPlayer, type Ctx, type PlayerRow } from './core';
import type { Db, Tx } from './db';
import { eventScores, krakenClaims, krakenHits, liveEvents, outbox, players, type SeasonConfig } from './db/schema';

type Q = Tx | Db;

async function current<T>(q: Q, kind: 'event' | 'kraken' | 'season', now: number): Promise<{ id: string; config: T } | null> {
  const [row] = await q
    .select()
    .from(liveEvents)
    .where(and(eq(liveEvents.kind, kind), lte(liveEvents.startsAt, now), gt(liveEvents.endsAt, now)))
    .orderBy(desc(liveEvents.startsAt))
    .limit(1);
  return row ? { id: row.id, config: row.config as T } : null;
}

export const currentEvent = (q: Q, now: number) => current<LiveEventConfig>(q, 'event', now);
export const currentKraken = (q: Q, now: number) => current<KrakenConfig>(q, 'kraken', now);
export const currentSeason = (q: Q, now: number) => current<SeasonConfig>(q, 'season', now);

export async function currentModifier(q: Q, now: number): Promise<EventModifier | undefined> {
  const ev = await currentEvent(q, now);
  return ev ? eventModifier(ev.config) : undefined;
}

export async function addEventScore(tx: Tx, eventId: string, playerId: string, score: number): Promise<void> {
  if (score <= 0) return;
  await tx
    .insert(eventScores)
    .values({ eventId, playerId, score })
    .onConflictDoUpdate({ target: [eventScores.eventId, eventScores.playerId], set: { score: sql`${eventScores.score} + ${score}` } });
}

async function eventView(q: Q, now: number, playerId: string): Promise<EventView | null> {
  const ev = await currentEvent(q, now);
  if (!ev) return null;
  const top = await q
    .select({ name: players.name, score: eventScores.score })
    .from(eventScores)
    .innerJoin(players, eq(players.id, eventScores.playerId))
    .where(eq(eventScores.eventId, ev.id))
    .orderBy(desc(eventScores.score))
    .limit(20);
  const [mine] = await q.select().from(eventScores).where(and(eq(eventScores.eventId, ev.id), eq(eventScores.playerId, playerId)));
  let myRank: number | null = null;
  if (mine) {
    const [better] = await q.select({ n: sql<number>`count(*)::int` }).from(eventScores).where(and(eq(eventScores.eventId, ev.id), gt(eventScores.score, mine.score)));
    myRank = (better?.n ?? 0) + 1;
  }
  return { config: ev.config, myScore: mine?.score ?? 0, myRank, top };
}

async function krakenTotals(q: Q, krakenId: string, playerId: string, day: string): Promise<{ total: number; mine: number; today: number }> {
  const [t] = await q
    .select({
      total: sql<number>`coalesce(sum(${krakenHits.damage}), 0)::float8`,
      mine: sql<number>`coalesce(sum(${krakenHits.damage}) filter (where ${krakenHits.playerId} = ${playerId}), 0)::float8`,
      today: sql<number>`(count(*) filter (where ${krakenHits.playerId} = ${playerId} and ${krakenHits.day} = ${day}))::int`,
    })
    .from(krakenHits)
    .where(eq(krakenHits.krakenId, krakenId));
  return { total: Number(t?.total ?? 0), mine: Number(t?.mine ?? 0), today: Number(t?.today ?? 0) };
}

export async function krakenView(q: Q, now: number, playerId: string): Promise<KrakenView | null> {
  const k = await currentKraken(q, now);
  if (!k) return null;
  const totals = await krakenTotals(q, k.id, playerId, dayKey(now));
  const claims = await q.select().from(krakenClaims).where(and(eq(krakenClaims.krakenId, k.id), eq(krakenClaims.playerId, playerId)));
  const dealt = Math.min(k.config.hpMax, totals.total);
  return {
    id: k.id,
    hpMax: k.config.hpMax,
    hpLeft: k.config.hpMax - dealt,
    endsAt: k.config.endsAt,
    myDamage: totals.mine,
    attacksLeft: Math.max(0, KRAKEN_ATTACKS_PER_DAY - totals.today),
    thresholds: k.config.thresholds.map((t) => ({
      pct: t.pct,
      reward: t.reward,
      reached: dealt >= (k.config.hpMax * t.pct) / 100,
      claimed: claims.some((c) => c.pct === t.pct),
    })),
  };
}

async function leagueView(q: Q, now: number, row: PlayerRow): Promise<LeagueView> {
  const season = await currentSeason(q, now);
  const top = await q.select({ name: players.name, trophies: players.trophies }).from(players).where(gt(players.trophies, 0)).orderBy(desc(players.trophies)).limit(20);
  let myRank: number | null = null;
  if (row.profile.trophies > 0) {
    const [better] = await q.select({ n: sql<number>`count(*)::int` }).from(players).where(gt(players.trophies, row.profile.trophies));
    myRank = (better?.n ?? 0) + 1;
  }
  return {
    trophies: row.profile.trophies,
    league: leagueOf(row.profile.trophies),
    season: season ? { id: season.id, endsAt: season.config.endsAt } : null,
    top,
    myRank,
  };
}

export async function liveopsView(q: Q, now: number, row: PlayerRow): Promise<LiveopsView> {
  return { event: await eventView(q, now, row.id), kraken: await krakenView(q, now, row.id), league: await leagueView(q, now, row) };
}

export async function krakenAttack(ctx: Ctx, playerId: string): Promise<KrakenAttackResponse> {
  const now = ctx.now();
  return withPlayer(ctx, playerId, async (tx, row) => {
    const k = await currentKraken(tx, now);
    if (!k) throw new ApiFail('no_kraken');
    if (!row.lastBuild) throw new ApiFail('no_build');
    const totals = await krakenTotals(tx, k.id, playerId, dayKey(now));
    if (totals.today >= KRAKEN_ATTACKS_PER_DAY) throw new ApiFail('no_attacks');
    const seed = `kraken/${k.id}/${playerId}/${randomId(6)}`;
    const result = simulateBattle(buildFighter(row.lastBuild), krakenFighter(), seed);
    let dealt = 0;
    for (const v of Object.values(result.damage[0])) dealt += v;
    const damage = Math.max(0, Math.min(Math.round(dealt), Math.round(k.config.hpMax - Math.min(k.config.hpMax, totals.total))));
    await tx.insert(krakenHits).values({ krakenId: k.id, playerId, damage, day: dayKey(now), ts: now });
    refreshPlayer(row, now);
    if (row.quests) row.quests = applyQuestDeltas(row.quests, { kraken_hit: 1 });
    await track(tx, now, playerId, 'kraken_hit', { damage });
    return { damage, seed, build: row.lastBuild, result, kraken: (await krakenView(tx, now, playerId)) as KrakenView, player: await playerView(tx, row, now) };
  });
}

export async function krakenClaim(ctx: Ctx, playerId: string, pct: number) {
  const now = ctx.now();
  return withPlayer(ctx, playerId, async (tx, row) => {
    const view = await krakenView(tx, now, playerId);
    const th = view?.thresholds.find((t) => t.pct === pct);
    if (!view || !th) throw new ApiFail('no_kraken');
    if (!th.reached) throw new ApiFail('kraken_not_reached');
    if (view.myDamage <= 0) throw new ApiFail('kraken_no_hits');
    const ins = await tx.insert(krakenClaims).values({ krakenId: view.id, playerId, pct }).onConflictDoNothing().returning();
    if (ins.length === 0) throw new ApiFail('kraken_claimed');
    grant(row, th.reward);
    return { player: await playerView(tx, row, now), reward: th.reward };
  });
}

// --- Admin/service operations ------------------------------------------------------------------------

export async function upsertLive(db: Q, kind: 'event' | 'kraken' | 'season', config: LiveEventConfig | KrakenConfig | SeasonConfig): Promise<void> {
  await db
    .insert(liveEvents)
    .values({ id: config.id, kind, config, startsAt: config.startsAt, endsAt: config.endsAt })
    .onConflictDoUpdate({ target: liveEvents.id, set: { config, startsAt: config.startsAt, endsAt: config.endsAt, kind } });
}

const WEEK = 7 * 86_400_000;

/** Monday 00:00 UTC of the week containing `ms`. */
export function weekStart(ms: number): number {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}

/**
 * Keeps the game alive without an operator: when nothing is scheduled, starts the next weekly event
 * from the default rotation, a Kraken and a monthly season. Admin-made entries always win.
 */
export async function ensureSchedule(ctx: Ctx): Promise<void> {
  const now = ctx.now();
  const start = weekStart(now);
  if (!(await currentEvent(ctx.db, now))) {
    const idx = Math.floor(start / WEEK) % DEFAULT_EVENTS.length;
    const base = DEFAULT_EVENTS[idx] as (typeof DEFAULT_EVENTS)[number];
    await upsertLive(ctx.db, 'event', { ...base, id: `${base.id}_${new Date(start).toISOString().slice(0, 10)}`, startsAt: start, endsAt: start + WEEK });
  }
  if (!(await currentKraken(ctx.db, now))) {
    const [active] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(players).where(gt(players.lastSeenAt, now - WEEK));
    const hpMax = Math.max(20_000, (active?.n ?? 0) * 6000);
    await upsertLive(ctx.db, 'kraken', { id: `kraken_${new Date(start).toISOString().slice(0, 10)}`, hpMax, startsAt: start, endsAt: start + WEEK, thresholds: KRAKEN_DEFAULT_THRESHOLDS });
  }
  if (!(await currentSeason(ctx.db, now))) {
    const d = new Date(now);
    const s = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const e = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    await upsertLive(ctx.db, 'season', { id: `season_${new Date(s).toISOString().slice(0, 7)}`, startsAt: s, endsAt: e });
  }
}

/** Finalises ended events, Krakens and seasons exactly once. */
export async function finalizeEnded(ctx: Ctx): Promise<number> {
  const now = ctx.now();
  const ended = await ctx.db.select().from(liveEvents).where(and(lte(liveEvents.endsAt, now), eq(liveEvents.finalized, false)));
  let done = 0;
  for (const ev of ended) {
    await ctx.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(liveEvents).where(and(eq(liveEvents.id, ev.id), eq(liveEvents.finalized, false))).for('update');
      if (!locked) return;
      if (ev.kind === 'event') {
        const cfg = ev.config as LiveEventConfig;
        const scores = await tx.select().from(eventScores).where(eq(eventScores.eventId, ev.id)).orderBy(desc(eventScores.score));
        let rank = 0;
        for (const s of scores) {
          rank += 1;
          const tier = cfg.rankRewards.find((r) => rank <= r.upTo);
          if (!tier) continue;
          const reward = tier.cosmetic ? { ...tier.reward, cosmetic: tier.cosmetic } : tier.reward;
          await addInbox(tx, now, s.playerId, 'event_result',
            { ru: `Итоги: ${cfg.title.ru}`, en: `Results: ${cfg.title.en}` },
            { ru: `Твоё место: ${rank}. Забери награду!`, en: `Your place: ${rank}. Claim your reward!` }, reward);
        }
      } else if (ev.kind === 'kraken') {
        const cfg = ev.config as KrakenConfig;
        const [sum] = await tx.select({ total: sql<number>`coalesce(sum(${krakenHits.damage}), 0)::float8` }).from(krakenHits).where(eq(krakenHits.krakenId, ev.id));
        if (Number(sum?.total ?? 0) >= cfg.hpMax) {
          const hitters = await tx.selectDistinct({ playerId: krakenHits.playerId }).from(krakenHits).where(eq(krakenHits.krakenId, ev.id));
          for (const h of hitters) {
            await addInbox(tx, now, h.playerId, 'kraken_down', { ru: 'Кракен повержен!', en: 'The Kraken is down!' },
              { ru: 'Риф победил. Спасибо за твой вклад!', en: 'The reef won. Thank you for your part!' }, { coral: 200, shine: 5 });
          }
        }
      } else {
        const ranked = await tx.select().from(players).where(gt(players.trophies, 0)).orderBy(desc(players.trophies)).for('update');
        let rank = 0;
        for (const p of ranked) {
          rank += 1;
          const league = leagueOf(p.profile.trophies);
          const cosmetic = rank === 1 ? 'title_reef_legend' : rank <= 10 ? 'title_gold_claw' : league === 'legend' || league === 'diamond' ? 'crab_abyss' : undefined;
          const idx = LEAGUES.findIndex((l) => l.id === league);
          const reward = cosmetic ? { coral: 100 * (idx + 1), cosmetic } : { coral: 100 * (idx + 1) };
          await addInbox(tx, now, p.id, 'season_result', { ru: 'Сезон завершён', en: 'Season finished' },
            { ru: `Твоё место в лиге: ${rank}.`, en: `Your league place: ${rank}.` }, reward);
          const trophies = seasonResetTrophies(p.profile.trophies);
          await tx.update(players).set({ profile: { ...p.profile, trophies }, trophies }).where(eq(players.id, p.id));
        }
      }
      await tx.update(liveEvents).set({ finalized: true }).where(eq(liveEvents.id, ev.id));
      done += 1;
    });
  }
  return done;
}

/** Queues a bot notification if the player opted in and was not notified about this recently. */
export async function notify(tx: Tx, ctx: Ctx, row: PlayerRow, kind: 'corf' | 'events' | 'kraken', text: { ru: string; en: string }, minGapMs: number): Promise<boolean> {
  const now = ctx.now();
  if (!row.tgId || row.botBlocked || !row.notify.enabled || !row.notify[kind]) return false;
  if (now - (row.notify.last[kind] ?? 0) < minGapMs) return false;
  row.notify = { ...row.notify, last: { ...row.notify.last, [kind]: now } };
  await tx.insert(outbox).values({
    id: randomId(), playerId: row.id, chatId: row.tgId, text: row.lang === 'en' ? text.en : text.ru,
    button: { text: row.lang === 'en' ? 'Play' : 'Играть', kind: 'webapp', url: ctx.config.publicUrl },
    status: 'queued', kind, notBefore: now, createdAt: now,
  });
  return true;
}
