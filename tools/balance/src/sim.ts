import {
  applyRunAction,
  BAL,
  feed,
  FEATS,
  guardianDef,
  poolDef,
  poolDietWeights,
  ratePower,
  runFighter,
  stageInfo,
  BUILDINGS,
  createRng,
  DIETS,
  maxHpOf,
  maxLevel,
  mutationDef,
  newProfile,
  runConfigFor,
  runRewards,
  slotCount,
  spawnTable,
  startRun,
  tenantDef,
  wouldMerge,
  type Diet,
  type Offer,
  type Pool,
  type Profile,
  type Rng,
  type RunAction,
  type RunState,
} from '@shellter/shared';

/** How a bot eats and builds. `diets` are the families it hunts for; empty means "anything". */
export interface Policy {
  id: string;
  diets: Diet[];
  random?: boolean;
}

export const POLICIES: Policy[] = [
  ...DIETS.map((d) => ({ id: `mono:${d}`, diets: [d] })),
  { id: 'hybrid:sting+glow', diets: ['sting', 'glow'] },
  { id: 'hybrid:spike+armor', diets: ['spike', 'armor'] },
  { id: 'hybrid:venom+soft', diets: ['venom', 'soft'] },
  { id: 'omnivore', diets: [] },
  { id: 'random', diets: [], random: true },
];

/** Town progress presets: a brand-new player, a mid-game one and a fully built town. */
export const PROFILES: Record<string, (now: number) => Profile> = {
  fresh: (now) => ({ ...newProfile(now), tutorialDone: true }),
  mid: (now) => {
    const p = { ...newProfile(now), tutorialDone: true };
    p.buildings = { ...p.buildings, lighthouse: 2, garden: 2, lab: 2, workshop: 2, hatchery: 2 };
    return p;
  },
  late: (now) => {
    const p = { ...newProfile(now), tutorialDone: true };
    for (const b of BUILDINGS) p.buildings[b] = maxLevel(b);
    // The chapter, not the endless mode: the lighthouse stops at stage 12.
    p.buildings.lighthouse = 3;
    p.feats = FEATS.map((f) => f.id);
    return p;
  },
};

export interface RunOutcome {
  result: 'carried' | 'defeat' | 'cleared';
  maxStage: number;
  size: number;
  coral: number;
  shine: number;
  merges2: number;
  merges3: number;
  mutations: number;
  bestSet: number;
  /** Loot the bot would have banked by carrying out right after each beaten guardian. */
  bank: Record<number, number>;
  kos: number;
  battlesLost: number;
}

const SKILL = 0.7;
const HUNT_SECONDS = 40;

/** A pool played by an average player: eats most of what it can, takes some bites from big fauna. */
function hunt(state: RunState, policy: Policy, rng: Rng): RunAction {
  const table = spawnTable(state.stage, poolDietWeights(state.pool, state.cfg.event?.dietWeights));
  const pool = poolDef(state.pool);
  const h = BAL.hunt;
  const spawned = h.initialSpawn + (((h.spawnRate[0] as number) + (h.spawnRate[1] as number)) / 2) * HUNT_SECONDS;
  // Picky eaters pass by food of other families, so they get fewer bites overall.
  const picky = policy.diets.length > 0 ? 0.85 : 1;
  const attempts = Math.round(spawned * SKILL * picky * (0.85 + rng.next() * 0.3));
  const total = table.reduce((sum, e) => sum + e.weight, 0);
  const log: [string, number][] = [];
  // The crab grows during the pool, exactly like in the client: bigger fauna becomes food on the way.
  const g = { size: state.size, xp: state.xp };
  let size = g.size;
  let misses = 0;
  for (let i = 0; i < attempts; i++) {
    // A bite lands only if the creature that swam by is small enough; among food the bot prefers its diet.
    const edible = table.filter((e) => e.tier <= size);
    const share = edible.reduce((sum, e) => sum + e.weight, 0) / total;
    if (edible.length === 0 || !rng.chance(share)) {
      misses += 1;
      continue;
    }
    const e = edible[rng.weightedIndex(edible.map((x) => x.weight * (policy.diets.includes(x.def.diet) ? 4 : 1)))] as (typeof table)[number];
    log.push([e.def.id, e.tier]);
    feed(g, e.tier, pool.xp * 100 - 100);
    size = g.size;
  }
  const edibleShare = attempts > 0 ? 1 - misses / attempts : 1;
  const danger = 1 - edibleShare;
  // Wilder currents bite harder; an average player parries a bite or two and finds the marked prey now and then.
  const hpLost = maxHpOf(state) * (0.05 + 0.3 * danger) * (0.5 + rng.next()) * (0.6 + 0.4 * pool.danger) * (pool.stalkerFrom < 1 ? 1.2 : 1);
  const chest = pool.nest ? (rng.chance(0.7) ? 1 : 0) : rng.chance(0.3) ? 1 : 0;
  return {
    type: 'hunt_done',
    report: {
      log, nodes: { oyster: rng.int(2, 4), coral: rng.int(2, 4), glitter: rng.chance(0.4) ? 1 : 0, chest }, drops: rng.int(0, 2), durationS: HUNT_SECONDS, hpLost, ko: false,
      ...(rng.chance(0.3) ? { trophy: true } : {}), parries: rng.int(0, 2),
    },
  };
}

