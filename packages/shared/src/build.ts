import { MAGNITUDE_KINDS, type ActiveAbility, type ActiveKind, type TenantDef } from './data/abilities';
import { BAL, GENE_PASSIVE, GENE_PASSIVE_MAX_STEPS, sizeScale } from './data/balance';
import { guardianDef } from './data/guardians';
import { heroDef } from './data/heroes';
import { mutationDef } from './data/mutations';
import { SET_BONUSES, SET_THRESHOLDS } from './data/sets';
import { shellDef } from './data/shells';
import { tenantDef } from './data/tenants';
import {
  addMods,
  DIETS,
  MUT_SLOTS,
  zeroDiets,
  zeroMods,
  type BuildSnapshot,
  type Diet,
  type DietMap,
  type Mods,
  type ShellInst,
  type TenantInst,
} from './types';

export function slotCount(heroId: string, shell: ShellInst, extraSlots = 0): number {
  const hero = heroDef(heroId);
  const n = 3 + shell.tier + shellDef(shell.id).slotDelta + hero.slotDelta + extraSlots;
  return Math.max(1, Math.min(hero.maxSlots, n));
}

/** Slots [0, frontCount) are the front row, the rest are the back row. */
export function frontCount(totalSlots: number): number {
  return Math.ceil(totalSlots / 2);
}

export function slotRow(index: number, totalSlots: number): 'front' | 'back' {
  return index < frontCount(totalSlots) ? 'front' : 'back';
}

export function rowMult(def: TenantDef, index: number, totalSlots: number): number {
  if (def.role === 'any') return 1;
  return def.role === slotRow(index, totalSlots) ? BAL.rowBonus : 1;
}

/** Number of tenants per family (bridges count for both). */
export function familyCounts(slots: readonly (TenantInst | null)[]): DietMap {
  const counts = zeroDiets();
  for (const t of slots) {
    if (!t) continue;
    for (const f of tenantDef(t.id).families) counts[f] += 1;
  }
  return counts;
}

/** Index (0..2) of the highest reached set threshold, or -1. */
export function setLevel(count: number): number {
  let level = -1;
  for (let i = 0; i < SET_THRESHOLDS.length; i++) if (count >= (SET_THRESHOLDS[i] as number)) level = i;
  return level;
}

export function genePower(genes: number): number {
  return Math.min(BAL.genePowerCap, Math.floor(genes) * BAL.genePowerPct);
}

/** Aggregates every passive source of a build. */
export function computeMods(build: BuildSnapshot): Mods {
  const hero = heroDef(build.heroId);
  const mods = zeroMods();
  addMods(mods, hero.mods);
  addMods(mods, build.extra);

  for (const d of DIETS) {
    const g = build.genes[d];
    mods.power[d] += genePower(g);
    addMods(mods, GENE_PASSIVE[d], Math.min(GENE_PASSIVE_MAX_STEPS, Math.floor(g / 10)));
  }

  for (const slot of MUT_SLOTS) {
    const inst = build.mutations[slot];
    if (!inst) continue;
    const def = mutationDef(inst.id);
    addMods(mods, def.tiers[Math.max(0, Math.min(2, inst.tier - 1))]);
  }

  addMods(mods, shellDef(build.shell.id).mods);

  const counts = familyCounts(build.slots);
  for (const d of DIETS) {
    const level = setLevel(counts[d]);
    if (level >= 0) addMods(mods, SET_BONUSES[d][level]);
  }

  const total = build.slots.length;
  build.slots.forEach((t, i) => {
    if (!t) return;
    const def = tenantDef(t.id);
    if (def.ability.type !== 'passive') return;
    addMods(mods, def.ability.mods[t.star - 1], hero.tenantPower * rowMult(def, i, total));
  });
  return mods;
}

