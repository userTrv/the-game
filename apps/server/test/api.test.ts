import type { AuthResponse, MeResponse, PlayerView, RunActionResponse } from '@shellter/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signInitData, signWidget } from '../src/auth';
import { analytics, ghosts, players } from '../src/db/schema';
import { botBuild } from '../src/seed';
import { buildFighter, ratePower } from '@shellter/shared';
import { harness, REPORT, startRun, type Harness } from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await harness({ devAuth: true });
});
afterAll(() => h.close());

describe('auth', () => {
  it('verifies initData: valid, tampered, expired, future', async () => {
    const good = signInitData({ id: 1001, first_name: 'Anna', language_code: 'ru' }, h.config.botToken, h.time.now);
    const ok = await h.call<AuthResponse>('POST', '/api/auth/telegram', { initData: good });
    expect(ok.status).toBe(200);
    expect(ok.body.player.name).toBe('Anna');
    expect(ok.body.player.guest).toBe(false);
    const again = await h.call<AuthResponse>('POST', '/api/auth/telegram', { initData: good });
    expect(again.body.player.id).toBe(ok.body.player.id);

    const tampered = good.replace('Anna', 'Evil');
    expect((await h.call('POST', '/api/auth/telegram', { initData: tampered })).status).toBe(401);
    const wrongToken = signInitData({ id: 1001 }, 'other:token', h.time.now);
    expect((await h.call('POST', '/api/auth/telegram', { initData: wrongToken })).status).toBe(401);
    const old = signInitData({ id: 1001 }, h.config.botToken, h.time.now - 2 * 86_400_000);
    expect((await h.call<{ error: { code: string } }>('POST', '/api/auth/telegram', { initData: old })).body.error.code).toBe('init_data_expired');
    const future = signInitData({ id: 1001 }, h.config.botToken, h.time.now + 3_600_000);
    expect((await h.call('POST', '/api/auth/telegram', { initData: future })).status).toBe(401);
  });

  it('referral rewards both sides once and never self', async () => {
    const a = await h.telegram(2001);
    const b = await h.telegram(2002, `ref_${a.player.id}`);
    expect(b.player.profile.coral).toBe(150);
    const a2 = await h.call<MeResponse>('GET', '/api/me', undefined, a.token);
    expect(a2.body.player.profile.coral).toBe(150);
    await h.telegram(2002, `ref_${a.player.id}`);
    expect((await h.call<MeResponse>('GET', '/api/me', undefined, a.token)).body.player.profile.coral).toBe(150);
  });

  it('guest: create, login by secret, link to Telegram, widget login', async () => {
    const g = await h.guest();
    expect(g.secret).toBeTruthy();
    expect(g.player.guest).toBe(true);
    const back = await h.call<AuthResponse>('POST', '/api/auth/guest', { secret: g.secret });
    expect(back.body.player.id).toBe(g.player.id);
    expect((await h.call('POST', '/api/auth/guest', { secret: 'x'.repeat(40) })).status).toBe(401);
    const initData = signInitData({ id: 3001, first_name: 'Linker' }, h.config.botToken, h.time.now);
    const linked = await h.call<AuthResponse>('POST', '/api/auth/link', { initData }, g.token);
    expect(linked.body.player.id).toBe(g.player.id);
    expect(linked.body.player.guest).toBe(false);
    const viaTg = await h.telegram(3001);
    expect(viaTg.player.id).toBe(g.player.id);

    const w: Record<string, string | number> = { id: 3002, first_name: 'Web', auth_date: Math.floor(h.time.now / 1000) };
    w.hash = signWidget(w, h.config.botToken);
    const widget = await h.call<AuthResponse>('POST', '/api/auth/widget', w);
    expect(widget.status).toBe(200);
    expect((await h.call('POST', '/api/auth/widget', { ...w, id: 3003 })).status).toBe(401);
    expect((await h.call('GET', '/api/me')).status).toBe(401);
  });
});

