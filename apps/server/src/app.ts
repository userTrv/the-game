import { existsSync } from 'node:fs';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import {
  AdIntentBody, AnalyticsBody, applyQuestDeltas, AuthGuestBody, AuthTelegramBody, AuthWidgetBody, buyTalent, claimMilestone,
  collectCorf, CORF_BOOST_MULT, CorfBody, COSMETIC_BY_ID, DoubleLootBody, GardenBody, HeroBody, IdBody, InvoiceBody, KrakenClaimBody, MetaError,
  NotifyBody, PASS_LEVELS, PASS_REWARDS, PASS_XP_PER_LEVEL, PassClaimBody, QUEST_BY_ID, RunActionBody, RunIdBody, selectHero,
  SettingsBody, setGardenOff, StartRunBody, UpgradeBody, upgradeBuilding,
  type AuthResponse, type InboxItem, type MeResponse,
} from '@shellter/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import { registerAdmin } from './admin';
import { consumeAd, createIntent, dailyChest, intentView, rewardCallback } from './ads';
import { AuthError, randomId, safeEqual, sha256, signInitData, signSession, verifyInitData, verifySession, verifyWidget, type TgUser } from './auth';
import type { Config } from './config';
import {
  ApiFail, applyReferral, createPlayer, grant, lockPlayer, ownedCosmetics, playerView, refreshPlayer, savePlayer, track, withPlayer,
  type BotClient, type Ctx, type PlayerRow,
} from './core';
import type { Db, Tx } from './db';
import { inbox, players, runs } from './db/schema';
import { krakenAttack, krakenClaim, liveopsView } from './liveops';
import { claimOutbox, reportOutbox } from './outbox';
import { abandonRun, activePublicRun, doubleLoot, runAction, startNewRun } from './runs';
import { createInvoice, orderView, preCheckout, shopView, successfulPayment } from './shop';

export interface AppDeps {
  db: Db;
  config: Config;
  now?: () => number;
  bot?: BotClient | null;
}

const ANALYTICS_TYPES = new Set(['session_start', 'session_end', 'tutorial_step', 'screen', 'share', 'ad_view', 'purchase_open', 'client_error', 'fps_report']);

declare module 'fastify' {
  interface FastifyRequest {
    playerId?: string;
  }
}

