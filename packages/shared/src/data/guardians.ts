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
  /** Families whose abilities hurt it more / less (see BAL.weakMult, BAL.resistMult). */
  weak: readonly Diet[];
  resist: readonly Diet[];
}

export const GUARDIANS: readonly GuardianDef[] = [
  {
    id: 'moray',
    hp: 190,
    atk: 9,
    interval: 1.7,
    armor: 0,
    crit: 0,
    abilities: [{ kind: 'zap', cd: 6.5, v: 15, first: 4.5, family: 'spike' }],
    weak: ['sting'],
    resist: ['venom'],
  },
  {
    id: 'gate_crab',
    hp: 540,
    atk: 16,
    interval: 1.5,
    armor: 25,
    crit: 5,
    abilities: [
      { kind: 'shield', cd: 8, v: 50, first: 3, family: 'armor' },
      { kind: 'burst', cd: 4, v: 12, family: 'spike' },
    ],
    weak: ['venom'],
    resist: ['spike'],
  },
  {
    id: 'octopus',
    hp: 1500,
    atk: 17,
    interval: 0.8,
    armor: 15,
    crit: 5,
    abilities: [
      { kind: 'blind', cd: 9, v: 2.2, first: 2.5, family: 'glow' },
      { kind: 'poison', cd: 5, v: 7, first: 4, family: 'venom' },
      { kind: 'pull', cd: 11, v: 30, dur: 3, first: 7, family: 'soft' },
    ],
    weak: ['spike'],
    resist: ['glow'],
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
    weak: ['glow'],
    resist: ['sting'],
  },
];

export const GUARDIAN_BY_ID: ReadonlyMap<string, GuardianDef> = new Map(GUARDIANS.map((g) => [g.id, g]));

export function guardianDef(id: string): GuardianDef {
  const g = GUARDIAN_BY_ID.get(id);
  if (!g) throw new Error(`unknown guardian: ${id}`);
  return g;
}
