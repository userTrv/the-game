import { simulateBattle, type BattleResult } from './battle';
import { buildFighter, computeMods, familyCounts, guardianFighter, slotCount, slotLinks, type Fighter } from './build';
import { BAL, feed, genesForTier, maxMealTier } from './data/balance';
import { guardianDef } from './data/guardians';
import { heroDef } from './data/heroes';
import { mutationDef } from './data/mutations';
import { poolDef, poolDietWeights, type Pool, type PoolKind } from './data/pools';
import { MAX_SHELL_TIER } from './data/shells';
import { tenantDef } from './data/tenants';
import { generateOffers, generateShellChoices, generateShop, registerMaxHp, tenantPrice, type Offer, type ShopItem } from './offers';
import { createRng, subSeed } from './rng';
import { CHAPTER_STAGES, spawnTable, stageInfo, type SpawnEntry } from './stages';
import {
  DIETS,
  zeroDiets,
  type BuildSnapshot,
  type Diet,
  type DietMap,
  type ModPatch,
  type Mods,
  type MutationInst,
  type MutSlot,
  type ShellInst,
  type Star,
  type TenantInst,
} from './types';

/** Snapshot of the player's meta progression taken when the run starts. */
export interface RunConfig {
  heroId: string;
  /** Deepest stage the player may reach (lighthouse level); the run is "cleared" after it. */
  maxStage: number;
  tenantPool: string[];
  shellPool: string[];
  mutSlots: MutSlot[];
  mutMaxTier: number;
  extraSlots: number;
  startPearls: number;
  startGenes: number;
  lives: number;
  /** Aggregated talent mods. */
  extra: ModPatch;
  /** Weekly event modifier. */
  event?: { id: string; dietWeights?: Partial<Record<Diet, number>>; lootPct?: number; pearlPct?: number };
  /** First ever run: scripted offers so the first merge happens early. */
  tutorial: boolean;
  starterTenant?: string;
}

export interface CampState {
  /** Stage this camp follows. */
  after: number;
  offers: Offer[];
  offerTaken: boolean;
  shop: ShopItem[];
  rerolls: number;
  /** A copy of a tenant already on the shell can be ordered once per camp. */
  ordered?: boolean;
  /** Non-null while the crab has to pick a new shell first. */
  shellChoices: ShellInst[] | null;
  /** Currents to choose from when the next stage is a pool. */
  paths?: Pool[];
  /** Another player's build to spar with; the server attaches it. null = nobody around. */
  rival?: Extract<Enemy, { kind: 'ghost' }> | null;
  dueled?: boolean;
}

export type Enemy =
  | { kind: 'guardian'; id: string; hpMult: number; atkMult: number }
  | { kind: 'ghost'; ghostId: string; name: string; build: BuildSnapshot; power: number };

export interface BattleSetup {
  stage: number;
  enemy: Enemy;
  attempt: number;
}

export interface RunStats {
  eatenByDiet: DietMap;
  eatenByCreature: Record<string, number>;
  eatenTotal: number;
  /** Merges into ★★ and ★★★. */
  merges: [number, number];
  maxSet: DietMap;
  battlesWon: number;
  battlesLost: number;
  ghostWins: number;
  ghostLosses: number;
  kos: number;
  pearlsEarned: number;
  rerolls: number;
  huntSeconds: number;
  maxStage: number;
  /** Almanac discoveries: tenant id -> highest star held, shells worn, guardians beaten. */
  seenTenants: Record<string, number>;
  seenShells: string[];
  guardiansBeaten: string[];
  /** Feat counters (absent in runs started before they existed). */
  linksMax?: number;
  parries?: number;
  trophies?: number;
  duelWins?: number;
  /** A guardian was beaten with at least 80 % health left. */
  flawless?: boolean;
}

export type RunPhase = 'hunt' | 'camp' | 'battle' | 'down' | 'ended';
export type RunResult = 'carried' | 'defeat' | 'cleared';

export interface RunState {
  v: 1;
  id: string;
  seed: string;
  cfg: RunConfig;
  stage: number;
  phase: RunPhase;
  hp: number;
  lives: number;
  size: number;
  xp: number;
  genes: DietMap;
  mutations: Partial<Record<MutSlot, MutationInst>>;
  shell: ShellInst;
  slots: (TenantInst | null)[];
  pearls: number;
  loot: { coral: number; shine: number };
  camp: CampState | null;
  battle: BattleSetup | null;
  /** Diets whose gene threshold was crossed and not yet rewarded with a mutation offer. */
  pendingMutations: Diet[];
  flags: { adReroll: boolean; secondChance: boolean; adDouble: boolean };
  stats: RunStats;
  result: RunResult | null;
  /** Increments with every hunt; part of the hunt token. */
  huntNonce: number;
  /** Current of the pool being hunted (absent in the first pool of a run). */
  pool?: Pool | null;
}

