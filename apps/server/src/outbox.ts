import { corfState } from '@shellter/shared';
import { and, asc, eq, gt, inArray, isNotNull, lt, lte, or, sql } from 'drizzle-orm';
import { randomId } from './auth';
import { lockPlayer, savePlayer, type Ctx } from './core';
import { broadcasts, eventScores, outbox, players, type OutboxButton, type Segment } from './db/schema';
import { currentEvent, currentKraken, notify } from './liveops';

const CLAIM_TTL = 60_000;

export interface OutboxMessage {
  id: string;
  chatId: number;
  text: string;
  button?: OutboxButton;
}

/** Hands queued messages to the bot; claimed ones return to the queue if the bot never reports. */
export async function claimOutbox(ctx: Ctx, limit: number): Promise<OutboxMessage[]> {
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(outbox)
      .where(or(and(eq(outbox.status, 'queued'), lte(outbox.notBefore, now)), and(eq(outbox.status, 'claimed'), lt(outbox.claimedAt, now - CLAIM_TTL))))
      .orderBy(asc(outbox.notBefore))
      .limit(Math.max(1, Math.min(100, limit)))
      .for('update');
    if (rows.length === 0) return [];
    await tx.update(outbox).set({ status: 'claimed', claimedAt: now, attempts: sql`${outbox.attempts} + 1` }).where(inArray(outbox.id, rows.map((r) => r.id)));
    return rows.map((r) => (r.button ? { id: r.id, chatId: r.chatId, text: r.text, button: r.button } : { id: r.id, chatId: r.chatId, text: r.text }));
  });
}

export interface OutboxResult {
  id: string;
  status: 'sent' | 'blocked' | 'retry' | 'failed';
  retryAfter?: number;
  error?: string;
}

export async function reportOutbox(ctx: Ctx, results: OutboxResult[]): Promise<void> {
  const now = ctx.now();
  for (const r of results) {
    await ctx.db.transaction(async (tx) => {
      const [row] = await tx.select().from(outbox).where(eq(outbox.id, r.id)).for('update');
      if (!row || row.status !== 'claimed') return;
      if (r.status === 'retry') {
        // Give up after 5 attempts so a broken message cannot loop forever.
        if (row.attempts >= 5) await tx.update(outbox).set({ status: 'failed', error: r.error ?? 'too many attempts', doneAt: now }).where(eq(outbox.id, r.id));
        else await tx.update(outbox).set({ status: 'queued', notBefore: now + Math.max(1, r.retryAfter ?? 5) * 1000, error: r.error ?? null }).where(eq(outbox.id, r.id));
        return;
      }
      await tx.update(outbox).set({ status: r.status, error: r.error ?? null, doneAt: now }).where(eq(outbox.id, r.id));
      if (r.status === 'blocked') {
        // The user blocked the bot: never message them again and drop what is still queued.
        await tx.update(players).set({ botBlocked: true }).where(eq(players.id, row.playerId));
        await tx.update(outbox).set({ status: 'blocked', doneAt: now }).where(and(eq(outbox.playerId, row.playerId), eq(outbox.status, 'queued')));
      }
    });
  }
}

function segmentWhere(seg: Segment, now: number) {
  const base = and(isNotNull(players.tgId), eq(players.botBlocked, false));
  switch (seg.kind) {
    case 'inactive':
      return and(base, lt(players.lastSeenAt, now - (seg.days ?? 7) * 86_400_000));
    case 'payers':
      return and(base, gt(players.paidStars, 0));
    case 'event':
      return and(base, inArray(players.id, sql`(select ${eventScores.playerId} from ${eventScores} where ${eventScores.eventId} = ${seg.eventId ?? ''})`));
    default:
      return base;
  }
}

export async function segmentSize(ctx: Ctx, seg: Segment): Promise<number> {
  const [c] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(players).where(segmentWhere(seg, ctx.now()));
  return c?.n ?? 0;
}

