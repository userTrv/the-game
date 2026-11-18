import type { InboxItem, LiveopsView, MeResponse, PlayerView, RunActionResponse } from '@shellter/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { liveEvents, outbox, players } from '../src/db/schema';
import { runJobs } from '../src/jobs';
import { finalizeEnded, upsertLive } from '../src/liveops';
import { seedDev } from '../src/seed';
import { harness, startRun, type Harness } from './helpers';

let h: Harness;
const SECRET = { 'x-internal-secret': 'test-internal' };
type P = { player: PlayerView };
type Err = { error: { code: string } };

beforeAll(async () => {
  h = await harness({ devAuth: true });
  await seedDev(h.app.ctx);
});
afterAll(() => h.close());

async function playRun(token: string): Promise<RunActionResponse> {
  const d = await startRun(h, token);
  await d.hunt();
  return d.ok({ type: 'carry_out' });
}

describe('town and meta', () => {
  it('upgrade, talent, hero, corf with clock, almanac, quests, pass, cosmetics', async () => {
    const a = await h.guest();
    expect((await h.call<Err>('POST', '/api/town/upgrade', { building: 'corf' }, a.token)).body.error.code).toBe('upgrade_coral');
    await h.call('POST', '/api/dev/grant', { coral: 5000, shine: 200 }, a.token);
    let p = (await h.call<P>('POST', '/api/town/upgrade', { building: 'corf' }, a.token)).body.player;
    expect(p.profile.buildings.corf).toBe(1);
    expect(p.profile.coral).toBe(4950);
    expect((await h.call<Err>('POST', '/api/town/talent', { id: 'tough_shell' }, a.token)).body.error.code).toBe('talent_locked');
    await h.call('POST', '/api/town/upgrade', { building: 'school' }, a.token);
    p = (await h.call<P>('POST', '/api/town/talent', { id: 'tough_shell' }, a.token)).body.player;
    expect(p.profile.talents.tough_shell).toBe(1);
    expect((await h.call<Err>('POST', '/api/town/hero', { heroId: 'mantis' }, a.token)).body.error.code).toBe('hero_locked');
    await h.call('POST', '/api/town/upgrade', { building: 'hatchery' }, a.token);
    await h.call('POST', '/api/town/upgrade', { building: 'hatchery' }, a.token);
    p = (await h.call<P>('POST', '/api/town/hero', { heroId: 'decorator' }, a.token)).body.player;
    expect(p.profile.heroId).toBe('decorator');

    h.time.now += 3 * 3_600_000;
    const before = (await h.call<MeResponse>('GET', '/api/me', undefined, a.token)).body.player;
    expect(before.corf.amount).toBe(36);
    const col = await h.call<P & { gained: number }>('POST', '/api/corf/collect', {}, a.token);
    expect(col.body.gained).toBe(36);
    expect(col.body.player.corf.amount).toBe(0);

    const end = await playRun(a.token);
    expect(end.ended).toBeDefined();
    // Quests: force-complete one through the stored state and claim it once.
    const [row] = await h.handle.db.select().from(players).where(eq(players.id, a.player.id));
    const q = row!.quests!;
    q.daily[0]!.progress = 99999;
    // The run above may have finished the second quest by chance; this test needs it open.
    q.daily[1]!.progress = 0;
    await h.handle.db.update(players).set({ quests: q }).where(eq(players.id, a.player.id));
    const claim = await h.call<P & { reward: { passXp: number } }>('POST', '/api/quests/claim', { id: q.daily[0]!.id }, a.token);
    expect(claim.status).toBe(200);
    expect(claim.body.player.pass.xp).toBe(claim.body.reward.passXp);
    expect((await h.call<Err>('POST', '/api/quests/claim', { id: q.daily[0]!.id }, a.token)).body.error.code).toBe('quest_claimed');
    expect((await h.call<Err>('POST', '/api/quests/claim', { id: q.daily[1]!.id }, a.token)).body.error.code).toBe('quest_incomplete');

    expect((await h.call<Err>('POST', '/api/pass/claim', { level: 1, track: 'free' }, a.token)).body.error.code).toBe('pass_locked');
    await h.handle.db.update(players).set({ pass: { ...claim.body.player.pass, xp: 250 } }).where(eq(players.id, a.player.id));
    expect((await h.call('POST', '/api/pass/claim', { level: 1, track: 'free' }, a.token)).status).toBe(200);
    expect((await h.call<Err>('POST', '/api/pass/claim', { level: 1, track: 'free' }, a.token)).body.error.code).toBe('pass_claimed');
    expect((await h.call<Err>('POST', '/api/pass/claim', { level: 1, track: 'premium' }, a.token)).body.error.code).toBe('pass_premium');

    expect((await h.call<Err>('POST', '/api/cosmetics/equip', { id: 'crab_azure' }, a.token)).body.error.code).toBe('cosmetic_locked');
    expect((await h.call<Err>('POST', '/api/almanac/claim', { id: 'guardians_4' }, a.token)).body.error.code).toBe('milestone_locked');
  });
});

