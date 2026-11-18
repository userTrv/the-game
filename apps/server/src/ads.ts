import { AD_DAILY_CAPS, AD_DAILY_TOTAL, AD_UNLOCK_BY_ID, DAILY_CHEST_REWARD, dayKey, type AdIntentView, type AdPlacement } from '@shellter/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import { randomId } from './auth';
import { ApiFail, grant, playerView, track, withPlayer, type Ctx, type PlayerRow } from './core';
import type { Tx } from './db';
import { adIntents, players } from './db/schema';

/**
 * Rewarded ads. The client asks for an intent, shows the ad, and the ad network calls our Reward
 * URL from its servers. Only that callback marks the intent as rewarded; the client callback is
 * never trusted. Players with "no ads" get the intent rewarded right away.
 */
export async function createIntent(ctx: Ctx, playerId: string, placement: AdPlacement): Promise<AdIntentView> {
  const now = ctx.now();
  const day = dayKey(now);
  return withPlayer(ctx, playerId, async (tx, row) => {
    const used = await tx
      .select({ placement: adIntents.placement, n: sql<number>`count(*)::int` })
      .from(adIntents)
      .where(and(eq(adIntents.playerId, playerId), eq(adIntents.day, day), sql`${adIntents.status} <> 'pending'`))
      .groupBy(adIntents.placement);
    // Cosmetic unlocks have their own cap and do not use up the daily rewards.
    const total = used.reduce((a, u) => (u.placement === 'unlock' ? a : a + u.n), 0);
    const mine = used.find((u) => u.placement === placement)?.n ?? 0;
    if ((placement !== 'unlock' && total >= AD_DAILY_TOTAL) || mine >= AD_DAILY_CAPS[placement]) throw new ApiFail('ad_limit');
    const id = randomId();
    const status = row.perks.noAds ? 'rewarded' : 'pending';
    await tx.insert(adIntents).values({ id, playerId, placement, status, day, createdAt: now, rewardedAt: row.perks.noAds ? now : null });
    return { id, placement, status };
  });
}

export async function intentView(ctx: Ctx, playerId: string, id: string): Promise<AdIntentView> {
  const [row] = await ctx.db.select().from(adIntents).where(and(eq(adIntents.id, id), eq(adIntents.playerId, playerId)));
  if (!row) throw new ApiFail('ad_not_found', 404);
  return { id: row.id, placement: row.placement as AdPlacement, status: row.status };
}

/**
 * Server-to-server reward callback. AdsGram calls `GET <Reward URL>?userid=[userId]` where userId is
 * the Telegram id; our URL also carries a secret. The newest pending intent of that player is rewarded.
 */
export async function rewardCallback(ctx: Ctx, secret: string, userId: string): Promise<boolean> {
  if (!ctx.config.adsRewardSecret || secret !== ctx.config.adsRewardSecret) throw new ApiFail('forbidden', 403);
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const tg = Number(userId);
    const [player] = await tx.select({ id: players.id }).from(players).where(Number.isSafeInteger(tg) && /^\d+$/.test(userId) ? eq(players.tgId, tg) : eq(players.id, userId));
    if (!player) return false;
    const [intent] = await tx
      .select()
      .from(adIntents)
      .where(and(eq(adIntents.playerId, player.id), eq(adIntents.status, 'pending')))
      .orderBy(desc(adIntents.createdAt))
      .limit(1)
      .for('update');
    // Intents older than 10 minutes cannot belong to the ad that just finished.
    if (!intent || now - intent.createdAt > 10 * 60_000) return false;
    await tx.update(adIntents).set({ status: 'rewarded', rewardedAt: now }).where(eq(adIntents.id, intent.id));
    await track(tx, now, player.id, 'ad_reward', { placement: intent.placement });
    return true;
  });
}

/** Spends a rewarded intent of the given placement. Returns false when it is not valid. */
export async function consumeAd(tx: Tx, ctx: Ctx, row: PlayerRow, intentId: string, placement: AdPlacement): Promise<boolean> {
  const [intent] = await tx.select().from(adIntents).where(and(eq(adIntents.id, intentId), eq(adIntents.playerId, row.id))).for('update');
  if (!intent || intent.placement !== placement || intent.status !== 'rewarded') return false;
  await tx.update(adIntents).set({ status: 'consumed' }).where(eq(adIntents.id, intentId));
  return true;
}

export async function dailyChest(ctx: Ctx, playerId: string, adIntentId: string) {
  const now = ctx.now();
  return withPlayer(ctx, playerId, async (tx, row) => {
    if (!(await consumeAd(tx, ctx, row, adIntentId, 'daily_chest'))) throw new ApiFail('ad_not_verified');
    grant(row, DAILY_CHEST_REWARD);
    return { player: await playerView(tx, row, now), reward: DAILY_CHEST_REWARD };
  });
}

/** One rewarded ad towards a cosmetic; the last required view unlocks it. */
export async function adUnlock(ctx: Ctx, playerId: string, id: string, adIntentId: string) {
  const now = ctx.now();
  return withPlayer(ctx, playerId, async (tx, row) => {
    const def = AD_UNLOCK_BY_ID.get(id);
    if (!def) throw new ApiFail('unlock_unknown');
    if (row.cosmetics.owned.includes(def.grant.id)) throw new ApiFail('unlock_owned');
    if (!(await consumeAd(tx, ctx, row, adIntentId, 'unlock'))) throw new ApiFail('ad_not_verified');
    const views = { ...(row.cosmetics.adViews ?? {}) };
    const n = (views[id] ?? 0) + 1;
    const unlocked = n >= def.views;
    if (unlocked) {
      delete views[id];
      grant(row, { cosmetic: def.grant.id });
    } else views[id] = n;
    row.cosmetics = { ...row.cosmetics, adViews: views };
    if (unlocked) await track(tx, now, playerId, 'ad_unlock', { id });
    return { player: await playerView(tx, row, now), unlocked };
  });
}
