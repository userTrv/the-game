import { signal } from '@preact/signals';
import {
  BAL, buildAbilities, buildFighter, computeMods, createRng, genesForTier, heroDef, sizeScale, spawnTable, stageInfo, xpForTier, xpNeed,
  zeroDiets, type AbilityInst, type ActiveKind, type BuildSnapshot, type CreatureDef, type DietMap, type Fighter, type HuntReport,
  type Mods, type PublicRun, type Rng, type SpawnEntry,
} from '@shellter/shared';
import type { Sprite} from 'pixi.js';
import { Container, Graphics, TilingSprite } from 'pixi.js';
import { sprite, tex } from '../gfx/assets';
import { CrabView } from '../gfx/crabView';
import { calm, DIET_TINT, Fx } from '../gfx/fx';
import { pixi, VIEW_W, viewHeight, type Scene } from '../gfx/stage';
import { BIOME_LOOK, Water } from '../gfx/water';
import { loadLocal, removeLocal, saveLocal } from '../platform/storage';
import { audio, sfx } from '../sound';
import { haptic, player } from '../state';

const H = BAL.hunt;
/** World zoom: the crab should read clearly on a phone held at arm's length. */
const ZOOM = 1.3;

export interface HuntHud {
  hp: number;
  maxHp: number;
  shield: number;
  size: number;
  xp: number;
  danger: number;
  time: number;
  canLeave: boolean;
  gained: DietMap;
  pearls: number;
  coral: number;
  hint: string | null;
  paused: boolean;
  eaten: number;
}

export const huntHud = signal<HuntHud | null>(null);

interface Creature {
  def: CreatureDef;
  tier: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  r: number;
  root: Container;
  body: Sprite;
  icon: Sprite;
  dir: number;
  think: number;
  biteT: number;
  stunT: number;
  slowT: number;
  poison: number;
  lureT: number;
  pullT: number;
  dash: number;
  flash: number;
  ph: number;
  scale: number;
}

interface Morsel {
  def: CreatureDef;
  tier: number;
  x: number;
  y: number;
  s: Sprite;
  age: number;
}

interface NodeEnt {
  kind: 'oyster' | 'coral' | 'glitter';
  x: number;
  y: number;
  s: Sprite;
  progress: number;
  done: boolean;
  respawn: number;
}

interface Saved {
  runId: string;
  nonce: number;
  time: number;
  eaten: Record<string, number>;
  nodes: { oyster: number; coral: number; glitter: number };
  hp: number;
  size: number;
  xp: number;
  gained: DietMap;
}

export class HuntScene implements Scene {
  readonly root = new Container();
  private world = new Container();
  private floor = new Container();
  private ents = new Container();
  private fx = new Fx();
  private dark = new Graphics();
  private water: Water;
  private crab = new CrabView();
  private creatures: Creature[] = [];
  private morsels: Morsel[] = [];
  private nodes: NodeEnt[] = [];
  private rng: Rng;
  private table: SpawnEntry[];
  private build: BuildSnapshot;
  private fighter: Fighter;
  private mods: Mods;
  private abilities: AbilityInst[];
  private cds: number[] = [];
  private cx = H.arenaW / 2;
  private cy = H.arenaH / 2;
  private facing = 1;
  private target: { x: number; y: number } | null = null;
  private hidden = true;
  private hp: number;
  private shield = 0;
  private size: number;
  private xp: number;
  private time = 0;
  private spawnAcc = 0;
  private atkT = 0;
  private combo = 0;
  private comboT = 0;
  private eaten: Record<string, number> = {};
  private eatenCount = 0;
  private nodeCount = { oyster: 0, coral: 0, glitter: 0 };
  private gained = zeroDiets();
  private pearls = 0;
  private coral = 0;
  private maxHpStart: number;
  private hudT = 0;
  private saveT = 0;
  private idleT = 0;
  private paused = false;
  private finished = false;
  private moved = 0;
  private sawBig = false;
  private hitStop = 0;
  private glitterSpawned = false;
  private camX = 0;
  private camY = 0;
  private info;
  private tutorial: boolean;
  private dangerTime: number;
  private canvas: HTMLCanvasElement;
  private onVis = (): void => {
    if (document.hidden) this.setPaused(true);
  };

  constructor(private run: PublicRun, private onDone: (report: HuntReport) => void) {
    this.info = stageInfo(run.stage);
    this.tutorial = run.cfg.tutorial && run.stage === 1;
    this.dangerTime = H.dangerTime * (this.tutorial ? 1.6 : 1);
    this.rng = createRng(`${run.huntSeed}/client`);
    this.table = spawnTable(run.stage, run.cfg.event?.dietWeights);
    this.size = run.size;
    this.xp = run.xp;
    this.hp = run.hp;
    this.build = this.makeBuild();
    this.mods = computeMods(this.build);
    this.fighter = buildFighter(this.build, this.mods);
    this.abilities = buildAbilities(this.build, this.mods);
    this.cds = this.abilities.map((a) => a.first + 1);
    this.maxHpStart = this.fighter.maxHp;
    this.shield = this.fighter.startShield * this.fighter.shieldMult;

    const saved = loadLocal<Saved | null>('hunt', null);
    if (saved && saved.runId === run.id && saved.nonce === run.huntNonce) {
      this.time = saved.time;
      this.eaten = saved.eaten;
      this.eatenCount = Object.values(saved.eaten).reduce((a, b) => a + b, 0);
      this.nodeCount = saved.nodes;
      this.gained = saved.gained;
      this.size = saved.size;
      this.xp = saved.xp;
      this.rebuild();
      this.hp = Math.min(this.fighter.maxHp, saved.hp);
    }

    this.water = new Water(this.info.biome, 10);
    this.buildFloor();
    this.ents.sortableChildren = true;
    this.world.addChild(this.floor, this.ents, this.fx.layer);
    this.root.addChild(this.water.root, this.world, this.dark);
    this.crab.setLook(this.look());
    this.ents.addChild(this.crab);
    this.crab.hidden = true;
    this.spawnNodes();
    for (let i = 0; i < H.initialSpawn; i++) this.spawn(true, i < 15);

    this.canvas = pixi().canvas as HTMLCanvasElement;
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    document.addEventListener('visibilitychange', this.onVis);
    this.pushHud();
  }

