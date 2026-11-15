import { describe, expect, it } from 'vitest';
import {
  applyRunAction, applyRunEnd, buildAbilities, buildFighter, computeMods, gardenUnlocked, generatePaths, gridNeighbors, guardianFighter, newProfile,
  publicRun, simulateBattle, slotLinks, startRun, trophyOf, unlockedHeroes, zeroDiets, BAL, POOLS,
  type BuildSnapshot, type HuntReport, type RunState, type TenantInst,
} from '../src';
import { fullConfig } from './helpers';

const report = (over: Partial<HuntReport> = {}): HuntReport => ({
  eaten: { moon_jelly: 12, plankton_spark: 6, sand_worm: 6 },
  nodes: { oyster: 2, coral: 0, glitter: 0 },
  durationS: 60,
  hpLost: 0,
  ko: false,
  ...over,
});

function build(slots: (TenantInst | null)[], heroId = 'hermit'): BuildSnapshot {
  return { heroId, size: 3, genes: zeroDiets(), mutations: {}, shell: { id: 'periwinkle', tier: 1 }, slots };
}

function camp(): RunState {
  let s = applyRunAction(startRun('r1', 'seed', fullConfig()), { type: 'hunt_done', report: report() }).state;
  if (s.camp!.shellChoices) s = applyRunAction(s, { type: 'choose_shell', index: 0 }).state;
  return applyRunAction(s, { type: 'skip_offer' }).state;
}

describe('shell grid', () => {
  it('cells touch their row neighbours and the cell of the same column in the other row', () => {
    // 5 slots: front 0 1 2, back 3 4.
    expect(gridNeighbors(0, 5).sort()).toEqual([1, 3]);
    expect(gridNeighbors(1, 5).sort()).toEqual([0, 2, 4]);
    expect(gridNeighbors(2, 5).sort()).toEqual([1]);
    expect(gridNeighbors(3, 5).sort()).toEqual([0, 4]);
    expect(gridNeighbors(4, 5).sort()).toEqual([1, 3]);
    for (let n = 1; n <= 10; n++) {
      for (let i = 0; i < n; i++) for (const j of gridNeighbors(i, n)) expect(gridNeighbors(j, n)).toContain(i);
    }
  });

  it('an aura strengthens matching neighbours only', () => {
    // anemone (aura sting) next to needle coral (spike) and fire coral (sting).
    const apart = build([{ id: 'fire_coral', star: 1 }, null, null, { id: 'anemone', star: 1 }]);
    const together = build([{ id: 'fire_coral', star: 1 }, { id: 'anemone', star: 1 }, null, null]);
    const v = (b: BuildSnapshot): number => buildAbilities(b, computeMods(b)).find((a) => a.kind === 'burst')!.v;
    expect(v(together)).toBeGreaterThan(v(apart) * 1.1);
    const links = slotLinks(together.slots, 'hermit');
    // The aura reaches the coral, and the coral's own bond counts the anemone.
    expect(links.active.map((l) => `${l.kind}:${l.from}>${l.to}`).sort()).toEqual(['aura:1>0', 'bond:0>1']);
    const spike = build([{ id: 'needle_coral', star: 1 }, { id: 'anemone', star: 1 }, null, null]);
    expect(slotLinks(spike.slots, 'hermit').power[0]).toBe(1);
  });

  it('haste auras shorten cooldowns up to the cap and solo needs empty neighbours', () => {
    const b = build([{ id: 'anemone', star: 1 }, { id: 'glow_shroom', star: 3 }, { id: 'kelp', star: 3 }, null]);
    const links = slotLinks(b.slots, 'hermit');
    // Both neighbours of cell 0 (right and below) hurry it.
    expect(links.cd[0]).toBeCloseTo(1 - 44 / 100);
    expect(Math.min(...links.cd)).toBeGreaterThanOrEqual(1 - BAL.linkHasteCap / 100);
    const alone = slotLinks([{ id: 'storm_polyp', star: 1 }, null, null, { id: 'anemone', star: 1 }], 'hermit');
    expect(alone.power[0]).toBeCloseTo(1.4);
    const crowded = slotLinks([{ id: 'storm_polyp', star: 1 }, { id: 'anemone', star: 1 }, null, null], 'hermit');
    expect(crowded.active.some((l) => l.kind === 'solo')).toBe(false);
  });

  it('the weaver doubles links', () => {
    const slots: (TenantInst | null)[] = [{ id: 'fire_coral', star: 1 }, { id: 'anemone', star: 1 }, null, null];
    expect(slotLinks(slots, 'weaver').power[0]! - 1).toBeCloseTo((slotLinks(slots, 'hermit').power[0]! - 1) * 2);
  });
});

