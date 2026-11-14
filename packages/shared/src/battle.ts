import type { AbilityInst, Fighter } from './build';
import type { ActiveKind } from './data/abilities';
import { BAL } from './data/balance';
import { createRng, type Rng } from './rng';

/**
 * Deterministic autobattle. Fixed 0.1 s ticks, one PRNG, only + - * / and Math.min/max/floor, so the
 * client and the server get bit-identical results from the same (fighters, seed).
 *
 * Side 0 is the challenger (the player), side 1 the defender (guardian or ghost).
 */
export type Side = 0 | 1;

/** Source of damage/effects: -1 claws, -2 thorns/reflect, -3 poison, -4 storm, >= 0 ability src. */
export const SRC_CLAW = -1;
export const SRC_THORNS = -2;
export const SRC_POISON = -3;
export const SRC_STORM = -4;

export type StatusKind = 'poison' | 'blind' | 'stun' | 'weak' | 'slow' | 'mark' | 'shield';

export type BattleEvent =
  | { t: number; e: 'hit'; s: Side; src: number; dmg: number; crit?: boolean; punch?: boolean; abs?: number }
  | { t: number; e: 'miss'; s: Side }
  | { t: number; e: 'cast'; s: Side; src: number; kind: ActiveKind }
  | { t: number; e: 'status'; s: Side; st: StatusKind; v: number; dur?: number }
  | { t: number; e: 'heal'; s: Side; src: number; v: number }
  | { t: number; e: 'dot'; s: Side; dmg: number }
  | { t: number; e: 'revive'; s: Side }
  | { t: number; e: 'enrage'; s: Side }
  | { t: number; e: 'frenzy' }
  | { t: number; e: 'end'; winner: Side };

export interface BattleResult {
  winner: Side;
  duration: number;
  /** Remaining HP fraction of each side. */
  hpLeft: [number, number];
  events: BattleEvent[];
  /** Damage dealt per source for each side (keys: claw, thorns, poison, storm, a<src>). */
  damage: [Record<string, number>, Record<string, number>];
  healed: [number, number];
}

interface SideState {
  f: Fighter;
  hp: number;
  shield: number;
  poison: number;
  blindT: number;
  stunT: number;
  stunImmuneT: number;
  weakT: number;
  weakV: number;
  slowT: number;
  slowV: number;
  markT: number;
  markV: number;
  atkTimer: number;
  hasteMult: number;
  cds: number[];
  attacks: number;
  stingCasts: number;
  reviveUsed: boolean;
  enraged: boolean;
  dotAcc: number;
  dmg: Record<string, number>;
  healed: number;
}

