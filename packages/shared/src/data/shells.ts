import type { ModPatch } from '../types';

export interface ShellDef {
  id: string;
  /** Added to the slot count of the growth tier. */
  slotDelta: number;
  mods: ModPatch;
  /** Shell workshop level that adds it to the pool (0 = from the start). */
  unlock: number;
  /** Never offered; only the starting home. */
  starter?: boolean;
  /** Feat that has to be done once before the shell is offered. */
  feat?: string;
}

export const SHELLS: readonly ShellDef[] = [
  { id: 'periwinkle', slotDelta: 0, mods: {}, unlock: 0, starter: true },
  { id: 'spiral', slotDelta: 1, mods: {}, unlock: 0 },
  { id: 'can', slotDelta: 0, mods: { armor: 30, hpPct: 10, speedPct: -12 }, unlock: 0 },
  { id: 'bottle', slotDelta: 0, mods: { power: { glow: 30 }, crit: 6 }, unlock: 0 },
  { id: 'conch', slotDelta: 0, mods: { hpPct: 22, regenPct: 0.2 }, unlock: 1 },
  { id: 'skull', slotDelta: 0, mods: { atkPct: 22, hastePct: 6 }, unlock: 1 },
  { id: 'teapot', slotDelta: 0, mods: { healPct: 35, power: { soft: 25 } }, unlock: 2 },
  { id: 'urchin_test', slotDelta: 0, mods: { thorns: 4, power: { spike: 30 } }, unlock: 2 },
  { id: 'boot', slotDelta: 0, mods: { pearlPct: 40, lootPct: 15 }, unlock: 3 },
  { id: 'clam', slotDelta: 0, mods: { startShieldPct: 18, power: { armor: 30 } }, unlock: 3 },
  { id: 'nautilus', slotDelta: 0, mods: { cdrPct: 12, speedPct: 6 }, unlock: 4 },
  { id: 'lamp', slotDelta: 0, mods: { power: { sting: 25, glow: 15 }, magnetPct: 40 }, unlock: 4 },
  { id: 'flask', slotDelta: 0, mods: { power: { venom: 30 }, poisonOnHit: 0.5 }, unlock: 5 },
  { id: 'crown', slotDelta: 0, mods: { power: { sting: 12, spike: 12, glow: 12, armor: 12, venom: 12, soft: 12 } }, unlock: 0, feat: 'set6' },
];

export const SHELL_BY_ID: ReadonlyMap<string, ShellDef> = new Map(SHELLS.map((s) => [s.id, s]));

export function shellDef(id: string): ShellDef {
  const s = SHELL_BY_ID.get(id);
  if (!s) throw new Error(`unknown shell: ${id}`);
  return s;
}

export const MAX_SHELL_TIER = 4;
export const MAX_SLOTS = 10;
