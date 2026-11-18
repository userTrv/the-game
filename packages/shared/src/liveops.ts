import type { Fighter } from './build';
import type { Cost } from './data/town';
import type { EventModifier } from './meta';
import { createRng } from './rng';
import type { RunState } from './run';
import { DIETS, type Diet } from './types';

// --- Quests ----------------------------------------------------------------------------------------

export type QuestMetric =
  | 'eat_total'
  | `eat_${Diet}`
  | 'merge2'
  | 'merge3'
  | 'set4'
  | 'win_battle'
  | 'reach_stage'
  | 'carry_out'
  | 'pearls'
  | 'runs'
  | 'ghost_win'
  | 'upgrade'
  | 'kraken_hit';

export interface QuestDef {
  id: string;
  period: 'daily' | 'weekly';
  metric: QuestMetric;
  need: number;
  reward: Cost & { passXp: number };
  /** 'max' metrics keep the best value instead of summing. */
  mode?: 'sum' | 'max';
}

const q = (id: string, period: 'daily' | 'weekly', metric: QuestMetric, need: number, coral: number, shine: number, passXp: number, mode: 'sum' | 'max' = 'sum'): QuestDef => ({
  id, period, metric, need, reward: { coral, shine, passXp }, mode,
});

export const QUESTS: readonly QuestDef[] = [
  q('d_eat_60', 'daily', 'eat_total', 60, 14, 0, 20),
  ...DIETS.map((d) => q(`d_eat_${d}`, 'daily', `eat_${d}`, 25, 16, 0, 20)),
  q('d_merge2', 'daily', 'merge2', 2, 20, 1, 25),
  q('d_win', 'daily', 'win_battle', 1, 18, 1, 25),
  q('d_carry', 'daily', 'carry_out', 1, 14, 0, 20),
  q('d_pearls', 'daily', 'pearls', 25, 14, 0, 20),
  q('d_runs', 'daily', 'runs', 2, 16, 0, 20),
  q('d_upgrade', 'daily', 'upgrade', 1, 12, 0, 20),
  q('w_eat_500', 'weekly', 'eat_total', 500, 90, 2, 100),
  q('w_merge3', 'weekly', 'merge3', 1, 120, 3, 120),
  q('w_set4', 'weekly', 'set4', 4, 90, 2, 100, 'max'),
  q('w_stage9', 'weekly', 'reach_stage', 9, 120, 3, 120, 'max'),
  q('w_wins', 'weekly', 'win_battle', 8, 100, 2, 100),
  q('w_ghost', 'weekly', 'ghost_win', 3, 100, 3, 110),
  q('w_kraken', 'weekly', 'kraken_hit', 5, 80, 2, 100),
  q('w_runs', 'weekly', 'runs', 10, 90, 2, 100),
];

export const QUEST_BY_ID: ReadonlyMap<string, QuestDef> = new Map(QUESTS.map((x) => [x.id, x]));
export const DAILY_QUESTS = 3;
export const WEEKLY_QUESTS = 3;

export interface QuestProgress {
  id: string;
  progress: number;
  claimed: boolean;
}

export interface QuestState {
  /** UTC day key YYYY-MM-DD. */
  day: string;
  daily: QuestProgress[];
  /** ISO week key YYYY-Www. */
  week: string;
  weekly: QuestProgress[];
}