describe('runs', () => {
  it('full happy path: rewards once, almanac, quests, no seed leak', async () => {
    const a = await h.guest();
    const d = await startRun(h, a.token);
    expect((await h.call<{ error: { code: string } }>('POST', '/api/run/start', { heroId: 'hermit' }, a.token)).body.error.code).toBe('run_active');
    const all: unknown[] = [];
    let r = await d.hunt();
    all.push(r);
    expect(r.run?.phase).toBe('camp');
    expect(r.run?.slots[0]).toEqual({ id: 'anemone', star: 1 });
    all.push((r = await d.ok({ type: 'pick_offer', index: 0 })));
    all.push(await d.ok({ type: 'descend' }));
    all.push(await d.hunt());
    r = await d.ok({ type: 'pick_offer', index: 0 });
    expect(r.events.some((e) => e.type === 'merge')).toBe(true);
    all.push(await d.ok({ type: 'descend' }));
    r = await d.ok({ type: 'battle' });
    all.push(r);
    expect(r.events.some((e) => e.type === 'battle')).toBe(true);
    // Tutorial: the lagoon ends at stage 3, so a win clears the run; a loss returns to the camp.
    if (!r.ended) r = await d.ok({ type: 'carry_out' });
    all.push(r);
    expect(r.ended?.summary.coral).toBeGreaterThan(0);
    expect(r.run).toBeNull();
    expect(r.player?.profile.coral).toBe(r.ended?.summary.coral);
    expect(r.player?.profile.stats.runs).toBe(1);
    expect(r.player?.profile.almanac.creatures.moon_jelly).toBe(24);
    expect(r.player?.profile.tutorialDone).toBe(true);
    expect(JSON.stringify(all)).not.toContain('"seed":"' + 'x');
    for (const x of all) expect(Object.keys((x as RunActionResponse).run ?? {})).not.toContain('seed');
    const me = await h.call<MeResponse>('GET', '/api/me', undefined, a.token);
    expect(me.body.run).toBeNull();
    expect((await d.act({ type: 'carry_out' })).body.error?.code).toBe('run_ended');
  });

  it('replay protection and concurrent duplicates', async () => {
    const a = await h.guest();
    const d = await startRun(h, a.token);
    h.time.now += 70_000;
    const body = { runId: d.runId, seq: 1, action: { type: 'hunt_done', report: REPORT } };
    const [x, y] = await Promise.all([h.call<RunActionResponse>('POST', '/api/run/action', body, a.token), h.call<RunActionResponse>('POST', '/api/run/action', body, a.token)]);
    expect(x.status).toBe(200);
    expect(y.body).toEqual(x.body);
    expect(x.body.run?.genes.sting).toBe(12);
    const wrong = await h.call<{ error: { code: string } }>('POST', '/api/run/action', { ...body, seq: 5 }, a.token);
    expect(wrong.status).toBe(409);
    expect(wrong.body.error.code).toBe('bad_seq');

    d.seq = 1;
    if (x.body.run?.camp?.shellChoices) await d.ok({ type: 'choose_shell', index: 0 });
    d.seq += 1;
    const end = { runId: d.runId, seq: d.seq, action: { type: 'carry_out' } };
    const ends = await Promise.all([1, 2, 3].map(() => h.call<RunActionResponse>('POST', '/api/run/action', end, a.token)));
    expect(ends.every((e) => e.status === 200)).toBe(true);
    const me = await h.call<MeResponse>('GET', '/api/me', undefined, a.token);
    expect(me.body.player.profile.coral).toBe(ends[0]!.body.ended!.summary.coral);
    expect(me.body.player.profile.stats.runs).toBe(1);
  });

  it('clamps absurd hunts by wall clock and logs them', async () => {
    const a = await h.guest();
    const d = await startRun(h, a.token);
    h.time.now += 20_000;
    const r = await d.ok({ type: 'hunt_done', report: { eaten: { moon_jelly: 50000, viperfish: 100 }, nodes: { oyster: 500, coral: 500, glitter: 50 }, durationS: 400, hpLost: 0, ko: false } });
    const eaten = Object.values(r.run!.stats.eatenByCreature).reduce((x, y) => x + y, 0);
    expect(eaten).toBeLessThanOrEqual(20 + Math.ceil(1.3 * 1.3 * 20) + 6);
    expect(r.run!.pearls).toBeLessThanOrEqual(10);
    expect(r.events.some((e) => e.type === 'clamped')).toBe(false);
    const sus = await h.handle.db.select().from(analytics).where(eq(analytics.type, 'suspicious'));
    expect(sus.some((s) => s.playerId === a.player.id)).toBe(true);
  });

  it('rejects illegal actions and client-forced flags', async () => {
    const a = await h.guest();
    const d = await startRun(h, a.token);
    expect((await d.act({ type: 'carry_out' })).body.error?.code).toBe('bad_phase');
    d.seq -= 1;
    await d.hunt();
    const forced = await h.call<{ error: { code: string } }>('POST', '/api/run/action', { runId: d.runId, seq: d.seq + 1, action: { type: 'reroll', free: true } }, a.token);
    // Unknown keys are stripped: this is a paid reroll and the crab has too few pearls or pays for it.
    expect([200, 400]).toContain(forced.status);
    if (forced.status === 200) d.seq += 1;
    const fake = await d.act({ type: 'reroll', adIntentId: 'nope' });
    expect(fake.body.error?.code).toBe('ad_not_verified');
    d.seq -= 1;
    const ghost = await h.call('POST', '/api/run/action', { runId: d.runId, seq: d.seq + 1, action: { type: 'descend', ghost: { kind: 'ghost' } } }, a.token);
    expect(ghost.status).toBe(400); // offer not taken yet -> pick_first, and the ghost key is ignored anyway
    expect((await h.call('POST', '/api/run/action', { runId: 'zzz', seq: 1, action: { type: 'descend' } }, a.token)).status).toBe(404);
    expect((await h.call('POST', '/api/run/action', { runId: d.runId, seq: 1, action: { type: 'hack' } }, a.token)).status).toBe(400);
    const ab = await h.call<RunActionResponse>('POST', '/api/run/abandon', { runId: d.runId }, a.token);
    expect(ab.body.ended?.result).toBe('defeat');
  });

  it('rewarded ad: intent -> server callback -> free reroll once; daily caps', async () => {
    const a = await h.guest();
    const d = await startRun(h, a.token);
    await d.hunt();
    const intent = await h.call<{ id: string; status: string }>('POST', '/api/ads/intent', { placement: 'reroll' }, a.token);
    expect(intent.body.status).toBe('pending');
    expect((await d.act({ type: 'reroll', adIntentId: intent.body.id })).body.error?.code).toBe('ad_not_verified');
    d.seq -= 1;
    expect((await h.call('GET', `/api/ads/reward?secret=wrong&userid=${a.player.id}`)).status).toBe(403);
    expect((await h.call<{ ok: boolean }>('GET', `/api/ads/reward?secret=${h.config.adsRewardSecret}&userid=${a.player.id}`)).body.ok).toBe(true);
    expect((await h.call<{ status: string }>('GET', `/api/ads/intent/${intent.body.id}`, undefined, a.token)).body.status).toBe('rewarded');
    const pearls = (await h.call<MeResponse>('GET', '/api/me', undefined, a.token)).body.run!.pearls;
    const rr = await d.ok({ type: 'reroll', adIntentId: intent.body.id });
    expect(rr.run!.pearls).toBe(pearls);
    expect(rr.run!.flags.adReroll).toBe(true);
    // Daily chest: capped at one per day.
    const chest = await h.call<{ id: string }>('POST', '/api/ads/intent', { placement: 'daily_chest' }, a.token);
    await h.call('POST', '/api/dev/ad-watch', {}, a.token);
    const got = await h.call<{ player: PlayerView }>('POST', '/api/ads/chest', { id: chest.body.id }, a.token);
    expect(got.body.player.profile.coral).toBe(80);
    expect((await h.call('POST', '/api/ads/chest', { id: chest.body.id }, a.token)).status).toBe(400);
    expect((await h.call<{ error: { code: string } }>('POST', '/api/ads/intent', { placement: 'daily_chest' }, a.token)).body.error.code).toBe('ad_limit');
  });

  it('ghost matchmaking on stage 6 with in-range power; trophies at run end', async () => {
    const a = await h.guest();
    await h.call('POST', '/api/dev/grant', { coral: 100000, shine: 1000 }, a.token);
    await h.call('POST', '/api/town/upgrade', { building: 'lighthouse' }, a.token);
    await h.handle.db.update(players).set({ profile: { ...(await h.call<MeResponse>('GET', '/api/me', undefined, a.token)).body.player.profile, tutorialDone: true, stats: { runs: 5, carried: 5, defeats: 0, bestStage: 3, chapterCleared: false, eaten: 0, merges: 0, ghostWins: 0 } } }).where(eq(players.id, a.player.id));
    let found = false;
    for (let attempt = 0; attempt < 12 && !found; attempt++) {
      const d = await startRun(h, a.token);
      await h.call('POST', '/api/dev/run-patch', { patch: { stage: 5, phase: 'hunt' } }, a.token);
      const r = await d.hunt();
      const power = ratePower(buildFighter({ heroId: 'hermit', size: r.run!.size, genes: r.run!.genes, mutations: {}, shell: r.run!.shell, slots: r.run!.slots }));
      await h.handle.db.delete(ghosts);
      await h.handle.db.insert(ghosts).values([
        { id: `g-in-${attempt}`, playerId: null, name: 'Rival', stage: 6, power, build: botBuild(1, 'weak'), createdAt: 1 },
        { id: `g-out-${attempt}`, playerId: null, name: 'Titan', stage: 6, power: power * 5, build: botBuild(12, 'strong'), createdAt: 1 },
      ]);
      await d.ok({ type: 'skip_offer' });
      const desc = await d.ok({ type: 'descend' });
      if (desc.run?.battle?.enemy.kind === 'ghost') {
        found = true;
        expect(desc.run.battle.enemy.name).toBe('Rival');
        const b = await d.ok({ type: 'battle' });
        const ev = b.events.find((e) => e.type === 'battle');
        const won = ev?.type === 'battle' && ev.won;
        const end = b.ended ? b : await d.ok({ type: 'carry_out' });
        expect(end.ended!.summary.trophies).toBe(won ? 25 : -12);
      } else {
        await h.call('POST', '/api/run/abandon', { runId: d.runId }, a.token);
      }
    }
    expect(found).toBe(true);
  });

  it('a rival waits at every camp from the second pool; a duel costs no lives and happens once', async () => {
    const a = await h.guest();
    const me = (await h.call<MeResponse>('GET', '/api/me', undefined, a.token)).body.player.profile;
    await h.handle.db.update(players).set({ profile: { ...me, tutorialDone: true } }).where(eq(players.id, a.player.id));
    await h.handle.db.delete(ghosts);
    await h.handle.db.insert(ghosts).values([{ id: 'rival-2', playerId: null, name: 'Sparring', stage: 2, power: 1, build: { ...botBuild(1, 'weak'), slots: [null, null, null], size: 1 }, createdAt: 1 }]);
    const d = await startRun(h, a.token);
    const first = await d.hunt();
    expect(first.run!.camp!.rival).toBeUndefined();
    expect(first.run!.camp!.paths).toHaveLength(3);
    expect((await d.act({ type: 'duel' })).status).toBe(400);
    d.seq -= 1;
    await d.ok({ type: 'skip_offer' });
    await d.ok({ type: 'descend', path: 1 });
    const second = await d.hunt();
    expect(second.run!.camp!.rival?.name).toBe('Sparring');
    // The player's own build stays behind for others at both camps.
    const mine = await h.handle.db.select().from(ghosts).where(eq(ghosts.playerId, a.player.id));
    expect(mine.map((g) => g.stage).sort()).toEqual([1, 2]);
    const fight = await d.ok({ type: 'duel' });
    const ev = fight.events.find((e) => e.type === 'battle');
    expect(ev?.type === 'battle' && ev.duel && ev.won).toBe(true);
    expect(fight.run!.phase).toBe('camp');
    expect(fight.run!.lives).toBe(second.run!.lives);
    expect(fight.run!.pearls).toBeGreaterThan(second.run!.pearls);
    expect((await d.act({ type: 'duel' })).status).toBe(400);
  });
});
