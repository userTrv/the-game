import { describe, expect, it } from 'vitest';
import {
  applyRunAction, startRun, publicRun, huntCaps, runRewards, tenantWeights, generateOffers, createRng, maxHpOf, RunError,
  type RunState, type HuntReport, BAL, xpNeed, feed, xpFalloff, orderPrice, newProfile, gardenUnlocked, setGardenOff, runConfigFor, GARDEN_MIN_POOL,
} from '../src';
import { fullConfig } from './helpers';

const report = (over: Partial<HuntReport> = {}): HuntReport => ({
  eaten: { moon_jelly: 12, plankton_spark: 6, sand_worm: 6 },
  nodes: { oyster: 3, coral: 4, glitter: 0 },
  durationS: 90,
  hpLost: 10,
  ko: false,
  ...over,
});

function toCamp(cfg = fullConfig()): RunState {
  return applyRunAction(startRun('r1', 'seed', cfg), { type: 'hunt_done', report: report() }).state;
}

describe('run reducer', () => {
  it('hunt gives xp, genes by diet, pearls and loot; state is not mutated', () => {
    const s0 = startRun('r1', 'seed', fullConfig());
    const frozen = JSON.stringify(s0);
    const { state, events } = applyRunAction(s0, { type: 'hunt_done', report: report() });
    expect(JSON.stringify(s0)).toBe(frozen);
    expect(state.phase).toBe('camp');
    expect(state.genes.sting).toBe(12);
    expect(state.genes.glow).toBe(6);
    expect(state.size).toBeGreaterThan(1);
    expect(events.some((e) => e.type === 'grow')).toBe(true);
    expect(state.pearls).toBeGreaterThanOrEqual(3);
    expect(state.loot.coral).toBeGreaterThan(0);
    expect(state.camp?.offers).toHaveLength(3);
    expect(events.some((e) => e.type === 'gene_threshold' && e.diet === 'sting')).toBe(true);
  });

  it('clamps impossible reports', () => {
    const s0 = startRun('r1', 'seed', fullConfig());
    const cheat = report({ eaten: { moon_jelly: 100000, viperfish: 50, nope: 5 }, nodes: { oyster: 999, coral: 999, glitter: 999 }, durationS: 60 });
    const { state, events } = applyRunAction(s0, { type: 'hunt_done', report: cheat }, { huntElapsedS: 30 });
    const caps = huntCaps(30);
    expect(state.stats.eatenTotal).toBeLessThanOrEqual(caps.maxEaten);
    expect(state.stats.eatenByCreature.viperfish).toBeUndefined();
    expect(state.pearls).toBeLessThanOrEqual(caps.maxOysters * 2);
    expect(events.filter((e) => e.type === 'clamped').length).toBeGreaterThanOrEqual(4);
  });

  it('gene-heavy diets get more offers of their family', () => {
    const s = toCamp();
    s.genes.venom = 40;
    const w = tenantWeights(s);
    expect(w.get('nudibranch')!).toBeGreaterThan(w.get('anemone')! * 1.5);
    let venom = 0;
    let total = 0;
    for (let i = 0; i < 300; i++) {
      for (const o of generateOffers({ ...s, pendingMutations: [] }, createRng(`w${i}`))) {
        if (o.type !== 'tenant') continue;
        total++;
        if (['nudibranch', 'cone_snail', 'toxic_sponge', 'fire_worm', 'blue_ring', 'stonefish'].includes(o.id)) venom++;
      }
    }
    expect(venom / total).toBeGreaterThan(0.3);
  });

  it('three equal tenants merge, cascading to three stars', () => {
    let s = toCamp();
    s.camp!.shellChoices = null;
    s.slots = [{ id: 'anemone', star: 2 }, { id: 'anemone', star: 2 }, { id: 'anemone', star: 1 }, { id: 'anemone', star: 1 }];
    s.camp!.offers = [{ type: 'tenant', id: 'anemone', star: 1 }, { type: 'heal', pct: 45 }, { type: 'heal', pct: 45 }];
    const r = applyRunAction(s, { type: 'pick_offer', index: 0 });
    s = r.state;
    const merges = r.events.filter((e) => e.type === 'merge');
    expect(merges).toHaveLength(2);
    expect(s.slots.filter(Boolean)).toEqual([{ id: 'anemone', star: 3 }]);
    expect(s.slots).toHaveLength(4);
    expect(s.stats.merges).toEqual([1, 1]);
  });

  it('full shell: needs a slot unless the pick merges; replaced tenant is sold', () => {
    const s = toCamp();
    s.camp!.shellChoices = null;
    s.slots = [{ id: 'urchin', star: 1 }, { id: 'barnacle', star: 1 }, { id: 'kelp', star: 1 }];
    s.camp!.offers = [{ type: 'tenant', id: 'anemone', star: 1 }, { type: 'heal', pct: 45 }, { type: 'heal', pct: 45 }];
    expect(() => applyRunAction(s, { type: 'pick_offer', index: 0 })).toThrow(RunError);
    const pearls = s.pearls;
    const r = applyRunAction(s, { type: 'pick_offer', index: 0, slot: 1 });
    expect(r.state.slots[1]).toEqual({ id: 'anemone', star: 1 });
    expect(r.state.pearls).toBe(pearls + 1);
  });

  it('decorator merges by two', () => {
    const s = toCamp(fullConfig({ heroId: 'decorator' }));
    s.camp!.shellChoices = null;
    s.slots[0] = { id: 'urchin', star: 1 };
    s.camp!.offers = [{ type: 'tenant', id: 'urchin', star: 1 }, { type: 'heal', pct: 45 }, { type: 'heal', pct: 45 }];
    const r = applyRunAction(s, { type: 'pick_offer', index: 0 });
    expect(r.state.slots[0]).toEqual({ id: 'urchin', star: 2 });
  });

  it('shop, reroll, sell and move', () => {
    let s = toCamp();
    s.camp!.shellChoices = null;
    s.pearls = 50;
    const item = s.camp!.shop.findIndex((i) => i.offer.type === 'tenant');
    const price = s.camp!.shop[item]!.price;
    s = applyRunAction(s, { type: 'buy', index: item }).state;
    expect(s.pearls).toBe(50 - price);
    expect(() => applyRunAction(s, { type: 'buy', index: item })).toThrow();
    const before = JSON.stringify(s.camp!.shop);
    s = applyRunAction(s, { type: 'reroll' }).state;
    expect(s.pearls).toBe(50 - price - 1);
    expect(JSON.stringify(s.camp!.shop)).not.toBe(before);
    s = applyRunAction(s, { type: 'reroll' }).state;
    expect(s.pearls).toBe(50 - price - 1 - 2);
    const idx = s.slots.findIndex(Boolean);
    const to = (idx + 1) % s.slots.length;
    s = applyRunAction(s, { type: 'move', from: idx, to }).state;
    expect(s.slots[idx]).toBeNull();
    const p = s.pearls;
    s = applyRunAction(s, { type: 'sell', slot: to }).state;
    expect(s.pearls).toBeGreaterThan(p);
    expect(s.slots.every((t) => t === null)).toBe(true);
  });

  it('outgrowing the shell forces a shell choice that adds slots', () => {
    const s0 = startRun('r1', 'seed', fullConfig());
    const big = report({ eaten: { moon_jelly: 14, compass_jelly: 12, lantern_fry: 8 }, durationS: 200 });
    let s = applyRunAction(s0, { type: 'hunt_done', report: big }).state;
    expect(s.size).toBeGreaterThanOrEqual(3);
    expect(s.camp!.shellChoices).not.toBeNull();
    expect(() => applyRunAction(s, { type: 'descend' })).toThrow();
    s = applyRunAction(s, { type: 'choose_shell', index: 0 }).state;
    expect(s.slots.length).toBeGreaterThanOrEqual(4);
    expect(s.shell.tier).toBe(1);
  });

  it('full flow: hunts, guardian, carry out; rewards and public state', () => {
    let s = toCamp();
    if (s.camp!.shellChoices) s = applyRunAction(s, { type: 'choose_shell', index: 0 }).state;
    expect(() => applyRunAction(s, { type: 'descend' })).toThrow();
    s = applyRunAction(s, { type: 'skip_offer' }).state;
    s = applyRunAction(s, { type: 'descend' }).state;
    expect(s.phase).toBe('hunt');
    expect(s.stage).toBe(2);
    s = applyRunAction(s, { type: 'hunt_done', report: report() }).state;
    if (s.camp!.shellChoices) s = applyRunAction(s, { type: 'choose_shell', index: 0 }).state;
    s = applyRunAction(s, { type: 'skip_offer' }).state;
    s = applyRunAction(s, { type: 'descend' }).state;
    expect(s.phase).toBe('battle');
    expect(s.battle?.enemy).toMatchObject({ kind: 'guardian', id: 'moray' });
    const r = applyRunAction(s, { type: 'battle' });
    const ev = r.events.find((e) => e.type === 'battle');
    expect(ev).toBeDefined();
    s = r.state;
    if (ev && ev.type === 'battle' && ev.won) {
      expect(s.phase).toBe('camp');
      expect(s.stage).toBe(3);
      expect(s.loot.shine).toBeGreaterThan(0);
    } else {
      expect(s.lives).toBe(2);
      expect(s.stage).toBe(2);
      expect(s.phase).toBe('camp');
    }
    const pub = publicRun(s);
    expect('seed' in pub).toBe(false);
    if (s.camp?.shellChoices) s = applyRunAction(s, { type: 'choose_shell', index: 0 }).state;
    s = applyRunAction(s, { type: 'carry_out' }).state;
    expect(s.phase).toBe('ended');
    const rew = runRewards(s);
    expect(rew.keep).toBe(1);
    expect(rew.coral).toBeGreaterThan(0);
  });

  it('lost battles cost lives; at zero the run is down, then second chance or defeat', () => {
    let s = toCamp(fullConfig({ lives: 1 }));
    s.camp!.shellChoices = null;
    s.camp!.offerTaken = true;
    s.camp!.after = 11; // straight to the boss with a size-2 crab
    s = applyRunAction(s, { type: 'descend' }).state;
    expect(s.battle?.enemy).toMatchObject({ id: 'angler' });
    s = applyRunAction(s, { type: 'battle' }).state;
    expect(s.phase).toBe('down');
    const again = applyRunAction(s, { type: 'second_chance' }).state;
    expect(again.phase).toBe('camp');
    expect(again.lives).toBe(1);
    expect(() => applyRunAction(applyRunAction(again, { type: 'descend' }).state, { type: 'second_chance' })).toThrow();
    const lost = applyRunAction(s, { type: 'give_up' }).state;
    expect(lost.result).toBe('defeat');
    expect(runRewards(lost).keep).toBe(BAL.defeatKeep);
  });

  it('ko in a hunt costs a life and restores some hp', () => {
    const s0 = startRun('r1', 'seed', fullConfig());
    const { state } = applyRunAction(s0, { type: 'hunt_done', report: report({ ko: true, hpLost: 500 }) });
    expect(state.lives).toBe(2);
    expect(state.hp).toBeGreaterThan(0);
    expect(state.hp).toBeLessThanOrEqual(maxHpOf(state));
  });

  it('cleared when the last allowed guardian falls', () => {
    let s = toCamp(fullConfig({ maxStage: 3 }));
    s.camp!.shellChoices = null;
    s.camp!.offerTaken = true;
    s.camp!.after = 2;
    s.size = 12;
    s.slots = [{ id: 'storm_polyp', star: 3 }, { id: 'anemone', star: 3 }, { id: 'sea_sponge', star: 3 }];
    s = applyRunAction(s, { type: 'descend' }).state;
    s = applyRunAction(s, { type: 'battle' }).state;
    expect(s.result).toBe('cleared');
    expect(() => applyRunAction(s, { type: 'carry_out' })).toThrow();
  });

  it('tutorial run offers the starter tenant on the first two camps', () => {
    const cfg = fullConfig({ tutorial: true, starterTenant: 'anemone' });
    let s = applyRunAction(startRun('t', 'seed-t', cfg), { type: 'hunt_done', report: report() }).state;
    expect(s.slots[0]).toEqual({ id: 'anemone', star: 1 });
    expect(s.camp!.offers[0]).toEqual({ type: 'tenant', id: 'anemone', star: 1 });
    if (s.camp!.shellChoices) s = applyRunAction(s, { type: 'choose_shell', index: 0 }).state;
    s = applyRunAction(s, { type: 'pick_offer', index: 0 }).state;
    s = applyRunAction(s, { type: 'descend' }).state;
    const r2 = applyRunAction(s, { type: 'hunt_done', report: report() });
    s = r2.state;
    if (s.camp!.shellChoices) s = applyRunAction(s, { type: 'choose_shell', index: 0 }).state;
    const r3 = applyRunAction(s, { type: 'pick_offer', index: 0 });
    expect(r3.events.some((e) => e.type === 'merge' && e.star === 2)).toBe(true);
  });

  it('xp curve is monotonic', () => {
    for (let s = 1; s < 30; s++) expect(xpNeed(s + 1)).toBeGreaterThan(xpNeed(s));
  });
});

