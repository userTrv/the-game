import type { Diet, ModPatch } from '../types';

export const SET_THRESHOLDS = [2, 4, 6] as const;

/**
 * Family set bonuses. The entry for a threshold is the TOTAL bonus at that threshold (not a delta),
 * so only the highest reached threshold is applied.
 */
export const SET_BONUSES: Record<Diet, readonly [ModPatch, ModPatch, ModPatch]> = {
  sting: [
    { power: { sting: 20 } },
    { power: { sting: 40 }, chainBonus: 1 },
    { power: { sting: 70 }, chainBonus: 2, stormEvery: 4 },
  ],
  spike: [
    { power: { spike: 20 }, thorns: 2 },
    { power: { spike: 40 }, thorns: 4, reflectPct: 12 },
    { power: { spike: 70 }, thorns: 7, reflectPct: 28 },
  ],
  glow: [
    { power: { glow: 15 }, crit: 10 },
    { power: { glow: 30 }, crit: 20, critMult: 50 },
    { power: { glow: 50 }, crit: 30, critMult: 100, blindOnCrit: 0.8 },
  ],
  armor: [
    { power: { armor: 15 }, armor: 20 },
    { power: { armor: 30 }, armor: 45, startShieldPct: 15 },
    { power: { armor: 50 }, armor: 80, startShieldPct: 30, shieldPct: 50 },
  ],
  venom: [
    { power: { venom: 20 } },
    { power: { venom: 40 }, poisonWeakenPct: 15 },
    { power: { venom: 70 }, poisonWeakenPct: 25, poisonNoDecay: 1 },
  ],
  soft: [
    { power: { soft: 15 }, regenPct: 0.8 },
    { power: { soft: 30 }, regenPct: 1.6, healPct: 30 },
    { power: { soft: 50 }, regenPct: 2.4, healPct: 60, revivePct: 35 },
  ],
};
