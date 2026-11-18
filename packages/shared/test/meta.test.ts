import { describe, expect, it } from 'vitest';
import {
  applyQuestDeltas, applyRunAction, applyRunEnd, buyTalent, claimMilestone, collectCorf, corfState, leagueOf, MetaError, newProfile,
  questDeltasForRun, refreshQuests, runConfigFor, startRun, upgradeBlocker, upgradeBuilding, weekKey, dayKey, AD_UNLOCKS, COSMETIC_BY_ID, botGhosts, BOT_STAGES, eventGoals, DEFAULT_EVENTS,
} from '../src';

describe('meta progression', () => {
  it('first run is a tutorial limited to the lagoon with the starter tenant', () => {
    const cfg = runConfigFor(newProfile(0), 'hermit');
    expect(cfg.maxStage).toBe(3);
    expect(cfg.tutorial).toBe(true);
    expect(cfg.starterTenant).toBe('anemone');
    expect(cfg.tenantPool.length).toBeGreaterThanOrEqual(10);
    expect(cfg.mutSlots).toEqual(['claws', 'carapace']);
    expect(() => runConfigFor(newProfile(0), 'mantis')).toThrow(MetaError);
  });

  it('upgrades cost resources, are instant and gated', () => {
    let p = newProfile(0);
    expect(upgradeBlocker(p, 'lighthouse')).toBe('coral');
    p = { ...p, coral: 1000, shine: 100 };
    p = upgradeBuilding(p, 'lighthouse');
    expect(p.buildings.lighthouse).toBe(1);
    expect(p.coral).toBe(920);
    expect(runConfigFor(p, 'hermit').maxStage).toBe(6);
    expect(upgradeBlocker(p, 'lighthouse')).toBe('best_stage');
    p = upgradeBuilding(upgradeBuilding(p, 'hatchery'), 'hatchery');
    expect(runConfigFor(p, 'decorator').heroId).toBe('decorator');
  });

  it('talents need the school and shine', () => {
    let p = { ...newProfile(0), shine: 10 };
    expect(() => buyTalent(p, 'tough_shell')).toThrow('talent_locked');
    p = { ...p, buildings: { ...p.buildings, school: 1 } };
    p = buyTalent(p, 'tough_shell');
    expect(p.shine).toBe(7);
    expect(runConfigFor(p, 'hermit').extra.hpPct).toBe(4);
    expect(() => buyTalent(p, 'tough_shell')).toThrow('talent_shine');
  });

  it('corf accrues offline up to 8 hours', () => {
    const p = { ...newProfile(0), buildings: { ...newProfile(0).buildings, corf: 1 } };
    expect(corfState(p, 3_600_000).amount).toBe(12);
    const st = corfState(p, 100 * 3_600_000);
    expect(st.amount).toBe(96);
    expect(st.full).toBe(true);
    const { profile, gained } = collectCorf(p, 100 * 3_600_000);
    expect(gained).toBe(96);
    expect(corfState(profile, 100 * 3_600_000).amount).toBe(0);
  });

  it('run end grants loot, updates almanac and stats', () => {
    const p0 = newProfile(0);
    let run = startRun('r', 's', runConfigFor(p0, 'hermit'));
    run = applyRunAction(run, { type: 'hunt_done', report: { eaten: { moon_jelly: 10, sand_worm: 5 }, nodes: { oyster: 2, coral: 3, glitter: 0 }, durationS: 60, hpLost: 0, ko: false } }).state;
    if (run.camp?.shellChoices) run = applyRunAction(run, { type: 'choose_shell', index: 0 }).state;
    run = applyRunAction(run, { type: 'carry_out' }).state;
    const { profile, summary } = applyRunEnd(p0, run);
    expect(profile.coral).toBe(summary.coral);
    expect(summary.coral).toBeGreaterThan(0);
    expect(summary.newCreatures.sort()).toEqual(['moon_jelly', 'sand_worm']);
    expect(profile.almanac.tenants.anemone).toBe(1);
    expect(profile.tutorialDone).toBe(true);
    expect(profile.stats.runs).toBe(1);
    const d = questDeltasForRun(run);
    expect(d.eat_sting).toBe(10);
    expect(d.carry_out).toBe(1);
  });

  it('milestones are claimable once', () => {
    let p = newProfile(0);
    p = { ...p, almanac: { ...p.almanac, guardians: ['moray'] } };
    const r = claimMilestone(p, 'guardians_1');
    expect(r.profile.coral).toBe(30);
    expect(() => claimMilestone(r.profile, 'guardians_1')).toThrow('milestone_claimed');
    expect(() => claimMilestone(p, 'guardians_2')).toThrow('milestone_locked');
  });

  it('quests roll per period, progress and cap', () => {
    const now = Date.UTC(2026, 10, 13, 12);
    const a = refreshQuests(null, 'p1', now);
    expect(a.daily).toHaveLength(3);
    expect(a.weekly).toHaveLength(3);
    expect(refreshQuests(a, 'p1', now + 3600_000)).toEqual(a);
    const next = refreshQuests(a, 'p1', now + 24 * 3600_000);
    expect(next.day).not.toBe(a.day);
    expect(next.weekly).toEqual(a.weekly);
    const bumped = applyQuestDeltas(a, { eat_total: 10000, runs: 100, merge2: 100, win_battle: 100, carry_out: 5, pearls: 1000, upgrade: 5, eat_sting: 999, eat_spike: 999, eat_glow: 999, eat_armor: 999, eat_venom: 999, eat_soft: 999 });
    expect(bumped.daily.every((x) => x.progress > 0)).toBe(true);
    expect(dayKey(now)).toBe('2026-11-13');
    expect(weekKey(now)).toBe('2026-W46');
    expect(weekKey(Date.UTC(2027, 0, 1))).toBe('2026-W53');
  });

  it('leagues and shop catalogue are consistent', () => {
    expect(leagueOf(0)).toBe('bronze');
    expect(leagueOf(950)).toBe('platinum');
    for (const u of AD_UNLOCKS) {
      expect(u.views).toBeGreaterThan(0);
      if (u.grant.type === 'cosmetic') expect(COSMETIC_BY_ID.get(u.grant.id)?.source).toBe('ads');
    }
    // Every cosmetic marked as an ad unlock can actually be unlocked.
    for (const c of COSMETIC_BY_ID.values()) if (c.source === 'ads') expect(AD_UNLOCKS.some((u) => u.grant.type === 'cosmetic' && u.grant.id === c.id)).toBe(true);
  });

  it('bot rivals are the same on every device and grow with the stage', () => {
    const a = botGhosts(BOT_STAGES.from);
    expect(botGhosts(BOT_STAGES.from)).toEqual(a);
    expect(a).toHaveLength(BOT_STAGES.perStage);
    const avg = (s: number): number => botGhosts(s).reduce((x, g) => x + g.power, 0) / BOT_STAGES.perStage;
    expect(avg(BOT_STAGES.to)).toBeGreaterThan(avg(BOT_STAGES.from));
  });

  it('offline event goals follow the rank tiers, best first', () => {
    const ev = { ...DEFAULT_EVENTS[0]!, startsAt: 0, endsAt: 1 };
    const goals = eventGoals(ev, 3000);
    expect(goals.map((g) => g.reached)).toEqual([false, true, true, true]);
    expect(goals[0]?.cosmetic).toBe(ev.rankRewards[0]?.cosmetic);
  });
});