function score(state: RunState, offer: Offer, policy: Policy): number {
  if (offer.type === 'heal') return state.hp < maxHpOf(state) * 0.5 ? 7 : state.hp < maxHpOf(state) * 0.75 ? 2.5 : 0;
  if (offer.type === 'mutation') {
    const def = mutationDef(offer.id);
    const cur = state.mutations[def.slot];
    if (cur && cur.id === def.id && cur.tier >= offer.tier) return 0;
    const fit = policy.diets.length === 0 || policy.diets.includes(def.diet);
    return (fit ? 5 : 2) + offer.tier;
  }
  const def = tenantDef(offer.id);
  let s = 1 + def.rarity + (offer.star - 1) * 3;
  if (policy.diets.length === 0 || def.families.some((f) => policy.diets.includes(f))) s += 3;
  if (def.link) s += 1;
  if (nextGuardianWeak(state).includes(def.families[0])) s += 1.5;
  if (wouldMerge(state, offer.id, offer.star)) s += 6;
  else if (state.slots.some((t) => t && t.id === offer.id && t.star === offer.star)) s += 2;
  return s;
}

function nextGuardianWeak(state: RunState): readonly Diet[] {
  let stage = (state.camp?.after ?? state.stage) + 1;
  while (stage <= state.cfg.maxStage && stageInfo(stage).kind !== 'guardian') stage += 1;
  const id = stage <= state.cfg.maxStage ? stageInfo(stage).guardianId : undefined;
  return id ? guardianDef(id).weak : [];
}

/** Shuffles tenants between cells while a swap makes the build stronger: links and rows both count. */
function arrange(state: RunState): RunState {
  for (let guard = 0; guard < 4; guard++) {
    const base = ratePower(runFighter(state));
    let best: { from: number; to: number; p: number } | null = null;
    for (let from = 0; from < state.slots.length; from++) {
      if (!state.slots[from]) continue;
      for (let to = 0; to < state.slots.length; to++) {
        if (to === from || (state.slots[to] && to < from)) continue;
        const slots = state.slots.slice();
        [slots[from], slots[to]] = [slots[to] ?? null, slots[from] ?? null];
        const p = ratePower(runFighter({ ...state, slots }));
        if (p > base * 1.01 && (!best || p > best.p)) best = { from, to, p };
      }
    }
    if (!best) break;
    state = applyRunAction(state, { type: 'move', from: best.from, to: best.to }).state;
  }
  return state;
}

/** Which current to dive into: its own swarm first, then pearls; a hurt crab takes the calm one. */
function choosePath(state: RunState, policy: Policy, rng: Rng): number | undefined {
  const paths: Pool[] = state.camp?.paths ?? [];
  if (paths.length === 0) return undefined;
  if (policy.random) return rng.int(0, paths.length - 1);
  const hurt = state.hp < maxHpOf(state) * 0.5;
  const value = (p: Pool): number => {
    if (p.kind === 'swarm') return policy.diets.length === 0 || (p.diet && policy.diets.includes(p.diet)) ? 5 : 1.5;
    if (p.kind === 'calm') return hurt ? 6 : 2;
    if (p.kind === 'pearl') return hurt ? 1 : 4;
    if (p.kind === 'dark') return hurt ? 0 : 3.5;
    return hurt ? 0.5 : 3;
  };
  let best = 0;
  paths.forEach((p, i) => {
    if (value(p) > value(paths[best] as Pool)) best = i;
  });
  return best;
}