describe('guardian weakness', () => {
  it('a family the guardian is weak to hurts it more, a resisted one less', () => {
    const dmg = (id: string): number => {
      const me = buildFighter(build([{ id, star: 2 }, null, null, null]));
      const r = simulateBattle(me, guardianFighter('moray', 50, 0.01), 'seed');
      return r.damage[0].a0 ?? 0;
    };
    // moray: weak to sting, resists venom. Same battle length, so totals compare directly.
    const neutral = dmg('needle_coral') / (13 / 2.4);
    const weak = dmg('anemone') / (11 / 2.0);
    expect(weak / neutral).toBeGreaterThan(1.3);
    expect(guardianFighter('moray').taken).toEqual({ sting: BAL.weakMult, venom: BAL.resistMult });
  });
});

describe('currents, trophy, parries', () => {
  it('a camp before a pool offers three different currents and the chosen one shapes the hunt', () => {
    const s = camp();
    expect(s.camp!.paths).toHaveLength(3);
    expect(new Set(s.camp!.paths!.map((p) => p.kind)).size).toBe(3);
    expect(generatePaths(s, 2)).toEqual(s.camp!.paths);
    const idx = s.camp!.paths!.findIndex((p) => p.kind === 'pearl');
    const pick = idx >= 0 ? idx : 0;
    const dived = applyRunAction(s, { type: 'descend', path: pick }).state;
    expect(dived.pool).toEqual(s.camp!.paths![pick]);
    const before = dived.pearls;
    const after = applyRunAction(dived, { type: 'hunt_done', report: report({ eaten: {}, nodes: { oyster: 2, coral: 0, glitter: 0 } }) }).state;
    expect(after.pearls - before).toBe(2 * BAL.hunt.oysterPearls * POOLS[dived.pool!.kind].oyster);
  });

  it('the marked prey pays once and parries are counted within reason', () => {
    const s = applyRunAction(camp(), { type: 'descend', path: 0 }).state;
    expect(publicRun(s).trophyId).toBe(trophyOf(s)!.def.id);
    const { state, events } = applyRunAction(s, { type: 'hunt_done', report: report({ eaten: {}, nodes: { oyster: 0, coral: 0, glitter: 0 }, trophy: true, parries: 500, durationS: 30 }) });
    expect(events.some((e) => e.type === 'trophy')).toBe(true);
    expect(state.pearls - s.pearls).toBe(BAL.hunt.trophyPearls);
    expect(state.stats.trophies).toBe(1);
    expect(state.stats.parries).toBe(11);
    const quick = applyRunAction(s, { type: 'hunt_done', report: report({ eaten: {}, nodes: { oyster: 0, coral: 0, glitter: 0 }, trophy: true, durationS: 3 }) }).state;
    expect(quick.stats.trophies ?? 0).toBe(0);
  });
});

describe('rival and feats', () => {
  it('a duel costs no lives, pays pearls once and counts for the league', () => {
    const s = camp();
    expect(() => applyRunAction(s, { type: 'duel' })).toThrow();
    const weak: BuildSnapshot = { ...build([null, null, null]), size: 1, name: 'Bot' };
    s.camp!.rival = { kind: 'ghost', ghostId: 'g1', name: 'Bot', build: weak, power: 1 };
    s.slots[0] = { id: 'anemone', star: 3 };
    const { state, events } = applyRunAction(s, { type: 'duel' });
    const ev = events.find((e) => e.type === 'battle');
    expect(ev && ev.type === 'battle' && ev.duel).toBe(true);
    expect(state.phase).toBe('camp');
    expect(state.lives).toBe(s.lives);
    expect(state.stats.duelWins).toBe(1);
    expect(state.pearls).toBeGreaterThan(s.pearls);
    expect(() => applyRunAction(state, { type: 'duel' })).toThrow();
  });

  it('feats done in a run unlock tenants and the weaver for good', () => {
    const p0 = newProfile(0);
    expect(gardenUnlocked(p0)).not.toContain('lure_kelp');
    expect(unlockedHeroes(p0)).not.toContain('weaver');
    const s = camp();
    s.stats.trophies = 3;
    s.stats.linksMax = 3;
    const ended = applyRunAction(s, { type: 'carry_out' }).state;
    const { profile, summary } = applyRunEnd(p0, ended);
    expect(summary.newFeats.sort()).toEqual(['links3', 'trophy3']);
    expect(gardenUnlocked(profile)).toContain('lure_kelp');
    expect(unlockedHeroes(profile)).toContain('weaver');
    expect(applyRunEnd(profile, ended).summary.newFeats).toEqual([]);
  });
});