function srcKey(src: number): string {
  if (src === SRC_CLAW) return 'claw';
  if (src === SRC_THORNS) return 'thorns';
  if (src === SRC_POISON) return 'poison';
  if (src === SRC_STORM) return 'storm';
  return `a${src}`;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export interface BattleOptions {
  /** Skip the event log (balance simulations). */
  noEvents?: boolean;
}

export function simulateBattle(a: Fighter, b: Fighter, seed: string, opts: BattleOptions = {}): BattleResult {
  const rng: Rng = createRng(seed);
  const events: BattleEvent[] = [];
  const log = opts.noEvents ? null : events;
  const dt = BAL.tick;

  const mk = (f: Fighter): SideState => ({
    f,
    hp: f.maxHp,
    shield: f.startShield * f.shieldMult,
    poison: 0,
    blindT: 0,
    stunT: 0,
    stunImmuneT: 0,
    weakT: 0,
    weakV: 0,
    slowT: 0,
    slowV: 0,
    markT: 0,
    markV: 0,
    atkTimer: f.interval * 0.5,
    hasteMult: 1,
    cds: f.abilities.map((ab) => ab.first),
    attacks: 0,
    stingCasts: 0,
    reviveUsed: false,
    enraged: false,
    dotAcc: 0,
    dmg: {},
    healed: 0,
  });
  const sides: [SideState, SideState] = [mk(a), mk(b)];
  let tick = 0;
  let time = 0;
  let frenzy = 1;
  let healFactor = 1;
  let frenzyAnnounced = false;

  for (const s of [0, 1] as const) {
    if (sides[s].shield > 0) log?.push({ t: 0, e: 'status', s, st: 'shield', v: round1(sides[s].shield) });
  }

  /** Applies damage to `target`; returns the amount that got through to shield + HP. */
  const damage = (
    from: Side,
    src: number,
    raw: number,
    o: { pure?: boolean; crit?: boolean; punch?: boolean; silent?: boolean } = {},
  ): number => {
    const me = sides[from];
    const target = sides[from === 0 ? 1 : 0];
    let dmg = raw * frenzy;
    if (!o.pure) {
      dmg *= 100 / (100 + target.f.armor);
      if (target.markT > 0) dmg *= 1 + target.markV / 100;
    }
    if (dmg <= 0) return 0;
    let absorbed = 0;
    if (target.shield > 0 && !o.pure) {
      absorbed = Math.min(target.shield, dmg);
      target.shield -= absorbed;
    }
    target.hp -= dmg - absorbed;
    const key = srcKey(src);
    me.dmg[key] = (me.dmg[key] ?? 0) + dmg;
    if (!o.silent && log) {
      const ev: BattleEvent = { t: time, e: 'hit', s: from, src, dmg: round1(dmg) };
      if (o.crit) ev.crit = true;
      if (o.punch) ev.punch = true;
      if (absorbed > 0) ev.abs = round1(absorbed);
      log.push(ev);
    }
    return dmg;
  };

  const heal = (side: Side, src: number, amount: number, silent = false): void => {
    const me = sides[side];
    const v = Math.min(me.f.maxHp - me.hp, amount * me.f.healMult * healFactor);
    if (v <= 0) return;
    me.hp += v;
    me.healed += v;
    if (!silent) log?.push({ t: time, e: 'heal', s: side, src, v: round1(v) });
  };

  const stun = (targetSide: Side, seconds: number): void => {
    const target = sides[targetSide];
    if (target.stunImmuneT > 0 || seconds <= 0) return;
    const dur = Math.min(BAL.maxStun, seconds);
    target.stunT = Math.max(target.stunT, dur);
    target.stunImmuneT = dur + BAL.stunImmunity;
    log?.push({ t: time, e: 'status', s: targetSide, st: 'stun', v: round1(dur), dur: round1(dur) });
  };

  const applyEffect = (from: Side, src: number, kind: ActiveKind, v: number, dur: number, n: number): void => {
    const me = sides[from];
    const foe: Side = from === 0 ? 1 : 0;
    const target = sides[foe];
    switch (kind) {
      case 'zap': {
        damage(from, src, v);
        let bounce = v;
        for (let i = 0; i < n; i++) {
          bounce *= BAL.chainFalloff;
          damage(from, src, bounce);
        }
        break;
      }
      case 'nova':
      case 'burst':
        damage(from, src, v);
        break;
      case 'blind':
        target.blindT = Math.max(target.blindT, v);
        log?.push({ t: time, e: 'status', s: foe, st: 'blind', v: round1(v), dur: round1(v) });
        break;
      case 'stun':
        stun(foe, v);
        break;
      case 'mark':
        target.markT = Math.max(target.markT, dur);
        target.markV = Math.max(target.markV, v);
        log?.push({ t: time, e: 'status', s: foe, st: 'mark', v: round1(v), dur });
        break;
      case 'weaken':
        target.weakT = Math.max(target.weakT, dur);
        target.weakV = Math.max(target.weakV, v);
        log?.push({ t: time, e: 'status', s: foe, st: 'weak', v: round1(v), dur });
        break;
      case 'pull':
        target.slowT = Math.max(target.slowT, dur);
        target.slowV = Math.max(target.slowV, v);
        log?.push({ t: time, e: 'status', s: foe, st: 'slow', v: round1(v), dur });
        break;
      case 'poison':
        target.poison += v;
        log?.push({ t: time, e: 'status', s: foe, st: 'poison', v: round1(target.poison) });
        break;
      case 'shield': {
        const add = v * me.f.shieldMult;
        me.shield += add;
        log?.push({ t: time, e: 'status', s: from, st: 'shield', v: round1(me.shield) });
        break;
      }
      case 'heal':
        heal(from, src, v);
        break;
    }
  };

  const cast = (from: Side, ab: AbilityInst): void => {
    const me = sides[from];
    log?.push({ t: time, e: 'cast', s: from, src: ab.src, kind: ab.kind });
    applyEffect(from, ab.src, ab.kind, ab.v, ab.dur, ab.n);
    if (ab.also) applyEffect(from, ab.src, ab.also.kind, ab.also.v, ab.also.dur, 0);
    if (ab.family === 'sting' && me.f.stormEvery > 0 && (ab.kind === 'zap' || ab.kind === 'nova' || ab.kind === 'burst')) {
      me.stingCasts += 1;
      if (me.stingCasts % me.f.stormEvery === 0) {
        damage(from, SRC_STORM, ab.v * BAL.stormMult);
        stun(from === 0 ? 1 : 0, BAL.stormStun);
      }
    }
  };

  const attack = (from: Side): void => {
    const me = sides[from];
    const foe: Side = from === 0 ? 1 : 0;
    const target = sides[foe];
    me.attacks += 1;
    const blinded = me.blindT > 0 && rng.chance(BAL.blindMiss);
    const dodged = !blinded && target.f.dodge > 0 && rng.chance(target.f.dodge);
    if (blinded || dodged) {
      log?.push({ t: time, e: 'miss', s: from });
      return;
    }
    let dmg = me.f.atk;
    if (me.weakT > 0) dmg *= 1 - me.weakV / 100;
    if (target.f.weakAura > 0) dmg *= 1 - target.f.weakAura;
    if (me.poison > 0 && target.f.poisonWeaken > 0) dmg *= 1 - target.f.poisonWeaken;
    const punch = me.f.punch !== undefined && me.attacks % me.f.punch.every === 0;
    if (punch && me.f.punch) dmg *= me.f.punch.mult;
    const crit = rng.chance(me.f.crit);
    if (crit) dmg *= me.f.critMult;
    const dealt = damage(from, SRC_CLAW, dmg, { crit, punch });
    if (punch && me.f.punch) stun(foe, me.f.punch.stun);
    if (me.f.zapOnHit > 0) damage(from, SRC_CLAW, me.f.zapOnHit, { silent: true });
    if (me.f.poisonOnHit > 0) target.poison += me.f.poisonOnHit;
    if (me.f.shieldOnHit > 0) me.shield += me.f.shieldOnHit * me.f.shieldMult;
    if (me.f.leech > 0) heal(from, SRC_CLAW, dealt * me.f.leech, true);
    if (crit && me.f.blindOnCrit > 0) target.blindT = Math.max(target.blindT, me.f.blindOnCrit);

    // Reactions of the target.
    const back = target.f.thorns + dealt * target.f.reflect;
    if (back > 0) damage(foe, SRC_THORNS, back, { silent: back < 1 });
    if (target.f.poisonThorns > 0) me.poison += target.f.poisonThorns;
    for (let i = 0; i < target.f.abilities.length; i++) {
      const ab = target.f.abilities[i] as AbilityInst;
      if (ab.kind === 'burst' && (target.cds[i] as number) <= 0 && target.stunT <= 0) {
        target.cds[i] = ab.cd;
        cast(foe, ab);
      }
    }
  };

  const alive = (s: Side): boolean => {
    const me = sides[s];
    if (me.hp > 0) return true;
    if (me.f.revive > 0 && !me.reviveUsed) {
      me.reviveUsed = true;
      me.hp = me.f.maxHp * me.f.revive;
      me.poison = 0;
      me.blindT = 0;
      me.stunT = 0;
      me.weakT = 0;
      me.slowT = 0;
      me.markT = 0;
      log?.push({ t: time, e: 'revive', s });
      return true;
    }
    return false;
  };

  const maxTicks = Math.round(BAL.maxDuration / dt);
  let winner: Side | null = null;

  while (tick < maxTicks && winner === null) {
    tick += 1;
    time = Math.round(tick * dt * 10) / 10;
    if (time > BAL.frenzyStart) {
      frenzy = 1 + BAL.frenzyPerSec * (time - BAL.frenzyStart);
      healFactor = 0.5;
      if (!frenzyAnnounced) {
        frenzyAnnounced = true;
        log?.push({ t: time, e: 'frenzy' });
      }
    }

    for (const s of [0, 1] as const) {
      const me = sides[s];
      const foe = sides[s === 0 ? 1 : 0];

      // Damage over time and regeneration.
      if (me.poison > 0) {
        const d = me.poison * dt * frenzy;
        me.hp -= d;
        foe.dmg.poison = (foe.dmg.poison ?? 0) + d;
        me.dotAcc += d;
        if (!foe.f.poisonNoDecay) {
          me.poison *= 1 - BAL.poisonDecayPerSec * dt;
          if (me.poison < 0.05) me.poison = 0;
        }
        if (tick % 5 === 0 && me.dotAcc > 0) {
          log?.push({ t: time, e: 'dot', s, dmg: round1(me.dotAcc) });
          me.dotAcc = 0;
        }
      }
      if (me.f.regen > 0 && me.hp > 0) heal(s, SRC_CLAW, me.f.regen * dt, true);

      if (me.blindT > 0) me.blindT -= dt;
      if (me.weakT > 0) me.weakT -= dt;
      if (me.slowT > 0) me.slowT -= dt;
      if (me.markT > 0) {
        me.markT -= dt;
        if (me.markT <= 0) me.markV = 0;
      }
      if (me.stunImmuneT > 0) me.stunImmuneT -= dt;

      if (!me.enraged && me.f.enrage && me.hp > 0 && me.hp < me.f.maxHp * me.f.enrage.below) {
        me.enraged = true;
        me.hasteMult = 1 + me.f.enrage.hastePct / 100;
        log?.push({ t: time, e: 'enrage', s });
      }

      if (me.stunT > 0) {
        me.stunT -= dt;
        continue;
      }
      if (me.hp <= 0) continue;

      const slow = me.slowT > 0 ? 1 + me.slowV / 100 : 1;
      me.atkTimer -= (dt * me.hasteMult) / slow;
      if (me.atkTimer <= 0) {
        me.atkTimer += me.f.interval;
        attack(s);
      }
      for (let i = 0; i < me.f.abilities.length; i++) {
        const ab = me.f.abilities[i] as AbilityInst;
        if ((me.cds[i] as number) > 0) me.cds[i] = (me.cds[i] as number) - dt;
        if (ab.kind === 'burst') continue; // reactive, fired from attack()
        if ((me.cds[i] as number) <= 0) {
          me.cds[i] = ab.cd;
          cast(s, ab);
        }
      }
    }

    const alive0 = alive(0);
    const alive1 = alive(1);
    if (!alive0) winner = 1;
    else if (!alive1) winner = 0;
  }

  if (winner === null) {
    const f0 = sides[0].hp / sides[0].f.maxHp;
    const f1 = sides[1].hp / sides[1].f.maxHp;
    winner = f0 > f1 ? 0 : 1;
  }
  log?.push({ t: time, e: 'end', winner });

  return {
    winner,
    duration: time,
    hpLeft: [
      Math.max(0, sides[0].hp) / sides[0].f.maxHp,
      Math.max(0, sides[1].hp) / sides[1].f.maxHp,
    ],
    events,
    damage: [sides[0].dmg, sides[1].dmg],
    healed: [sides[0].healed, sides[1].healed],
  };
}

const DUMMY_BASE: Omit<Fighter, 'id' | 'maxHp' | 'atk' | 'interval' | 'armor'> = {
  isGuardian: true,
  crit: 0,
  critMult: 2,
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
  abilities: [],
};

/**
 * Single-number build strength used for ghost matchmaking and the "power" label. Geometric mean of
 * the damage dealt to a punching bag in 20 s and the punishment survived against a standard attacker.
 */
export function ratePower(f: Fighter): number {
  const bag: Fighter = { ...DUMMY_BASE, id: 'bag', maxHp: 1e9, atk: 6, interval: 1.2, armor: 10 };
  const res = simulateBattle(f, bag, 'power-rating', { noEvents: true });
  let dealt = 0;
  for (const k of Object.keys(res.damage[0])) dealt += res.damage[0][k] as number;
  const dps = dealt / res.duration;

  const brute: Fighter = { ...DUMMY_BASE, id: 'brute', maxHp: 1e9, atk: 14, interval: 1, armor: 0 };
  const tank = simulateBattle(f, brute, 'power-rating', { noEvents: true });
  let taken = 0;
  for (const k of Object.keys(tank.damage[1])) taken += tank.damage[1][k] as number;
  // Survived the whole fight: extrapolate from the HP that is left.
  const ehp = tank.winner === 0 || tank.hpLeft[0] > 0 ? taken / Math.max(0.05, 1 - tank.hpLeft[0]) : taken;
  return Math.round(Math.sqrt(Math.max(1, dps) * Math.max(1, ehp)));
}