/** Slot argument for a tenant offer: a free slot, a merge, or the weakest tenant if the new one is better. */
function placement(state: RunState, offer: Offer, policy: Policy, value: number): { ok: boolean; slot?: number } {
  if (offer.type !== 'tenant') return { ok: true };
  if (state.slots.includes(null) || wouldMerge(state, offer.id, offer.star)) return { ok: true };
  let worst = -1;
  let worstScore = Infinity;
  state.slots.forEach((t, i) => {
    if (!t) return;
    const s = score({ ...state, slots: state.slots.filter((_, j) => j !== i) }, { type: 'tenant', id: t.id, star: t.star }, policy);
    if (s < worstScore) {
      worstScore = s;
      worst = i;
    }
  });
  return worst >= 0 && value > worstScore + 1 ? { ok: true, slot: worst } : { ok: false };
}

function campActions(state: RunState, policy: Policy, rng: Rng): RunState {
  const before = JSON.stringify(state.slots);
  const act = (a: RunAction): void => {
    state = applyRunAction(state, a).state;
  };
  const camp = state.camp;
  if (!camp) return state;
  if (camp.shellChoices) {
    // Most slots wins; random bots take any.
    const choices = camp.shellChoices;
    let best = 0;
    if (policy.random) best = rng.int(0, choices.length - 1);
    else choices.forEach((c, i) => {
      if (slotCount(state.cfg.heroId, c, state.cfg.extraSlots) > slotCount(state.cfg.heroId, choices[best] as (typeof choices)[number], state.cfg.extraSlots)) best = i;
    });
    act({ type: 'choose_shell', index: best });
  }
  if (!camp.offerTaken) {
    const offers = state.camp?.offers ?? [];
    const ranked = offers.map((o, i) => ({ i, o, s: policy.random ? rng.next() * 10 : score(state, o, policy) })).sort((a, b) => b.s - a.s);
    let taken = false;
    for (const r of ranked) {
      if (r.s <= 0) break;
      const p = placement(state, r.o, policy, r.s);
      if (!p.ok) continue;
      act(p.slot !== undefined ? { type: 'pick_offer', index: r.i, slot: p.slot } : { type: 'pick_offer', index: r.i });
      taken = true;
      break;
    }
    if (!taken) act({ type: 'skip_offer' });
  }
  // Spend pearls: best affordable item first; one paid reroll when rich and nothing fits.
  for (let guard = 0; guard < 8; guard++) {
    const shop = state.camp?.shop ?? [];
    const options = shop
      .map((item, i) => ({ i, item, s: policy.random ? rng.next() * 8 : score(state, item.offer, policy) }))
      .filter((x) => !x.item.sold && x.item.price <= state.pearls && x.s >= 4)
      .filter((x) => !(x.item.offer.type === 'heal' && state.hp >= maxHpOf(state)))
      .sort((a, b) => b.s - a.s);
    let bought = false;
    for (const x of options) {
      const p = placement(state, x.item.offer, policy, x.s);
      if (!p.ok) continue;
      act(p.slot !== undefined ? { type: 'buy', index: x.i, slot: p.slot } : { type: 'buy', index: x.i });
      bought = true;
      break;
    }
    if (bought) continue;
    const c = state.camp;
    if (c && c.rerolls === 0 && state.pearls >= 10) {
      act({ type: 'reroll' });
      continue;
    }
    break;
  }
  // Nothing new on the shell: the arrangement found at the last camp still stands.
  return policy.random || JSON.stringify(state.slots) === before ? state : arrange(state);
}