  private makeBuild(): BuildSnapshot {
    const r = this.run;
    return { heroId: r.cfg.heroId, size: this.size, genes: r.genes, mutations: r.mutations, shell: r.shell, slots: r.slots, extra: r.cfg.extra };
  }

  private look() {
    const eq = player.value?.cosmetics.equipped;
    return { heroId: this.run.cfg.heroId, shell: this.run.shell, slots: this.run.slots, mutations: this.run.mutations, crabSkin: eq?.crab, shellPaint: eq?.shell };
  }

  private rebuild(): void {
    this.build = this.makeBuild();
    this.mods = computeMods(this.build);
    this.fighter = buildFighter(this.build, this.mods);
    const old = this.cds;
    this.abilities = buildAbilities(this.build, this.mods);
    this.cds = this.abilities.map((a, i) => old[i] ?? a.first);
  }

  // --- Setup ---------------------------------------------------------------------------------------

  private buildFloor(): void {
    const look = BIOME_LOOK[this.info.biome];
    const g = new Graphics();
    g.roundRect(-40, -40, H.arenaW + 80, H.arenaH + 80, 60).fill({ color: look.floor });
    const rng = createRng(`${this.run.huntSeed}/floor`);
    for (let i = 0; i < 90; i++) {
      g.ellipse(rng.next() * H.arenaW, rng.next() * H.arenaH, 6 + rng.next() * 22, 3 + rng.next() * 9).fill({ color: look.floor2, alpha: 0.5 });
    }
    this.floor.addChild(g);
    const c = new TilingSprite({ texture: this.water.root.children[1] instanceof TilingSprite ? (this.water.root.children[1] as TilingSprite).texture : tex('fx/dot'), width: H.arenaW + 80, height: H.arenaH + 80 });
    c.position.set(-40, -40);
    c.alpha = look.caustic * 0.75;
    c.blendMode = 'add';
    this.floor.addChild(c);
    this.caustic = c;
    const decor = { lagoon: ['rock_sand', 'rock_coral', 'seagrass', 'seagrass_tall', 'fan_coral'], wreck: ['rock_dark', 'plank', 'anchor', 'barrel', 'kelp_dark'], abyss: ['rock_abyss', 'vent', 'crystal', 'bones', 'glow_weed'], trench: ['rock_abyss', 'vent', 'crystal', 'bones', 'glow_weed'] }[this.info.biome];
    for (let i = 0; i < 16; i++) {
      const id = decor[rng.int(0, decor.length - 1)] as string;
      const s = sprite(`decor/${id}`, 0.7 + rng.next() * 0.4);
      // Keep the middle of the arena open; decor frames the edges.
      const edge = rng.chance(0.8);
      const x = edge ? (rng.chance(0.5) ? rng.next() * 90 : H.arenaW - rng.next() * 90) : 60 + rng.next() * (H.arenaW - 120);
      const y = 40 + rng.next() * (H.arenaH - 60);
      s.position.set(x, y);
      s.zIndex = y;
      if (rng.chance(0.5)) s.scale.x *= -1;
      if (this.info.biome === 'trench') s.tint = 0xc8a8ff;
      this.ents.addChild(s);
    }
  }
  private caustic: TilingSprite | null = null;

  private spawnNodes(): void {
    const rng = createRng(`${this.run.huntSeed}/nodes`);
    const place = (kind: NodeEnt['kind']): void => {
      const x = 70 + rng.next() * (H.arenaW - 140);
      const y = 90 + rng.next() * (H.arenaH - 180);
      const s = sprite(kind === 'oyster' ? 'node/oyster' : kind === 'coral' ? 'node/coral' : 'node/glitter', 0.9);
      s.position.set(x, y);
      s.zIndex = y;
      this.ents.addChild(s);
      this.nodes.push({ kind, x, y, s, progress: 0, done: false, respawn: 0 });
    };
    for (let i = 0; i < H.oysters; i++) place('oyster');
    for (let i = 0; i < H.corals; i++) place('coral');
  }