export interface AbilityInst {
  /** Slot index for crabs, ability index for guardians. */
  src: number;
  kind: ActiveKind;
  cd: number;
  v: number;
  dur: number;
  /** Extra bounces. */
  n: number;
  family: Diet;
  /** Seconds before the first use. */
  first: number;
  range: number;
  also?: { kind: Exclude<ActiveKind, 'burst'>; v: number; dur: number };
}

export interface Fighter {
  id: string;
  isGuardian: boolean;
  maxHp: number;
  atk: number;
  interval: number;
  armor: number;
  /** 0..1 */
  crit: number;
  critMult: number;
  dodge: number;
  thorns: number;
  reflect: number;
  /** HP per second. */
  regen: number;
  leech: number;
  zapOnHit: number;
  poisonOnHit: number;
  poisonThorns: number;
  shieldOnHit: number;
  blindOnCrit: number;
  startShield: number;
  shieldMult: number;
  healMult: number;
  poisonNoDecay: boolean;
  poisonWeaken: number;
  weakAura: number;
  revive: number;
  chainBonus: number;
  stormEvery: number;
  punch?: { every: number; mult: number; stun: number };
  enrage?: { below: number; hastePct: number };
  abilities: AbilityInst[];
}

const DEFAULT_DUR: Partial<Record<ActiveKind, number>> = { mark: 3, weaken: 3, pull: 2 };

function scaleEffect(
  kind: ActiveKind,
  base: number,
  magnitude: number,
  soft: number,
): number {
  if (MAGNITUDE_KINDS.includes(kind)) return base * magnitude;
  const v = base * soft;
  if (kind === 'stun') return Math.min(BAL.maxStun, v);
  if (kind === 'blind') return Math.min(5, v);
  return Math.min(75, v);
}

function familyPower(mods: Mods, families: readonly Diet[]): number {
  let p = 0;
  for (const f of families) p = Math.max(p, mods.power[f]);
  return p;
}

/** Active tenant abilities of a build with all scaling applied. */
export function buildAbilities(build: BuildSnapshot, mods: Mods): AbilityInst[] {
  const hero = heroDef(build.heroId);
  const total = build.slots.length;
  const cdr = 1 - Math.min(50, Math.max(0, mods.cdrPct)) / 100;
  const sz = sizeScale(build.size, BAL.abilityPerSize);
  const out: AbilityInst[] = [];
  build.slots.forEach((t, i) => {
    if (!t) return;
    const def = tenantDef(t.id);
    if (def.ability.type !== 'active') return;
    const a: ActiveAbility = def.ability;
    const power = familyPower(mods, def.families);
    const row = rowMult(def, i, total);
    const magnitude = sz * (1 + power / 100) * row * hero.tenantPower;
    const soft = (1 + (BAL.softPowerShare * power) / 100) * row * hero.tenantPower;
    const inst: AbilityInst = {
      src: i,
      kind: a.kind,
      cd: Math.max(0.5, a.cd * cdr),
      v: scaleEffect(a.kind, a.v[t.star - 1] as number, magnitude, soft),
      dur: a.dur ?? DEFAULT_DUR[a.kind] ?? 0,
      n: (a.n ?? 0) + (a.kind === 'zap' && def.families.includes('sting') ? mods.chainBonus : 0),
      family: def.families[0],
      // Stagger first uses so abilities do not all fire on the same tick.
      first: Math.min(a.cd * cdr, 0.6 + 0.35 * i),
      range: a.range ?? 100,
    };
    if (a.also) {
      inst.also = {
        kind: a.also.kind,
        v: scaleEffect(a.also.kind, a.also.v[t.star - 1] as number, magnitude, soft),
        dur: a.also.dur ?? DEFAULT_DUR[a.also.kind] ?? 0,
      };
    }
    out.push(inst);
  });
  return out;
}

