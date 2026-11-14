import { BAL } from './data/balance';
import { heroDef } from './data/heroes';
import { MUTATIONS } from './data/mutations';
import { shellDef } from './data/shells';
import { tenantDef } from './data/tenants';
import type { Rng } from './rng';
import type { RunState } from './run';
import { DIETS, type Diet, type ShellInst, type Star } from './types';

export type Offer =
  | { type: 'tenant'; id: string; star: Star }
  | { type: 'mutation'; id: string; tier: number }
  | { type: 'heal'; pct: number };

export interface ShopItem {
  offer: Offer;
  price: number;
  sold: boolean;
}

/**
 * Offer weight of every tenant in the pool. This is the "you are what you eat" link: genes of a
 * family multiply the weight of its tenants, and tenants already on the shell come up more often so
 * merges are reachable.
 */
export function tenantWeights(state: RunState): Map<string, number> {
  const need = heroDef(state.cfg.heroId).mergeCount;
  const stage = state.camp?.after ?? state.stage;
  const owned = new Map<string, number>();
  for (const t of state.slots) if (t && t.star === 1) owned.set(t.id, (owned.get(t.id) ?? 0) + 1);
  const weights = new Map<string, number>();
  for (const id of state.cfg.tenantPool) {
    const def = tenantDef(id);
    const r = def.rarity - 1;
    let w = (BAL.offerRarityWeight[r] as number) * (1 + stage * (BAL.offerRarityStageBonus[r] as number));
    let fam = 0;
    for (const f of def.families) fam += 1 + state.genes[f] * BAL.offerGeneK;
    w *= fam / def.families.length;
    const have = owned.get(id) ?? 0;
    if (have > 0) w *= BAL.offerOwnedMult;
    if (have >= need - 1) w *= BAL.offerNearMergeMult;
    weights.set(id, w);
  }
  return weights;
}

/** Number of gene thresholds reached for a diet, capped by the mutation lab level. */
export function mutationTierAvailable(state: RunState, diet: Diet): number {
  const reached = BAL.geneThresholds.filter((t) => state.genes[diet] >= t).length;
  return Math.min(reached, state.cfg.mutMaxTier);
}

interface MutCandidate {
  id: string;
  tier: number;
  weight: number;
  diet: Diet;
}

export function mutationCandidates(state: RunState): MutCandidate[] {
  const out: MutCandidate[] = [];
  for (const d of DIETS) {
    const tier = mutationTierAvailable(state, d);
    if (tier <= 0) continue;
    for (const def of MUTATIONS) {
      if (def.diet !== d || !state.cfg.mutSlots.includes(def.slot)) continue;
      const cur = state.mutations[def.slot];
      if (cur && cur.id === def.id && cur.tier >= tier) continue;
      let weight = 1 + state.genes[d];
      // Replacing a different mutation of the same strength is rarely what the player wants.
      if (cur && cur.id !== def.id && cur.tier >= tier) weight *= 0.35;
      out.push({ id: def.id, tier, weight, diet: d });
    }
  }
  return out;
}

function pickTenant(weights: Map<string, number>, taken: Set<string>, rng: Rng): string | null {
  const ids: string[] = [];
  const ws: number[] = [];
  for (const [id, w] of weights) {
    if (taken.has(id) || !(w > 0)) continue;
    ids.push(id);
    ws.push(w);
  }
  if (ids.length === 0) return null;
  return ids[rng.weightedIndex(ws)] as string;
}

export const OFFER_COUNT = 3;