export async function createBroadcast(ctx: Ctx, input: { segment: Segment; text: { ru: string; en: string }; button: OutboxButton | null; scheduledAt: number }): Promise<string> {
  const id = randomId();
  await ctx.db.insert(broadcasts).values({ id, segment: input.segment, text: input.text, button: input.button, scheduledAt: input.scheduledAt, status: 'scheduled', createdAt: ctx.now() });
  return id;
}

/** Expands due broadcasts into outbox rows (one per recipient, in the recipient's language). */
export async function dispatchBroadcasts(ctx: Ctx): Promise<number> {
  const now = ctx.now();
  const due = await ctx.db.select().from(broadcasts).where(and(eq(broadcasts.status, 'scheduled'), lte(broadcasts.scheduledAt, now)));
  let queued = 0;
  for (const b of due) {
    await ctx.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(broadcasts).where(and(eq(broadcasts.id, b.id), eq(broadcasts.status, 'scheduled'))).for('update');
      if (!locked) return;
      const targets = await tx.select({ id: players.id, tgId: players.tgId, lang: players.lang }).from(players).where(segmentWhere(b.segment, now));
      for (let i = 0; i < targets.length; i += 500) {
        const chunk = targets.slice(i, i + 500);
        await tx.insert(outbox).values(chunk.map((t) => ({
          id: randomId(), playerId: t.id, chatId: t.tgId as number, text: t.lang === 'en' ? b.text.en || b.text.ru : b.text.ru || b.text.en,
          button: b.button, status: 'queued' as const, kind: 'broadcast', broadcastId: b.id, notBefore: now, createdAt: now,
        })));
      }
      await tx.update(broadcasts).set({ status: 'queued', total: targets.length }).where(eq(broadcasts.id, b.id));
      queued += targets.length;
    });
  }
  return queued;
}

export async function broadcastReport(ctx: Ctx, id: string): Promise<Record<string, number>> {
  const rows = await ctx.db.select({ status: outbox.status, n: sql<number>`count(*)::int` }).from(outbox).where(eq(outbox.broadcastId, id)).groupBy(outbox.status);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r.n;
  return out;
}

const DAY = 86_400_000;

/** Opt-in trigger notifications with frequency caps: corf full, event started, Kraken defeated. */
export async function triggerNotifications(ctx: Ctx): Promise<number> {
  const now = ctx.now();
  let sent = 0;
  const candidates = await ctx.db
    .select({ id: players.id })
    .from(players)
    .where(and(isNotNull(players.tgId), eq(players.botBlocked, false), gt(players.lastSeenAt, now - 14 * DAY), lt(players.lastSeenAt, now - 30 * 60_000)))
    .limit(2000);
  const ev = await currentEvent(ctx.db, now);
  const kraken = await currentKraken(ctx.db, now);
  for (const c of candidates) {
    await ctx.db.transaction(async (tx) => {
      const row = await lockPlayer(tx, c.id);
      let ok = false;
      if (corfState(row.profile, now).full) {
        ok = await notify(tx, ctx, row, 'corf', { ru: '🦀 Садок полон! Забери кораллы, пока не перелилось.', en: '🦀 The corf is full! Collect your coral.' }, DAY);
      }
      if (!ok && ev && now - ev.config.startsAt < DAY && (row.notify.last.events ?? 0) < ev.config.startsAt) {
        ok = await notify(tx, ctx, row, 'events', { ru: `🌊 Началось событие «${ev.config.title.ru}». ${ev.config.description.ru}`, en: `🌊 Event started: ${ev.config.title.en}. ${ev.config.description.en}` }, DAY);
      }
      if (!ok && kraken && row.lastBuild && now - kraken.config.startsAt < DAY && (row.notify.last.kraken ?? 0) < kraken.config.startsAt) {
        ok = await notify(tx, ctx, row, 'kraken', { ru: '🐙 Кракен вернулся! Весь риф бьёт его вместе — загляни.', en: '🐙 The Kraken is back! The whole reef fights it together.' }, DAY);
      }
      if (ok) {
        sent += 1;
        await savePlayer(tx, row);
      }
    });
  }
  return sent;
}
