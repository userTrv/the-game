import type { Diet, ModPatch } from '../types';

/** All tunable numbers of a run live here so the balance simulator can sweep them. */
export const BAL = {
  // --- Growth --------------------------------------------------------------------------------
  /** XP to grow from size S to S+1. */
  xpNeedBase: 10,
  xpNeedPow: 2.2,
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
  offerOwnedMult: 1.7,
  offerNearMergeMult: 1.5,
  offerMutationChance: 0.3,
  offerHealChance: 0.12,

  // --- Hunt ----------------------------------------------------------------------------------
  hunt: {
    arenaW: 620,
    arenaH: 1100,
    /** Seconds until danger reaches 1. */
    dangerTime: 150,
    minLeaveTime: 12,
    hardMaxTime: 480,
    initialSpawn: 22,
    maxAlive: 34,
    /** Creatures per second at danger 0 and 1. */
    spawnRate: [0.8, 1.1] as readonly number[],
    creatureHpBase: 6,
    creatureHpPow: 1.6,
    creatureDmgBase: 4,
    creatureDmgPow: 1.25,
    biteInterval: 1.0,
    eatRadius: 26,
    magnetRadius: 70,
    oysters: 5,
    corals: 6,
    glitterChance: 0.5,
    oysterPearls: [1, 2] as readonly number[],
    coralYield: [3, 6] as readonly number[],
    glitterYield: [1, 2] as readonly number[],
    /** Coral dropped per eaten creature tier. */
    coralPerTier: 0.25,
    nodeRespawnTime: 45,
  },
} as const;

/** Passive bonus per full 10 genes of a diet. */
export const GENE_PASSIVE: Record<Diet, ModPatch> = {
  sting: { hastePct: 3 },
  spike: { thorns: 1 },
  glow: { crit: 2 },
  armor: { armor: 6 },
  venom: { atkPct: 3 },
  soft: { hpPct: 4 },
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