export function buildFighter(build: BuildSnapshot, precomputed?: Mods): Fighter {
  const hero = heroDef(build.heroId);
  const mods = precomputed ?? computeMods(build);
  const sz = sizeScale(build.size, BAL.abilityPerSize);
  const pw = (d: Diet) => 1 + mods.power[d] / 100;
  const fighter: Fighter = {
    id: build.heroId,
    isGuardian: false,
    maxHp: Math.round(hero.hp * sizeScale(build.size, BAL.hpPerSize) * (1 + mods.hpPct / 100)),
    atk: hero.atk * sizeScale(build.size, BAL.atkPerSize) * (1 + mods.atkPct / 100),
    interval: hero.interval / (1 + Math.max(-50, mods.hastePct) / 100),
    armor: Math.max(0, mods.armor),
    crit: Math.min(1, (BAL.baseCrit + mods.crit) / 100),
    critMult: BAL.baseCritMult + mods.critMult / 100,
    dodge: Math.min(0.6, Math.max(0, mods.dodgePct) / 100),
    thorns: mods.thorns * sz * pw('spike'),
    reflect: Math.min(0.8, mods.reflectPct / 100),
    regen: 0,
    leech: Math.min(0.8, mods.leechPct / 100),
    zapOnHit: mods.zapOnHit * sz * pw('sting'),
    poisonOnHit: mods.poisonOnHit * sz * pw('venom'),
    poisonThorns: mods.poisonThorns * sz * pw('venom'),
    shieldOnHit: mods.shieldOnHit * sz * pw('armor'),
    blindOnCrit: mods.blindOnCrit,
    startShield: 0,
    shieldMult: 1 + mods.shieldPct / 100,
    healMult: 1 + mods.healPct / 100,
    poisonNoDecay: mods.poisonNoDecay > 0,
    poisonWeaken: Math.min(0.6, mods.poisonWeakenPct / 100),
    weakAura: Math.min(0.5, mods.weakAuraPct / 100),
    revive: Math.min(1, mods.revivePct / 100),
    chainBonus: mods.chainBonus,
    stormEvery: mods.stormEvery,
    abilities: buildAbilities(build, mods),
  };
  fighter.regen = (fighter.maxHp * mods.regenPct) / 100;
  fighter.startShield = (fighter.maxHp * mods.startShieldPct) / 100;
  if (hero.punch) fighter.punch = hero.punch;
  return fighter;
}

export function guardianFighter(id: string, hpMult = 1, atkMult = 1): Fighter {
  const g = guardianDef(id);
  const scaleV = (kind: ActiveKind, v: number): number => {
    if (kind === 'heal' || kind === 'shield') return v * hpMult;
    return MAGNITUDE_KINDS.includes(kind) ? v * atkMult : v;
  };
  const fighter: Fighter = {
    id: g.id,
    isGuardian: true,
    maxHp: Math.round(g.hp * hpMult),
    atk: g.atk * atkMult,
    interval: g.interval,
    armor: g.armor,
    crit: g.crit / 100,
    critMult: BAL.baseCritMult,
    dodge: 0,
    thorns: 0,
    reflect: 0,
    regen: 0,
    leech: 0,
    zapOnHit: 0,
    poisonOnHit: 0,
    poisonThorns: 0,
    shieldOnHit: 0,
    blindOnCrit: 0,
    startShield: 0,
    shieldMult: 1,
    healMult: 1,
    poisonNoDecay: false,
    poisonWeaken: 0,
    weakAura: 0,
    revive: 0,
    chainBonus: 0,
    stormEvery: 0,
    abilities: g.abilities.map((a, i) => {
      const inst: AbilityInst = {
        src: i,
        kind: a.kind,
        cd: a.cd,
        v: scaleV(a.kind, a.v),
        dur: a.dur ?? DEFAULT_DUR[a.kind] ?? 0,
        n: 0,
        family: a.family,
        first: a.first ?? a.cd,
        range: 0,
      };
      if (a.also) inst.also = { kind: a.also.kind, v: scaleV(a.also.kind, a.also.v), dur: a.also.dur ?? DEFAULT_DUR[a.also.kind] ?? 0 };
      return inst;
    }),
  };
  if (g.enrage) fighter.enrage = g.enrage;
  return fighter;
}
