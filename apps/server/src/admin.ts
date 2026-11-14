import { DIETS, type KrakenConfig, type LiveEventConfig } from '@shellter/shared';
import { and, desc, eq, gte, ilike, inArray, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { safeEqual, signSession, verifySession } from './auth';
import { ApiFail, grant, playerView, withPlayer, type Ctx } from './core';
import { analytics, broadcasts, liveEvents, payments, players, runs, type SeasonConfig } from './db/schema';
import { upsertLive } from './liveops';
import { broadcastReport, createBroadcast, segmentSize } from './outbox';
import { refundPayment } from './shop';

const DAY = 86_400_000;
const dayOf = (ms: number) => Math.floor(ms / DAY);

const LocalText = z.object({ ru: z.string().max(3500), en: z.string().max(3500) });
const SegmentSchema = z.object({ kind: z.enum(['all', 'inactive', 'event', 'payers']), days: z.number().int().min(1).max(365).optional(), eventId: z.string().max(64).optional() });
const ButtonSchema = z.object({ text: z.string().min(1).max(40), kind: z.enum(['webapp', 'url']), url: z.string().url().max(300) });
const BroadcastBody = z.object({ segment: SegmentSchema, text: LocalText, button: ButtonSchema.nullable().optional(), scheduledAt: z.number().optional() });
const LiveBody = z.object({ kind: z.enum(['event', 'kraken', 'season']), config: z.record(z.string(), z.unknown()) });

async function dashboard(ctx: Ctx) {
  const now = ctx.now();
  const today = dayOf(now);
  const since = (today - 45) * DAY;
  const activity = await ctx.db
    .select({ playerId: analytics.playerId, day: sql<number>`floor(${analytics.ts} / 86400000)::int` })
    .from(analytics)
    .where(and(gte(analytics.ts, since), sql`${analytics.playerId} is not null`))
    .groupBy(analytics.playerId, sql`floor(${analytics.ts} / 86400000)`);
  const byPlayer = new Map<string, Set<number>>();
  const byDay = new Map<number, Set<string>>();
  for (const a of activity) {
    if (!a.playerId) continue;
    (byPlayer.get(a.playerId) ?? byPlayer.set(a.playerId, new Set()).get(a.playerId)!).add(a.day);
    (byDay.get(a.day) ?? byDay.set(a.day, new Set()).get(a.day)!).add(a.playerId);
  }
  const dau = byDay.get(today)?.size ?? 0;
  const mauSet = new Set<string>();
  for (let d = today - 29; d <= today; d++) for (const p of byDay.get(d) ?? []) mauSet.add(p);
  const cohort = await ctx.db.select({ id: players.id, createdAt: players.createdAt, paidStars: players.paidStars }).from(players).where(gte(players.createdAt, since));
  const retention = (n: number): { rate: number; cohort: number } => {
    let eligible = 0;
    let back = 0;
    for (const p of cohort) {
      const d0 = dayOf(p.createdAt);
      if (d0 + n > today) continue;
      eligible += 1;
      if (byPlayer.get(p.id)?.has(d0 + n)) back += 1;
    }
    return { rate: eligible ? back / eligible : 0, cohort: eligible };
  };
  const dauSeries = Array.from({ length: 14 }, (_, i) => ({ day: new Date((today - 13 + i) * DAY).toISOString().slice(0, 10), dau: byDay.get(today - 13 + i)?.size ?? 0 }));

  const [sess] = await ctx.db
    .select({ avg: sql<number>`coalesce(avg((${analytics.props}->>'seconds')::float8), 0)::float8`, n: sql<number>`count(*)::int` })
    .from(analytics)
    .where(and(eq(analytics.type, 'session_end'), gte(analytics.ts, now - 7 * DAY)));

  const steps = await ctx.db
    .select({ step: sql<string>`${analytics.props}->>'step'`, n: sql<number>`count(distinct ${analytics.playerId})::int` })
    .from(analytics)
    .where(and(eq(analytics.type, 'tutorial_step'), gte(analytics.ts, now - 30 * DAY)))
    .groupBy(sql`${analytics.props}->>'step'`);

  const ends = await ctx.db.select({ props: analytics.props }).from(analytics).where(and(eq(analytics.type, 'run_end'), gte(analytics.ts, now - 14 * DAY))).orderBy(desc(analytics.ts)).limit(5000);
  const builds: Record<string, { runs: number; stageSum: number; success: number }> = {};
  for (const e of ends) {
    const p = e.props ?? {};
    const diets = (p.diets ?? {}) as Record<string, number>;
    let top = 'none';
    let best = 0;
    for (const d of DIETS) if ((diets[d] ?? 0) > best) { best = diets[d] ?? 0; top = d; }
    const key = `${String(p.hero ?? '?')}/${top}`;
    const b = builds[key] ?? (builds[key] = { runs: 0, stageSum: 0, success: 0 });
    b.runs += 1;
    b.stageSum += Number(p.stage ?? 0);
    if (p.result !== 'defeat') b.success += 1;
  }
  const battles = await ctx.db
    .select({ hero: sql<string>`${analytics.props}->>'hero'`, won: sql<number>`(count(*) filter (where (${analytics.props}->>'won')::boolean))::int`, n: sql<number>`count(*)::int` })
    .from(analytics)
    .where(and(eq(analytics.type, 'battle'), gte(analytics.ts, now - 14 * DAY)))
    .groupBy(sql`${analytics.props}->>'hero'`);

  const [rev] = await ctx.db
    .select({ stars: sql<number>`coalesce(sum(${payments.stars}), 0)::int`, n: sql<number>`count(*)::int`, payers: sql<number>`count(distinct ${payments.playerId})::int` })
    .from(payments)
    .where(and(eq(payments.status, 'paid'), gte(payments.paidAt, now - 30 * DAY)));
  const [revToday] = await ctx.db.select({ stars: sql<number>`coalesce(sum(${payments.stars}), 0)::int` }).from(payments).where(and(eq(payments.status, 'paid'), gte(payments.paidAt, today * DAY)));
  const [ads] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(analytics).where(and(eq(analytics.type, 'ad_reward'), gte(analytics.ts, now - 30 * DAY)));
  const [adsToday] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(analytics).where(and(eq(analytics.type, 'ad_reward'), gte(analytics.ts, today * DAY)));
  const [total] = await ctx.db.select({ n: sql<number>`count(*)::int`, payers: sql<number>`(count(*) filter (where ${players.paidStars} > 0))::int` }).from(players);
  const [suspicious] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(analytics).where(and(eq(analytics.type, 'suspicious'), gte(analytics.ts, now - 7 * DAY)));

  return {
    dau, mau: mauSet.size, dauSeries,
    retention: { d1: retention(1), d7: retention(7), d30: retention(30) },
    session: { avgSeconds: Math.round(sess?.avg ?? 0), count: sess?.n ?? 0 },
    funnel: steps.filter((s) => s.step).sort((a, b) => b.n - a.n),
    builds: Object.entries(builds).map(([key, b]) => ({ key, runs: b.runs, avgStage: b.stageSum / b.runs, successRate: b.success / b.runs })).sort((a, b) => b.runs - a.runs).slice(0, 30),
    battles: battles.map((b) => ({ hero: b.hero, winRate: b.n ? b.won / b.n : 0, battles: b.n })),
    revenue: { stars30d: rev?.stars ?? 0, purchases30d: rev?.n ?? 0, payers30d: rev?.payers ?? 0, starsToday: revToday?.stars ?? 0, arpdauStars: dau ? (revToday?.stars ?? 0) / dau : 0 },
    ads: { rewards30d: ads?.n ?? 0, rewardsToday: adsToday?.n ?? 0 },
    players: { total: total?.n ?? 0, payers: total?.payers ?? 0, conversion: total?.n ? (total.payers ?? 0) / total.n : 0 },
    suspicious7d: suspicious?.n ?? 0,
  };
}

export function registerAdmin(app: FastifyInstance, ctx: Ctx): void {
  app.post('/admin/api/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { password } = z.object({ password: z.string().max(200) }).parse(req.body);
    if (!ctx.config.adminPassword || !safeEqual(password, ctx.config.adminPassword)) throw new ApiFail('forbidden', 403);
    return { token: await signSession('admin', ctx.config.jwtSecret, 'admin') };
  });

  app.register(async (admin) => {
    admin.addHook('preHandler', async (req) => {
      const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      const session = token ? await verifySession(token, ctx.config.jwtSecret) : null;
      if (!ctx.config.adminPassword || !session || session.role !== 'admin') throw new ApiFail('forbidden', 403);
    });

    admin.get('/dashboard', () => dashboard(ctx));

    admin.get('/players', async (req) => {
      const { q } = z.object({ q: z.string().max(64).default('') }).parse(req.query);
      const tg = /^\d+$/.test(q) ? Number(q) : null;
      const where = q ? or(eq(players.id, q), ilike(players.name, `%${q.replace(/[%_]/g, '')}%`), ...(tg !== null ? [eq(players.tgId, tg)] : [])) : undefined;
      const rows = await ctx.db.select().from(players).where(where).orderBy(desc(players.lastSeenAt)).limit(50);
      return { players: rows.map((p) => ({ id: p.id, name: p.name, tgId: p.tgId, guest: p.guest, lang: p.lang, coral: p.profile.coral, shine: p.profile.shine, trophies: p.trophies, runs: p.profile.stats.runs, bestStage: p.profile.stats.bestStage, paidStars: p.paidStars, createdAt: p.createdAt, lastSeenAt: p.lastSeenAt, botBlocked: p.botBlocked })) };
    });

    admin.get('/players/:id', async (req) => {
      const { id } = z.object({ id: z.string().max(64) }).parse(req.params);
      const [p] = await ctx.db.select().from(players).where(eq(players.id, id));
      if (!p) throw new ApiFail('not_found', 404);
      const lastRuns = await ctx.db.select({ id: runs.id, heroId: runs.heroId, status: runs.status, result: runs.result, stage: runs.stageReached, startedAt: runs.startedAt }).from(runs).where(eq(runs.playerId, id)).orderBy(desc(runs.startedAt)).limit(20);
      const pays = await ctx.db.select().from(payments).where(eq(payments.playerId, id)).orderBy(desc(payments.createdAt)).limit(50);
      return { player: await playerView(ctx.db, p, ctx.now()), tgId: p.tgId, paidStars: p.paidStars, runs: lastRuns, payments: pays };
    });

    admin.post('/players/:id/grant', async (req) => {
      const { id } = z.object({ id: z.string().max(64) }).parse(req.params);
      const body = z.object({ coral: z.number().int().optional(), shine: z.number().int().optional(), cosmetic: z.string().max(40).optional() }).parse(req.body);
      return withPlayer(ctx, id, async (tx, row) => {
        grant(row, body);
        return { player: await playerView(tx, row, ctx.now()) };
      });
    });

    admin.get('/live', async () => ({ items: await ctx.db.select().from(liveEvents).orderBy(desc(liveEvents.startsAt)).limit(100) }));
    admin.post('/live', async (req) => {
      const { kind, config } = LiveBody.parse(req.body);
      const base = z.object({ id: z.string().min(1).max(64), startsAt: z.number(), endsAt: z.number() }).parse(config);
      if (base.endsAt <= base.startsAt) throw new ApiFail('bad_request');
      await upsertLive(ctx.db, kind, config as unknown as LiveEventConfig | KrakenConfig | SeasonConfig);
      return { ok: true };
    });
    admin.delete('/live/:id', async (req) => {
      const { id } = z.object({ id: z.string().max(64) }).parse(req.params);
      await ctx.db.delete(liveEvents).where(eq(liveEvents.id, id));
      return { ok: true };
    });

    admin.post('/broadcasts/preview', async (req) => {
      const body = BroadcastBody.parse(req.body);
      return { recipients: await segmentSize(ctx, body.segment), text: body.text, button: body.button ?? null };
    });
    admin.post('/broadcasts', async (req) => {
      const body = BroadcastBody.parse(req.body);
      const id = await createBroadcast(ctx, { segment: body.segment, text: body.text, button: body.button ?? null, scheduledAt: body.scheduledAt ?? ctx.now() });
      return { id };
    });
    admin.get('/broadcasts', async () => {
      const rows = await ctx.db.select().from(broadcasts).orderBy(desc(broadcasts.createdAt)).limit(50);
      const out = [];
      for (const b of rows) out.push({ ...b, report: await broadcastReport(ctx, b.id) });
      return { broadcasts: out };
    });
    admin.post('/broadcasts/:id/cancel', async (req) => {
      const { id } = z.object({ id: z.string().max(64) }).parse(req.params);
      await ctx.db.update(broadcasts).set({ status: 'cancelled' }).where(and(eq(broadcasts.id, id), eq(broadcasts.status, 'scheduled')));
      return { ok: true };
    });

    admin.get('/payments', async () => ({ payments: await ctx.db.select().from(payments).where(inArray(payments.status, ['paid', 'refunded'])).orderBy(desc(payments.createdAt)).limit(100) }));
    admin.post('/payments/:id/refund', async (req) => {
      const { id } = z.object({ id: z.string().max(64) }).parse(req.params);
      return refundPayment(ctx, id);
    });
  }, { prefix: '/admin/api' });
}
