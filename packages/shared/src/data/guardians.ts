import type { ActiveKind } from './abilities';
import type { Diet } from '../types';

export interface GuardianAbility {
  kind: ActiveKind;
  cd: number;
  v: number;
  dur?: number;
  /** Seconds before the first use. */
  first?: number;
  family: Diet;
  also?: { kind: Exclude<ActiveKind, 'burst'>; v: number; dur?: number };
}

export interface GuardianDef {
  id: string;
  /** Stats at the stage the guardian first appears on. */
  hp: number;
  atk: number;
  interval: number;
  armor: number;
  crit: number;
  abilities: readonly GuardianAbility[];
  /** Below this HP fraction the guardian gets +haste percent, once. */
  enrage?: { below: number; hastePct: number };
  boss?: boolean;
}

export const GUARDIANS: readonly GuardianDef[] = [
  {
    id: 'moray',
    hp: 260,
    atk: 11,
    interval: 1.6,
    armor: 0,
    crit: 0,
    abilities: [{ kind: 'zap', cd: 6, v: 22, first: 4, family: 'spike' }],
  },
  {
    id: 'gate_crab',
    hp: 640,
    atk: 20,
    interval: 1.5,
    armor: 35,
    crit: 5,
    abilities: [
      { kind: 'shield', cd: 8, v: 70, first: 3, family: 'armor' },
      { kind: 'burst', cd: 3.5, v: 16, family: 'spike' },
    ],
  },
  {
    id: 'octopus',
    hp: 1250,
    atk: 17,
    interval: 0.8,
    armor: 15,
    crit: 5,
    abilities: [
      { kind: 'blind', cd: 9, v: 2.2, first: 2.5, family: 'glow' },
      { kind: 'poison', cd: 5, v: 7, first: 4, family: 'venom' },
      { kind: 'pull', cd: 11, v: 30, dur: 3, first: 7, family: 'soft' },
    ],
  },
  {
    id: 'angler',
    hp: 2700,
    atk: 52,
    interval: 1.35,
    armor: 30,
    crit: 15,
    abilities: [
      { kind: 'stun', cd: 10, v: 1.1, first: 5, family: 'glow', also: { kind: 'zap', v: 60 } },
      { kind: 'zap', cd: 4.5, v: 55, first: 3, family: 'sting' },
      { kind: 'heal', cd: 12, v: 160, first: 12, family: 'soft' },
    ],
    enrage: { below: 0.4, hastePct: 40 },
    boss: true,
  },
];

export const GUARDIAN_BY_ID: ReadonlyMap<string, GuardianDef> = new Map(GUARDIANS.map((g) => [g.id, g]));

export function guardianDef(id: string): GuardianDef {
  const g = GUARDIAN_BY_ID.get(id);
  if (!g) throw new Error(`unknown guardian: ${id}`);
  return g;
}