export interface HuntReport {
  /** Ordered meals as [creature id, tier]; the server replays growth from it. */
  log?: [string, number][];
  /** Compact form without order (tests, simulator): creature id -> number eaten at the stage tier. */
  eaten?: Record<string, number>;
  nodes: { oyster: number; coral: number; glitter: number; chest?: number };
  /** Pearls dropped by slain predators. */
  drops?: number;
  /** The pool's marked prey was eaten. */
  trophy?: boolean;
  /** Bites parried by hiding at the right moment. */
  parries?: number;
  durationS: number;
  /** HP lost during the pool, absolute, after healing. May be negative (net heal). */
  hpLost: number;
  ko: boolean;
}

export type RunAction =
  | { type: 'hunt_done'; report: HuntReport }
  | { type: 'pick_offer'; index: number; slot?: number }
  | { type: 'skip_offer' }
  | { type: 'buy'; index: number; slot?: number }
  /** Buys a ★ copy of the tenant sitting in slot `of`. */
  | { type: 'order'; of: number; slot?: number }
  | { type: 'reroll'; free?: boolean }
  | { type: 'sell'; slot: number }
  | { type: 'move'; from: number; to: number }
  | { type: 'choose_shell'; index: number }
  | { type: 'descend'; ghost?: Extract<Enemy, { kind: 'ghost' }>; path?: number }
  /** Spars with the camp's rival: no lives at stake. */
  | { type: 'duel' }
  | { type: 'carry_out' }
  | { type: 'battle' }
  | { type: 'second_chance' }
  | { type: 'give_up' };

export type RunEvent =
  | { type: 'merge'; id: string; star: Star; slot: number; from: number[] }
  | { type: 'tenant_added'; id: string; star: Star; slot: number }
  | { type: 'tenant_sold'; id: string; star: Star; slot: number; pearls: number }
  | { type: 'mutation'; slot: MutSlot; id: string; tier: number }
  | { type: 'grow'; size: number }
  | { type: 'gene_threshold'; diet: Diet; level: number }
  | { type: 'shell'; shell: ShellInst }
  | { type: 'heal'; amount: number }
  | { type: 'ko'; lives: number }
  | { type: 'battle'; result: BattleResult; won: boolean; enemy: Enemy; seed: string; duel?: boolean; rewards?: { pearls: number; shine: number; trophies: number } }
  | { type: 'trophy'; id: string; pearls: number }
  | { type: 'clamped'; what: string }
  | { type: 'ended'; result: RunResult };

export class RunError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
  }
}

function fail(code: string, message?: string): never {
  throw new RunError(code, message);
}

export function buildOf(state: RunState): BuildSnapshot {
  const extra: ModPatch = { ...state.cfg.extra };
  return {
    heroId: state.cfg.heroId,
    size: state.size,
    genes: state.genes,
    mutations: state.mutations,
    shell: state.shell,
    slots: state.slots,
    extra,
  };
}

export function runMods(state: RunState): Mods {
  return computeMods(buildOf(state));
}

export function runFighter(state: RunState): Fighter {
  return buildFighter(buildOf(state));
}

export function maxHpOf(state: RunState): number {
  return runFighter(state).maxHp;
}

export function lootMult(state: RunState, stage: number, mods: Mods): number {
  return (1 + BAL.lootDepthK * (stage - 1)) * (1 + (mods.lootPct + (state.cfg.event?.lootPct ?? 0)) / 100);
}

registerMaxHp(maxHpOf);

function emptyStats(): RunStats {
  return {
    eatenByDiet: zeroDiets(),
    eatenByCreature: {},
    eatenTotal: 0,
    merges: [0, 0],
    maxSet: zeroDiets(),
    battlesWon: 0,
    battlesLost: 0,
    ghostWins: 0,
    ghostLosses: 0,
    kos: 0,
    pearlsEarned: 0,
    rerolls: 0,
    huntSeconds: 0,
    maxStage: 1,
    seenTenants: {},
    seenShells: [],
    guardiansBeaten: [],
  };
}

export function startRun(id: string, seed: string, cfg: RunConfig): RunState {
  const hero = heroDef(cfg.heroId);
  const shell: ShellInst = { id: 'periwinkle', tier: 0 };
  const n = slotCount(hero.id, shell, cfg.extraSlots);
  const slots: (TenantInst | null)[] = new Array<TenantInst | null>(n).fill(null);
  if (cfg.starterTenant) slots[0] = { id: cfg.starterTenant, star: 1 };
  const genes = zeroDiets();
  for (const d of DIETS) genes[d] = cfg.startGenes;
  const state: RunState = {
    v: 1,
    id,
    seed,
    cfg,
    stage: 1,
    phase: 'hunt',
    hp: 0,
    lives: cfg.lives,
    size: 1,
    xp: 0,
    genes,
    mutations: {},
    shell,
    slots,
    pearls: cfg.startPearls,
    loot: { coral: 0, shine: 0 },
    camp: null,
    battle: null,
    pendingMutations: [],
    flags: { adReroll: false, secondChance: false, adDouble: false },
    stats: emptyStats(),
    result: null,
    huntNonce: 1,
  };
  state.hp = maxHpOf(state);
  updateSetStats(state);
  return state;
}

