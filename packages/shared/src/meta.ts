import { BAL } from './data/balance';
import { CREATURES } from './data/creatures';
import { GUARDIANS } from './data/guardians';
import { HEROES, heroDef } from './data/heroes';
import { SHELLS } from './data/shells';
import { TENANTS } from './data/tenants';
import {
  ALMANAC_REWARD_MULT,
  BUILDING_DEFS,
  BUILDINGS,
  CORF_CAP_HOURS,
  CORF_RATE_PER_HOUR,
  LIGHTHOUSE_STAGES,
  TALENT_BY_ID,
  TALENTS,
  type BuildingId,
  type Cost,
} from './data/town';
import { runRewards, type RunConfig, type RunState } from './run';
import { addMods, type ModPatch, type MutSlot, zeroMods } from './types';

/** Meta progression of a player. Stored on the server; the client only renders it. */
export interface Profile {
  coral: number;
  shine: number;
  trophies: number;
  buildings: Record<BuildingId, number>;
  talents: Record<string, number>;
  heroId: string;
  almanac: Almanac;
  /** Unix ms of the last corf collection. */
  corfSince: number;
  stats: ProfileStats;
  tutorialDone: boolean;
}

export interface Almanac {
  /** Creature id -> total eaten. */
  creatures: Record<string, number>;
  /** Tenant id -> highest star owned. */
  tenants: Record<string, number>;
  shells: string[];
  guardians: string[];
  /** Claimed milestone ids. */
  claimed: string[];
}

export interface ProfileStats {
  runs: number;
  carried: number;
  defeats: number;
  bestStage: number;
  chapterCleared: boolean;
  eaten: number;
  merges: number;
  ghostWins: number;
}

export function newProfile(now: number): Profile {
  const buildings = {} as Record<BuildingId, number>;
  for (const b of BUILDINGS) buildings[b] = 0;
  return {
    coral: 0,
    shine: 0,
    trophies: 0,
    buildings,
    talents: {},
    heroId: 'hermit',
    almanac: { creatures: {}, tenants: {}, shells: ['periwinkle'], guardians: [], claimed: [] },
    corfSince: now,
    stats: { runs: 0, carried: 0, defeats: 0, bestStage: 0, chapterCleared: false, eaten: 0, merges: 0, ghostWins: 0 },
    tutorialDone: false,
  };
}

export class MetaError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

// --- Buildings -----------------------------------------------------------------------------------

export function maxLevel(b: BuildingId): number {
  return BUILDING_DEFS[b].costs.length;
}

export function upgradeCost(profile: Profile, b: BuildingId): Cost | null {
  return BUILDING_DEFS[b].costs[profile.buildings[b]] ?? null;
}

/** Why the building cannot be upgraded right now, or null when it can. */
export function upgradeBlocker(profile: Profile, b: BuildingId): 'max' | 'coral' | 'shine' | 'best_stage' | 'chapter' | null {
  const level = profile.buildings[b];
  const cost = upgradeCost(profile, b);
  if (!cost) return 'max';
  const req = BUILDING_DEFS[b].requires?.[level];
  if (req?.chapterCleared && !profile.stats.chapterCleared) return 'chapter';
  if (req?.bestStage && profile.stats.bestStage < req.bestStage) return 'best_stage';
  if (profile.coral < cost.coral) return 'coral';
  if (profile.shine < cost.shine) return 'shine';
  return null;
}

export function upgradeBuilding(profile: Profile, b: BuildingId): Profile {
  const blocker = upgradeBlocker(profile, b);
  if (blocker) throw new MetaError(`upgrade_${blocker}`);
  const cost = upgradeCost(profile, b) as Cost;
  return {
    ...profile,
    coral: profile.coral - cost.coral,
    shine: profile.shine - cost.shine,
    buildings: { ...profile.buildings, [b]: profile.buildings[b] + 1 },
  };
}

export function unlockedHeroes(profile: Profile): string[] {
  return HEROES.filter((h) => h.unlock <= profile.buildings.hatchery).map((h) => h.id);
}

export function selectHero(profile: Profile, heroId: string): Profile {
  if (!unlockedHeroes(profile).includes(heroId)) throw new MetaError('hero_locked');
  return { ...profile, heroId };
}

// --- Talents -------------------------------------------------------------------------------------

export function talentCost(profile: Profile, id: string): number | null {
  const def = TALENT_BY_ID.get(id);
  if (!def) return null;
  return def.costs[profile.talents[id] ?? 0] ?? null;
}