export function simulateRun(seed: string, policy: Policy, profile: Profile, heroId = 'hermit', onBattle?: (before: RunState, won: boolean) => void): RunOutcome {
  const rng = createRng(`${seed}:bot`);
  let state = startRun('sim', seed, runConfigFor(profile, heroId));
  const bank: Record<number, number> = {};
  for (let step = 0; step < 400 && state.phase !== 'ended'; step++) {
    switch (state.phase) {
      case 'hunt':
        state = applyRunAction(state, hunt(state, policy, rng)).state;
        break;
      case 'camp': {
        state = campActions(state, policy, rng);
        const after = state.camp?.after ?? state.stage;
        if (after % 3 === 0 && bank[after] === undefined) {
          bank[after] = Math.floor(state.loot.coral + state.pearls * BAL.pearlToCoral);
        }
        const path = choosePath(state, policy, rng);
        state = applyRunAction(state, after + 1 > state.cfg.maxStage ? { type: 'carry_out' } : path !== undefined ? { type: 'descend', path } : { type: 'descend' }).state;
        break;
      }
      case 'battle': {
        const before = state;
        const won0 = state.stats.battlesWon;
        state = applyRunAction(state, { type: 'battle' }).state;
        onBattle?.(before, state.stats.battlesWon > won0);
        break;
      }
      case 'down':
        state = applyRunAction(state, { type: 'give_up' }).state;
        break;
    }
  }
  if (state.phase !== 'ended' || !state.result) throw new Error(`run did not end: ${seed} ${policy.id}`);
  const rewards = runRewards(state);
  return {
    result: state.result,
    maxStage: state.stats.maxStage,
    size: state.size,
    coral: rewards.coral,
    shine: rewards.shine,
    merges2: state.stats.merges[0],
    merges3: state.stats.merges[1],
    mutations: Object.keys(state.mutations).length,
    bestSet: Math.max(...DIETS.map((d) => state.stats.maxSet[d])),
    bank,
    kos: state.stats.kos,
    battlesLost: state.stats.battlesLost,
  };
}

export interface Summary {
  policy: string;
  profile: string;
  hero: string;
  runs: number;
  maxStage: number;
  avgStage: number;
  /** Share of runs that beat the guardian of stage 3, 6, 9, 12 (only those within reach). */
  beat: Record<number, number>;
  clearRate: number;
  avgCoral: number;
  avgShine: number;
  avgSize: number;
  avgMerges2: number;
  avgMerges3: number;
  avgMutations: number;
  avgBestSet: number;
  /** Average loot banked right after each guardian, among the runs that got there. */
  bank: Record<number, number>;
}

export function summarize(policy: Policy, profileId: string, runs: number, heroId = 'hermit', seedPrefix = 'bal'): Summary {
  const profile = (PROFILES[profileId] as (now: number) => Profile)(0);
  const maxStage = runConfigFor(profile, heroId).maxStage;
  const out: RunOutcome[] = [];
  for (let i = 0; i < runs; i++) out.push(simulateRun(`${seedPrefix}:${profileId}:${heroId}:${policy.id}:${i}`, policy, profile, heroId));
  const avg = (f: (o: RunOutcome) => number): number => out.reduce((s, o) => s + f(o), 0) / out.length;
  const beat: Record<number, number> = {};
  const bank: Record<number, number> = {};
  for (let g = 3; g <= Math.min(12, maxStage); g += 3) {
    const reached = out.filter((o) => o.bank[g] !== undefined || (g === maxStage && o.result === 'cleared'));
    beat[g] = reached.length / out.length;
    const banked = out.filter((o) => o.bank[g] !== undefined);
    if (banked.length > 0) bank[g] = banked.reduce((s, o) => s + (o.bank[g] ?? 0), 0) / banked.length;
  }
  return {
    policy: policy.id,
    profile: profileId,
    hero: heroId,
    runs,
    maxStage,
    avgStage: avg((o) => o.maxStage),
    beat,
    clearRate: avg((o) => (o.result === 'cleared' ? 1 : 0)),
    avgCoral: avg((o) => o.coral),
    avgShine: avg((o) => o.shine),
    avgSize: avg((o) => o.size),
    avgMerges2: avg((o) => o.merges2),
    avgMerges3: avg((o) => o.merges3),
    avgMutations: avg((o) => o.mutations),
    avgBestSet: avg((o) => o.bestSet),
    bank,
  };
}