  private spawn(initial: boolean, forceEdible = false): void {
    if (this.creatures.length >= H.maxAlive) return;
    const danger = Math.min(1, this.time / this.dangerTime);
    const ws = this.table.map((e) => {
      const gap = e.tier - this.size;
      if (gap <= 0) return e.weight * (gap < -3 ? 0.35 : 1);
      if (forceEdible) return 0;
      if (this.tutorial && this.time < 25) return gap === 1 ? e.weight * 0.2 : 0;
      return e.weight * (gap === 1 ? 0.55 : 0.16 + 0.5 * danger);
    });
    if (!ws.some((w) => w > 0)) ws.fill(1);
    const entry = this.table[this.rng.weightedIndex(ws)] as SpawnEntry;
    let x = 0;
    let y = 0;
    for (let tries = 0; tries < 12; tries++) {
      x = 30 + this.rng.next() * (H.arenaW - 60);
      y = 30 + this.rng.next() * (H.arenaH - 60);
      if (!initial) {
        // Enter from an edge.
        const side = this.rng.int(0, 3);
        if (side === 0) x = 10;
        else if (side === 1) x = H.arenaW - 10;
        else if (side === 2) y = 10;
        else y = H.arenaH - 10;
      }
      if (Math.hypot(x - this.cx, y - this.cy) > (initial ? 110 : 240)) break;
    }
    const def = entry.def;
    const scale = 0.62 + def.rank * 0.17 + (this.info.loop > 0 ? 0.05 : 0);
    const root = new Container();
    const shadow = sprite('fx/shadow', 0.5 * scale);
    shadow.alpha = 0.5;
    const body = sprite(`creature/${def.id}`, scale);
    body.y = def.hover ? -16 * scale : 0;
    if (this.info.biome === 'trench') body.tint = 0xd8c0ff;
    const icon = sprite(`icon/diet_${def.diet}`, 0.42);
    icon.y = body.y - 30 * scale;
    root.addChild(shadow, body, icon);
    this.ents.addChild(root);
    const hp = H.creatureHpBase * Math.pow(entry.tier, H.creatureHpPow);
    this.creatures.push({
      def, tier: entry.tier, x, y, vx: 0, vy: 0, hp, maxHp: hp, r: 12 * scale, root, body, icon, dir: this.rng.next() * Math.PI * 2,
      think: this.rng.next() * 2, biteT: 0, stunT: 0, slowT: 0, poison: 0, lureT: 0, pullT: 0, dash: 0, flash: 0, ph: this.rng.next() * 6, scale,
    });
  }

  // --- Input ---------------------------------------------------------------------------------------

  private toWorld(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const k = (rect.width / VIEW_W) * ZOOM;
    return { x: (e.clientX - rect.left) / k + this.camX, y: (e.clientY - rect.top) / k + this.camY };
  }
  private onDown = (e: PointerEvent): void => {
    if (this.finished) return;
    if (this.paused) this.setPaused(false);
    this.target = this.toWorld(e);
    this.hidden = false;
    this.idleT = 0;
  };
  private onMove = (e: PointerEvent): void => {
    if (this.target && !this.finished) this.target = this.toWorld(e);
  };
  private onUp = (): void => {
    if (!this.target) return;
    this.target = null;
    this.hidden = true;
    sfx('hide', { volume: 0.5 });
  };

  setPaused(p: boolean): void {
    if (this.paused === p || this.finished) return;
    this.paused = p;
    if (p) {
      this.target = null;
      this.hidden = true;
      this.save();
    }
    this.pushHud();
  }

  // --- Simulation ----------------------------------------------------------------------------------

  private crabScale(): number {
    return Math.max(0.72, Math.min(1.5, 0.78 + 0.1 * (this.size - this.info.baseTier)));
  }

  private eatReach(): number {
    return H.eatRadius * (1 + this.mods.eatRadiusPct / 100) * this.crabScale();
  }

  private eat(def: CreatureDef, tier: number, x: number, y: number): void {
    this.eaten[def.id] = (this.eaten[def.id] ?? 0) + 1;
    this.eatenCount += 1;
    this.xp += xpForTier(tier) * (1 + this.mods.xpPct / 100);
    this.gained[def.diet] += genesForTier(tier) * heroDef(this.run.cfg.heroId).geneMult * (1 + this.mods.genePct / 100);
    this.coral += H.coralPerTier * tier;
    this.combo = this.comboT > 0 ? Math.min(12, this.combo + 1) : 0;
    this.comboT = 1.2;
    const tint = DIET_TINT[def.diet] ?? 0xffffff;
    this.fx.emit('fx/dot', x, y, { n: 7, tint, speed: 90, size: 12, life: 0.4, add: true });
    this.fx.ring(x, y, 26, tint, 0.3);
    this.crab.bump(0.5);
    this.crab.snap();
    sfx(tier >= this.size ? 'eat_big' : 'eat_small', { pitch: 1 + this.combo * 0.05 });
    haptic('light');
    let grew = false;
    while (this.xp >= xpNeed(this.size)) {
      this.xp -= xpNeed(this.size);
      this.size += 1;
      grew = true;
    }
    if (grew) {
      const before = this.fighter.maxHp;
      this.rebuild();
      this.hp += this.fighter.maxHp - before;
      this.fx.ring(this.cx, this.cy - 10, 70, 0xfff3a8, 0.6);
      this.fx.emit('fx/spark', this.cx, this.cy - 14, { n: 14, tint: 0xfff3a8, speed: 140, size: 14, life: 0.7, add: true });
      this.fx.text(this.cx, this.cy - 50, '▲', 0xfff3a8, 26);
      this.crab.bump(1.2);
      this.hitStop = calm.on ? 0 : 0.07;
      sfx('grow');
      haptic('medium');
    }
  }