describe('live-ops', () => {
  it('event scores and ranking, Kraken limits and claims, finalisation once, season reset', async () => {
    const a = await h.guest();
    const b = await h.guest();
    const endA = await playRun(a.token);
    expect(endA.ended?.eventScore).toBeGreaterThan(0);
    await playRun(b.token);
    await playRun(b.token);
    const live = (await h.call<LiveopsView>('GET', '/api/liveops', undefined, a.token)).body;
    expect(live.event?.myScore).toBe(endA.ended?.eventScore);
    expect(live.event?.myRank).toBe(2);
    expect(live.event?.top[0]?.score).toBeGreaterThan(live.event!.myScore);
    expect(live.kraken?.attacksLeft).toBe(3);

    const fresh = await h.guest();
    expect((await h.call<Err>('POST', '/api/kraken/attack', {}, fresh.token)).body.error.code).toBe('no_build');
    let dealt = 0;
    for (let i = 0; i < 3; i++) {
      const r = await h.call<{ damage: number; kraken: { attacksLeft: number } }>('POST', '/api/kraken/attack', {}, a.token);
      expect(r.status).toBe(200);
      dealt += r.body.damage;
      expect(r.body.kraken.attacksLeft).toBe(2 - i);
    }
    expect(dealt).toBeGreaterThan(0);
    expect((await h.call<Err>('POST', '/api/kraken/attack', {}, a.token)).body.error.code).toBe('no_attacks');
    expect((await h.call<Err>('POST', '/api/kraken/claim', { pct: 25 }, a.token)).body.error.code).toBe('kraken_not_reached');
    // Shrink the Kraken so the community threshold is reached.
    const [k] = await h.handle.db.select().from(liveEvents).where(eq(liveEvents.kind, 'kraken'));
    await upsertLive(h.handle.db, 'kraken', { ...(k!.config as object), hpMax: Math.max(1, Math.floor(dealt * 2)) } as never);
    const claim = await h.call<P>('POST', '/api/kraken/claim', { pct: 25 }, a.token);
    expect(claim.status).toBe(200);
    expect((await h.call<Err>('POST', '/api/kraken/claim', { pct: 25 }, a.token)).body.error.code).toBe('kraken_claimed');
    expect((await h.call<Err>('POST', '/api/kraken/claim', { pct: 25 }, b.token)).body.error.code).toBe('kraken_no_hits');

    await h.call('POST', '/api/dev/grant', { trophies: 300 }, a.token);
    h.time.now += 40 * 86_400_000;
    expect(await finalizeEnded(h.app.ctx)).toBeGreaterThanOrEqual(3);
    expect(await finalizeEnded(h.app.ctx)).toBe(0);
    const inboxA = (await h.call<{ items: InboxItem[] }>('GET', '/api/inbox', undefined, a.token)).body.items;
    const result = inboxA.find((i) => i.kind === 'event_result');
    expect(result?.reward?.coral).toBeGreaterThan(0);
    const coral = (await h.call<MeResponse>('GET', '/api/me', undefined, a.token)).body.player;
    expect(coral.profile.trophies).toBe(150);
    expect(coral.inboxUnread).toBeGreaterThan(0);
    const got = await h.call<P>('POST', '/api/inbox/claim', { id: result!.id }, a.token);
    expect(got.body.player.profile.coral).toBe(coral.profile.coral + result!.reward!.coral!);
    expect((await h.call('POST', '/api/inbox/claim', { id: result!.id }, a.token)).status).toBe(400);
    await runJobs(h.app.ctx);
    expect((await h.call<LiveopsView>('GET', '/api/liveops', undefined, a.token)).body.event).not.toBeNull();
  });
});