export function buyTalent(profile: Profile, id: string): Profile {
  const def = TALENT_BY_ID.get(id);
  if (!def) throw new MetaError('talent_unknown');
  if (profile.buildings.school < def.tier) throw new MetaError('talent_locked');
  const cost = talentCost(profile, id);
  if (cost === null) throw new MetaError('talent_max');
  if (profile.shine < cost) throw new MetaError('talent_shine');
  return { ...profile, shine: profile.shine - cost, talents: { ...profile.talents, [id]: (profile.talents[id] ?? 0) + 1 } };
}

// --- Corf (offline coral) --------------------------------------------------------------------------

export function corfState(profile: Profile, now: number): { amount: number; cap: number; full: boolean; fullAt: number } {
  const rate = CORF_RATE_PER_HOUR[profile.buildings.corf] ?? 0;
  const cap = rate * CORF_CAP_HOURS;
  const hours = Math.max(0, now - profile.corfSince) / 3_600_000;
  const amount = Math.min(cap, Math.floor(rate * hours));
  return { amount, cap, full: cap > 0 && amount >= cap, fullAt: profile.corfSince + CORF_CAP_HOURS * 3_600_000 };
}

export function collectCorf(profile: Profile, now: number, mult = 1): { profile: Profile; gained: number } {
  const gained = Math.floor(corfState(profile, now).amount * mult);
  return { profile: { ...profile, coral: profile.coral + gained, corfSince: now }, gained };
}

// --- Run config ------------------------------------------------------------------------------------

export type EventModifier = NonNullable<RunConfig['event']>;

/** Everything a run inherits from the town, talents and the current weekly event. */
export function runConfigFor(profile: Profile, heroId: string, event?: EventModifier): RunConfig {
  if (!unlockedHeroes(profile).includes(heroId)) throw new MetaError('hero_locked');
  heroDef(heroId);
  const b = profile.buildings;
  const extra = zeroMods();
  let startPearls = b.hatchery >= 1 ? 3 : 0;
  let startGenes = b.hatchery >= 3 ? 3 : 0;
  let lives: number = BAL.lives;
  for (const t of TALENTS) {
    const level = profile.talents[t.id] ?? 0;
    if (level <= 0) continue;
    addMods(extra, t.mods?.[level - 1]);
    const cfg = t.cfg?.[level - 1];
    if (cfg) {
      startPearls += cfg.startPearls ?? 0;
      startGenes += cfg.startGenes ?? 0;
      lives += cfg.lives ?? 0;
    }
  }
  const mutSlots: MutSlot[] = ['claws', 'carapace'];
  if (b.lab >= 1) mutSlots.push('legs');
  if (b.lab >= 2) mutSlots.push('antennae');
  const lighthouse = LIGHTHOUSE_STAGES[b.lighthouse] ?? 3;
  const tutorial = !profile.tutorialDone;
  const cfg: RunConfig = {
    heroId,
    maxStage: lighthouse,
    tenantPool: TENANTS.filter((t) => t.unlock <= b.garden).map((t) => t.id),
    shellPool: SHELLS.filter((s) => !s.starter && s.unlock <= b.workshop).map((s) => s.id),
    mutSlots,
    mutMaxTier: b.lab >= 4 ? 3 : b.lab >= 3 ? 2 : 1,
    extraSlots: 0,
    startPearls,
    startGenes,
    lives,
    extra: extra as ModPatch,
    tutorial,
  };
  if (tutorial) cfg.starterTenant = 'anemone';
  if (event) cfg.event = event;
  return cfg;
}

// --- Run end ---------------------------------------------------------------------------------------

export interface RunSummary {
  coral: number;
  shine: number;
  trophies: number;
  newCreatures: string[];
  newTenants: string[];
  newShells: string[];
  newGuardians: string[];
  bestStage: boolean;
  chapterCleared: boolean;
}