// --- Tenants -----------------------------------------------------------------------------------

export function sellValue(t: TenantInst): number {
  const base = BAL.sellPrice[tenantDef(t.id).rarity - 1] as number;
  return base * Math.pow(3, t.star - 1);
}

/** Would adding this tenant immediately merge (so no free slot is needed)? */
export function wouldMerge(state: RunState, id: string, star: Star): boolean {
  if (star >= 3) return false;
  const need = heroDef(state.cfg.heroId).mergeCount - 1;
  let have = 0;
  for (const t of state.slots) if (t && t.id === id && t.star === star) have += 1;
  return have >= need;
}

function resolveMerges(state: RunState, events: RunEvent[]): void {
  const need = heroDef(state.cfg.heroId).mergeCount;
  for (let guard = 0; guard < 20; guard++) {
    let merged = false;
    const groups = new Map<string, number[]>();
    state.slots.forEach((t, i) => {
      if (!t || t.star >= 3) return;
      const key = `${t.id}:${t.star}`;
      const list = groups.get(key);
      if (list) list.push(i);
      else groups.set(key, [i]);
    });
    for (const [key, idx] of groups) {
      if (idx.length < need) continue;
      const used = idx.slice(0, need);
      const [id, starStr] = key.split(':') as [string, string];
      const star = (Number(starStr) + 1) as Star;
      const keep = used[0] as number;
      for (const i of used) state.slots[i] = null;
      state.slots[keep] = { id, star };
      state.stats.merges[star - 2] = (state.stats.merges[star - 2] ?? 0) + 1;
      events.push({ type: 'merge', id, star, slot: keep, from: used });
      merged = true;
      break;
    }
    if (!merged) break;
  }
  updateSetStats(state);
}

function updateSetStats(state: RunState): void {
  const counts = familyCounts(state.slots);
  for (const d of DIETS) state.stats.maxSet[d] = Math.max(state.stats.maxSet[d], counts[d]);
  const links = slotLinks(state.slots, state.cfg.heroId).active.length;
  state.stats.linksMax = Math.max(state.stats.linksMax ?? 0, links);
  for (const t of state.slots) {
    if (t) state.stats.seenTenants[t.id] = Math.max(state.stats.seenTenants[t.id] ?? 0, t.star);
  }
}

/**
 * Puts a tenant on the shell. Uses a free slot, or merges, or replaces `slot` (the replaced tenant
 * is sold). Throws when there is no room and no slot was given.
 */
function addTenant(state: RunState, t: TenantInst, slot: number | undefined, events: RunEvent[]): void {
  let target = state.slots.findIndex((x) => x === null);
  if (slot !== undefined && slot >= 0 && slot < state.slots.length) {
    const current = state.slots[slot];
    if (current === null) target = slot;
    else if (target < 0 && !wouldMerge(state, t.id, t.star)) {
      const pearls = sellValue(current as TenantInst);
      state.pearls += pearls;
      events.push({ type: 'tenant_sold', id: (current as TenantInst).id, star: (current as TenantInst).star, slot, pearls });
      state.slots[slot] = null;
      target = slot;
    }
  }
  if (target < 0) {
    if (!wouldMerge(state, t.id, t.star)) fail('no_slot', 'shell is full: choose a slot to replace');
    // Temporarily append; the merge frees it right away.
    state.slots.push({ ...t });
    events.push({ type: 'tenant_added', id: t.id, star: t.star, slot: state.slots.length - 1 });
    resolveMerges(state, events);
    state.slots.pop();
    return;
  }
  state.slots[target] = { ...t };
  events.push({ type: 'tenant_added', id: t.id, star: t.star, slot: target });
  resolveMerges(state, events);
}

function clampHp(state: RunState): void {
  const max = maxHpOf(state);
  state.hp = Math.max(1, Math.min(max, state.hp));
}

// --- Hunt --------------------------------------------------------------------------------------

export interface HuntCaps {
  maxEaten: number;
  maxOysters: number;
  maxCorals: number;
  maxGlitter: number;
  maxChests: number;
  maxDuration: number;
}

