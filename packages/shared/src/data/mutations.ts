import type { Diet, ModPatch, MutSlot } from '../types';

export interface MutationDef {
  id: string;
  slot: MutSlot;
  diet: Diet;
  /** Mods for tier I, II, III (unlocked by gene thresholds). */
  tiers: readonly [ModPatch, ModPatch, ModPatch];
}

const m = (
  slot: MutSlot,
  diet: Diet,
  name: string,
  tiers: readonly [ModPatch, ModPatch, ModPatch],
): MutationDef => ({ id: `${slot}_${name}`, slot, diet, tiers });

/** 4 body slots x 6 diets. One mutation per slot is active; a new one replaces the old. */
export const MUTATIONS: readonly MutationDef[] = [
  // Claws: how the crab hits
  m('claws', 'sting', 'spark', [{ zapOnHit: 3 }, { zapOnHit: 6 }, { zapOnHit: 11 }]),
  m('claws', 'spike', 'mace', [{ atkPct: 18 }, { atkPct: 36 }, { atkPct: 60 }]),
  m('claws', 'glow', 'flash', [
    { crit: 8, blindOnCrit: 0.4 },
    { crit: 15, blindOnCrit: 0.7 },
    { crit: 24, blindOnCrit: 1 },
  ]),
  m('claws', 'armor', 'bulwark', [
    { atkPct: 5, shieldOnHit: 1.5 },
    { atkPct: 10, shieldOnHit: 3 },
    { atkPct: 15, shieldOnHit: 5.5 },
  ]),
  m('claws', 'venom', 'fang', [{ poisonOnHit: 0.7 }, { poisonOnHit: 1.4 }, { poisonOnHit: 2.4 }]),
  m('claws', 'soft', 'sucker', [{ leechPct: 9 }, { leechPct: 16 }, { leechPct: 25 }]),

  // Carapace: what happens when the crab is hit
  m('carapace', 'sting', 'static', [
    { thorns: 3, power: { sting: 8 } },
    { thorns: 6, power: { sting: 16 } },
    { thorns: 11, power: { sting: 28 } },
  ]),
  m('carapace', 'spike', 'thorny', [
    { thorns: 4, armor: 6 },
    { thorns: 8, armor: 12 },
    { thorns: 14, armor: 20 },
  ]),
  m('carapace', 'glow', 'mirror', [{ dodgePct: 7 }, { dodgePct: 12 }, { dodgePct: 18 }]),
  m('carapace', 'armor', 'thick', [{ armor: 20 }, { armor: 40 }, { armor: 70 }]),
  m('carapace', 'venom', 'toxic', [{ poisonThorns: 1 }, { poisonThorns: 2 }, { poisonThorns: 3.5 }]),
  m('carapace', 'soft', 'springy', [{ hpPct: 15 }, { hpPct: 30 }, { hpPct: 50 }]),

  // Legs: movement and tempo
  m('legs', 'sting', 'bolt', [
    { speedPct: 10, hastePct: 6 },
    { speedPct: 18, hastePct: 12 },
    { speedPct: 26, hastePct: 20 },
  ]),
  m('legs', 'spike', 'stilts', [
    { speedPct: 6, trample: 3, atkPct: 6 },
    { speedPct: 10, trample: 6, atkPct: 12 },
    { speedPct: 14, trample: 10, atkPct: 20 },
  ]),
  m('legs', 'glow', 'beacon', [
    { magnetPct: 30, xpPct: 5 },
    { magnetPct: 60, xpPct: 10 },
    { magnetPct: 100, xpPct: 15 },
  ]),
  m('legs', 'armor', 'anchor', [
    { armor: 10, hpPct: 5 },
    { armor: 20, hpPct: 10 },
    { armor: 35, hpPct: 16 },
  ]),
  m('legs', 'venom', 'whip', [
    { power: { venom: 15 }, speedPct: 5 },
    { power: { venom: 30 }, speedPct: 8 },
    { power: { venom: 50 }, speedPct: 12 },
  ]),
  m('legs', 'soft', 'flipper', [
    { speedPct: 15, regenPct: 0.3 },
    { speedPct: 25, regenPct: 0.6 },
    { speedPct: 35, regenPct: 1 },
  ]),

  // Antennae: senses and utility
  m('antennae', 'sting', 'aerial', [{ cdrPct: 6 }, { cdrPct: 12 }, { cdrPct: 20 }]),
  m('antennae', 'spike', 'harpoon', [
    { eatRadiusPct: 15, atkPct: 4 },
    { eatRadiusPct: 30, atkPct: 8 },
    { eatRadiusPct: 45, atkPct: 12 },
  ]),
  m('antennae', 'glow', 'lure', [
    { pearlPct: 15, crit: 3 },
    { pearlPct: 30, crit: 6 },
    { pearlPct: 50, crit: 10 },
  ]),
  m('antennae', 'armor', 'radar', [{ startShieldPct: 8 }, { startShieldPct: 15 }, { startShieldPct: 25 }]),
  m('antennae', 'venom', 'stinger', [{ weakAuraPct: 5 }, { weakAuraPct: 10 }, { weakAuraPct: 15 }]),
  m('antennae', 'soft', 'taster', [{ xpPct: 10 }, { xpPct: 20 }, { xpPct: 30 }]),
];

export const MUTATION_BY_ID: ReadonlyMap<string, MutationDef> = new Map(MUTATIONS.map((x) => [x.id, x]));

export function mutationDef(id: string): MutationDef {
  const x = MUTATION_BY_ID.get(id);
  if (!x) throw new Error(`unknown mutation: ${id}`);
  return x;
}