describe('cosmetics for rewarded ads', () => {
  it('each verified ad counts once; the last one unlocks; owned items refuse more views', async () => {
    const a = await h.guest();
    const watch = async (): Promise<string> => {
      // The ad network rewards the newest pending intent; the test clock must move between them.
      h.time.now += 1000;
      const intent = await h.call<{ id: string }>('POST', '/api/ads/intent', { placement: 'unlock' }, a.token);
      await h.call('POST', '/api/dev/ad-watch', {}, a.token);
      return intent.body.id;
    };
    // An intent without a watched ad is not accepted.
    const raw = await h.call<{ id: string }>('POST', '/api/ads/intent', { placement: 'unlock' }, a.token);
    expect((await h.call<Err>('POST', '/api/ads/unlock', { id: 'crab_azure', adIntentId: raw.body.id }, a.token)).body.error.code).toBe('ad_not_verified');
    let res: P & { unlocked: boolean } = { player: a.player, unlocked: false };
    for (let i = 0; i < 5; i++) {
      const id = await watch();
      res = (await h.call<P & { unlocked: boolean }>('POST', '/api/ads/unlock', { id: 'crab_azure', adIntentId: id }, a.token)).body;
      expect(res.unlocked).toBe(i === 4);
      if (i < 4) expect(res.player.adUnlocks.crab_azure).toBe(i + 1);
      // The same intent cannot be spent twice.
      expect((await h.call<Err>('POST', '/api/ads/unlock', { id: 'crab_azure', adIntentId: id }, a.token)).status).toBe(400);
    }
    expect(res.player.cosmetics.owned).toContain('crab_azure');
    expect(res.player.adUnlocks.crab_azure).toBeUndefined();
    expect((await h.call('POST', '/api/cosmetics/equip', { id: 'crab_azure' }, a.token)).status).toBe(200);
    expect((await h.call<Err>('POST', '/api/ads/unlock', { id: 'crab_azure', adIntentId: await watch() }, a.token)).body.error.code).toBe('unlock_owned');
    expect((await h.call<Err>('POST', '/api/ads/unlock', { id: 'no_such', adIntentId: 'x' }, a.token)).body.error.code).toBe('unlock_unknown');
    // Unlock views do not eat into the daily ad rewards.
    const me = (await h.call<MeResponse>('GET', '/api/me', undefined, a.token)).body.player;
    expect(me.adsToday.unlock).toBe(6);
    expect((await h.call('POST', '/api/ads/intent', { placement: 'daily_chest' }, a.token)).status).toBe(200);
  });
});

