export const DIETS = ['sting', 'spike', 'glow', 'armor', 'venom', 'soft'] as const;
export type Diet = (typeof DIETS)[number];

export const MUT_SLOTS = ['claws', 'carapace', 'legs', 'antennae'] as const;
export type MutSlot = (typeof MUT_SLOTS)[number];

export const BIOMES = ['lagoon', 'wreck', 'abyss', 'trench'] as const;
export type BiomeId = (typeof BIOMES)[number];

export type Star = 1 | 2 | 3;
/** Per-star values: [★, ★★, ★★★]. */
export type Triple = readonly [number, number, number];

export type DietMap = Record<Diet, number>;

export function zeroDiets(): DietMap {
  return { sting: 0, spike: 0, glow: 0, armor: 0, venom: 0, soft: 0 };
}

/**
 * Additive modifier bag. Everything a build grants beyond tenant abilities is expressed here:
 * gene passives, mutations, shells, set bonuses, talents, hero traits, event modifiers.
 * Percent fields are in percent points (20 = +20 %).
 */
export interface Mods {
  hpPct: number;
  atkPct: number;
  hastePct: number;
  armor: number;
  /** Crit chance, percent points. */
  crit: number;
  /** Extra crit multiplier, percent points (50 = x2.0 -> x2.5). */
  critMult: number;
  /** Flat damage returned to melee attackers (scaled by size). */
  thorns: number;
  /** Percent of taken melee damage reflected. */
  reflectPct: number;
  /** Percent of max HP regenerated per second. */
  regenPct: number;
  /** Percent of claw damage healed. */
  leechPct: number;
  /** Chance (percent) that enemy claw attacks miss. */
  dodgePct: number;
  /** Ability power per family, percent points. */
  power: DietMap;
  /** Ability cooldown reduction, percent points. */
  cdrPct: number;
  /** Extra sting damage on every claw hit (scaled by size and sting power). */
  zapOnHit: number;
  /** Poison applied by every claw hit (scaled). */
  poisonOnHit: number;
  /** Poison applied to melee attackers (scaled). */
  poisonThorns: number;
  /** Shield gained on every claw hit (scaled). */
  shieldOnHit: number;
  /** Seconds of blind applied by crits. */
  blindOnCrit: number;
  /** Percent of max HP as shield at battle start (and pool start). */
  startShieldPct: number;
  shieldPct: number;
  healPct: number;
  /** 1 = poison on the enemy never decays. */
  poisonNoDecay: number;
  /** Poisoned enemies deal this much less damage, percent. */
  poisonWeakenPct: number;
  /** Enemy attack reduced permanently, percent. */
  weakAuraPct: number;
  /** Revive once with this percent of max HP. */
  revivePct: number;
  /** Extra bounces for chain abilities. */
  chainBonus: number;
  /** Every Nth sting ability triggers a storm (0 = off). */
  stormEvery: number;
  // Hunt-only
  speedPct: number;
  eatRadiusPct: number;
  magnetPct: number;
  xpPct: number;
  pearlPct: number;
  lootPct: number;
  /** Damage per second to creatures touching the crab (scaled). */
  trample: number;
  /** Gene gain, percent. */
  genePct: number;
}

export function zeroMods(): Mods {
  return {
    hpPct: 0,
    atkPct: 0,
    hastePct: 0,
    armor: 0,
    crit: 0,
    critMult: 0,
    thorns: 0,
    reflectPct: 0,
    regenPct: 0,
    leechPct: 0,
    dodgePct: 0,
    power: zeroDiets(),
    cdrPct: 0,
    zapOnHit: 0,
    poisonOnHit: 0,
    poisonThorns: 0,
    shieldOnHit: 0,
    blindOnCrit: 0,
    startShieldPct: 0,
    shieldPct: 0,
    healPct: 0,
    poisonNoDecay: 0,
    poisonWeakenPct: 0,
    weakAuraPct: 0,
    revivePct: 0,
    chainBonus: 0,
    stormEvery: 0,
    speedPct: 0,
    eatRadiusPct: 0,
    magnetPct: 0,
    xpPct: 0,
    pearlPct: 0,
    lootPct: 0,
    trample: 0,
    genePct: 0,
  };
}

export type ModPatch = Partial<Omit<Mods, 'power'>> & { power?: Partial<DietMap> };

/** Adds patch * k into target (mutates and returns target). */
export function addMods(target: Mods, patch: ModPatch | undefined, k = 1): Mods {
  if (!patch) return target;
  for (const key of Object.keys(patch) as (keyof ModPatch)[]) {
    if (key === 'power') {
      const p = patch.power;
      if (p) for (const d of DIETS) target.power[d] += (p[d] ?? 0) * k;
    } else if (key === 'stormEvery') {
      // Not additive: the smallest positive interval wins.
      const v = patch.stormEvery ?? 0;
      if (v > 0) target.stormEvery = target.stormEvery > 0 ? Math.min(target.stormEvery, v) : v;
    } else {
      target[key] += (patch[key] ?? 0) * k;
    }
  }
  return target;
}

export interface TenantInst {
  id: string;
  star: Star;
}

export interface MutationInst {
  id: string;
  /** 1..3 */
  tier: number;
}

export interface ShellInst {
  id: string;
  /** Growth tier 0..4: decides slot count and visual size. */
  tier: number;
}

/** Everything the battle simulation needs to know about a crab. Also the ghost format. */
export interface BuildSnapshot {
  heroId: string;
  size: number;
  genes: DietMap;
  mutations: Partial<Record<MutSlot, MutationInst>>;
  shell: ShellInst;
  slots: (TenantInst | null)[];
  /** Extra mods from meta (talents) and events, already aggregated. */
  extra?: ModPatch;
  /** Cosmetics; never affects simulation. */
  skin?: { crab?: string; shell?: string; merge?: string };
  name?: string;
}