  private hurtCreature(c: Creature, dmg: number, tint = 0xffffff): void {
    if (c.hp <= 0) return;
    c.hp -= dmg;
    c.flash = 0.12;
    if (dmg >= 1) this.fx.text(c.x, c.y - 24 * c.scale, String(Math.round(dmg)), tint, 12);
    if (c.hp <= 0) {
      // A defeated creature turns into a morsel anyone can eat, however big it was.
      const s = sprite(`fx/morsel_${c.def.diet}`, 1.1 + c.def.rank * 0.15);
      s.position.set(c.x, c.y);
      s.zIndex = c.y;
      this.ents.addChild(s);
      this.morsels.push({ def: c.def, tier: c.tier, x: c.x, y: c.y, s, age: 0 });
      this.fx.emit('fx/dot', c.x, c.y - 8, { n: 10, tint: DIET_TINT[c.def.diet] ?? 0xffffff, speed: 110, size: 14, life: 0.5, add: true });
      this.fx.addShake(2);
      sfx('enemy_hit');
    }
  }

  private nearest(range: number, pred: (c: Creature) => boolean, from?: { x: number; y: number }, skip?: Set<Creature>): Creature | null {
    let best: Creature | null = null;
    let bd = range;
    const ox = from?.x ?? this.cx;
    const oy = from?.y ?? this.cy;
    for (const c of this.creatures) {
      if (c.hp <= 0 || skip?.has(c) || !pred(c)) continue;
      const d = Math.hypot(c.x - ox, c.y - oy) - c.r;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  private inRange(range: number): Creature[] {
    return this.creatures.filter((c) => c.hp > 0 && Math.hypot(c.x - this.cx, c.y - this.cy) - c.r < range);
  }

  private zapLine(x1: number, y1: number, x2: number, y2: number, tint: number): void {
    for (let i = 1; i <= 4; i++) {
      const k = i / 4;
      this.fx.emit('fx/spark', x1 + (x2 - x1) * k, y1 + (y2 - y1) * k, { n: 1, tint, speed: 20, size: 9, life: 0.22, add: true });
    }
  }

  /** Applies one ability effect in the pool; returns false when it had no target (cooldown is kept short). */
  private applyEffect(ab: AbilityInst, kind: ActiveKind, v: number, dur: number, n: number): boolean {
    const tint = DIET_TINT[ab.family] ?? 0xffffff;
    const range = ab.range * (0.9 + 0.1 * this.crabScale());
    const from = this.slotWorld(ab.src);
    const threat = (c: Creature): boolean => c.tier > this.size;
    switch (kind) {
      case 'zap': {
        const first = this.nearest(range, threat) ?? this.nearest(range * 0.8, () => true);
        if (!first) return false;
        const hit = new Set<Creature>();
        let cur: Creature | null = first;
        let dmg = v;
        let px = from.x;
        let py = from.y;
        for (let i = 0; i <= n && cur; i++) {
          this.zapLine(px, py, cur.x, cur.y - 8, tint);
          this.hurtCreature(cur, dmg, tint);
          hit.add(cur);
          px = cur.x;
          py = cur.y;
          dmg *= BAL.chainFalloff;
          cur = this.nearest(100, () => true, { x: px, y: py }, hit);
        }
        sfx(ab.family === 'sting' ? 'zap' : ab.family === 'venom' ? 'poison' : 'spike', { volume: 0.6 });
        return true;
      }
      case 'nova':
      case 'burst': {
        const list = this.inRange(range);
        if (list.length === 0 && kind === 'nova') return false;
        for (const c of list) this.hurtCreature(c, v, tint);
        this.fx.ring(this.cx, this.cy - 10, range, tint, 0.4);
        sfx('spike', { volume: 0.6 });
        return true;
      }
      case 'blind':
      case 'stun': {
        const list = kind === 'stun' ? [this.nearest(range, threat)].filter((c): c is Creature => c !== null) : this.inRange(range).filter(threat);
        if (list.length === 0) return false;
        for (const c of list) {
          c.stunT = Math.max(c.stunT, v);
          this.fx.emit('fx/spark', c.x, c.y - 20 * c.scale, { n: 4, tint: 0xfff6a0, speed: 40, size: 10, life: 0.5, add: true });
        }
        this.fx.ring(this.cx, this.cy - 10, range, 0xc6fff4, 0.35);
        sfx(kind === 'stun' ? 'stun' : 'flash', { volume: 0.6 });
        return true;
      }
      case 'mark': {
        const list = this.inRange(range).filter((c) => c.tier <= this.size);
        if (list.length === 0) return false;
        for (const c of list) c.lureT = dur + 1.5;
        this.fx.ring(this.cx, this.cy - 10, range * 0.6, tint, 0.6);
        sfx('flash', { volume: 0.4, pitch: 1.3 });
        return true;
      }
      case 'pull': {
        const c = this.nearest(range, (x) => x.tier <= this.size);
        if (!c) return false;
        c.pullT = 0.55;
        this.zapLine(from.x, from.y, c.x, c.y, 0x8fe0a0);
        sfx('pull', { volume: 0.6 });
        return true;
      }
      case 'weaken': {
        const list = this.inRange(range).filter(threat);
        if (list.length === 0) return false;
        for (const c of list) c.slowT = Math.max(c.slowT, dur + 1);
        this.fx.ring(this.cx, this.cy - 10, range, tint, 0.4);
        sfx('poison', { volume: 0.5 });
        return true;
      }
      case 'poison': {
        const c = this.nearest(range, threat) ?? this.nearest(range * 0.7, () => true);
        if (!c) return false;
        c.poison += v;
        this.zapLine(from.x, from.y, c.x, c.y - 8, tint);
        sfx('poison', { volume: 0.5 });
        return true;
      }
      case 'shield': {
        const cap = this.fighter.maxHp * 0.6;
        if (this.shield >= cap) return false;
        this.shield = Math.min(cap, this.shield + v * this.fighter.shieldMult);
        this.fx.ring(this.cx, this.cy - 12, 34, 0x9fc4ff, 0.4);
        sfx('shield', { volume: 0.5 });
        return true;
      }
      case 'heal': {
        if (this.hp >= this.fighter.maxHp - 0.5) return false;
        const amount = Math.min(this.fighter.maxHp - this.hp, v * this.fighter.healMult);
        this.hp += amount;
        this.fx.text(this.cx, this.cy - 44, `+${Math.round(amount)}`, 0x9dffb0, 14);
        this.fx.emit('fx/spark', this.cx, this.cy - 16, { n: 5, tint: 0x9dffb0, speed: 40, size: 9, life: 0.6, up: 40, add: true });
        sfx('heal', { volume: 0.5 });
        return true;
      }
    }
  }

  private slotWorld(slot: number): { x: number; y: number } {
    const p = this.crab.slotPoint(slot);
    return { x: this.cx + p.x, y: this.cy + p.y };
  }

  private cast(i: number): void {
    const ab = this.abilities[i] as AbilityInst;
    const ok = this.applyEffect(ab, ab.kind, ab.v, ab.dur, ab.n);
    if (ab.also && ok) this.applyEffect(ab, ab.also.kind, ab.also.v, ab.also.dur, 0);
    this.cds[i] = ok ? ab.cd : 0.4;
    if (ok) this.crab.pulseSlot(ab.src);
  }

  private takeBite(c: Creature): void {
    c.biteT = H.biteInterval;
    let dmg = H.creatureDmgBase * Math.pow(c.tier, H.creatureDmgPow) * (100 / (100 + this.fighter.armor));
    if (this.fighter.dodge > 0 && Math.random() < this.fighter.dodge) {
      this.fx.text(this.cx, this.cy - 40, '✦', 0xc6fff4, 14);
      return;
    }
    const absorbed = Math.min(this.shield, dmg);
    this.shield -= absorbed;
    dmg -= absorbed;
    this.hp -= dmg;
    if (dmg > 0) {
      this.fx.text(this.cx, this.cy - 40, `-${Math.max(1, Math.round(dmg))}`, 0xff7a7a, 16);
      this.fx.addShake(5);
      this.crab.bump(0.8);
      this.hitStop = calm.on ? 0 : 0.05;
      sfx('hurt');
      haptic('heavy');
    } else {
      sfx('shield', { volume: 0.5 });
    }
    const back = this.fighter.thorns + (dmg + absorbed) * this.fighter.reflect;
    if (back > 0) this.hurtCreature(c, back, DIET_TINT.spike);
    if (this.fighter.poisonThorns > 0) c.poison += this.fighter.poisonThorns;
    this.abilities.forEach((ab, i) => {
      if (ab.kind === 'burst' && (this.cds[i] as number) <= 0) this.cast(i);
    });
    if (!this.sawBig) this.sawBig = true;
  }

  private finish(ko: boolean): void {
    if (this.finished) return;
    this.finished = true;
    this.target = null;
    removeLocal('hunt');
    const report: HuntReport = {
      eaten: this.eaten,
      nodes: this.nodeCount,
      durationS: Math.round(this.time * 10) / 10,
      hpLost: Math.round((this.run.hp + (this.fighter.maxHp - this.maxHpStart) - Math.max(0, this.hp)) * 100) / 100,
      ko,
    };
    this.pushHud();
    setTimeout(() => this.onDone(report), ko ? 900 : 250);
  }

  leave(): void {
    if (this.time >= H.minLeaveTime) this.finish(false);
  }

  /** Test hook: where things are on screen (client px), so an automated player can steer. */
  debugState(): { crab: { x: number; y: number }; eaten: number; time: number; creatures: { x: number; y: number; edible: boolean }[]; nodes: { x: number; y: number }[] } {
    const rect = this.canvas.getBoundingClientRect();
    const k = (rect.width / VIEW_W) * ZOOM;
    const sc = (x: number, y: number): { x: number; y: number } => ({ x: rect.left + (x - this.camX) * k, y: rect.top + (y - this.camY) * k });
    return {
      crab: sc(this.cx, this.cy - 14),
      eaten: this.eatenCount,
      time: this.time,
      creatures: this.creatures.filter((c) => c.hp > 0).map((c) => ({ ...sc(c.x, c.y), edible: c.tier <= this.size })),
      nodes: this.nodes.filter((n) => !n.done).map((n) => sc(n.x, n.y)),
    };
  }

  private save(): void {
    if (this.finished) return;
    const s: Saved = { runId: this.run.id, nonce: this.run.huntNonce, time: this.time, eaten: this.eaten, nodes: this.nodeCount, hp: this.hp, size: this.size, xp: this.xp, gained: this.gained };
    saveLocal('hunt', s);
  }

  private hint(): string | null {
    if (!this.tutorial) return this.time < 4 && this.run.stage > 1 ? null : null;
    if (this.moved < 80) return 'hunt.hint.move';
    if (this.eatenCount < 3) return 'hunt.hint.eat';
    if (this.sawBig && this.time < 60 && this.hp < this.fighter.maxHp) return 'hunt.hint.hide';
    if (this.nodeCount.oyster === 0 && this.eatenCount >= 6 && this.time < 50) return 'hunt.hint.node';
    if (this.eatenCount >= 14 && this.time > 35) return 'hunt.hint.leave';
    return null;
  }

  private pushHud(): void {
    huntHud.value = {
      hp: Math.max(0, this.hp), maxHp: this.fighter.maxHp, shield: this.shield, size: this.size, xp: this.xp / xpNeed(this.size),
      danger: Math.min(1, this.time / this.dangerTime), time: this.time, canLeave: this.time >= H.minLeaveTime && !this.finished,
      gained: { ...this.gained }, pearls: this.pearls, coral: Math.floor(this.coral), hint: this.hint(), paused: this.paused, eaten: this.eatenCount,
    };
  }

  update(dtRaw: number): void {
    this.water.update(dtRaw);
    if (this.caustic) this.caustic.tilePosition.set(this.water ? performance.now() * 0.008 : 0, performance.now() * 0.005);
    this.fx.update(dtRaw);
    if (this.paused || this.finished) {
      this.crab.hidden = true;
      this.crab.update(dtRaw);
      return;
    }
    if (this.hitStop > 0) {
      this.hitStop -= dtRaw;
      return;
    }
    const dt = dtRaw;
    const f = this.fighter;
    this.time += dt;
    this.comboT -= dt;
    const danger = Math.min(1, this.time / this.dangerTime);
    audio.setIntensity(danger);

    // Crab movement: follow the finger.
    const speed = heroDef(this.run.cfg.heroId).speed * (1 + this.mods.speedPct / 100);
    let moving = false;
    if (this.target) {
      const dx = this.target.x - this.cx;
      const dy = this.target.y - (this.cy - 14);
      const d = Math.hypot(dx, dy);
      if (d > 10) {
        const v = Math.min(speed, d * 6) * dt;
        this.cx += (dx / d) * v;
        this.cy += (dy / d) * v;
        this.moved += v;
        moving = true;
        if (Math.abs(dx) > 6) this.facing = dx > 0 ? 1 : -1;
      }
      this.idleT = 0;
    } else {
      this.idleT += dt;
      if (this.idleT > 14) this.setPaused(true);
    }
    // A gentle current pushes downwards as danger grows.
    if (!this.hidden) this.cy += danger * 10 * dt;
    this.cx = Math.max(24, Math.min(H.arenaW - 24, this.cx));
    this.cy = Math.max(40, Math.min(H.arenaH - 20, this.cy));

    const cs = this.crabScale();
    const crabR = 15 * cs;
    const reach = this.eatReach();

    // Regeneration and trample.
    if (f.regen > 0 && this.hp < f.maxHp) this.hp = Math.min(f.maxHp, this.hp + f.regen * dt * 0.5);
    const trample = this.mods.trample * sizeScale(this.size, BAL.abilityPerSize);

    // Tenant abilities.
    for (let i = 0; i < this.abilities.length; i++) {
      this.cds[i] = (this.cds[i] as number) - dt;
      if ((this.abilities[i] as AbilityInst).kind !== 'burst' && (this.cds[i] as number) <= 0) this.cast(i);
    }

    // Claws pinch the nearest creature that is too big to swallow.
    this.atkT -= dt;
    if (!this.hidden && this.atkT <= 0) {
      const foe = this.nearest(reach + 14, (c) => c.tier > this.size);
      if (foe) {
        this.atkT = f.interval;
        const crit = Math.random() < f.crit;
        const dmg = f.atk * (crit ? f.critMult : 1);
        this.hurtCreature(foe, dmg + f.zapOnHit, crit ? 0xfff3a8 : 0xffffff);
        if (f.poisonOnHit > 0) foe.poison += f.poisonOnHit;
        if (f.shieldOnHit > 0) this.shield = Math.min(f.maxHp * 0.6, this.shield + f.shieldOnHit);
        if (f.leech > 0) this.hp = Math.min(f.maxHp, this.hp + dmg * f.leech);
        if (crit && f.blindOnCrit > 0) foe.stunT = Math.max(foe.stunT, f.blindOnCrit);
        this.crab.snap();
        this.facing = foe.x > this.cx ? 1 : -1;
        sfx(crit ? 'crit' : 'claw_snap', { volume: 0.7 });
      }
    }

    // Creatures.
    for (let i = this.creatures.length - 1; i >= 0; i--) {
      const c = this.creatures[i] as Creature;
      if (c.hp <= 0) {
        this.ents.removeChild(c.root);
        c.root.destroy({ children: true });
        this.creatures[i] = this.creatures[this.creatures.length - 1] as Creature;
        this.creatures.pop();
        continue;
      }
      const dx = this.cx - c.x;
      const dy = this.cy - c.y;
      const dist = Math.hypot(dx, dy) || 1;
      const edible = c.tier <= this.size;
      c.biteT -= dt;
      c.think -= dt;
      c.flash -= dt;
      if (c.poison > 0) {
        this.hurtCreature(c, 0, 0);
        c.hp -= c.poison * dt;
        c.poison *= 1 - BAL.poisonDecayPerSec * dt;
        if (c.hp <= 0) {
          c.hp = 0.01;
          this.hurtCreature(c, 1, DIET_TINT.venom);
          continue;
        }
      }
      let sp = c.def.speed * (c.slowT > 0 ? 0.45 : 1);
      if (c.slowT > 0) c.slowT -= dt;
      let ax = Math.cos(c.dir);
      let ay = Math.sin(c.dir);
      if (c.stunT > 0) {
        c.stunT -= dt;
        sp = 0;
      } else if (c.pullT > 0) {
        c.pullT -= dt;
        ax = dx / dist;
        ay = dy / dist;
        sp = 320;
      } else if (c.lureT > 0 && edible) {
        c.lureT -= dt;
        ax = dx / dist;
        ay = dy / dist;
        sp = Math.max(sp, 46);
      } else if (!edible && !this.hidden && (c.def.behavior === 'hunter' || (c.def.behavior === 'ambush' && (dist < 120 || c.dash > 0))) && dist < 190 + danger * 80) {
        // Predators chase a crab that is out of its shell.
        ax = dx / dist;
        ay = dy / dist;
        if (c.def.behavior === 'ambush') {
          if (c.dash <= 0 && c.think <= 0) {
            c.dash = 0.5;
            c.think = 2.6;
          }
          sp = c.dash > 0 ? c.def.speed : 0;
          c.dash -= dt;
        } else sp *= 1 + danger * 0.25;
        if (!this.sawBig && dist < 120) this.sawBig = true;
      } else {
        if (edible && !this.hidden && dist < 80 && (c.def.behavior === 'dart' || c.def.behavior === 'school') && c.dash <= 0) {
          c.dir = Math.atan2(-dy, -dx) + (this.rng.next() - 0.5);
          c.dash = 0.5;
        }
        if (c.dash > 0) {
          c.dash -= dt;
          sp *= c.def.behavior === 'dart' ? 1.6 : 1.2;
        } else if (c.def.behavior === 'dart') sp *= 0.12;
        else if (c.def.behavior === 'ambush') sp = 0;
        if (c.think <= 0) {
          c.think = 1.5 + this.rng.next() * 2.5;
          c.dir += (this.rng.next() - 0.5) * 2.4;
        }
        ax = Math.cos(c.dir);
        ay = Math.sin(c.dir);
      }
      c.x += ax * sp * dt;
      c.y += ay * sp * dt + danger * 6 * dt;
      if (c.x < 16 || c.x > H.arenaW - 16) c.dir = Math.PI - c.dir;
      if (c.y < 20 || c.y > H.arenaH - 12) c.dir = -c.dir;
      c.x = Math.max(12, Math.min(H.arenaW - 12, c.x));
      c.y = Math.max(16, Math.min(H.arenaH - 8, c.y));

      // Contact.
      if (dist < crabR + c.r) {
        if (trample > 0) this.hurtCreature(c, trample * dt * 4, DIET_TINT.spike);
        if (!this.hidden) {
          if (edible && dist < reach + c.r * 0.6) {
            c.hp = 0;
            this.eat(c.def, c.tier, c.x, c.y);
            continue;
          }
          if (!edible && c.biteT <= 0 && c.stunT <= 0) this.takeBite(c);
        }
      }

      // Visuals.
      c.root.position.set(c.x, c.y);
      c.root.zIndex = c.y;
      const bob = c.def.hover ? Math.sin(this.time * 2.4 + c.ph) * 3 : 0;
      c.body.y = (c.def.hover ? -16 * c.scale : 0) + bob;
      const face = Math.abs(ax) > 0.15 ? (ax > 0 ? 1 : -1) : Math.sign(c.body.scale.x) || 1;
      const wob = 1 + Math.sin(this.time * 6 + c.ph) * 0.04;
      c.body.scale.set((face * c.scale * wob) / 2, (c.scale / wob) / 2);
      c.body.tint = c.flash > 0 ? 0xffb0b0 : this.info.biome === 'trench' ? 0xd8c0ff : 0xffffff;
      c.body.rotation = c.stunT > 0 ? Math.sin(this.time * 20) * 0.15 : 0;
      c.icon.y = c.body.y - 30 * c.scale;
      c.icon.visible = edible;
      c.root.alpha = !edible && this.hidden ? 0.85 : 1;
    }

    // Morsels drift to the crab and get eaten.
    const magnet = H.magnetRadius * (1 + this.mods.magnetPct / 100);
    for (let i = this.morsels.length - 1; i >= 0; i--) {
      const m = this.morsels[i] as Morsel;
      m.age += dt;
      const dx = this.cx - m.x;
      const dy = this.cy - 10 - m.y;
      const d = Math.hypot(dx, dy) || 1;
      if (!this.hidden && d < magnet) {
        const v = (240 + (magnet - d) * 3) * dt;
        m.x += (dx / d) * v;
        m.y += (dy / d) * v;
      }
      m.s.position.set(m.x, m.y + Math.sin(m.age * 5) * 2);
      m.s.zIndex = m.y;
      if ((!this.hidden && d < crabR + 6) || m.age > 25) {
        if (m.age <= 25) this.eat(m.def, m.tier, m.x, m.y);
        this.ents.removeChild(m.s);
        m.s.destroy();
        this.morsels.splice(i, 1);
      }
    }

    // Resource nodes: stand next to one and it opens by itself.
    for (const n of this.nodes) {
      if (n.done) {
        n.respawn -= dt;
        if (n.respawn <= 0 && n.kind !== 'glitter') {
          n.done = false;
          n.progress = 0;
          n.s.texture = tex(n.kind === 'oyster' ? 'node/oyster' : 'node/coral');
          n.s.alpha = 1;
        }
        continue;
      }
      const d = Math.hypot(n.x - this.cx, n.y - this.cy);
      const near = !this.hidden && d < 46 * cs + 10;
      n.progress = near ? n.progress + dt : Math.max(0, n.progress - dt * 2);
      n.s.rotation = near ? Math.sin(this.time * 30) * 0.06 : 0;
      const need = n.kind === 'glitter' ? 0.2 : 0.9;
      if (n.progress >= need) {
        n.done = true;
        n.respawn = H.nodeRespawnTime;
        this.nodeCount[n.kind] += 1;
        const tint = n.kind === 'oyster' ? 0xfdf7ff : n.kind === 'coral' ? 0xff8a7a : 0xffe066;
        this.fx.emit(n.kind === 'coral' ? 'fx/dot' : 'fx/spark', n.x, n.y - 16, { n: 12, tint, speed: 120, size: 13, life: 0.7, add: true, up: 40, gravity: 160 });
        this.fx.ring(n.x, n.y - 12, 40, tint, 0.45);
        if (n.kind === 'oyster') {
          n.s.texture = tex('node/oyster_open');
          this.pearls += 1;
          this.fx.text(n.x, n.y - 40, '+1', 0xfdf7ff, 18);
          sfx('collect_pearl');
        } else if (n.kind === 'coral') {
          n.s.alpha = 0.35;
          this.coral += 4;
          this.fx.text(n.x, n.y - 44, '+4', 0xffb0a0, 16);
          sfx('collect_coral');
        } else {
          n.s.visible = false;
          this.fx.text(n.x, n.y - 40, '✦', 0xffe066, 22);
          sfx('collect_shine');
        }
        haptic('medium');
      }
    }
    // Staying longer pays: a glitter appears once the pool gets dangerous.
    if (!this.glitterSpawned && this.time > 55) {
      this.glitterSpawned = true;
      if (createRng(`${this.run.huntSeed}/glitter`).chance(H.glitterChance)) {
        const x = 80 + this.rng.next() * (H.arenaW - 160);
        const y = 120 + this.rng.next() * (H.arenaH - 240);
        const s = sprite('node/glitter', 0.9);
        s.position.set(x, y);
        s.zIndex = y;
        this.ents.addChild(s);
        this.nodes.push({ kind: 'glitter', x, y, s, progress: 0, done: false, respawn: 0 });
      }
    }

    // Spawning.
    const rate = (H.spawnRate[0] as number) + ((H.spawnRate[1] as number) - (H.spawnRate[0] as number)) * danger;
    this.spawnAcc += rate * dt;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      this.spawn(false);
    }

    // Crab view and camera.
    this.crab.hidden = this.hidden;
    this.crab.moving = moving;
    this.crab.position.set(this.cx, this.cy);
    this.crab.zIndex = this.cy;
    this.crab.scale.set(cs * this.facing, cs);
    this.crab.update(dt);

    const vh = viewHeight() / ZOOM;
    const vw = VIEW_W / ZOOM;
    const tx = Math.max(-20, Math.min(H.arenaW + 20 - vw, this.cx - vw / 2));
    const ty = Math.max(-20, Math.min(H.arenaH + 20 - vh, this.cy - vh * 0.52));
    this.camX += (tx - this.camX) * Math.min(1, dt * 6);
    this.camY += (ty - this.camY) * Math.min(1, dt * 6);
    const sh = this.fx.shake;
    this.world.position.set((-this.camX + (Math.random() - 0.5) * sh) * ZOOM, (-this.camY + (Math.random() - 0.5) * sh) * ZOOM);
    this.dark.alpha = BIOME_LOOK[this.info.biome].dark + danger * 0.3;

    if (this.hp <= 0) {
      this.fx.addShake(8);
      sfx('defeat');
      this.finish(true);
    }
    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.12;
      this.pushHud();
    }
    this.saveT -= dt;
    if (this.saveT <= 0) {
      this.saveT = 2.5;
      this.save();
    }
  }

  resize(w: number, h: number): void {
    this.water.resize(w, h);
    this.dark.clear().rect(0, 0, w, h).fill({ color: 0x050826 });
    this.world.scale.set(ZOOM);
    this.camX = Math.max(-20, Math.min(H.arenaW + 20 - w / ZOOM, this.cx - w / ZOOM / 2));
    this.camY = Math.max(-20, Math.min(H.arenaH + 20 - h / ZOOM, this.cy - (h / ZOOM) * 0.52));
  }

  destroy(): void {
    this.save();
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    document.removeEventListener('visibilitychange', this.onVis);
    huntHud.value = null;
    audio.setIntensity(0);
    this.root.destroy({ children: true });
  }
}
