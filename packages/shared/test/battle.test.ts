import { describe, expect, it } from 'vitest';
import { buildFighter, computeMods, guardianFighter, ratePower, simulateBattle, zeroDiets, GUARDIANS, TENANTS } from '../src';
import { build } from './helpers';

describe('battle simulation', () => {
  it('is deterministic for the same seed and differs across seeds', () => {
    const a = buildFighter(build({ size: 4, slots: [{ id: 'anemone', star: 2 }, { id: 'glow_shroom', star: 1 }, { id: 'sea_sponge', star: 1 }] }));
    const b = guardianFighter('moray');
    const r1 = simulateBattle(a, b, 'seed-1');
    const r2 = simulateBattle(a, b, 'seed-1');
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    const others = ['s2', 's3', 's4', 's5'].map((s) => JSON.stringify(simulateBattle(a, b, s).events));
    expect(others.some((o) => o !== JSON.stringify(r1.events))).toBe(true);
  });

  it('always terminates with a winner and an end event', () => {
    for (const g of GUARDIANS) {
      const res = simulateBattle(buildFighter(build({ size: 6 })), guardianFighter(g.id), `t-${g.id}`);
      expect([0, 1]).toContain(res.winner);
      expect(res.duration).toBeGreaterThan(0);
      expect(res.duration).toBeLessThanOrEqual(50);
      expect(res.events.at(-1)).toEqual({ t: res.duration, e: 'end', winner: res.winner });
    }
  });

  it('every tenant makes the crab stronger or at least not weaker at every star', () => {
    const base = ratePower(buildFighter(build({ size: 5 })));
    for (const t of TENANTS) {
      const p1 = ratePower(buildFighter(build({ size: 5, slots: [{ id: t.id, star: 1 }, null, null] })));
      const p3 = ratePower(buildFighter(build({ size: 5, slots: [{ id: t.id, star: 3 }, null, null] })));
      // Crit rolls shift a little when an ability changes the tempo, hence the tolerance.
      expect(p1, t.id).toBeGreaterThanOrEqual(base * 0.96);
      expect(p3, t.id).toBeGreaterThanOrEqual(p1 * 0.96);
    }
  });

  it('applies set bonuses at 2/4/6 and counts bridges for both families', () => {
    const slots = (ids: string[]) => ids.map((id) => ({ id, star: 1 as const }));
    const m2 = computeMods(build({ slots: slots(['anemone', 'fire_coral']) }));
    expect(m2.power.sting).toBe(20);
    const m4 = computeMods(build({ slots: slots(['anemone', 'fire_coral', 'hydroid', 'electric_urchin']) }));
    expect(m4.power.sting).toBe(40);
    expect(m4.chainBonus).toBe(1);
    const bridge = computeMods(build({ slots: slots(['urchin', 'electric_urchin']) }));
    expect(bridge.power.spike).toBe(20);
    expect(bridge.power.sting).toBe(0);
  });

  it('genes add family power and passive steps', () => {
    const genes = zeroDiets();
    genes.armor = 27;
    const m = computeMods(build({ genes }));
    expect(m.power.armor).toBe(27);
    expect(m.armor).toBe(12);
  });

  it('preferred row gives a bonus', () => {
    // urchin prefers the front row: 4 slots -> indices 0,1 front.
    const front = computeMods(build({ slots: [{ id: 'urchin', star: 1 }, null, null, null] }));
    const back = computeMods(build({ slots: [null, null, null, { id: 'urchin', star: 1 }] }));
    expect(front.thorns).toBeCloseTo(3 * 1.25);
    expect(back.thorns).toBeCloseTo(3);
  });

  it('poison, shield, heal and revive work', () => {
    const venom = buildFighter(build({ size: 3, slots: [{ id: 'nudibranch', star: 3 }, { id: 'limpet', star: 2 }, { id: 'sea_sponge', star: 2 }] }));
    const res = simulateBattle(venom, guardianFighter('moray'), 'p');
    expect(res.damage[0].poison ?? 0).toBeGreaterThan(0);
    expect(res.events.some((e) => e.e === 'status' && e.st === 'shield')).toBe(true);
    expect(res.healed[0]).toBeGreaterThan(0);

    const soft6 = build({ size: 1, shell: { id: 'spiral', tier: 3 }, slots: ['sea_sponge', 'kelp', 'feather_worm', 'sea_cucumber', 'soft_coral', 'sea_squirt', null].map((id) => (id ? { id, star: 1 as const } : null)) });
    const r = simulateBattle(buildFighter(soft6), guardianFighter('angler'), 'rv');
    expect(r.events.some((e) => e.e === 'revive' && e.s === 0)).toBe(true);
  });

  it('mantis punches and decorator has weaker tenants', () => {
    const mantis = simulateBattle(buildFighter(build({ heroId: 'mantis', slots: [null, null] })), guardianFighter('moray'), 'm');
    expect(mantis.events.some((e) => e.e === 'hit' && e.punch)).toBe(true);
    const hermit = buildFighter(build({ slots: [{ id: 'anemone', star: 1 }, null, null] }));
    const deco = buildFighter(build({ heroId: 'decorator', slots: [{ id: 'anemone', star: 1 }, null, null, null, null] }));
    expect(deco.abilities[0]!.v).toBeLessThan(hermit.abilities[0]!.v);
  });
});
