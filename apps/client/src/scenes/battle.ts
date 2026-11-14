import { signal } from '@preact/signals';
import { buildFighter, enemyFighter, krakenFighter, stageInfo, type BattleEvent, type BiomeId, type BuildSnapshot, type Fighter, type PublicRun } from '@shellter/shared';
import type { Sprite } from 'pixi.js';
import { Container, Graphics, Sprite as PixiSprite } from 'pixi.js';
import { sprite } from '../gfx/assets';
import { CrabView, type CrabLook } from '../gfx/crabView';
import { calm, DIET_TINT, Fx } from '../gfx/fx';
import { VIEW_W, type Scene } from '../gfx/stage';
import { BIOME_LOOK, Deep, glowTexture } from '../gfx/deep';
import { sfx } from '../sound';
import { haptic, player, type BattleView } from '../state';

export interface BattleHud {
  hp: [number, number];
  max: [number, number];
  shield: [number, number];
  status: [string[], string[]];
  time: number;
  done: boolean;
  frenzy: boolean;
}

export const battleHud = signal<BattleHud | null>(null);
export const battleSpeed = signal(1);

export function buildOfRun(r: PublicRun): BuildSnapshot {
  return { heroId: r.cfg.heroId, size: r.size, genes: r.genes, mutations: r.mutations, shell: r.shell, slots: r.slots, extra: r.cfg.extra };
}

function lookOf(b: BuildSnapshot): CrabLook {
  return { heroId: b.heroId, shell: b.shell, slots: b.slots, mutations: b.mutations, crabSkin: b.skin?.crab, shellPaint: b.skin?.shell };
}

const SFX_BY_KIND: Record<string, Parameters<typeof sfx>[0]> = {
  zap: 'zap', nova: 'spike', burst: 'spike', blind: 'flash', mark: 'flash', shield: 'shield', poison: 'poison', weaken: 'poison', heal: 'heal', pull: 'pull', stun: 'stun',
};

/** Plays back a simulated battle. The outcome is already known; this only animates the event log. */
export class BattleScene implements Scene {
  readonly root = new Container();
  private water: Deep;
  private floor = new Graphics();
  private fx = new Fx();
  private actors: [Container, Container] = [new Container(), new Container()];
  private crabs: [CrabView | null, CrabView | null] = [null, null];
  private boss: Sprite | null = null;
  private fighters: [Fighter, Fighter];
  private hp: [number, number];
  private shield: [number, number] = [0, 0];
  private timers: [Record<string, number>, Record<string, number>] = [{}, {}];
  private lunge: [number, number] = [0, 0];
  private flash: [number, number] = [0, 0];
  private t = 0;
  private i = 0;
  private done = false;
  private frenzy = false;
  private endT = 0;
  private baseY = 520;
  private hudT = 0;
  private events: BattleEvent[];

  constructor(private view: BattleView, private onEnd: () => void) {
    const biome = view.kraken ? 'abyss' : stageInfo(view.stage).biome;
    this.water = new Deep(biome, 8);
    this.events = view.result.events;
    const myBuild = buildOfRun(view.me);
    const eq = player.value?.cosmetics.equipped;
    if (eq) myBuild.skin = { crab: eq.crab, shell: eq.shell };
    this.fighters = [buildFighter(myBuild), view.kraken ? krakenFighter() : enemyFighter(view.enemy)];
    this.hp = [this.fighters[0].maxHp, this.fighters[1].maxHp];

    const me = new CrabView();
    me.setLook(lookOf(myBuild));
    me.scale.set(1.7);
    this.crabs[0] = me;
    this.actors[0].addChild(me);
    if (view.enemy.kind === 'ghost') {
      const foe = new CrabView();
      foe.setLook(lookOf(view.enemy.build));
      foe.scale.set(-1.7, 1.7);
      foe.alpha = 0.88;
      this.crabs[1] = foe;
      this.actors[1].addChild(foe);
    } else {
      const shadow = sprite('fx/shadow', 2.4);
      shadow.alpha = 0.6;
      this.boss = sprite(`guardian/${view.enemy.id}`, view.enemy.id === 'angler' || view.enemy.id === 'kraken' ? 0.86 : 0.78);
      if (view.enemy.hpMult > 1) this.boss.tint = 0xffd0d0;
      this.actors[1].addChild(shadow, this.boss);
    }
    this.root.addChild(this.water.root, this.floor, this.actors[1], this.actors[0], this.fx.layer, this.water.front);
    battleSpeed.value = 1;
    this.pushHud();
  }