export function buildApp(deps: AppDeps): FastifyInstance & { ctx: Ctx; clock: { offset: number } } {
  const clock = { offset: 0 };
  const baseNow = deps.now ?? Date.now;
  const ctx: Ctx = { db: deps.db, config: deps.config, now: () => baseNow() + clock.offset, bot: deps.bot ?? null };
  const cfg = deps.config;

  const app = Fastify({
    logger: cfg.logLevel === 'silent' ? false : { level: cfg.logLevel, redact: ['req.headers.authorization', 'req.headers["x-internal-secret"]'] },
    bodyLimit: 64 * 1024,
    trustProxy: true,
    genReqId: (req) => String(req.headers['x-request-id'] ?? randomId(6)),
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof ApiFail) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    if (err instanceof MetaError) return reply.status(400).send({ error: { code: err.code, message: err.code } });
    if (err instanceof AuthError) return reply.status(401).send({ error: { code: err.code, message: err.code } });
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return reply.status(400).send({ error: { code: 'bad_request', message: first ? `${first.path.join('.')}: ${first.message}` : 'bad request' } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: { code: status === 429 ? 'rate_limited' : 'bad_request', message: status === 429 ? 'too many requests' : 'bad request' } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'internal', message: 'internal error' } });
  });

  void app.register(cors, { origin: cfg.devAuth && cfg.corsOrigins.length === 0 ? true : cfg.corsOrigins.length > 0 ? cfg.corsOrigins : false });

  // Resolve the session early so the rate limiter can key by player.
  app.addHook('onRequest', async (req) => {
    const h = req.headers.authorization;
    if (h?.startsWith('Bearer ')) {
      const s = await verifySession(h.slice(7), cfg.jwtSecret);
      if (s && s.role === 'player') req.playerId = s.sub;
    }
  });
  if (cfg.rateLimit > 0) {
    void app.register(rateLimit, { max: cfg.rateLimit, timeWindow: '1 minute', keyGenerator: (req) => req.playerId ?? req.ip });
  }
  const authLimit = cfg.rateLimit > 0 ? { config: { rateLimit: { max: Math.min(20, cfg.rateLimit), timeWindow: '1 minute' } } } : {};

  // Routes live in a child plugin so that cors and the rate limiter are loaded before them.
  void app.register(async (r) => {
  const me = (req: FastifyRequest): string => {
    if (!req.playerId) throw new ApiFail('unauthorized', 401);
    return req.playerId;
  };

  const authResponse = async (tx: Tx, row: PlayerRow, secret?: string): Promise<AuthResponse> => {
    const now = ctx.now();
    row.lastSeenAt = now;
    refreshPlayer(row, now);
    await savePlayer(tx, row);
    const out: AuthResponse = { token: await signSession(row.id, cfg.jwtSecret), player: await playerView(tx, row, now), run: await activePublicRun(tx, row.id) };
    if (secret) out.secret = secret;
    return out;
  };

  const upsertTelegram = async (tx: Tx, user: TgUser, startParam?: string): Promise<{ row: PlayerRow; isNew: boolean }> => {
    const [existing] = await tx.select().from(players).where(eq(players.tgId, user.id)).for('update');
    if (existing) return { row: existing, isNew: false };
    const row = await createPlayer(tx, ctx.now(), { tg: user });
    await applyReferral(tx, ctx.now(), row, startParam);
    return { row, isNew: true };
  };

  r.get('/health', async () => ({ ok: true }));
  r.get('/api/health', async () => ({ ok: true }));
  r.get('/ready', async () => {
    await ctx.db.select({ id: players.id }).from(players).limit(1);
    return { ok: true };
  });

  // --- Auth ------------------------------------------------------------------------------------
  r.post('/api/auth/telegram', authLimit, async (req) => {
    const { initData } = AuthTelegramBody.parse(req.body);
    const { user, startParam } = verifyInitData(initData, cfg.botToken, ctx.now(), cfg.initDataMaxAgeS);
    return ctx.db.transaction(async (tx) => authResponse(tx, (await upsertTelegram(tx, user, startParam)).row));
  });

  r.post('/api/auth/guest', authLimit, async (req) => {
    const { secret } = AuthGuestBody.parse(req.body ?? {});
    return ctx.db.transaction(async (tx) => {
      if (secret) {
        const [row] = await tx.select().from(players).where(eq(players.guestHash, sha256(secret))).for('update');
        if (!row) throw new ApiFail('unauthorized', 401);
        return authResponse(tx, row);
      }
      const fresh = randomId(32);
      return authResponse(tx, await createPlayer(tx, ctx.now(), { guestHash: sha256(fresh) }), fresh);
    });
  });

  r.post('/api/auth/widget', authLimit, async (req) => {
    const data = AuthWidgetBody.parse(req.body);
    const user = verifyWidget(data, cfg.botToken, ctx.now(), cfg.initDataMaxAgeS);
    return ctx.db.transaction(async (tx) => {
      // A logged-in guest binds the Telegram account to the current progress.
      if (req.playerId) {
        const row = await lockPlayer(tx, req.playerId);
        const [taken] = await tx.select().from(players).where(eq(players.tgId, user.id)).for('update');
        if (taken) return authResponse(tx, taken);
        if (row.guest) {
          row.tgId = user.id;
          row.guest = false;
          if (user.first_name) row.name = user.first_name.slice(0, 24);
          return authResponse(tx, row);
        }
      }
      return authResponse(tx, (await upsertTelegram(tx, user)).row);
    });
  });

  r.post('/api/auth/link', authLimit, async (req) => {
    const id = me(req);
    const { initData } = AuthTelegramBody.parse(req.body);
    const { user } = verifyInitData(initData, cfg.botToken, ctx.now(), cfg.initDataMaxAgeS);
    return ctx.db.transaction(async (tx) => {
      const row = await lockPlayer(tx, id);
      const [taken] = await tx.select().from(players).where(eq(players.tgId, user.id)).for('update');
      if (taken) return authResponse(tx, taken);
      row.tgId = user.id;
      row.guest = false;
      if (user.first_name) row.name = user.first_name.slice(0, 24);
      return authResponse(tx, row);
    });
  });

  // --- Player ----------------------------------------------------------------------------------
  r.get('/api/me', async (req): Promise<MeResponse> =>
    withPlayer(ctx, me(req), async (tx, row) => {
      const now = ctx.now();
      row.lastSeenAt = now;
      return { player: await playerView(tx, row, now), run: await activePublicRun(tx, row.id), liveops: await liveopsView(tx, now, row) };
    }),
  );

  r.post('/api/me/settings', async (req) => {
    const body = SettingsBody.parse(req.body);
    return withPlayer(ctx, me(req), async (tx, row) => {
      if (body.lang) row.lang = body.lang;
      if (body.name) row.name = body.name;
      return { player: await playerView(tx, row, ctx.now()) };
    });
  });

  r.get('/api/me/notify', async (req) => {
    const [row] = await ctx.db.select().from(players).where(eq(players.id, me(req)));
    if (!row) throw new ApiFail('unauthorized', 401);
    const { enabled, corf, events, kraken } = row.notify;
    return { settings: { enabled, corf, events, kraken }, telegram: row.tgId !== null && !row.botBlocked };
  });
  r.post('/api/me/notify', async (req) => {
    const body = NotifyBody.parse(req.body);
    return withPlayer(ctx, me(req), async (_tx, row) => {
      row.notify = { ...row.notify, ...body };
      const { enabled, corf, events, kraken } = row.notify;
      return { settings: { enabled, corf, events, kraken } };
    });
  });

  // --- Runs ------------------------------------------------------------------------------------
  r.post('/api/run/start', async (req) => {
    const body = StartRunBody.parse(req.body);
    return startNewRun(ctx, me(req), body.heroId, body.slot ?? 0);
  });
  r.post('/api/run/action', async (req) => {
    const body = RunActionBody.parse(req.body);
    return runAction(ctx, me(req), body.runId, body.seq, body.action);
  });
  r.post('/api/run/abandon', async (req) => abandonRun(ctx, me(req), RunIdBody.parse(req.body).runId));
  r.post('/api/run/double', async (req) => {
    const body = DoubleLootBody.parse(req.body);
    return doubleLoot(ctx, me(req), body.runId, body.adIntentId);
  });

  // --- Town and meta ---------------------------------------------------------------------------
  const meta = <T>(req: FastifyRequest, fn: (tx: Tx, row: PlayerRow, now: number) => Promise<T> | T) =>
    withPlayer(ctx, me(req), async (tx, row) => {
      const now = ctx.now();
      refreshPlayer(row, now);
      const extra = await fn(tx, row, now);
      return { ...(extra as object), player: await playerView(tx, row, now) };
    });

  r.post('/api/town/upgrade', async (req) => {
    const { building } = UpgradeBody.parse(req.body);
    return meta(req, async (tx, row, now) => {
      row.profile = upgradeBuilding(row.profile, building);
      if (row.quests) row.quests = applyQuestDeltas(row.quests, { upgrade: 1 });
      await track(tx, now, row.id, 'upgrade', { building, level: row.profile.buildings[building] });
      return {};
    });
  });
  r.post('/api/town/talent', async (req) => {
    const { id } = IdBody.parse(req.body);
    return meta(req, (_tx, row) => {
      row.profile = buyTalent(row.profile, id);
      return {};
    });
  });
  r.post('/api/town/hero', async (req) => {
    const { heroId } = HeroBody.parse(req.body);
    return meta(req, (_tx, row) => {
      row.profile = selectHero(row.profile, heroId);
      return {};
    });
  });
  r.post('/api/town/garden', async (req) => {
    const { off } = GardenBody.parse(req.body);
    return meta(req, (_tx, row) => {
      row.profile = setGardenOff(row.profile, off);
      return {};
    });
  });
  r.post('/api/corf/collect', async (req) => {
    const { adIntentId } = CorfBody.parse(req.body ?? {});
    return meta(req, async (tx, row, now) => {
      let mult = 1;
      if (adIntentId) {
        if (!(await consumeAd(tx, ctx, row, adIntentId, 'corf_boost'))) throw new ApiFail('ad_not_verified');
        mult = CORF_BOOST_MULT;
      }
      const res = collectCorf(row.profile, now, mult);
      row.profile = res.profile;
      return { gained: res.gained };
    });
  });
  r.post('/api/almanac/claim', async (req) => {
    const { id } = IdBody.parse(req.body);
    return meta(req, (_tx, row) => {
      const res = claimMilestone(row.profile, id);
      row.profile = res.profile;
      return { reward: res.reward };
    });
  });
  r.post('/api/quests/claim', async (req) => {
    const { id } = IdBody.parse(req.body);
    return meta(req, (_tx, row) => {
      const def = QUEST_BY_ID.get(id);
      const q = row.quests;
      const list = def && q ? (def.period === 'daily' ? q.daily : q.weekly) : [];
      const entry = list.find((x) => x.id === id);
      if (!def || !q || !entry) throw new ApiFail('quest_unknown');
      if (entry.claimed) throw new ApiFail('quest_claimed');
      if (entry.progress < def.need) throw new ApiFail('quest_incomplete');
      const mark = (l: typeof q.daily) => l.map((x) => (x.id === id ? { ...x, claimed: true } : x));
      row.quests = { ...q, daily: mark(q.daily), weekly: mark(q.weekly) };
      grant(row, def.reward);
      row.pass = { ...row.pass, xp: Math.min(PASS_LEVELS * PASS_XP_PER_LEVEL, row.pass.xp + def.reward.passXp) };
      return { reward: def.reward };
    });
  });
  r.post('/api/pass/claim', async (req) => {
    const { level, track: lane } = PassClaimBody.parse(req.body);
    return meta(req, (_tx, row) => {
      const def = PASS_REWARDS.find((r) => r.level === level);
      if (!def) throw new ApiFail('pass_unknown');
      if (Math.floor(row.pass.xp / PASS_XP_PER_LEVEL) < level) throw new ApiFail('pass_locked');
      if (lane === 'free') {
        if (row.pass.claimedFree.includes(level)) throw new ApiFail('pass_claimed');
        row.pass = { ...row.pass, claimedFree: [...row.pass.claimedFree, level] };
        grant(row, def.free);
      } else {
        if (!row.pass.premium) throw new ApiFail('pass_premium');
        if (row.pass.claimedPremium.includes(level)) throw new ApiFail('pass_claimed');
        row.pass = { ...row.pass, claimedPremium: [...row.pass.claimedPremium, level] };
        grant(row, def.premium);
      }
      return {};
    });
  });
  r.post('/api/cosmetics/equip', async (req) => {
    const { id } = IdBody.parse(req.body);
    return meta(req, (_tx, row) => {
      const def = COSMETIC_BY_ID.get(id);
      if (!def || !ownedCosmetics(row.cosmetics).includes(id)) throw new ApiFail('cosmetic_locked');
      const current = row.cosmetics.equipped[def.kind];
      // Tapping the equipped title takes it off.
      row.cosmetics = { ...row.cosmetics, equipped: { ...row.cosmetics.equipped, [def.kind]: def.kind === 'title' && current === id ? '' : id } };
      return {};
    });
  });

  // --- Live-ops --------------------------------------------------------------------------------
  r.get('/api/liveops', async (req) => {
    const [row] = await ctx.db.select().from(players).where(eq(players.id, me(req)));
    if (!row) throw new ApiFail('unauthorized', 401);
    return liveopsView(ctx.db, ctx.now(), row);
  });
  r.post('/api/kraken/attack', async (req) => krakenAttack(ctx, me(req)));
  r.post('/api/kraken/claim', async (req) => krakenClaim(ctx, me(req), KrakenClaimBody.parse(req.body).pct));

  // --- Inbox -----------------------------------------------------------------------------------
  r.get('/api/inbox', async (req) => {
    const rows = await ctx.db.select().from(inbox).where(eq(inbox.playerId, me(req))).orderBy(desc(inbox.createdAt)).limit(50);
    const items: InboxItem[] = rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, reward: r.reward, createdAt: r.createdAt, claimed: r.claimedAt !== null }));
    return { items };
  });
  r.post('/api/inbox/claim', async (req) => {
    const { id } = IdBody.parse(req.body);
    return meta(req, async (tx, row, now) => {
      const [item] = await tx.select().from(inbox).where(and(eq(inbox.id, id), eq(inbox.playerId, row.id), isNull(inbox.claimedAt))).for('update');
      if (!item) throw new ApiFail('inbox_claimed');
      await tx.update(inbox).set({ claimedAt: now }).where(eq(inbox.id, id));
      grant(row, item.reward);
      return { reward: item.reward };
    });
  });

  // --- Shop (Telegram Stars) -------------------------------------------------------------------
  r.get('/api/shop', async (req) => {
    const [row] = await ctx.db.select().from(players).where(eq(players.id, me(req)));
    if (!row) throw new ApiFail('unauthorized', 401);
    return shopView(ctx, row);
  });
  r.post('/api/shop/invoice', async (req) => createInvoice(ctx, me(req), InvoiceBody.parse(req.body).productId));
  r.get('/api/shop/order/:id', async (req) => orderView(ctx, me(req), z.object({ id: z.string().max(64) }).parse(req.params).id));

  // --- Rewarded ads ----------------------------------------------------------------------------
  r.post('/api/ads/intent', async (req) => createIntent(ctx, me(req), AdIntentBody.parse(req.body).placement));
  r.get('/api/ads/intent/:id', async (req) => intentView(ctx, me(req), z.object({ id: z.string().max(64) }).parse(req.params).id));
  r.post('/api/ads/chest', async (req) => dailyChest(ctx, me(req), IdBody.parse(req.body).id));
  // Reward URL for the ad network: GET /api/ads/reward?secret=...&userid=[userId]
  r.get('/api/ads/reward', async (req) => {
    const q = z.object({ secret: z.string().max(200), userid: z.string().max(64) }).parse(req.query);
    return { ok: await rewardCallback(ctx, q.secret, q.userid) };
  });

  // --- Analytics -------------------------------------------------------------------------------
  r.post('/api/analytics', async (req) => {
    const id = me(req);
    const body = AnalyticsBody.parse(req.body);
    const now = ctx.now();
    for (const e of body.events) {
      if (!ANALYTICS_TYPES.has(e.type)) continue;
      const props = e.props && JSON.stringify(e.props).length <= 2000 ? e.props : undefined;
      await track(ctx.db, now, id, e.type, props, body.sessionId);
    }
    await ctx.db.update(players).set({ lastSeenAt: now }).where(eq(players.id, id));
    return { ok: true };
  });

  // --- Internal API (bot -> server) --------------------------------------------------------------
  void r.register(async (internal) => {
    internal.addHook('preHandler', async (req) => {
      if (!safeEqual(String(req.headers['x-internal-secret'] ?? ''), cfg.internalSecret)) throw new ApiFail('unauthorized', 401);
    });
    const TgUserSchema = z.object({ id: z.number().int(), first_name: z.string().optional(), last_name: z.string().optional(), username: z.string().optional(), language_code: z.string().optional() });

    internal.post('/bot/start', async (req) => {
      const body = z.object({ tgUser: TgUserSchema, startParam: z.string().max(64).optional() }).parse(req.body);
      return ctx.db.transaction(async (tx) => {
        const { row, isNew } = await upsertTelegram(tx, body.tgUser as TgUser, body.startParam);
        // Writing to the bot again means the user unblocked it.
        row.botBlocked = false;
        await savePlayer(tx, row);
        return { ok: true, isNew, lang: row.lang };
      });
    });
    internal.post('/bot/notify-settings', async (req) => {
      const body = z.object({ tgId: z.number().int(), set: NotifyBody.optional() }).parse(req.body);
      return ctx.db.transaction(async (tx) => {
        const { row } = await upsertTelegram(tx, { id: body.tgId });
        if (body.set) row.notify = { ...row.notify, ...body.set };
        await savePlayer(tx, row);
        const { enabled, corf, events, kraken } = row.notify;
        return { ok: true, settings: { enabled, corf, events, kraken }, lang: row.lang };
      });
    });
    const Pay = z.object({ tgId: z.number().int(), payload: z.string().max(128), currency: z.string().max(8), totalAmount: z.number().int() });
    internal.post('/payments/pre-checkout', async (req) => preCheckout(ctx, Pay.parse(req.body)));
    internal.post('/payments/successful', async (req) => {
      const body = Pay.extend({ telegramPaymentChargeId: z.string().min(1).max(256), providerPaymentChargeId: z.string().optional() }).parse(req.body);
      return successfulPayment(ctx, { payload: body.payload, currency: body.currency, totalAmount: body.totalAmount, chargeId: body.telegramPaymentChargeId });
    });
    internal.post('/outbox/claim', async (req) => ({ messages: await claimOutbox(ctx, z.object({ limit: z.number().int().min(1).max(100) }).parse(req.body).limit) }));
    internal.post('/outbox/report', async (req) => {
      const body = z.object({ results: z.array(z.object({ id: z.string(), status: z.enum(['sent', 'blocked', 'retry', 'failed']), retryAfter: z.number().optional(), error: z.string().max(500).optional() })).max(200) }).parse(req.body);
      await reportOutbox(ctx, body.results);
      return { ok: true };
    });
  }, { prefix: '/internal' });

  registerAdmin(r, ctx);

  // --- Dev helpers (mock mode only) ------------------------------------------------------------
  if (cfg.devAuth) {
    r.post('/api/dev/init-data', async (req) => {
      const body = z.object({ user: z.object({ id: z.number().int(), first_name: z.string().optional(), username: z.string().optional(), language_code: z.string().optional() }), startParam: z.string().optional() }).parse(req.body);
      return { initData: signInitData(body.user as TgUser, cfg.botToken, ctx.now(), body.startParam) };
    });
    r.post('/api/dev/grant', async (req) => {
      const body = z.object({ coral: z.number().int().optional(), shine: z.number().int().optional(), trophies: z.number().int().optional() }).parse(req.body);
      return meta(req, (_tx, row) => {
        grant(row, body);
        if (body.trophies) row.profile = { ...row.profile, trophies: Math.max(0, row.profile.trophies + body.trophies) };
        return {};
      });
    });
    r.post('/api/dev/reset', async (req) => {
      const id = me(req);
      return withPlayer(ctx, id, async (tx, row) => {
        const now = ctx.now();
        const fresh = await createPlayer(tx, now, {});
        await tx.delete(players).where(eq(players.id, fresh.id));
        await tx.delete(runs).where(eq(runs.playerId, id));
        Object.assign(row, { profile: fresh.profile, quests: null, cosmetics: fresh.cosmetics, pass: fresh.pass, perks: fresh.perks, lastBuild: null });
        return { player: await playerView(tx, row, now) };
      });
    });
    r.post('/api/dev/time-travel', async (req) => {
      clock.offset += z.object({ ms: z.number() }).parse(req.body).ms;
      return { now: ctx.now() };
    });
    r.post('/api/dev/run-patch', async (req) => {
      const { patch } = z.object({ patch: z.record(z.string(), z.unknown()) }).parse(req.body);
      const [run] = await ctx.db.select().from(runs).where(and(eq(runs.playerId, me(req)), eq(runs.status, 'active')));
      if (!run) throw new ApiFail('run_not_found', 404);
      await ctx.db.update(runs).set({ state: { ...run.state, ...patch } as typeof run.state }).where(eq(runs.id, run.id));
      return { ok: true };
    });
    // Mock ad network: "plays" the ad and calls the Reward URL server-side, like AdsGram does.
    r.post('/api/dev/ad-watch', async (req) => ({ ok: await rewardCallback(ctx, cfg.adsRewardSecret, me(req)) }));
  }

  // --- Static client and admin panel -----------------------------------------------------------
  if (cfg.adminDist && existsSync(cfg.adminDist)) {
    void r.register(fastifyStatic, { root: cfg.adminDist, prefix: '/admin/', decorateReply: false });
  }
  if (cfg.clientDist && existsSync(cfg.clientDist)) {
    void r.register(fastifyStatic, {
      root: cfg.clientDist,
      setHeaders(res, path) {
        res.setHeader('cache-control', /\/assets\//.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    r.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/internal/') && !req.url.startsWith('/admin/')) return reply.sendFile('index.html');
      return reply.status(404).send({ error: { code: 'not_found', message: 'not found' } });
    });
  } else {
    r.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: 'not_found', message: 'not found' } }));
  }

  });

  return Object.assign(app, { ctx, clock });
}
