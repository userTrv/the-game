import type { Diet, ModPatch } from '../types';

/** All tunable numbers of a run live here so the balance simulator can sweep them. */
export const BAL = {
  // --- Growth --------------------------------------------------------------------------------
  /** XP to grow from size S to S+1. */
  xpNeedBase: 10,
  xpNeedPow: 1.8,
  /** XP for eating a creature of tier t. */
  xpTierPow: 1.5,
  hpPerSize: 0.12,
  atkPerSize: 0.08,
  /** Tenant/mutation magnitudes scale with size too, so builds keep up with depth. */
  abilityPerSize: 0.07,
  /** Sizes at which the crab outgrows its shell (index = new shell tier - 1). */
  shellSizes: [3, 5, 7, 9] as readonly number[],

  // --- Genes ---------------------------------------------------------------------------------
  geneThresholds: [10, 25, 50] as readonly number[],
  /** Family ability power per gene point, percent. */
  genePowerPct: 1,
  genePowerCap: 100,

  // --- Tenants -------------------------------------------------------------------------------
  /** Bonus for a tenant sitting in its preferred row. */
  rowBonus: 1.25,
  /** Damage multiplier of a family a guardian is weak to / resists. */
  weakMult: 1.5,
  resistMult: 0.6,
  /** Links can shorten a neighbour's cooldown by at most this share. */
  linkHasteCap: 50,
  /** Non-magnitude effects (durations, percents) get this share of family power. */
  softPowerShare: 0.4,

  // --- Battle --------------------------------------------------------------------------------
  tick: 0.1,
  baseCrit: 5,
  baseCritMult: 2,
  blindMiss: 0.5,
  poisonDecayPerSec: 0.1,
  stunImmunity: 2.5,
  maxStun: 2.5,
  /** After this many seconds both sides deal more and heal less every second. */
  frenzyStart: 25,
  frenzyPerSec: 0.12,
  maxDuration: 50,
  chainFalloff: 0.6,
  stormMult: 1.5,
  stormStun: 0.5,

  // --- Run -----------------------------------------------------------------------------------
  lives: 3,
  /** Share of loot kept on defeat. */
  defeatKeep: 0.4,
  campHealPct: 15,
  healOfferPct: 45,
  koHpPct: 35,
  /** Loot multiplier grows with depth: 1 + k * (stage - 1). */
  lootDepthK: 0.12,
  pearlToCoral: 2,
  /** Pearls for beating the rival at a camp: base + stage / 3. */
  duelPearls: 2,
  rerollBase: 1,
  rerollStep: 1,
  /** Tenant price in pearls by rarity (index = rarity - 1). */
  tenantPrice: [3, 5, 8] as readonly number[],
  sellPrice: [1, 2, 3] as readonly number[],
  healPrice: 4,
  shopSize: 3,
  /** Chance that a shop tenant is ★★ (per stage past the first guardian). */
  shopStar2PerStage: 0.03,
  shopStar2Max: 0.25,
  star2PriceMult: 3,
  /** Offer weights. */
  offerRarityWeight: [10, 5, 2] as readonly number[],
  offerRarityStageBonus: [0, 0.25, 0.2] as readonly number[],
  offerGeneK: 0.08,
  offerOwnedMult: 2.5,
  offerNearMergeMult: 2,
  /** Ordering a copy of a tenant already on the shell costs its price plus this. */
  orderExtra: 2,
  offerMutationChance: 0.3,
  offerHealChance: 0.12,

  // --- Hunt ----------------------------------------------------------------------------------
  hunt: {
    /** The pool has no walls: the world is generated in square chunks around the crab. */
    chunk: 512,
    /** Seconds until danger reaches 1; it keeps growing past that up to dangerMax. */
    dangerTime: 150,
    dangerMax: 3,
    minLeaveTime: 12,
    hardMaxTime: 480,
    initialSpawn: 20,
    maxAlive: 34,
    /** Creatures per second at danger 0 and 1. */
    spawnRate: [0.9, 1.3] as readonly number[],
    creatureHpBase: 6,
    creatureHpPow: 1.6,
    creatureDmgBase: 4,
    creatureDmgPow: 1.25,
    biteInterval: 1.0,
    eatRadius: 26,
    magnetRadius: 70,
    /**
     * Food smaller than the crab feeds it worse: index = size - tier (0 = same tier), the last value
     * applies to everything smaller. Camping an early pool for levels is pointless.
     */
    xpFalloff: [1, 0.7, 0.4, 0.2, 0.08] as readonly number[],
    /**
     * Stalkers: predators whose tier follows the crab (size + 1, later + 2), so they can never be
     * outgrown. They start at this danger and come more often as it rises.
     */
    stalkerFrom: 0.3,
    stalkerInterval: [22, 7] as readonly number[],
    stalkerExtraTierAt: 1.4,
    stalkerMaxAlive: 4,
    /** The marked prey of a pool: pearls and genes of its family for eating it. */
    trophyPearls: 3,
    trophyGenes: 3,
    /** A predator freezes this long before biting; hiding inside the window parries the bite. */
    biteWindup: 0.55,
    parryStun: 2,
    /** Pearls: nothing respawns. */
    oysterPearls: 1,
    chestPearls: 3,
    chestCoral: 12,
    /** Chance that a slain regular predator drops a pearl; stalkers always do. */
    predatorPearlChance: 0.35,
    coralYield: [3, 6] as readonly number[],
    glitterYield: [1, 2] as readonly number[],
    /** Coral dropped per eaten creature tier. */
    coralPerTier: 0.25,
    /** Distance from the entry point (world units) at which the world is twice as rich and dangerous. */
    richDistance: 2200,
  },
} as const;

/** Passive bonus per full 10 genes of a diet. */
export const GENE_PASSIVE: Record<Diet, ModPatch> = {
  sting: { hastePct: 3 },
  spike: { thorns: 1 },
  glow: { crit: 3, atkPct: 2 },
  armor: { armor: 6 },
  venom: { atkPct: 3 },
  soft: { hpPct: 7 },
};
export const GENE_PASSIVE_MAX_STEPS = 8;

export function xpNeed(size: number): number {
  return Math.round(BAL.xpNeedBase * Math.pow(size, BAL.xpNeedPow));
}

export function xpForTier(tier: number): number {
  return Math.pow(Math.max(1, tier), BAL.xpTierPow);
}

export function sizeScale(size: number, per: number): number {
  return 1 + per * (size - 1);
}

/** Gene points for eating a creature of the given tier. */
export function genesForTier(tier: number): number {
  return 1 + Math.floor((tier - 1) / 4);
}

/** Share of a meal's XP the crab gets when it is `size` and the food is of `tier`. */
export function xpFalloff(size: number, tier: number): number {
  const f = BAL.hunt.xpFalloff;
  const gap = Math.max(0, Math.floor(size - tier));
  return f[Math.min(gap, f.length - 1)] as number;
}

/** Highest tier a meal may have for a crab of this size: stalkers are size + 2 at most. */
export function maxMealTier(size: number, stageTier: number): number {
  return Math.max(stageTier, size + 2);
}

/** Adds one meal to a growing crab (shared by the client HUD and the server so sizes always agree). */
export function feed(g: { size: number; xp: number }, tier: number, xpPct: number): boolean {
  g.xp += xpForTier(tier) * xpFalloff(g.size, tier) * (1 + xpPct / 100);
  let grew = false;
  while (g.xp >= xpNeed(g.size)) {
    g.xp -= xpNeed(g.size);
    g.size += 1;
    grew = true;
  }
  return grew;
}