  private pos(side: 0 | 1): { x: number; y: number } {
    return { x: side === 0 ? 96 : VIEW_W - 104, y: this.baseY };
  }

  private center(side: 0 | 1): { x: number; y: number } {
    const p = this.pos(side);
    return { x: p.x, y: p.y - (side === 1 && this.boss ? 70 : 34) };
  }

  private source(side: 0 | 1, src: number): { x: number; y: number } {
    const crab = this.crabs[side];
    const p = this.pos(side);
    if (crab && src >= 0) {
      const s = crab.slotPoint(src);
      return { x: p.x + s.x, y: p.y + s.y };
    }
    return this.center(side);
  }

  private apply(e: BattleEvent): void {
    switch (e.e) {
      case 'hit': {
        const target = (e.s === 0 ? 1 : 0) as 0 | 1;
        const abs = e.abs ?? 0;
        this.shield[target] = Math.max(0, this.shield[target] - abs);
        this.hp[target] -= e.dmg - abs;
        const c = this.center(target);
        const big = e.crit === true || e.punch === true;
        if (e.src === -1) {
          this.lunge[e.s] = 1;
          this.crabs[e.s]?.snap();
          sfx(big ? 'crit' : 'claw_snap', { volume: 0.7, pan: e.s === 0 ? -0.3 : 0.3 });
        } else if (e.src >= 0) {
          const from = this.source(e.s, e.src);
          const ab = this.fighters[e.s].abilities.find((a) => a.src === e.src);
          const tint = DIET_TINT[ab?.family ?? 'sting'] ?? 0xffffff;
          for (let k = 1; k <= 5; k++) this.fx.emit('fx/spark', from.x + ((c.x - from.x) * k) / 5, from.y + ((c.y - from.y) * k) / 5, { n: 1, tint, speed: 18, size: 11, life: 0.22, add: true });
          this.fx.ring(c.x, c.y, 34, tint, 0.3);
        }
        this.flash[target] = 0.14;
        this.fx.emit('fx/dot', c.x, c.y, { n: big ? 10 : 4, tint: abs >= e.dmg ? 0x9fc4ff : 0xffffff, speed: big ? 150 : 80, size: big ? 16 : 10, life: 0.35, add: true });
        this.fx.text(c.x + (target === 0 ? -10 : 10), c.y - 30, `${big ? '★ ' : ''}${Math.round(e.dmg)}`, big ? 0xffe066 : target === 0 ? 0xff9a9a : 0xffffff, big ? 22 : 15);
        this.fx.addShake(big ? 6 : 1.5);
        this.crabs[target]?.bump(big ? 1 : 0.4);
        if (big) haptic('medium');
        break;
      }
      case 'miss': {
        const c = this.center(e.s === 0 ? 1 : 0);
        this.lunge[e.s] = 1;
        this.fx.text(c.x, c.y - 30, '✕', 0xc6fff4, 16);
        sfx('miss', { volume: 0.5 });
        break;
      }
      case 'cast': {
        this.crabs[e.s]?.pulseSlot(e.src);
        const p = this.source(e.s, e.src);
        this.fx.ring(p.x, p.y, 16, 0xffffff, 0.25);
        const id = SFX_BY_KIND[e.kind];
        if (id) sfx(id, { volume: 0.55, pan: e.s === 0 ? -0.3 : 0.3 });
        break;
      }
      case 'status': {
        const c = this.center(e.s);
        if (e.st === 'shield') {
          this.shield[e.s] = e.v;
          this.fx.ring(c.x, c.y, 46, 0x9fc4ff, 0.4);
        } else {
          this.timers[e.s][e.st] = e.st === 'poison' ? 99 : (e.dur ?? 2);
          const tint = e.st === 'poison' ? DIET_TINT.venom : e.st === 'stun' ? 0xfff6a0 : e.st === 'blind' ? 0xc6fff4 : 0xd9b8ff;
          this.fx.emit('fx/spark', c.x, c.y - 30, { n: 5, tint, speed: 50, size: 11, life: 0.5, add: true });
        }
        break;
      }
      case 'heal': {
        this.hp[e.s] = Math.min(this.fighters[e.s].maxHp, this.hp[e.s] + e.v);
        const c = this.center(e.s);
        this.fx.text(c.x, c.y - 44, `+${Math.round(e.v)}`, 0x9dffb0, 15);
        this.fx.emit('fx/spark', c.x, c.y, { n: 5, tint: 0x9dffb0, speed: 40, size: 10, life: 0.6, up: 50, add: true });
        break;
      }
      case 'dot': {
        this.hp[e.s] -= e.dmg;
        const c = this.center(e.s);
        this.fx.text(c.x + 24, c.y - 10, String(Math.max(1, Math.round(e.dmg))), DIET_TINT.venom, 12);
        break;
      }
      case 'revive': {
        this.hp[e.s] = this.fighters[e.s].maxHp * this.fighters[e.s].revive;
        this.timers[e.s] = {};
        const c = this.center(e.s);
        this.fx.ring(c.x, c.y, 90, 0xffb0d0, 0.7);
        this.fx.emit('fx/spark', c.x, c.y, { n: 20, tint: 0xffb0d0, speed: 160, size: 14, life: 0.8, add: true });
        sfx('heal');
        break;
      }
      case 'enrage': {
        const c = this.center(e.s);
        this.fx.ring(c.x, c.y, 110, 0xff5a5a, 0.6);
        this.fx.addShake(7);
        sfx('boss_roar');
        break;
      }
      case 'frenzy':
        this.frenzy = true;
        sfx('boss_roar', { volume: 0.6 });
        break;
      case 'end': {
        const loser = (e.winner === 0 ? 1 : 0) as 0 | 1;
        this.hp[loser] = 0;
        this.hp[e.winner] = this.view.result.hpLeft[e.winner] * this.fighters[e.winner].maxHp;
        const c = this.center(loser);
        this.fx.emit('fx/dot', c.x, c.y, { n: 26, tint: 0xffffff, speed: 220, size: 20, life: 0.8, add: true });
        this.fx.ring(c.x, c.y, 130, 0xffffff, 0.6);
        this.fx.addShake(9);
        sfx(e.winner === 0 ? 'victory' : 'defeat');
        haptic(e.winner === 0 ? 'success' : 'error');
        this.done = true;
        this.endT = 1.1;
        break;
      }
    }
  }

