import type { Diet, ModPatch, Triple } from '../types';

/**
 * Active ability kinds. Every kind has a meaning both in the autobattle and in the real-time hunt:
 *  zap     - damage to one target (battle: the enemy; hunt: nearest creature in range), `n` extra bounces
 *  nova    - damage to everything around (battle: the enemy)
 *  burst   - reactive: fires when the owner is hit by a melee attack, at most once per cooldown
 *  blind   - v = seconds; blinded attackers miss half of their claw attacks (hunt: creatures lose aggro)
 *  mark    - v = % extra damage taken for `dur` seconds (hunt: lures edible prey toward the crab)
 *  shield  - v = absorb amount
 *  poison  - v = poison damage per second added to the target
 *  weaken  - v = % attack reduction for `dur` (hunt: slows creatures)
 *  heal    - v = hit points
 *  pull    - v = % attack slow for `dur` (hunt: yanks edible prey toward the crab)
 *  stun    - v = seconds
 */
export type ActiveKind =
  | 'zap'
  | 'nova'
  | 'burst'
  | 'blind'
  | 'mark'
  | 'shield'
  | 'poison'
  | 'weaken'
  | 'heal'
  | 'pull'
  | 'stun';

export interface ActiveAbility {
  type: 'active';
  kind: ActiveKind;
  /** Cooldown, seconds. */
  cd: number;
  v: Triple;
  dur?: number;
  /** Hunt range in world units. */
  range?: number;
  /** Extra bounces (zap). */
  n?: number;
  /** Secondary effect applied together with the primary one. */
  also?: { kind: Exclude<ActiveKind, 'burst'>; v: Triple; dur?: number };
}

export interface PassiveAbility {
  type: 'passive';
  /** Icon/animation hint only. */
  kind: 'thorns' | 'focus' | 'plate' | 'regen' | 'grow' | 'haste' | 'might' | 'leech' | 'luck';
  mods: readonly [ModPatch, ModPatch, ModPatch];
}

export type AbilityDef = ActiveAbility | PassiveAbility;

/**
 * How a tenant works with its neighbours on the shell grid (see `gridNeighbors`):
 *  aura - every neighbour (of `family`, or any) gets +v % power, or -v % cooldown for stat 'haste'
 *  bond - the tenant itself gets +v % power per neighbour of `family` (or per any neighbour)
 *  solo - the tenant itself gets +v % power while no neighbouring cell is occupied
 */
export interface LinkDef {
  kind: 'aura' | 'bond' | 'solo';
  stat: 'power' | 'haste';
  family?: Diet;
  v: Triple;
}

export type Role = 'front' | 'back' | 'any';

export interface TenantDef {
  id: string;
  families: readonly [Diet] | readonly [Diet, Diet];
  /** 1 common, 2 uncommon, 3 rare. */
  rarity: 1 | 2 | 3;
  role: Role;
  ability: AbilityDef;
  /** Tenant garden level that adds it to the pool (0 = available from the start). */
  unlock: number;
  link?: LinkDef;
  /** Feat that has to be done once before the tenant can show up (on top of `unlock`). */
  feat?: string;
}

/** Kinds whose magnitude is a flat amount and scales with size and family power. */
export const MAGNITUDE_KINDS: readonly ActiveKind[] = ['zap', 'nova', 'burst', 'shield', 'poison', 'heal'];