/** Grants the rewards of an ended run and updates stats and the almanac. Pure. */
export function applyRunEnd(profile: Profile, run: RunState): { profile: Profile; summary: RunSummary } {
  if (run.phase !== 'ended' || !run.result) throw new MetaError('run_not_ended');
  const rewards = runRewards(run);
  const almanac: Almanac = {
    creatures: { ...profile.almanac.creatures },
    tenants: { ...profile.almanac.tenants },
    shells: profile.almanac.shells.slice(),
    guardians: profile.almanac.guardians.slice(),
    claimed: profile.almanac.claimed.slice(),
  };
  const summary: RunSummary = {
    coral: rewards.coral,
    shine: rewards.shine,
    trophies: rewards.trophies,
    newCreatures: [],
    newTenants: [],
    newShells: [],
    newGuardians: [],
    bestStage: false,
    chapterCleared: false,
  };
  for (const [id, n] of Object.entries(run.stats.eatenByCreature)) {
    if (!almanac.creatures[id]) summary.newCreatures.push(id);
    almanac.creatures[id] = (almanac.creatures[id] ?? 0) + n;
  }
  for (const [id, star] of Object.entries(run.stats.seenTenants)) {
    if (!almanac.tenants[id]) summary.newTenants.push(id);
    almanac.tenants[id] = Math.max(almanac.tenants[id] ?? 0, star);
  }
  for (const id of run.stats.seenShells) {
    if (!almanac.shells.includes(id)) {
      almanac.shells.push(id);
      summary.newShells.push(id);
    }
  }
  for (const id of run.stats.guardiansBeaten) {
    if (!almanac.guardians.includes(id)) {
      almanac.guardians.push(id);
      summary.newGuardians.push(id);
    }
  }
  const reached = run.stats.maxStage;
  const cleared = run.result === 'cleared' && reached >= 12;
  summary.bestStage = reached > profile.stats.bestStage;
  summary.chapterCleared = cleared && !profile.stats.chapterCleared;
  const next: Profile = {
    ...profile,
    coral: profile.coral + rewards.coral,
    shine: profile.shine + rewards.shine,
    trophies: Math.max(0, profile.trophies + rewards.trophies),
    almanac,
    tutorialDone: true,
    stats: {
      runs: profile.stats.runs + 1,
      carried: profile.stats.carried + (run.result === 'defeat' ? 0 : 1),
      defeats: profile.stats.defeats + (run.result === 'defeat' ? 1 : 0),
      bestStage: Math.max(profile.stats.bestStage, reached),
      chapterCleared: profile.stats.chapterCleared || cleared,
      eaten: profile.stats.eaten + run.stats.eatenTotal,
      merges: profile.stats.merges + run.stats.merges[0] + run.stats.merges[1],
      ghostWins: profile.stats.ghostWins + run.stats.ghostWins,
    },
  };
  return { profile: next, summary };
}

// --- Almanac milestones ------------------------------------------------------------------------------

export interface Milestone {
  id: string;
  kind: 'creatures' | 'tenants' | 'shells' | 'guardians' | 'stars';
  need: number;
  reward: Cost;
}

export const ALMANAC_TOTALS = {
  creatures: CREATURES.length,
  tenants: TENANTS.length,
  shells: SHELLS.length,
  guardians: GUARDIANS.length,
};

export const MILESTONES: readonly Milestone[] = [
  ...[5, 12, 20, 28, CREATURES.length].map((need, i) => ({ id: `creatures_${need}`, kind: 'creatures' as const, need, reward: { coral: 40 * (i + 1) * (i + 1), shine: 2 * (i + 1) } })),
  ...[6, 14, 24, 34, TENANTS.length].map((need, i) => ({ id: `tenants_${need}`, kind: 'tenants' as const, need, reward: { coral: 50 * (i + 1) * (i + 1), shine: 3 * (i + 1) } })),
  ...[4, 8, SHELLS.length].map((need, i) => ({ id: `shells_${need}`, kind: 'shells' as const, need, reward: { coral: 80 * (i + 1) * (i + 1), shine: 4 * (i + 1) } })),
  ...[1, 2, 3, 4].map((need, i) => ({ id: `guardians_${need}`, kind: 'guardians' as const, need, reward: { coral: 60 * (i + 1), shine: 5 * (i + 1) } })),
  ...[3, 10, 20].map((need, i) => ({ id: `stars_${need}`, kind: 'stars' as const, need, reward: { coral: 120 * (i + 1) * (i + 1), shine: 8 * (i + 1) } })),
];

export function milestoneProgress(almanac: Almanac, m: Milestone): number {
  switch (m.kind) {
    case 'creatures':
      return Object.keys(almanac.creatures).length;
    case 'tenants':
      return Object.keys(almanac.tenants).length;
    case 'shells':
      return almanac.shells.length;
    case 'guardians':
      return almanac.guardians.length;
    case 'stars':
      return Object.values(almanac.tenants).filter((s) => s >= 3).length;
  }
}

export function claimMilestone(profile: Profile, id: string): { profile: Profile; reward: Cost } {
  const m = MILESTONES.find((x) => x.id === id);
  if (!m) throw new MetaError('milestone_unknown');
  if (profile.almanac.claimed.includes(id)) throw new MetaError('milestone_claimed');
  if (milestoneProgress(profile.almanac, m) < m.need) throw new MetaError('milestone_locked');
  const mult = ALMANAC_REWARD_MULT[profile.buildings.almanac] ?? 1;
  const reward = { coral: Math.round(m.reward.coral * mult), shine: Math.round(m.reward.shine * mult) };
  return {
    profile: {
      ...profile,
      coral: profile.coral + reward.coral,
      shine: profile.shine + reward.shine,
      almanac: { ...profile.almanac, claimed: [...profile.almanac.claimed, id] },
    },
    reward,
  };
}
