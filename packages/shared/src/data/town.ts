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
    costs: [c(60), c(260, 6), c(800, 25), c(2400, 80)],
    requires: [undefined, { bestStage: 6 }, { bestStage: 9 }, { chapterCleared: true }],
  },
  garden: { id: 'garden', costs: [c(50), c(160, 3), c(420, 10), c(1000, 28), c(2200, 60)] },
  lab: { id: 'lab', costs: [c(70), c(220, 4), c(600, 14), c(1500, 40)] },
  workshop: { id: 'workshop', costs: [c(60), c(180, 3), c(460, 10), c(1100, 28), c(2400, 60)] },
  hatchery: { id: 'hatchery', costs: [c(90), c(380, 10), c(900, 26), c(2200, 70)] },
  corf: { id: 'corf', costs: [c(40), c(150, 2), c(400, 8), c(1000, 22), c(2200, 50)] },
  school: { id: 'school', costs: [c(80, 2), c(300, 8), c(800, 22), c(2000, 55)] },
  almanac: { id: 'almanac', costs: [c(50), c(250, 5), c(900, 20)] },
};

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