/** Physical limits of a pool of the given length: how much a crab could possibly find and eat. */
export function huntCaps(durationS: number): HuntCaps {
  const h = BAL.hunt;
  const d = Math.max(0, Math.min(h.hardMaxTime, durationS));
  return {
    maxEaten: h.initialSpawn + Math.ceil((h.spawnRate[1] as number) * 1.3 * d) + 6,
    maxOysters: 3 + Math.floor(d / 8),
    maxCorals: 4 + Math.floor(d / 6),
    maxGlitter: 1 + Math.floor(d / 45),
    maxChests: 1 + Math.floor(d / 40),
    maxDuration: h.hardMaxTime,
  };
}

export function orderPrice(t: TenantInst): number {
  return tenantPrice(t.id, 1) + BAL.orderExtra;
}

/**
 * Applies a hunt report. The client only says what it ate and collected; all gains are derived here
 * from game data, and anything above the physical limits of a pool is cut down.
 * `maxDurationS` is the wall-clock time since the hunt started (the server passes it).
 */
function applyHunt(state: RunState, report: HuntReport, maxDurationS: number | undefined, events: RunEvent[]): void {
  const stage = state.stage;
  let duration = Math.max(0, Math.min(BAL.hunt.hardMaxTime, Number(report.durationS) || 0));
  if (maxDurationS !== undefined && duration > maxDurationS + 2) {
    duration = Math.max(0, maxDurationS);
    events.push({ type: 'clamped', what: 'duration' });
  }
  const caps = huntCaps(duration);
  const pool = poolDef(state.pool);
  const table = new Map(spawnTable(stage, poolDietWeights(state.pool, state.cfg.event?.dietWeights)).map((e) => [e.def.id, e]));
  const modsBefore = runMods(state);
  const hero = heroDef(state.cfg.heroId);

  // Meals in order. The compact form is replayed from the smallest fauna up, like a crab growing into a pool.
  let log: [string, number][] = [];
  if (Array.isArray(report.log)) {
    for (const entry of report.log) {
      if (Array.isArray(entry)) log.push([String(entry[0]), Math.floor(Number(entry[1]))]);
    }
  } else {
    const groups: [string, number, number][] = [];
    for (const [id, raw] of Object.entries(report.eaten ?? {})) {
      const n = Math.floor(Number(raw));
      if (n > 0) groups.push([id, table.get(id)?.tier ?? 0, Math.min(n, caps.maxEaten + 1)]);
    }
    groups.sort((a, b) => a[1] - b[1]);
    for (const [id, tier, n] of groups) for (let i = 0; i < n; i++) log.push([id, tier]);
  }
  const unknown = new Set<string>();
  log = log.filter(([id]) => {
    if (table.has(id)) return true;
    unknown.add(id);
    return false;
  });
  for (const id of unknown) events.push({ type: 'clamped', what: `creature:${id}` });
  if (log.length > caps.maxEaten) {
    // Thin out evenly so the order of what remains is kept.
    const k = caps.maxEaten / log.length;
    log = log.filter((_, i) => Math.floor((i + 1) * k) > Math.floor(i * k));
    events.push({ type: 'clamped', what: 'eaten' });
  }

  const lm = lootMult(state, stage, modsBefore);
  const geneBefore: DietMap = { ...state.genes };
  const hpBefore = maxHpOf(state);
  let predatorMeals = 0;
  let tierClamped = false;
  for (const [id, rawTier] of log) {
    const entry = table.get(id);
    if (!entry) continue;
    const top = maxMealTier(state.size, entry.tier);
    const tier = Math.max(entry.tier, Math.min(top, Number.isFinite(rawTier) ? rawTier : entry.tier));
    if (tier !== rawTier) tierClamped = true;
    if (tier > state.size) predatorMeals += 1;
    const def = entry.def;
    if (feed(state, tier, (1 + modsBefore.xpPct / 100) * pool.xp * 100 - 100)) events.push({ type: 'grow', size: state.size });
    const swarm = state.pool?.kind === 'swarm' && state.pool.diet === def.diet ? 1 + pool.swarmGenePct / 100 : 1;
    state.genes[def.diet] += genesForTier(tier) * hero.geneMult * (1 + modsBefore.genePct / 100) * swarm;
    state.loot.coral += BAL.hunt.coralPerTier * tier * lm;
    state.stats.eatenByDiet[def.diet] += 1;
    state.stats.eatenByCreature[id] = (state.stats.eatenByCreature[id] ?? 0) + 1;
    state.stats.eatenTotal += 1;
  }
  if (tierClamped && Array.isArray(report.log)) events.push({ type: 'clamped', what: 'tier' });

  const rng = createRng(subSeed(state.seed, 'nodes', stage, state.huntNonce));
  const clampNode = (v: unknown, cap: number, what: string): number => {
    const n = Math.max(0, Math.floor(Number(v) || 0));
    if (n > cap) events.push({ type: 'clamped', what });
    return Math.min(n, cap);
  };
  const oysters = clampNode(report.nodes?.oyster, caps.maxOysters, 'oyster');
  const corals = clampNode(report.nodes?.coral, caps.maxCorals, 'coral');
  const glitter = clampNode(report.nodes?.glitter, caps.maxGlitter, 'glitter');
  const chests = clampNode(report.nodes?.chest, caps.maxChests, 'chest');
  const drops = clampNode(report.drops, predatorMeals + 2, 'drops');
  // The marked prey: one per pool, and only a crab that had time to reach it.
  let trophyPearls = 0;
  if (report.trophy === true && duration >= 8) {
    const prey = trophyOf(state);
    if (prey) {
      trophyPearls = BAL.hunt.trophyPearls;
      state.genes[prey.def.diet] += BAL.hunt.trophyGenes * hero.geneMult;
      state.stats.trophies = (state.stats.trophies ?? 0) + 1;
      events.push({ type: 'trophy', id: prey.def.id, pearls: trophyPearls });
    }
  }
  state.stats.parries = (state.stats.parries ?? 0) + clampNode(report.parries, 1 + Math.floor(duration / 3), 'parries');
  const rawPearls = oysters * BAL.hunt.oysterPearls * pool.oyster + chests * BAL.hunt.chestPearls + drops + trophyPearls;
  const pearls = Math.round(rawPearls * (1 + (modsBefore.pearlPct + (state.cfg.event?.pearlPct ?? 0)) / 100));
  state.pearls += pearls;
  state.stats.pearlsEarned += pearls;
  state.loot.coral += chests * BAL.hunt.chestCoral * lm;
  for (let i = 0; i < corals; i++) state.loot.coral += rng.int(BAL.hunt.coralYield[0] as number, BAL.hunt.coralYield[1] as number) * lm;
  for (let i = 0; i < glitter; i++) state.loot.shine += rng.int(BAL.hunt.glitterYield[0] as number, BAL.hunt.glitterYield[1] as number) * lm;
  state.stats.huntSeconds += duration;

  // Gene thresholds -> guaranteed mutation offers.
  for (const d of DIETS) {
    BAL.geneThresholds.forEach((th, level) => {
      if (geneBefore[d] < th && state.genes[d] >= th) {
        events.push({ type: 'gene_threshold', diet: d, level: level + 1 });
        if (!state.pendingMutations.includes(d)) state.pendingMutations.push(d);
      }
    });
  }

  // Health: growth heals by the gained max HP.
  const hpAfter = maxHpOf(state);
  const lost = Math.max(-hpAfter, Math.min(hpAfter * 3, Number(report.hpLost) || 0));
  state.hp = state.hp + (hpAfter - hpBefore) - lost;
  if (report.ko || state.hp <= 0) {
    state.lives -= 1;
    state.stats.kos += 1;
    state.hp = (hpAfter * BAL.koHpPct) / 100;
    events.push({ type: 'ko', lives: state.lives });
  }
  clampHp(state);
}