  skip(): void {
    if (this.done) return;
    // Jump to the end without animating the middle.
    const last = this.events[this.events.length - 1];
    this.i = this.events.length;
    this.shield = [0, 0];
    this.timers = [{}, {}];
    if (last) this.apply(last);
  }

  private pushHud(): void {
    const names = (side: 0 | 1): string[] => Object.keys(this.timers[side]).filter((k) => (this.timers[side][k] ?? 0) > 0);
    battleHud.value = {
      hp: [Math.max(0, this.hp[0]), Math.max(0, this.hp[1])], max: [this.fighters[0].maxHp, this.fighters[1].maxHp],
      shield: [this.shield[0], this.shield[1]], status: [names(0), names(1)], time: this.t, done: this.done && this.endT <= 0, frenzy: this.frenzy,
    };
  }

  update(dtRaw: number): void {
    this.water.update(dtRaw);
    this.fx.update(dtRaw);
    const dt = dtRaw * battleSpeed.value;
    if (!this.done) {
      this.t += dt;
      // At x4 many events land in one frame; cap the work per frame so it stays smooth.
      let budget = 40;
      while (this.i < this.events.length && (this.events[this.i] as BattleEvent).t <= this.t && budget-- > 0 && !this.done) {
        this.apply(this.events[this.i] as BattleEvent);
        this.i += 1;
      }
    } else if (this.endT > 0) {
      this.endT -= dtRaw;
      if (this.endT <= 0) {
        this.pushHud();
        this.onEnd();
      }
    }
    for (const s of [0, 1] as const) {
      for (const k of Object.keys(this.timers[s])) this.timers[s][k] = (this.timers[s][k] ?? 0) - dt;
      this.lunge[s] = Math.max(0, this.lunge[s] - dtRaw * 5 * Math.max(1, battleSpeed.value * 0.6));
      this.flash[s] = Math.max(0, this.flash[s] - dtRaw);
      const p = this.pos(s);
      const dir = s === 0 ? 1 : -1;
      const dead = this.done && this.hp[s] <= 0;
      const l = Math.sin(this.lunge[s] * Math.PI) * 34 * dir;
      const sh = calm.on ? 0 : this.fx.shake;
      this.actors[s].position.set(p.x + l + (Math.random() - 0.5) * sh, p.y + (Math.random() - 0.5) * sh);
      this.actors[s].alpha = dead ? Math.max(0, this.actors[s].alpha - dtRaw * 1.5) : 1;
      this.actors[s].rotation = dead ? this.actors[s].rotation + dtRaw * dir * 1.2 : 0;
      const crab = this.crabs[s];
      if (crab) {
        crab.moving = this.lunge[s] > 0;
        crab.update(dtRaw);
      }
    }
    if (this.boss) {
      const tt = performance.now() / 1000;
      this.boss.scale.y = Math.abs(this.boss.scale.x) * (1 + Math.sin(tt * 2.2) * 0.025);
      this.boss.tint = this.flash[1] > 0 ? 0xff9a9a : this.view.enemy.kind === 'guardian' && this.view.enemy.hpMult > 1 ? 0xffd0d0 : 0xffffff;
      this.boss.rotation = (this.timers[1].stun ?? 0) > 0 ? Math.sin(tt * 24) * 0.05 : 0;
    }
    this.hudT -= dtRaw;
    if (this.hudT <= 0) {
      this.hudT = 0.06;
      this.pushHud();
    }
  }

