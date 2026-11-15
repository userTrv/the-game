import type { Diet } from '../types';

/**
 * Currents: the kinds of pool a crab can dive into. Three are offered at every camp before a hunt.
 * The same numbers drive the client (what shows up) and the server (what a report is worth).
 */
export type PoolKind = 'calm' | 'pearl' | 'swarm' | 'nest' | 'dark';

export interface Pool {
  kind: PoolKind;
  /** Family of a swarm. */
  diet?: Diet;
}

export interface PoolDef {
  /** How fast danger grows. */
  danger: number;
  /** XP from meals. */
  xp: number;
  /** Pearls per opened oyster. */
  oyster: number;
  /** Stalkers come at this share of the usual danger. */
  stalkerFrom: number;
  /** A guarded chest right by the entry. */
  nest: boolean;
  /** Spawn weight of the swarm's family and its gene bonus, percent. */
  swarmWeight: number;
  swarmGenePct: number;
}

export const POOLS: Record<PoolKind, PoolDef> = {
  calm: { danger: 0.6, xp: 0.85, oyster: 1, stalkerFrom: 1, nest: false, swarmWeight: 1, swarmGenePct: 0 },
  pearl: { danger: 1.3, xp: 1, oyster: 2, stalkerFrom: 1, nest: false, swarmWeight: 1, swarmGenePct: 0 },
  swarm: { danger: 1, xp: 1, oyster: 1, stalkerFrom: 1, nest: false, swarmWeight: 3, swarmGenePct: 25 },
  nest: { danger: 1, xp: 1, oyster: 1, stalkerFrom: 0.4, nest: true, swarmWeight: 1, swarmGenePct: 0 },
  dark: { danger: 1.5, xp: 1.3, oyster: 1, stalkerFrom: 1, nest: false, swarmWeight: 1, swarmGenePct: 0 },
};

export const NEUTRAL_POOL: PoolDef = { danger: 1, xp: 1, oyster: 1, stalkerFrom: 1, nest: false, swarmWeight: 1, swarmGenePct: 0 };

export function poolDef(pool: Pool | null | undefined): PoolDef {
  return pool ? POOLS[pool.kind] : NEUTRAL_POOL;
}

/** Spawn weights of a pool merged with the weekly event's. */
export function poolDietWeights(pool: Pool | null | undefined, event?: Partial<Record<Diet, number>>): Partial<Record<Diet, number>> | undefined {
  if (!pool || pool.kind !== 'swarm' || !pool.diet) return event;
  return { ...event, [pool.diet]: (event?.[pool.diet] ?? 1) * POOLS.swarm.swarmWeight };
}