export function generateOffers(state: RunState, rng: Rng): Offer[] {
  const offers: Offer[] = [];
  const weights = tenantWeights(state);
  const taken = new Set<string>();
  const stage = state.camp?.after ?? state.stage;
  let muts = mutationCandidates(state);
  let hasHeal = false;
  let hasMutation = false;

  const pushMutation = (pool: MutCandidate[]): boolean => {
    if (pool.length === 0) return false;
    const c = pool[rng.weightedIndex(pool.map((x) => x.weight))] as MutCandidate;
    offers.push({ type: 'mutation', id: c.id, tier: c.tier });
    muts = muts.filter((x) => x.id !== c.id);
    hasMutation = true;
    return true;
  };

  // The first run teaches merging: the starter tenant keeps coming back.
  if (state.cfg.tutorial && state.cfg.starterTenant && stage <= 2 && weights.has(state.cfg.starterTenant)) {
    offers.push({ type: 'tenant', id: state.cfg.starterTenant, star: 1 });
    taken.add(state.cfg.starterTenant);
  }

  // A freshly crossed gene threshold always shows up as a mutation card.
  if (state.pendingMutations.length > 0 && offers.length < OFFER_COUNT) {
    pushMutation(muts.filter((x) => state.pendingMutations.includes(x.diet)));
  }

  const hpFrac = state.hp / Math.max(1, maxHpEstimate(state));
  while (offers.length < OFFER_COUNT) {
    const roll = rng.next();
    const healChance = BAL.offerHealChance * (hpFrac < 0.5 ? 2.5 : hpFrac > 0.9 ? 0 : 1);
    if (!hasMutation && roll < BAL.offerMutationChance && pushMutation(muts)) continue;
    if (!hasHeal && roll > 1 - healChance) {
      offers.push({ type: 'heal', pct: BAL.healOfferPct });
      hasHeal = true;
      continue;
    }
    const id = pickTenant(weights, taken, rng);
    if (id === null) {
      offers.push({ type: 'heal', pct: BAL.healOfferPct });
      hasHeal = true;
      continue;
    }
    taken.add(id);
    offers.push({ type: 'tenant', id, star: 1 });
  }
  return offers;
}

// run.ts imports this module, so the max HP is passed lazily to avoid an import cycle at load time.
let maxHpFn: ((state: RunState) => number) | null = null;
export function registerMaxHp(fn: (state: RunState) => number): void {
  maxHpFn = fn;
}
function maxHpEstimate(state: RunState): number {
  return maxHpFn ? maxHpFn(state) : state.hp;
}

export function tenantPrice(id: string, star: Star): number {
  const base = BAL.tenantPrice[tenantDef(id).rarity - 1] as number;
  return star >= 2 ? base * BAL.star2PriceMult : base;
}

export function generateShop(state: RunState, rng: Rng): ShopItem[] {
  const items: ShopItem[] = [];
  const weights = tenantWeights(state);
  const taken = new Set<string>();
  const stage = state.camp?.after ?? state.stage;
  const star2Chance = Math.min(BAL.shopStar2Max, BAL.shopStar2PerStage * Math.max(0, stage - 3));
  // The shop remembers the build: its first shelf holds a tenant that already lives on the shell.
  const mine = new Map<string, number>();
  for (const t of state.slots) if (t && t.star < 3 && weights.has(t.id)) mine.set(t.id, weights.get(t.id) as number);
  for (let i = 0; i < BAL.shopSize; i++) {
    const id = i === 0 && mine.size > 0 ? pickTenant(mine, taken, rng) : pickTenant(weights, taken, rng);
    if (id === null) break;
    taken.add(id);
    const star: Star = rng.chance(star2Chance) ? 2 : 1;
    items.push({ offer: { type: 'tenant', id, star }, price: tenantPrice(id, star), sold: false });
  }
  items.push({ offer: { type: 'heal', pct: BAL.healOfferPct }, price: BAL.healPrice, sold: false });
  return items;
}

export function generateShellChoices(state: RunState, tier: number, rng: Rng): ShellInst[] {
  const pool = state.cfg.shellPool.filter((id) => !shellDef(id).starter);
  if (pool.length === 0) return [{ id: state.shell.id, tier }];
  return rng
    .shuffle(pool)
    .slice(0, 3)
    .map((id) => ({ id, tier }));
}