  resize(w: number, h: number): void {
    this.water.resize(w, h);
    this.baseY = Math.round(h * 0.6);
    const look = BIOME_LOOK[this.view.kraken ? 'abyss' : stageInfo(this.view.stage).biome];
    // No floor in open water: two pools of light mark where the fighters hang.
    this.floor.clear();
    this.floor.ellipse(96, this.baseY + 8, 92, 26).fill({ color: look.glow, alpha: 0.1 });
    this.floor.ellipse(w - 104, this.baseY + 8, 120, 32).fill({ color: 0xff6a5a, alpha: 0.08 });
  }

  destroy(): void {
    battleHud.value = null;
    this.root.destroy({ children: true });
  }
}

/** Calm backdrop with the player's crab in the middle: camp, home and result screens. */
export class ShowcaseScene implements Scene {
  readonly root = new Container();
  private water: Deep;
  private floor = new Graphics();
  private fx = new Fx();
  readonly crab = new CrabView();
  private y = 0.3;
  private scaleK = 1.6;
  private showCrab = true;

  constructor(biome: BiomeId, look: CrabLook | null, opts: { y?: number; scale?: number } = {}) {
    this.water = new Deep(biome, 10);
    this.biome = biome;
    this.y = opts.y ?? 0.3;
    this.scaleK = opts.scale ?? 1.6;
    this.root.addChild(this.water.root, this.pool, this.floor, this.crab, this.fx.layer, this.water.front);
    this.setLook(look);
  }
  private biome: BiomeId;
  private pool = ShowcaseScene.makePool();
  private static makePool(): PixiSprite {
    const g = new PixiSprite(glowTexture());
    g.anchor.set(0.5);
    g.alpha = 0.3;
    g.blendMode = 'add';
    return g;
  }

  setLook(look: CrabLook | null): void {
    this.showCrab = look !== null;
    this.crab.visible = this.showCrab;
    if (look) this.crab.setLook(look);
  }

  /** Festive burst on the given slot (merge) or on the whole crab. */
  celebrate(slot: number | null, tint = 0xffe066, rainbow = false): void {
    const p = slot !== null ? this.crab.slotPoint(slot) : { x: 0, y: -30 * this.scaleK };
    const x = this.crab.x + p.x;
    const y = this.crab.y + p.y;
    const tints = rainbow ? [0xff6a88, 0xffd166, 0x7bff9a, 0x7be3ff, 0xc38bff] : [tint, 0xffffff];
    tints.forEach((c, i) => this.fx.emit(i % 2 ? 'fx/dot' : 'fx/spark', x, y, { n: 9, tint: c, speed: 170, size: 15, life: 0.9, add: true, gravity: 120, up: 60 }));
    this.fx.ring(x, y, 80, tint, 0.6);
    this.fx.ring(x, y, 46, 0xffffff, 0.4);
    if (slot !== null) this.crab.pulseSlot(slot);
    this.crab.bump(1);
  }

  update(dt: number): void {
    this.water.update(dt);
    this.fx.update(dt);
    this.crab.update(dt);
  }

  resize(w: number, h: number): void {
    this.water.resize(w, h);
    const look = BIOME_LOOK[this.biome];
    const fy = h * this.y + 30;
    this.floor.clear();
    this.pool.visible = this.showCrab;
    this.pool.tint = look.glow;
    this.pool.position.set(w / 2, fy + 4);
    this.pool.width = w * 1.25;
    this.pool.height = w * 1.05;
    this.crab.position.set(w / 2 + 18, fy + 22);
    this.crab.scale.set(this.scaleK);
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