// --- Camp --------------------------------------------------------------------------------------

function enterCamp(state: RunState, events: RunEvent[]): void {
  const max = maxHpOf(state);
  const healed = Math.min(max - state.hp, (max * BAL.campHealPct) / 100);
  if (healed > 0) {
    state.hp += healed;
    events.push({ type: 'heal', amount: healed });
  }
  const rng = createRng(subSeed(state.seed, 'camp', state.stage));
  const shellTier = Math.min(MAX_SHELL_TIER, BAL.shellSizes.filter((s) => state.size >= s).length);
  state.camp = {
    after: state.stage,
    offers: generateOffers(state, rng),
    offerTaken: false,
    shop: generateShop(state, rng),
    rerolls: 0,
    shellChoices: shellTier > state.shell.tier ? generateShellChoices(state, shellTier, rng) : null,
  };
  const next = state.stage + 1;
  if (next <= state.cfg.maxStage && stageInfo(next).kind === 'hunt') state.camp.paths = generatePaths(state, next);
  state.pendingMutations = [];
  state.phase = 'camp';
  state.battle = null;
}

const PATH_KINDS: readonly PoolKind[] = ['calm', 'pearl', 'swarm', 'nest', 'dark'];

/** Three different currents for the pool at `stage`; a swarm is of a family that lives there. */
export function generatePaths(state: RunState, stage: number): Pool[] {
  const rng = createRng(subSeed(state.seed, 'paths', stage));
  const kinds = PATH_KINDS.slice();
  const out: Pool[] = [];
  const diets = [...new Set(spawnTable(stage).map((e) => e.def.diet))];
  while (out.length < 3 && kinds.length > 0) {
    const kind = kinds.splice(rng.int(0, kinds.length - 1), 1)[0] as PoolKind;
    if (kind === 'swarm') {
      if (diets.length === 0) continue;
      out.push({ kind, diet: diets[rng.int(0, diets.length - 1)] as Diet });
    } else out.push({ kind });
  }
  return out;
}