export function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function weekKey(ms: number): string {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((thursday.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function rollQuests(period: 'daily' | 'weekly', count: number, seed: string): QuestProgress[] {
  const pool = QUESTS.filter((x) => x.period === period);
  return createRng(seed)
    .shuffle(pool)
    .slice(0, count)
    .map((x) => ({ id: x.id, progress: 0, claimed: false }));
}

/** Rolls new daily/weekly quests when the period changed. Deterministic per player and period. */
export function refreshQuests(state: QuestState | null, playerId: string, now: number): QuestState {
  const day = dayKey(now);
  const week = weekKey(now);
  return {
    day,
    daily: state && state.day === day ? state.daily : rollQuests('daily', DAILY_QUESTS, `q/${playerId}/${day}`),
    week,
    weekly: state && state.week === week ? state.weekly : rollQuests('weekly', WEEKLY_QUESTS, `q/${playerId}/${week}`),
  };
}

export type QuestDeltas = Partial<Record<QuestMetric, number>>;

export function questDeltasForRun(run: RunState): QuestDeltas {
  const d: QuestDeltas = {
    eat_total: run.stats.eatenTotal,
    merge2: run.stats.merges[0],
    merge3: run.stats.merges[1],
    win_battle: run.stats.battlesWon,
    reach_stage: run.stats.maxStage,
    carry_out: run.result === 'defeat' ? 0 : 1,
    pearls: run.stats.pearlsEarned,
    runs: 1,
    ghost_win: run.stats.ghostWins,
    set4: Math.max(...DIETS.map((x) => run.stats.maxSet[x])),
  };
  for (const diet of DIETS) d[`eat_${diet}`] = run.stats.eatenByDiet[diet];
  return d;
}

export function applyQuestDeltas(state: QuestState, deltas: QuestDeltas): QuestState {
  const bump = (list: QuestProgress[]): QuestProgress[] =>
    list.map((p) => {
      const def = QUEST_BY_ID.get(p.id);
      const delta = def ? deltas[def.metric] : undefined;
      if (!def || !delta || p.claimed) return p;
      const progress = def.mode === 'max' ? Math.max(p.progress, delta) : p.progress + delta;
      return { ...p, progress: Math.min(def.need, progress) };
    });
  return { ...state, daily: bump(state.daily), weekly: bump(state.weekly) };
}

// --- Weekly event ------------------------------------------------------------------------------------

export interface LocalText {
  ru: string;
  en: string;
}

export interface LiveEventConfig {
  id: string;
  title: LocalText;
  description: LocalText;
  /** Unix ms. */
  startsAt: number;
  endsAt: number;
  modifier: Omit<EventModifier, 'id'>;
  /** Diet whose eaten creatures score points; all creatures score when absent. */
  featuredDiet?: Diet;
  /** Leaderboard rewards by rank (inclusive upper bound). */
  rankRewards: { upTo: number; reward: Cost; cosmetic?: string }[];
}

export function eventModifier(ev: LiveEventConfig): EventModifier {
  return { id: ev.id, ...ev.modifier };
}

export function eventScore(run: RunState, ev: LiveEventConfig): number {
  const eaten = ev.featuredDiet ? run.stats.eatenByDiet[ev.featuredDiet] : run.stats.eatenTotal;
  return eaten + 15 * run.stats.maxStage + 40 * run.stats.battlesWon;
}

export const DEFAULT_EVENTS: readonly Omit<LiveEventConfig, 'startsAt' | 'endsAt'>[] = [
  {
    id: 'jelly_bloom',
    title: { ru: 'Нерест медуз', en: 'Jellyfish bloom' },
    description: { ru: 'Жгучих существ вдвое больше. Очки события дают съеденные жгучие.', en: 'Twice as many stinging creatures. Stinging prey scores event points.' },
    modifier: { dietWeights: { sting: 2 } },
    featuredDiet: 'sting',
    rankRewards: [
      { upTo: 1, reward: { coral: 750, shine: 40 }, cosmetic: 'title_jelly_king' },
      { upTo: 10, reward: { coral: 450, shine: 22 } },
      { upTo: 100, reward: { coral: 220, shine: 10 } },
      { upTo: 100000, reward: { coral: 70, shine: 3 } },
    ],
  },
  {
    id: 'pearl_tide',
    title: { ru: 'Жемчужный прилив', en: 'Pearl tide' },
    description: { ru: 'Жемчужницы щедрее на треть, панцирных существ больше.', en: 'Oysters give a third more pearls, more armored creatures.' },
    modifier: { dietWeights: { armor: 1.6 }, pearlPct: 35 },
    featuredDiet: 'armor',
    rankRewards: [
      { upTo: 1, reward: { coral: 750, shine: 40 }, cosmetic: 'title_pearl_baron' },
      { upTo: 10, reward: { coral: 450, shine: 22 } },
      { upTo: 100, reward: { coral: 220, shine: 10 } },
      { upTo: 100000, reward: { coral: 70, shine: 3 } },
    ],
  },
  {
    id: 'glow_night',
    title: { ru: 'Ночь светлячков', en: 'Night of lights' },
    description: { ru: 'Светящихся существ вдвое больше, добыча ценнее.', en: 'Twice as many glowing creatures, loot is worth more.' },
    modifier: { dietWeights: { glow: 2 }, lootPct: 15 },
    featuredDiet: 'glow',
    rankRewards: [
      { upTo: 1, reward: { coral: 750, shine: 40 }, cosmetic: 'title_lamplighter' },
      { upTo: 10, reward: { coral: 450, shine: 22 } },
      { upTo: 100, reward: { coral: 220, shine: 10 } },
      { upTo: 100000, reward: { coral: 70, shine: 3 } },
    ],
  },
];

/**
 * Builds without a server have no leaderboard: the rank tiers of an event turn into personal score
 * goals, best tier first. A week of steady play reaches the second goal.
 */
export const EVENT_SCORE_GOALS = [6000, 3000, 1200, 1] as const;

export function eventGoals(ev: LiveEventConfig, score: number): { score: number; reward: Cost; cosmetic?: string; reached: boolean }[] {
  return ev.rankRewards.map((r, i) => {
    const need = EVENT_SCORE_GOALS[Math.min(i, EVENT_SCORE_GOALS.length - 1)] as number;
    return r.cosmetic ? { score: need, reward: r.reward, cosmetic: r.cosmetic, reached: score >= need } : { score: need, reward: r.reward, reached: score >= need };
  });
}

/** Kraken health in builds without a server: the share of one active player on the server. */
export const KRAKEN_SOLO_HP = 6000;

// --- Kraken (community boss) ---------------------------------------------------------------------------

export interface KrakenConfig {
  id: string;
  hpMax: number;
  startsAt: number;
  endsAt: number;
  /** Rewards for everyone who hit the Kraken once the community passes a damage share. */
  thresholds: { pct: number; reward: Cost }[];
}

export const KRAKEN_ATTACKS_PER_DAY = 3;
export const KRAKEN_DEFAULT_THRESHOLDS: KrakenConfig['thresholds'] = [
  { pct: 25, reward: { coral: 70, shine: 3 } },
  { pct: 50, reward: { coral: 150, shine: 6 } },
  { pct: 75, reward: { coral: 250, shine: 10 } },
  { pct: 100, reward: { coral: 450, shine: 20 } },
];

/** The Kraken never dies inside one fight: the damage dealt in the fight is the contribution. */
export function krakenFighter(): Fighter {
  return {
    id: 'kraken',
    isGuardian: true,
    maxHp: 1e9,
    atk: 18,
    interval: 1.1,
    armor: 25,
    crit: 0.1,
    critMult: 2,
    dodge: 0,
    thorns: 0,
    reflect: 0,
    regen: 0,
    leech: 0,
    zapOnHit: 0,
    poisonOnHit: 0,
    poisonThorns: 0,
    shieldOnHit: 0,
    blindOnCrit: 0,
    startShield: 0,
    shieldMult: 1,
    healMult: 1,
    poisonNoDecay: false,
    poisonWeaken: 0,
    weakAura: 0,
    revive: 0,
    chainBonus: 0,
    stormEvery: 0,
    abilities: [
      { src: 0, kind: 'blind', cd: 9, v: 2, dur: 0, n: 0, family: 'glow', first: 3, range: 0 },
      { src: 1, kind: 'zap', cd: 5, v: 30, dur: 0, n: 0, family: 'sting', first: 4, range: 0 },
      { src: 2, kind: 'poison', cd: 6, v: 6, dur: 0, n: 0, family: 'venom', first: 6, range: 0 },
    ],
  };
}

// --- Leagues ---------------------------------------------------------------------------------------------

export const LEAGUES = [
  { id: 'bronze', min: 0 },
  { id: 'silver', min: 200 },
  { id: 'gold', min: 500 },
  { id: 'platinum', min: 900 },
  { id: 'diamond', min: 1400 },
  { id: 'legend', min: 2000 },
] as const;
export type LeagueId = (typeof LEAGUES)[number]['id'];

export function leagueOf(trophies: number): LeagueId {
  let id: LeagueId = 'bronze';
  for (const l of LEAGUES) if (trophies >= l.min) id = l.id;
  return id;
}

/** Soft reset at the end of a season. */
export function seasonResetTrophies(trophies: number): number {
  return Math.floor(trophies * 0.5);
}

// --- Cosmetics -------------------------------------------------------------------

export type CosmeticKind = 'crab' | 'shell' | 'merge' | 'town' | 'title';

export interface CosmeticDef {
  id: string;
  kind: CosmeticKind;
  source: 'ads' | 'pass' | 'league' | 'event' | 'free';
}

export const COSMETICS: readonly CosmeticDef[] = [
  { id: 'crab_default', kind: 'crab', source: 'free' },
  { id: 'crab_azure', kind: 'crab', source: 'ads' },
  { id: 'crab_coral', kind: 'crab', source: 'ads' },
  { id: 'crab_gold', kind: 'crab', source: 'pass' },
  { id: 'crab_abyss', kind: 'crab', source: 'league' },
  { id: 'shell_default', kind: 'shell', source: 'free' },
  { id: 'shell_candy', kind: 'shell', source: 'ads' },
  { id: 'shell_galaxy', kind: 'shell', source: 'ads' },
  { id: 'shell_pearl', kind: 'shell', source: 'pass' },
  { id: 'merge_default', kind: 'merge', source: 'free' },
  { id: 'merge_rainbow', kind: 'merge', source: 'ads' },
  { id: 'merge_bubbles', kind: 'merge', source: 'pass' },
  { id: 'town_default', kind: 'town', source: 'free' },
  { id: 'town_lanterns', kind: 'town', source: 'ads' },
  { id: 'title_jelly_king', kind: 'title', source: 'event' },
  { id: 'title_pearl_baron', kind: 'title', source: 'event' },
  { id: 'title_lamplighter', kind: 'title', source: 'event' },
  { id: 'title_gold_claw', kind: 'title', source: 'league' },
  { id: 'title_reef_legend', kind: 'title', source: 'league' },
];
export const COSMETIC_BY_ID: ReadonlyMap<string, CosmeticDef> = new Map(COSMETICS.map((x) => [x.id, x]));

/**
 * Things unlocked by watching rewarded ads, one view at a time. Progress is kept, so a player can
 * spread the views over several sessions. Nothing here changes battle strength.
 */
export type AdUnlockGrant = { type: 'cosmetic'; id: string } | { type: 'pass' };

export interface AdUnlockDef {
  id: string;
  /** Rewarded ads needed to unlock. */
  views: number;
  grant: AdUnlockGrant;
}

export const AD_UNLOCKS: readonly AdUnlockDef[] = [
  { id: 'merge_rainbow', views: 4, grant: { type: 'cosmetic', id: 'merge_rainbow' } },
  { id: 'crab_azure', views: 5, grant: { type: 'cosmetic', id: 'crab_azure' } },
  { id: 'crab_coral', views: 5, grant: { type: 'cosmetic', id: 'crab_coral' } },
  { id: 'town_lanterns', views: 5, grant: { type: 'cosmetic', id: 'town_lanterns' } },
  { id: 'shell_candy', views: 7, grant: { type: 'cosmetic', id: 'shell_candy' } },
  { id: 'shell_galaxy', views: 7, grant: { type: 'cosmetic', id: 'shell_galaxy' } },
  { id: 'season_pass', views: 12, grant: { type: 'pass' } },
];
export const AD_UNLOCK_BY_ID: ReadonlyMap<string, AdUnlockDef> = new Map(AD_UNLOCKS.map((x) => [x.id, x]));

/** Season pass: XP comes from quests; the free track gives resources, the premium one (unlocked by ads) cosmetics. */
export const PASS_XP_PER_LEVEL = 100;
export const PASS_LEVELS = 20;
export interface PassReward {
  level: number;
  free: Cost;
  premium: { cosmetic?: string; coral?: number; shine?: number };
}
export const PASS_REWARDS: readonly PassReward[] = Array.from({ length: PASS_LEVELS }, (_, i) => {
  const level = i + 1;
  const premium: PassReward['premium'] =
    level === 5 ? { cosmetic: 'merge_bubbles' } : level === 12 ? { cosmetic: 'shell_pearl' } : level === 20 ? { cosmetic: 'crab_gold' } : { coral: 60 + 15 * level, shine: level % 2 === 0 ? 3 : 0 };
  return { level, free: { coral: 30 + 10 * level, shine: level % 5 === 0 ? 5 : 0 }, premium };
});

// --- Rewarded ads --------------------------------------------------------------------------------------------

export const AD_PLACEMENTS = ['double_loot', 'second_chance', 'daily_chest', 'reroll', 'corf_boost', 'unlock'] as const;
export type AdPlacement = (typeof AD_PLACEMENTS)[number];
export const AD_DAILY_CAPS: Record<AdPlacement, number> = {
  double_loot: 5,
  second_chance: 1,
  daily_chest: 1,
  reroll: 6,
  corf_boost: 3,
  unlock: 30,
};
export const AD_DAILY_TOTAL = 12;
export const DAILY_CHEST_REWARD: Cost = { coral: 80, shine: 3 };
export const CORF_BOOST_MULT = 2;

export const REFERRAL_REWARD: Cost = { coral: 150, shine: 5 };
