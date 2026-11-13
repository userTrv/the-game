import { simulateBattle, type BattleResult } from './battle';
import { buildFighter, computeMods, familyCounts, guardianFighter, slotCount, type Fighter } from './build';
import { BAL, genesForTier, xpForTier, xpNeed } from './data/balance';
import { CREATURE_BY_ID } from './data/creatures';
import { guardianDef } from './data/guardians';
import { heroDef } from './data/heroes';
import { mutationDef } from './data/mutations';
import { MAX_SHELL_TIER } from './data/shells';
import { tenantDef } from './data/tenants';
import { generateOffers, generateShellChoices, generateShop, registerMaxHp, type Offer, type ShopItem } from './offers';
import { createRng, subSeed } from './rng';
import { CHAPTER_STAGES, creatureTier, spawnTable, stageInfo } from './stages';
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
  /** Non-null while the crab has to pick a new shell first. */
  shellChoices: ShellInst[] | null;
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
}

export interface HuntReport {
  /** Creature id -> number eaten. */
  eaten: Record<string, number>;
  nodes: { oyster: number; coral: number; glitter: number };
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
  | { type: 'reroll'; free?: boolean }
  | { type: 'sell'; slot: number }
  | { type: 'move'; from: number; to: number }
  | { type: 'choose_shell'; index: number }
  | { type: 'descend'; ghost?: Extract<Enemy, { kind: 'ghost' }> }
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
  | { type: 'battle'; result: BattleResult; won: boolean; enemy: Enemy; seed: string; rewards?: { pearls: number; shine: number; trophies: number } }
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
  maxDuration: number;
}

export function huntCaps(durationS: number): HuntCaps {
  const h = BAL.hunt;
  const d = Math.max(0, Math.min(h.hardMaxTime, durationS));
  const respawns = Math.floor(d / h.nodeRespawnTime);
  return {
    maxEaten: h.initialSpawn + Math.ceil((h.spawnRate[1] as number) * d) + 2,
    maxOysters: h.oysters * (1 + respawns),
    maxCorals: h.corals * (1 + respawns),
    maxGlitter: 1 + respawns,
    maxDuration: h.hardMaxTime,
  };
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
  const table = new Map(spawnTable(stage, state.cfg.event?.dietWeights).map((e) => [e.def.id, e]));
  const modsBefore = runMods(state);
  const hero = heroDef(state.cfg.heroId);

  // Sanitise: known creatures of this stage only, non-negative integers, total under the cap.
  const eaten: [string, number][] = [];
  let total = 0;
  for (const [id, raw] of Object.entries(report.eaten ?? {})) {
    const n = Math.floor(Number(raw));
    if (!(n > 0) || !table.has(id)) {
      if (n > 0) events.push({ type: 'clamped', what: `creature:${id}` });
      continue;
    }
    eaten.push([id, n]);
    total += n;
  }
  if (total > caps.maxEaten) {
    const k = caps.maxEaten / total;
    for (const e of eaten) e[1] = Math.floor(e[1] * k);
    events.push({ type: 'clamped', what: 'eaten' });
  }

  const lm = lootMult(state, stage, modsBefore);
  const geneBefore: DietMap = { ...state.genes };
  let xp = 0;
  for (const [id, n] of eaten) {
    const def = CREATURE_BY_ID.get(id);
    if (!def) continue;
    const tier = creatureTier(stage, def);
    xp += xpForTier(tier) * n;
    state.genes[def.diet] += genesForTier(tier) * n * hero.geneMult * (1 + modsBefore.genePct / 100);
    state.loot.coral += BAL.hunt.coralPerTier * tier * n * lm;
    state.stats.eatenByDiet[def.diet] += n;
    state.stats.eatenByCreature[id] = (state.stats.eatenByCreature[id] ?? 0) + n;
    state.stats.eatenTotal += n;
  }
  state.xp += xp * (1 + modsBefore.xpPct / 100);

  const rng = createRng(subSeed(state.seed, 'nodes', stage, state.huntNonce));
  const clampNode = (v: number, cap: number, what: string): number => {
    const n = Math.max(0, Math.floor(Number(v) || 0));
    if (n > cap) events.push({ type: 'clamped', what });
    return Math.min(n, cap);
  };
  const oysters = clampNode(report.nodes?.oyster, caps.maxOysters, 'oyster');
  const corals = clampNode(report.nodes?.coral, caps.maxCorals, 'coral');
  const glitter = clampNode(report.nodes?.glitter, caps.maxGlitter, 'glitter');
  let pearls = 0;
  for (let i = 0; i < oysters; i++) pearls += rng.int(BAL.hunt.oysterPearls[0] as number, BAL.hunt.oysterPearls[1] as number);
  pearls = Math.round(pearls * (1 + (modsBefore.pearlPct + (state.cfg.event?.pearlPct ?? 0)) / 100));
  state.pearls += pearls;
  state.stats.pearlsEarned += pearls;
  for (let i = 0; i < corals; i++) state.loot.coral += rng.int(BAL.hunt.coralYield[0] as number, BAL.hunt.coralYield[1] as number) * lm;
  for (let i = 0; i < glitter; i++) state.loot.shine += rng.int(BAL.hunt.glitterYield[0] as number, BAL.hunt.glitterYield[1] as number) * lm;
  state.stats.huntSeconds += duration;

  // Growth.
  const hpBefore = maxHpOf(state);
  while (state.xp >= xpNeed(state.size)) {
    state.xp -= xpNeed(state.size);
    state.size += 1;
    events.push({ type: 'grow', size: state.size });
  }

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
  state.pendingMutations = [];
  state.phase = 'camp';
  state.battle = null;
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
export type PublicRun = Omit<RunState, 'seed'> & { huntSeed: string };

export function publicRun(state: RunState): PublicRun {
  const { seed, ...rest } = state;
  return { ...rest, huntSeed: String(createRng(subSeed(seed, 'hunt', state.stage, state.huntNonce)).int(0, 2 ** 31 - 1)) };
}

export const RUN_CHAPTER_STAGES = CHAPTER_STAGES;