/** The marked prey of the current pool: a creature of the pool's fauna, picked by the run seed. */
export function trophyOf(state: RunState): { def: SpawnEntry['def'] } | null {
  const table = spawnTable(state.stage, poolDietWeights(state.pool, state.cfg.event?.dietWeights));
  if (table.length === 0) return null;
  const rng = createRng(subSeed(state.seed, 'trophy', state.stage, state.huntNonce));
  return { def: (table[rng.int(0, table.length - 1)] as SpawnEntry).def };
}

export function duelPearls(stage: number): number {
  return BAL.duelPearls + Math.floor(stage / 3);
}

export function rerollCost(camp: CampState): number {
  return BAL.rerollBase + BAL.rerollStep * camp.rerolls;
}

function applyOffer(state: RunState, offer: Offer, slot: number | undefined, events: RunEvent[]): void {
  switch (offer.type) {
    case 'tenant':
      addTenant(state, { id: offer.id, star: offer.star }, slot, events);
      break;
    case 'mutation': {
      const def = mutationDef(offer.id);
      state.mutations[def.slot] = { id: def.id, tier: offer.tier };
      events.push({ type: 'mutation', slot: def.slot, id: def.id, tier: offer.tier });
      break;
    }
    case 'heal': {
      const max = maxHpOf(state);
      const amount = Math.min(max - state.hp, (max * offer.pct) / 100);
      state.hp += amount;
      events.push({ type: 'heal', amount });
      break;
    }
  }
  clampHp(state);
}

// --- Battles -----------------------------------------------------------------------------------

export function enemyFighter(enemy: Enemy): Fighter {
  return enemy.kind === 'guardian'
    ? guardianFighter(enemy.id, enemy.hpMult, enemy.atkMult)
    : buildFighter(enemy.build);
}

export function battleSeed(state: RunState, setup: BattleSetup): string {
  return subSeed(state.seed, 'battle', setup.stage, setup.attempt);
}

export function guardianRewards(stage: number, boss: boolean): { pearls: number; shine: number } {
  return { pearls: 6 + stage, shine: Math.round((boss ? 3 : 1.5) * (2 + stage)) };
}

export const TROPHY_WIN = 25;
export const TROPHY_LOSS = 12;

function finish(state: RunState, result: RunResult, events: RunEvent[]): void {
  state.phase = 'ended';
  state.result = result;
  state.camp = null;
  state.battle = null;
  events.push({ type: 'ended', result });
}

export interface RunRewards {
  coral: number;
  shine: number;
  trophies: number;
  /** Share of loot kept (1 or the defeat share). */
  keep: number;
}

/** Final meta rewards of an ended run. */
export function runRewards(state: RunState): RunRewards {
  const keep = state.result === 'defeat' ? BAL.defeatKeep : 1;
  const pearlCoral = state.result === 'defeat' ? 0 : state.pearls * BAL.pearlToCoral;
  const clearBonus = state.result === 'cleared' ? 1.25 : 1;
  const double = state.flags.adDouble && state.result !== 'defeat' ? 2 : 1;
  return {
    coral: Math.floor((state.loot.coral * keep + pearlCoral) * clearBonus * double),
    shine: Math.floor(state.loot.shine * keep * clearBonus * double),
    trophies: state.stats.ghostWins * TROPHY_WIN - state.stats.ghostLosses * TROPHY_LOSS,
    keep,
  };
}

// --- Reducer -----------------------------------------------------------------------------------

export interface RunContext {
  /** Wall-clock seconds since the current hunt started (server only). */
  huntElapsedS?: number;
}

/**
 * Pure state transition. Returns a new state (the input is not mutated) and the events that happened,
 * which the client turns into animations. Throws RunError on illegal actions.
 */
