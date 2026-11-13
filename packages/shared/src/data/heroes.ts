import type { ModPatch } from '../types';

/**
 * How a hero carries its tenants. 'shell' = slots on the shell (all current heroes).
 * 'retinue' is reserved for a future hero whose symbionts swim behind it in formation: the
 * simulation only sees `slots`, so such a hero needs a new layout strategy in the renderer and a
 * HeroDef with layout: 'retinue', nothing else.
 */
export type HeroLayout = 'shell' | 'retinue';

export interface HeroDef {
  id: string;
  layout: HeroLayout;
  hp: number;
  atk: number;
  /** Seconds between claw attacks. */
  interval: number;
  /** Hunt speed, world units per second. */
  speed: number;
  slotDelta: number;
  maxSlots: number;
  /** Multiplier for tenant ability magnitudes and passive mods. */
  tenantPower: number;
  /** Copies needed for a merge. */
  mergeCount: 2 | 3;
  /** Gene gain multiplier. */
  geneMult: number;
  /** Every Nth claw attack is a heavy punch. */
  punch?: { every: number; mult: number; stun: number };
  mods: ModPatch;
  /** Hatchery level that unlocks the hero. */
  unlock: number;
}

export const HEROES: readonly HeroDef[] = [
  {
    id: 'hermit',
    layout: 'shell',
    hp: 100,
    atk: 8,
    interval: 1.2,
    speed: 150,
    slotDelta: 0,
    maxSlots: 8,
    tenantPower: 1,
    mergeCount: 3,
    geneMult: 1,
    mods: {},
    unlock: 0,
  },
  {
    id: 'decorator',
    layout: 'shell',
    hp: 110,
    atk: 7,
    interval: 1.3,
    speed: 140,
    slotDelta: 2,
    maxSlots: 10,
    tenantPower: 0.72,
    mergeCount: 2,
    geneMult: 1,
    mods: {},
    unlock: 2,
  },
  {
    id: 'mantis',
    layout: 'shell',
    hp: 90,
    atk: 12,
    interval: 1.1,
    speed: 165,
    slotDelta: -1,
    maxSlots: 6,
    tenantPower: 1,
    mergeCount: 3,
    geneMult: 1.5,
    punch: { every: 4, mult: 2.5, stun: 0.4 },
    mods: { crit: 5 },
    unlock: 4,
  },
];

export const HERO_BY_ID: ReadonlyMap<string, HeroDef> = new Map(HEROES.map((h) => [h.id, h]));

export function heroDef(id: string): HeroDef {
  const h = HERO_BY_ID.get(id);
  if (!h) throw new Error(`unknown hero: ${id}`);
  return h;
}