describe('bot integration, broadcasts and admin', () => {
  it('internal start/settings, broadcast queue with throttled claims, 403 and 429 handling, dashboard', async () => {
    expect((await h.call('POST', '/internal/bot/start', { tgUser: { id: 8001 } })).status).toBe(401);
    const s = await h.call<{ isNew: boolean; lang: string }>('POST', '/internal/bot/start', { tgUser: { id: 8001, first_name: 'Bob', language_code: 'en' } }, undefined, SECRET);
    expect(s.body).toMatchObject({ isNew: true, lang: 'en' });
    await h.call('POST', '/internal/bot/start', { tgUser: { id: 8002, first_name: 'Вера', language_code: 'ru' } }, undefined, SECRET);
    const set = await h.call<{ settings: { corf: boolean } }>('POST', '/internal/bot/notify-settings', { tgId: 8001, set: { corf: false } }, undefined, SECRET);
    expect(set.body.settings.corf).toBe(false);

    const admin = (await h.call<{ token: string }>('POST', '/admin/api/login', { password: h.config.adminPassword })).body.token;
    expect((await h.call('POST', '/admin/api/login', { password: 'bad' })).status).toBe(403);
    await h.handle.db.delete(outbox);
    const bc = { segment: { kind: 'all' }, text: { ru: 'Привет, риф!', en: 'Hello, reef!' }, button: { text: 'Play', kind: 'webapp', url: 'https://game.test' } };
    const preview = await h.call<{ recipients: number }>('POST', '/admin/api/broadcasts/preview', bc, admin);
    expect(preview.body.recipients).toBeGreaterThanOrEqual(2);
    const later = await h.call<{ id: string }>('POST', '/admin/api/broadcasts', { ...bc, scheduledAt: h.time.now + 3_600_000 }, admin);
    await runJobs(h.app.ctx);
    expect((await h.call<{ messages: unknown[] }>('POST', '/internal/outbox/claim', { limit: 30 }, undefined, SECRET)).body.messages.filter((m) => (m as { text: string }).text.includes('риф') || (m as { text: string }).text.includes('reef'))).toHaveLength(0);
    h.time.now += 3_700_000;
    await runJobs(h.app.ctx);
    const claimed = (await h.call<{ messages: { id: string; chatId: number; text: string; button?: { kind: string } }[] }>('POST', '/internal/outbox/claim', { limit: 100 }, undefined, SECRET)).body.messages.filter((m) => /риф!|reef!/.test(m.text));
    expect(claimed.length).toBe(preview.body.recipients);
    const en = claimed.find((m) => m.chatId === 8001)!;
    const ru = claimed.find((m) => m.chatId === 8002)!;
    expect(en.text).toBe('Hello, reef!');
    expect(ru.text).toBe('Привет, риф!');
    expect(en.button?.kind).toBe('webapp');
    // Claimed messages are not handed out twice.
    expect((await h.call<{ messages: { text: string }[] }>('POST', '/internal/outbox/claim', { limit: 100 }, undefined, SECRET)).body.messages.filter((m) => /риф!|reef!/.test(m.text))).toHaveLength(0);
    const rest = claimed.filter((m) => m !== en && m !== ru).map((m) => ({ id: m.id, status: 'sent' as const }));
    await h.call('POST', '/internal/outbox/report', { results: [{ id: en.id, status: 'blocked', error: 'Forbidden' }, { id: ru.id, status: 'retry', retryAfter: 30 }, ...rest] }, undefined, SECRET);
    const [blocked] = await h.handle.db.select().from(players).where(eq(players.tgId, 8001));
    expect(blocked!.botBlocked).toBe(true);
    expect((await h.call<{ messages: unknown[] }>('POST', '/internal/outbox/claim', { limit: 100 }, undefined, SECRET)).body.messages).toHaveLength(0);
    h.time.now += 31_000;
    const retry = (await h.call<{ messages: { id: string }[] }>('POST', '/internal/outbox/claim', { limit: 100 }, undefined, SECRET)).body.messages;
    expect(retry.map((m) => m.id)).toEqual([ru.id]);
    await h.call('POST', '/internal/outbox/report', { results: [{ id: ru.id, status: 'sent' }] }, undefined, SECRET);
    const list = await h.call<{ broadcasts: { id: string; total: number; report: Record<string, number> }[] }>('GET', '/admin/api/broadcasts', undefined, admin);
    const mine = list.body.broadcasts.find((b) => b.id === later.body.id)!;
    expect(mine.report.blocked).toBe(1);
    expect(mine.report.sent).toBe(mine.total - 1);
    // Blocked players are excluded from later broadcasts.
    expect((await h.call<{ recipients: number }>('POST', '/admin/api/broadcasts/preview', bc, admin)).body.recipients).toBe(preview.body.recipients - 1);

    const dash = await h.call<{ dau: number; players: { total: number }; revenue: { stars30d: number }; retention: { d1: { rate: number } } }>('GET', '/admin/api/dashboard', undefined, admin);
    expect(dash.status).toBe(200);
    expect(dash.body.players.total).toBeGreaterThan(3);
    const found = await h.call<{ players: { id: string }[] }>('GET', '/admin/api/players?q=8002', undefined, admin);
    expect(found.body.players).toHaveLength(1);
    expect((await h.call('GET', `/admin/api/players/${found.body.players[0]!.id}`, undefined, admin)).status).toBe(200);
    expect((await h.call('GET', '/admin/api/dashboard')).status).toBe(403);
  });

  it('corf-full trigger notification respects opt-in and the frequency cap', async () => {
    const a = await h.telegram(9001);
    await h.call('POST', '/api/dev/grant', { coral: 100 }, a.token);
    await h.call('POST', '/api/town/upgrade', { building: 'corf' }, a.token);
    await h.handle.db.delete(outbox);
    h.time.now += 9 * 3_600_000;
    await runJobs(h.app.ctx);
    const q1 = await h.handle.db.select().from(outbox).where(eq(outbox.playerId, a.player.id));
    expect(q1.filter((m) => m.kind === 'corf')).toHaveLength(1);
    h.time.now += 3_600_000;
    await runJobs(h.app.ctx);
    expect((await h.handle.db.select().from(outbox).where(eq(outbox.playerId, a.player.id))).filter((m) => m.kind === 'corf')).toHaveLength(1);
    await h.call('POST', '/api/me/notify', { corf: false }, a.token);
    h.time.now += 30 * 3_600_000;
    await runJobs(h.app.ctx);
    expect((await h.handle.db.select().from(outbox).where(eq(outbox.playerId, a.player.id))).filter((m) => m.kind === 'corf')).toHaveLength(1);
  });
});