export function applyRunAction(
  prev: RunState,
  action: RunAction,
  ctx: RunContext = {},
): { state: RunState; events: RunEvent[] } {
  const state = JSON.parse(JSON.stringify(prev)) as RunState;
  const events: RunEvent[] = [];
  const camp = (): CampState => {
    if (state.phase !== 'camp' || !state.camp) fail('bad_phase', 'not at a camp');
    return state.camp;
  };
  const campFree = (): CampState => {
    const c = camp();
    if (c.shellChoices) fail('shell_first', 'choose a shell first');
    return c;
  };

  switch (action.type) {
    case 'hunt_done': {
      if (state.phase !== 'hunt') fail('bad_phase', 'not hunting');
      applyHunt(state, action.report, ctx.huntElapsedS, events);
      state.stats.maxStage = Math.max(state.stats.maxStage, state.stage);
      if (state.lives <= 0) {
        if (state.flags.secondChance) finish(state, 'defeat', events);
        else state.phase = 'down';
      } else {
        enterCamp(state, events);
      }
      break;
    }

    case 'choose_shell': {
      const c = camp();
      const choice = c.shellChoices?.[action.index];
      if (!choice) fail('bad_index');
      const n = slotCount(state.cfg.heroId, choice, state.cfg.extraSlots);
      state.shell = { ...choice };
      // Tenants move into the new home and keep their places.
      state.slots = new Array<TenantInst | null>(Math.max(n, prev.slots.length)).fill(null);
      prev.slots.forEach((t, i) => {
        if (t) state.slots[i] = { ...t };
      });
      c.shellChoices = null;
      if (!state.stats.seenShells.includes(choice.id)) state.stats.seenShells.push(choice.id);
      events.push({ type: 'shell', shell: state.shell });
      clampHp(state);
      break;
    }

    case 'pick_offer': {
      const c = campFree();
      if (c.offerTaken) fail('offer_taken');
      const offer = c.offers[action.index];
      if (!offer) fail('bad_index');
      applyOffer(state, offer, action.slot, events);
      c.offerTaken = true;
      break;
    }

    case 'skip_offer': {
      const c = campFree();
      if (c.offerTaken) fail('offer_taken');
      c.offerTaken = true;
      // A skipped pick is worth a couple of pearls.
      state.pearls += 2;
      break;
    }

    case 'buy': {
      const c = campFree();
      const item = c.shop[action.index];
      if (!item || item.sold) fail('bad_index');
      if (state.pearls < item.price) fail('no_pearls');
      if (item.offer.type === 'heal' && state.hp >= maxHpOf(state)) fail('full_hp');
      state.pearls -= item.price;
      applyOffer(state, item.offer, action.slot, events);
      item.sold = true;
      break;
    }

    case 'order': {
      const c = campFree();
      if (c.ordered) fail('order_used');
      const src = state.slots[action.of];
      if (!src) fail('empty_slot');
      if (src.star >= 3) fail('order_max');
      const price = orderPrice(src);
      if (state.pearls < price) fail('no_pearls');
      state.pearls -= price;
      addTenant(state, { id: src.id, star: 1 }, action.slot, events);
      c.ordered = true;
      clampHp(state);
      break;
    }

    case 'reroll': {
      const c = campFree();
      if (action.free) {
        if (state.flags.adReroll) fail('ad_reroll_used');
        state.flags.adReroll = true;
      } else {
        const cost = rerollCost(c);
        if (state.pearls < cost) fail('no_pearls');
        state.pearls -= cost;
      }
      c.rerolls += 1;
      state.stats.rerolls += 1;
      const rng = createRng(subSeed(state.seed, 'reroll', c.after, c.rerolls));
      c.shop = generateShop(state, rng);
      if (!c.offerTaken) c.offers = generateOffers(state, rng);
      break;
    }

    case 'sell': {
      campFree();
      const t = state.slots[action.slot];
      if (!t) fail('empty_slot');
      const pearls = sellValue(t);
      state.pearls += pearls;
      state.slots[action.slot] = null;
      events.push({ type: 'tenant_sold', id: t.id, star: t.star, slot: action.slot, pearls });
      clampHp(state);
      break;
    }

    case 'move': {
      campFree();
      const { from, to } = action;
      const n = state.slots.length;
      if (!(from >= 0 && from < n && to >= 0 && to < n) || from === to) fail('bad_index');
      const a = state.slots[from] ?? null;
      state.slots[from] = state.slots[to] ?? null;
      state.slots[to] = a;
      clampHp(state);
      break;
    }

    case 'descend': {
      const c = campFree();
      if (!c.offerTaken) fail('pick_first', 'take or skip the offer first');
      const next = c.after + 1;
      if (next > state.cfg.maxStage) fail('max_stage');
      const info = stageInfo(next);
      state.stage = next;
      if (info.kind === 'guardian') {
        const enemy: Enemy =
          action.ghost ?? {
            kind: 'guardian',
            id: info.guardianId as string,
            hpMult: info.guardianHpMult,
            atkMult: info.guardianAtkMult,
          };
        const attempt = state.battle && state.battle.stage === next ? state.battle.attempt : 0;
        state.battle = { stage: next, enemy, attempt };
        state.phase = 'battle';
        // The camp is kept: a lost battle returns the crab here.
      } else {
        state.pool = c.paths?.[Math.max(0, Math.min((c.paths?.length ?? 1) - 1, Math.floor(action.path ?? 0)))] ?? null;
        state.camp = null;
        state.battle = null;
        state.phase = 'hunt';
        state.huntNonce += 1;
      }
      break;
    }

    case 'battle': {
      if (state.phase !== 'battle' || !state.battle) fail('bad_phase', 'no battle');
      const setup = state.battle;
      const seed = battleSeed(state, setup);
      const result = simulateBattle(runFighter(state), enemyFighter(setup.enemy), seed);
      const won = result.winner === 0;
      const isGhost = setup.enemy.kind === 'ghost';
      if (won) {
        const boss = setup.enemy.kind === 'guardian' && guardianDef(setup.enemy.id).boss === true;
        const base = guardianRewards(setup.stage, boss);
        const mods = runMods(state);
        const pearls = Math.round(base.pearls * (1 + mods.pearlPct / 100));
        const shine = base.shine * lootMult(state, setup.stage, mods);
        state.pearls += pearls;
        state.stats.pearlsEarned += pearls;
        state.loot.shine += shine;
        state.stats.battlesWon += 1;
        if (isGhost) state.stats.ghostWins += 1;
        else if (setup.enemy.kind === 'guardian' && !state.stats.guardiansBeaten.includes(setup.enemy.id)) {
          state.stats.guardiansBeaten.push(setup.enemy.id);
        }
        if (!isGhost && result.hpLeft[0] >= 0.8) state.stats.flawless = true;
        state.stats.maxStage = Math.max(state.stats.maxStage, setup.stage);
        events.push({ type: 'battle', result, won, enemy: setup.enemy, seed, rewards: { pearls, shine: Math.floor(shine), trophies: isGhost ? TROPHY_WIN : 0 } });
        if (setup.stage >= state.cfg.maxStage) {
          finish(state, 'cleared', events);
        } else {
          state.stage = setup.stage;
          enterCamp(state, events);
        }
      } else {
        state.lives -= 1;
        state.stats.battlesLost += 1;
        if (isGhost) state.stats.ghostLosses += 1;
        events.push({ type: 'battle', result, won, enemy: setup.enemy, seed, rewards: { pearls: 0, shine: 0, trophies: isGhost ? -TROPHY_LOSS : 0 } });
        setup.attempt += 1;
        if (state.lives <= 0) {
          if (state.flags.secondChance) finish(state, 'defeat', events);
          else state.phase = 'down';
        } else {
          // Back to the camp before the guardian; the build can be adjusted and the fight retried.
          state.stage = setup.stage - 1;
          state.phase = 'camp';
        }
      }
      break;
    }

    case 'duel': {
      const c = campFree();
      if (!c.rival) fail('no_rival');
      if (c.dueled) fail('duel_used');
      const seed = subSeed(state.seed, 'duel', c.after);
      const result = simulateBattle(runFighter(state), enemyFighter(c.rival), seed);
      const won = result.winner === 0;
      c.dueled = true;
      let pearls = 0;
      if (won) {
        pearls = duelPearls(c.after);
        state.pearls += pearls;
        state.stats.pearlsEarned += pearls;
        state.stats.ghostWins += 1;
        state.stats.duelWins = (state.stats.duelWins ?? 0) + 1;
      } else state.stats.ghostLosses += 1;
      events.push({ type: 'battle', result, won, enemy: c.rival, seed, duel: true, rewards: { pearls, shine: 0, trophies: won ? TROPHY_WIN : -TROPHY_LOSS } });
      break;
    }

    case 'second_chance': {
      if (state.phase !== 'down') fail('bad_phase');
      if (state.flags.secondChance) fail('second_chance_used');
      state.flags.secondChance = true;
      state.lives = 1;
      state.hp = maxHpOf(state) * 0.6;
      if (state.battle && state.camp) {
        state.stage = state.battle.stage - 1;
        state.phase = 'camp';
      } else {
        enterCamp(state, events);
      }
      break;
    }

    case 'give_up': {
      if (state.phase !== 'down') fail('bad_phase');
      finish(state, 'defeat', events);
      break;
    }

    case 'carry_out': {
      campFree();
      finish(state, 'carried', events);
      break;
    }
  }
  return { state, events };
}

/** State safe to send to the client: no seed, so offers cannot be predicted. */
export type PublicRun = Omit<RunState, 'seed'> & { /** Creature id of the pool's marked prey (while hunting). */ trophyId?: string; huntSeed: string; /** Number of the last applied action; the next request sends seq + 1. */ seq: number };

export function publicRun(state: RunState, seq = 0): PublicRun {
  const { seed, ...rest } = state;
  const prey = state.phase === 'hunt' ? trophyOf(state) : null;
  return { ...rest, ...(prey ? { trophyId: prey.def.id } : {}), seq, huntSeed: String(createRng(subSeed(seed, 'hunt', state.stage, state.huntNonce)).int(0, 2 ** 31 - 1)) };
}

export const RUN_CHAPTER_STAGES = CHAPTER_STAGES;
