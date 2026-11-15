import type { ModPatch } from '../types';

export const BUILDINGS = ['lighthouse', 'garden', 'lab', 'workshop', 'hatchery', 'corf', 'school', 'almanac'] as const;
export type BuildingId = (typeof BUILDINGS)[number];

export interface Cost {
  coral: number;
  shine: number;
}

export interface BuildingDef {
  id: BuildingId;
  /** costs[i] = price of going from level i to i + 1. Upgrades are instant. */
  costs: readonly Cost[];
  /** Other requirements for reaching level i + 1. */
  requires?: readonly ({ chapterCleared?: boolean; bestStage?: number } | undefined)[];
}

const c = (coral: number, shine = 0): Cost => ({ coral, shine });

/**
 * Reef town. Levels start at 0.
 *  lighthouse - how deep a run may go: 3 / 6 / 9 / 12 stages, then endless
 *  garden     - tenant pool (TenantDef.unlock <= level)
 *  lab        - mutation slots and tiers
 *  workshop   - shell pool (ShellDef.unlock <= level)
 *  hatchery   - heroes and starting bonuses
 *  corf       - offline coral, capped at 8 hours
 *  school     - talent tiers
 *  almanac    - collection rewards multiplier
 */
export const BUILDING_DEFS: Record<BuildingId, BuildingDef> = {
  lighthouse: {
    id: 'lighthouse',
    costs: [c(80), c(520, 10), c(2600, 45), c(9500, 150)],
    requires: [undefined, { bestStage: 6 }, { bestStage: 9 }, { chapterCleared: true }],
  },
  garden: { id: 'garden', costs: [c(60), c(260, 4), c(950, 16), c(3200, 50), c(10000, 140)] },
  lab: { id: 'lab', costs: [c(90), c(380, 6), c(1500, 24), c(5200, 80)] },
  workshop: { id: 'workshop', costs: [c(70), c(300, 5), c(1100, 18), c(3600, 55), c(11000, 150)] },
  hatchery: { id: 'hatchery', costs: [c(120), c(650, 14), c(2400, 45), c(8000, 130)] },
  corf: { id: 'corf', costs: [c(50), c(240, 3), c(900, 14), c(3000, 45), c(9000, 120)] },
  school: { id: 'school', costs: [c(100, 3), c(520, 12), c(2000, 40), c(7000, 110)] },
  almanac: { id: 'almanac', costs: [c(70), c(600, 10), c(3200, 50)] },
};

/** The garden is a deck: tenants can be switched off, but the pool never gets smaller than this. */
export const GARDEN_MIN_POOL = 8;

export const LIGHTHOUSE_STAGES = [3, 6, 9, 12, 9999] as const;
export const CORF_RATE_PER_HOUR = [0, 12, 22, 36, 55, 80] as const;
export const CORF_CAP_HOURS = 8;
export const ALMANAC_REWARD_MULT = [1, 1.25, 1.6, 2] as const;

export interface TalentDef {
  id: string;
  /** School level needed. */
  tier: number;
  /** Shine cost per level. */
  costs: readonly number[];
  /** Mods per level (total, not delta). */
  mods?: readonly ModPatch[];
  /** Run config tweaks per level (total). */
  cfg?: readonly { startPearls?: number; startGenes?: number; lives?: number }[];
}

export const TALENTS: readonly TalentDef[] = [
  { id: 'tough_shell', tier: 1, costs: [3, 8, 18], mods: [{ hpPct: 4 }, { hpPct: 8 }, { hpPct: 12 }] },
  { id: 'sharp_claws', tier: 1, costs: [3, 8, 18], mods: [{ atkPct: 4 }, { atkPct: 8 }, { atkPct: 12 }] },
  { id: 'quick_legs', tier: 1, costs: [3, 8, 18], mods: [{ speedPct: 4 }, { speedPct: 8 }, { speedPct: 12 }] },
  { id: 'big_appetite', tier: 2, costs: [6, 14, 30], mods: [{ xpPct: 5 }, { xpPct: 10 }, { xpPct: 15 }] },
  { id: 'pearl_diver', tier: 2, costs: [6, 14, 30], mods: [{ pearlPct: 10 }, { pearlPct: 20 }, { pearlPct: 30 }] },
  { id: 'lucky_shell', tier: 2, costs: [6, 14, 30], cfg: [{ startPearls: 2 }, { startPearls: 4 }, { startPearls: 6 }] },
  { id: 'treasure_nose', tier: 3, costs: [12, 28, 60], mods: [{ lootPct: 5 }, { lootPct: 10 }, { lootPct: 15 }] },
  { id: 'thick_skin', tier: 3, costs: [12, 28, 60], mods: [{ armor: 5 }, { armor: 10 }, { armor: 15 }] },
  { id: 'magnet', tier: 3, costs: [12, 28, 60], mods: [{ magnetPct: 15 }, { magnetPct: 30 }, { magnetPct: 45 }] },
  { id: 'gene_memory', tier: 4, costs: [25, 60, 120], cfg: [{ startGenes: 1 }, { startGenes: 2 }, { startGenes: 3 }] },
  { id: 'extra_life', tier: 4, costs: [150], cfg: [{ lives: 1 }] },
];

export const TALENT_BY_ID: ReadonlyMap<string, TalentDef> = new Map(TALENTS.map((t) => [t.id, t]));