describe('v2 hunt rules', () => {
  it('small food feeds a big crab worse, so camping an early pool does not pay', () => {
    const small = { size: 1, xp: 0 };
    const big = { size: 6, xp: 0 };
    feed(small, 1, 0);
    feed(big, 1, 0);
    expect(big.xp).toBeLessThan(small.xp * 0.1);
    expect(xpFalloff(3, 3)).toBe(1);
    expect(xpFalloff(3, 5)).toBe(1);
  });

  it('replays an ordered log, clamps stalker tiers and counts pearls from every source', () => {
    const s0 = startRun('r1', 'seed', fullConfig());
    const log: [string, number][] = [];
    for (let i = 0; i < 20; i++) log.push(['moon_jelly', 1]);
    log.push(['lionfish', 99]);
    const { state, events } = applyRunAction(s0, {
      type: 'hunt_done',
      report: { log, nodes: { oyster: 2, coral: 0, glitter: 0, chest: 1 }, drops: 1, durationS: 60, hpLost: 0, ko: false },
    });
    expect(state.stats.eatenTotal).toBe(21);
    expect(events.some((e) => e.type === 'clamped' && e.what === 'tier')).toBe(true);
    expect(state.pearls).toBe(s0.pearls + 2 * BAL.hunt.oysterPearls + BAL.hunt.chestPearls + 1);
    // 20 jellies and one clamped predator: far from the size a tier-99 meal would give.
    expect(state.size).toBeLessThan(8);
  });

  it('orders a copy of a tenant on the shell once per camp', () => {
    let s = applyRunAction(startRun('r1', 'seed', fullConfig()), { type: 'hunt_done', report: { eaten: { moon_jelly: 6 }, nodes: { oyster: 0, coral: 0, glitter: 0 }, durationS: 30, hpLost: 0, ko: false } }).state;
    if (s.camp!.shellChoices) s = applyRunAction(s, { type: 'choose_shell', index: 0 }).state;
    s.slots[0] = { id: 'anemone', star: 1 };
    s.pearls = 50;
    const before = s.pearls;
    const r = applyRunAction(s, { type: 'order', of: 0 });
    expect(r.state.pearls).toBe(before - orderPrice({ id: 'anemone', star: 1 }));
    expect(r.state.slots.filter((t) => t?.id === 'anemone')).toHaveLength(2);
    expect(() => applyRunAction(r.state, { type: 'order', of: 0 })).toThrow('order_used');
  });

  it('the garden deck narrows the pool but never below the minimum', () => {
    const p = { ...newProfile(0), tutorialDone: true };
    const all = gardenUnlocked(p);
    const off = all.slice(0, all.length - GARDEN_MIN_POOL);
    const q = setGardenOff(p, off);
    expect(runConfigFor(q, 'hermit').tenantPool).toHaveLength(Math.min(GARDEN_MIN_POOL, all.length));
    expect(() => setGardenOff(p, all)).toThrow('garden_min');
  });
});
