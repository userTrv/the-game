import { signal } from '@preact/signals';
import {
  BAL, buildAbilities, buildFighter, computeMods, createRng, feed, genesForTier, heroDef, sizeScale, spawnTable, stageInfo, xpNeed,
  zeroDiets, type AbilityInst, type ActiveKind, type BuildSnapshot, type CreatureDef, type DietMap, type Fighter, type HuntReport,
  type Mods, type PublicRun, type Rng, type SpawnEntry,
} from '@shellter/shared';
import type { Sprite} from 'pixi.js';
import { Container, Graphics, Sprite as PixiSprite } from 'pixi.js';
import { sprite, tex } from '../gfx/assets';
import { CrabView } from '../gfx/crabView';
import { calm, DIET_TINT, Fx } from '../gfx/fx';
import { pixi, VIEW_W, viewHeight, type Scene } from '../gfx/stage';
import { BIOME_LOOK, Deep, glowTexture } from '../gfx/deep';
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
  /** Distance from the entry point, metres. */
  dist: number;
  stalkers: number;
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
  glow: Sprite;
  /** Tier follows the crab: cannot be outgrown, bites even a hidden crab. */
  stalker: boolean;
  /** Guards a chest: stays near its nest. */
  home: { x: number; y: number } | null;
}

/** A pearl dropped by a slain predator, waiting to be picked up. */
interface Drop {
  x: number;
  y: number;
  s: Sprite;
  age: number;
}

interface Morsel {
  def: CreatureDef;
  tier: number;
  x: number;
  y: number;
  s: Sprite;
  age: number;
}

type NodeKind = 'oyster' | 'coral' | 'glitter' | 'chest';

interface NodeEnt {
  /** Stable id inside the world (`chunk:index`), so a collected node stays collected. */
  key: string;
  kind: NodeKind;
  x: number;
  y: number;
  s: Sprite;
  glow: Sprite;
  progress: number;
  done: boolean;
}

interface Chunk {
  nodes: NodeEnt[];
  decor: Sprite[];
}

interface Saved {
  runId: string;
  nonce: number;
  time: number;
  log: [string, number][];
  nodes: Record<NodeKind, number>;
  drops: number;
  taken: string[];
  x: number;
  y: number;
  hp: number;
  size: number;
  xp: number;
  gained: DietMap;
}

export class HuntScene implements Scene {
  readonly root = new Container();
  private world = new Container();
  private glows = new Container();
  private ents = new Container();
  private fx = new Fx();
  private dark = new Graphics();
  private deep: Deep;
  private chunks = new Map<string, Chunk>();
  private taken = new Set<string>();
  private nested = new Set<string>();
  private drops: Drop[] = [];
  private dropCount = 0;
  private log: [string, number][] = [];
  private stalkerT = 0;
  private maxTableTier = 1;
  private heading = 0;
  private crabGlow: Sprite;
  private trailT = 0;
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
  private cx = 0;
  private cy = 0;
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
  private eatenCount = 0;
  private nodeCount: Record<NodeKind, number> = { oyster: 0, coral: 0, glitter: 0, chest: 0 };
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
    this.maxTableTier = Math.max(...this.table.map((e) => e.tier));
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
      this.log = saved.log ?? [];
      this.eatenCount = this.log.length;
      this.nodeCount = { ...this.nodeCount, ...saved.nodes };
      this.dropCount = saved.drops ?? 0;
      this.taken = new Set(saved.taken ?? []);
      this.pearls = this.nodeCount.oyster * H.oysterPearls + this.nodeCount.chest * H.chestPearls + this.dropCount;
      this.cx = saved.x ?? 0;
      this.cy = saved.y ?? 0;
      this.gained = saved.gained;
      this.size = saved.size;
      this.xp = saved.xp;
      this.rebuild();
      this.hp = Math.min(this.fighter.maxHp, saved.hp);
    }

    this.deep = new Deep(this.info.biome, 6);
    this.ents.sortableChildren = true;
    this.world.addChild(this.glows, this.ents, this.fx.layer);
    this.root.addChild(this.deep.root, this.world, this.deep.front, this.dark);
    this.crabGlow = this.makeGlow(BIOME_LOOK[this.info.biome].glow, 150, 0.22);
    this.crab.setLook(this.look());
    this.ents.addChild(this.crab);
    this.crab.hidden = true;
    this.syncChunks();
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

  private makeGlow(tint: number, size: number, alpha: number): Sprite {
    const g = new PixiSprite(glowTexture());
    g.anchor.set(0.5);
    g.width = size;
    g.height = size;
    g.tint = tint;
    g.alpha = alpha;
    g.blendMode = 'add';
    this.glows.addChild(g);
    return g;
  }

  /** How rich and dangerous the water is here: 0 at the entry point, 1 at `richDistance`, capped at 2. */
  private richAt(x: number, y: number): number {
    return Math.min(2, Math.hypot(x, y) / H.richDistance);
  }

  private danger(): number {
    return Math.min(H.dangerMax, this.time / this.dangerTime + this.richAt(this.cx, this.cy) * 0.4);
  }

  /**
   * The world has no walls: it is generated chunk by chunk from the hunt seed, so the same place
   * always looks the same, and whatever was collected stays collected.
   */
  private buildChunk(ix: number, iy: number): Chunk {
    const key = `${ix},${iy}`;
    const rng = createRng(`${this.run.huntSeed}/c/${key}`);
    const size = H.chunk;
    const ox = ix * size;
    const oy = iy * size;
    const rich = this.richAt(ox + size / 2, oy + size / 2);
    const home = ix === 0 && iy === 0;
    const chunk: Chunk = { nodes: [], decor: [] };
    const tint = this.info.biome === 'trench' ? 0xc8a8ff : 0xffffff;
    const decorIds = { lagoon: ['rock_sand', 'rock_coral', 'seagrass', 'seagrass_tall', 'fan_coral'], wreck: ['rock_dark', 'plank', 'anchor', 'barrel', 'kelp_dark'], abyss: ['rock_abyss', 'vent', 'crystal', 'bones', 'glow_weed'], trench: ['rock_abyss', 'vent', 'crystal', 'bones', 'glow_weed'] }[this.info.biome];
    const spot = (pad: number): { x: number; y: number } => ({ x: ox + pad + rng.next() * (size - pad * 2), y: oy + pad + rng.next() * (size - pad * 2) });
    const decorCount = rng.int(2, 4);
    for (let i = 0; i < decorCount; i++) {
      const p = spot(30);
      // The entry point stays clear.
      if (Math.hypot(p.x, p.y) < 90) continue;
      const s = sprite(`decor/${decorIds[rng.int(0, decorIds.length - 1)] as string}`, 0.7 + rng.next() * 0.5);
      s.position.set(p.x, p.y);
      s.zIndex = p.y;
      s.alpha = 0.92;
      s.tint = tint;
      if (rng.chance(0.5)) s.scale.x *= -1;
      this.ents.addChild(s);
      chunk.decor.push(s);
    }
    let n = 0;
    const node = (kind: NodeKind, x: number, y: number): void => {
      const id = `${key}:${n++}`;
      const taken = this.taken.has(id);
      if (taken && kind !== 'oyster') return;
      const s = sprite(taken ? 'node/oyster_open' : kind === 'chest' ? 'node/chest' : `node/${kind}`, 0.9);
      s.position.set(x, y);
      s.zIndex = y;
      this.ents.addChild(s);
      const glowTint = kind === 'oyster' ? 0xe8f4ff : kind === 'coral' ? 0xff8a7a : 0xffe066;
      const glow = this.makeGlow(glowTint, kind === 'chest' ? 150 : 110, taken ? 0 : 0.3);
      glow.position.set(x, y - 10);
      chunk.nodes.push({ key: id, kind, x, y, s, glow, progress: 0, done: taken });
    };
    // Scattered finds; richer water has more of them.
    if (home || rng.chance(0.3 + rich * 0.2)) {
      const p = home ? { x: 120 + rng.next() * 60, y: -100 - rng.next() * 60 } : spot(60);
      node('oyster', p.x, p.y);
    }
    const corals = rng.int(0, 1) + (rng.chance(0.3 + rich * 0.25) ? 1 : 0);
    for (let i = 0; i < corals; i++) {
      const p = spot(50);
      node('coral', p.x, p.y);
    }
    if (!home && rng.chance(0.05 + rich * 0.05)) {
      const p = spot(80);
      node('glitter', p.x, p.y);
    }
    // Places worth a detour: a pearl bank, or a nest whose owner guards a chest.
    const poi = home ? 1 : rng.next();
    if (poi < 0.07 + rich * 0.04) {
      const c = spot(120);
      const count = rng.int(2, 3);
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + rng.next();
        node('oyster', c.x + Math.cos(a) * 46, c.y + Math.sin(a) * 34);
      }
    } else if (poi < 0.13 + rich * 0.07) {
      const c = spot(130);
      const id = `${key}:${n}`;
      node('chest', c.x, c.y);
      if (!this.taken.has(id) && !this.nested.has(key)) {
        this.nested.add(key);
        this.spawnGuard(c.x, c.y);
      }
    }
    return chunk;
  }

  /** Keeps the chunks around the camera alive and drops the ones left far behind. */
  private syncChunks(): void {
    const size = H.chunk;
    const vh = viewHeight() / ZOOM;
    const vw = VIEW_W / ZOOM;
    const pad = 160;
    const x0 = Math.floor((this.cx - vw / 2 - pad) / size);
    const x1 = Math.floor((this.cx + vw / 2 + pad) / size);
    const y0 = Math.floor((this.cy - vh * 0.52 - pad) / size);
    const y1 = Math.floor((this.cy + vh * 0.48 + pad) / size);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const key = `${ix},${iy}`;
        if (!this.chunks.has(key)) this.chunks.set(key, this.buildChunk(ix, iy));
      }
    }
    for (const [key, chunk] of this.chunks) {
      const [ix, iy] = key.split(',').map(Number) as [number, number];
      if (ix >= x0 - 1 && ix <= x1 + 1 && iy >= y0 - 1 && iy <= y1 + 1) continue;
      for (const s of chunk.decor) s.destroy();
      for (const nd of chunk.nodes) {
        nd.s.destroy();
        nd.glow.destroy();
      }
      this.chunks.delete(key);
    }
    this.nodes = [];
    for (const chunk of this.chunks.values()) for (const nd of chunk.nodes) this.nodes.push(nd);
  }

  /** Distance at which things appear and disappear: just outside the screen. */
  private ringRadius(): number {
    const vh = viewHeight() / ZOOM;
    const vw = VIEW_W / ZOOM;
    return Math.hypot(vw / 2, vh / 2) + 50;
  }

  private addCreature(def: CreatureDef, tier: number, x: number, y: number, opts: { stalker?: boolean; home?: { x: number; y: number } } = {}): Creature {
    const stalker = opts.stalker === true;
    const scale = (0.62 + def.rank * 0.17 + (this.info.loop > 0 ? 0.05 : 0)) * (stalker ? 1.25 : 1);
    const root = new Container();
    const body = sprite(`creature/${def.id}`, scale);
    body.y = def.hover ? -16 * scale : 0;
    const icon = sprite(`icon/diet_${def.diet}`, 0.42);
    icon.y = body.y - 30 * scale;
    root.addChild(body, icon);
    this.ents.addChild(root);
    const glow = this.makeGlow(stalker ? 0xff4a5a : DIET_TINT[def.diet] ?? 0xffffff, (70 + def.rank * 16) * (stalker ? 1.6 : 1), 0.3);
    const hp = H.creatureHpBase * Math.pow(tier, H.creatureHpPow) * (stalker ? 1.3 : 1);
    const c: Creature = {
      def, tier, x, y, vx: 0, vy: 0, hp, maxHp: hp, r: 12 * scale, root, body, icon, dir: this.rng.next() * Math.PI * 2,
      think: this.rng.next() * 2, biteT: 0, stunT: 0, slowT: 0, poison: 0, lureT: 0, pullT: 0, dash: 0, flash: 0, ph: this.rng.next() * 6, scale,
      glow, stalker, home: opts.home ?? null,
    };
    this.creatures.push(c);
    return c;
  }

  private predatorDef(): SpawnEntry {
    const hunters = this.table.filter((e) => e.def.behavior === 'hunter');
    const pool = hunters.length > 0 ? hunters : [...this.table].sort((a, b) => b.def.rank - a.def.rank).slice(0, 2);
    return pool[this.rng.int(0, pool.length - 1)] as SpawnEntry;
  }

  /** A predator that sits on its nest and its chest. */
  private spawnGuard(x: number, y: number): void {
    const e = this.predatorDef();
    this.addCreature(e.def, Math.max(e.tier, this.size + 1), x + 30, y + 10, { home: { x, y } });
  }

  /** A stalker comes for a crab that stays too long or grows too big: its tier follows the crab. */
  private spawnStalker(): void {
    const e = this.predatorDef();
    const a = this.rng.next() * Math.PI * 2;
    const r = this.ringRadius();
    const tier = this.size + 1 + (this.danger() >= H.stalkerExtraTierAt ? 1 : 0);
    const c = this.addCreature(e.def, tier, this.cx + Math.cos(a) * r, this.cy + Math.sin(a) * r, { stalker: true });
    c.body.tint = 0xffb4b4;
    sfx('stun', { volume: 0.35, pitch: 0.6 });
  }

  private spawn(initial: boolean, forceEdible = false): void {
    if (this.creatures.length >= H.maxAlive) return;
    const danger = Math.min(1.5, this.danger());
    const ws = this.table.map((e) => {
      const gap = e.tier - this.size;
      if (gap <= 0) return e.weight * (gap < -3 ? 0.35 : 1);
      if (forceEdible) return 0;
      if (this.tutorial && this.time < 25) return gap === 1 ? e.weight * 0.2 : 0;
      return e.weight * (gap === 1 ? 0.55 : 0.16 + 0.5 * danger);
    });
    if (!ws.some((w) => w > 0)) ws.fill(1);
    const entry = this.table[this.rng.weightedIndex(ws)] as SpawnEntry;
    const ring = this.ringRadius();
    let a = this.rng.next() * Math.PI * 2;
    // Fresh fauna mostly shows up ahead of a moving crab, so the water never feels empty.
    if (!initial && this.target && this.rng.chance(0.65)) a = this.heading + (this.rng.next() - 0.5) * 2.4;
    const r = initial ? 110 + this.rng.next() * (ring - 110) : ring + this.rng.next() * 60;
    this.addCreature(entry.def, entry.tier, this.cx + Math.cos(a) * r, this.cy + Math.sin(a) * r * (initial ? 1.3 : 1));
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
    this.log.push([def.id, tier]);
    this.eatenCount += 1;
    const g = { size: this.size, xp: this.xp };
    const grew = feed(g, tier, this.mods.xpPct);
    this.size = g.size;
    this.xp = g.xp;
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
      // Predators carry pearls: a stalker always drops one, other big fauna sometimes.
      if (c.tier > this.size && (c.stalker || this.rng.chance(H.predatorPearlChance))) {
        const ps = sprite('icon/pearl', 0.7);
        ps.position.set(c.x + 14, c.y - 6);
        ps.zIndex = c.y;
        this.ents.addChild(ps);
        this.drops.push({ x: c.x + 14, y: c.y - 6, s: ps, age: 0 });
      }
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
    // A stalker pries at a closed shell too, though the shell takes most of it.
    if (this.hidden) dmg *= 0.3;
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
      log: this.log,
      nodes: this.nodeCount,
      drops: this.dropCount,
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
    const s: Saved = {
      runId: this.run.id, nonce: this.run.huntNonce, time: this.time, log: this.log, nodes: this.nodeCount, drops: this.dropCount,
      taken: [...this.taken], x: this.cx, y: this.cy, hp: this.hp, size: this.size, xp: this.xp, gained: this.gained,
    };
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
      danger: this.danger(), time: this.time, canLeave: this.time >= H.minLeaveTime && !this.finished,
      gained: { ...this.gained }, pearls: this.pearls, coral: Math.floor(this.coral), hint: this.hint(), paused: this.paused, eaten: this.eatenCount,
      dist: Math.round(Math.hypot(this.cx, this.cy) / 40), stalkers: this.creatures.filter((c) => c.stalker && c.hp > 0).length,
    };
  }

  update(dtRaw: number): void {
    this.deep.setCamera(this.camX * ZOOM, this.camY * ZOOM);
    this.deep.update(dtRaw);
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
    const dangerRaw = this.danger();
    const danger = Math.min(1, dangerRaw);
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
        this.heading = Math.atan2(dy, dx);
      }
      this.idleT = 0;
    } else {
      this.idleT += dt;
      if (this.idleT > 14) this.setPaused(true);
    }
    this.syncChunks();

    const cs = this.crabScale();
    const crabR = 15 * cs;
    const reach = this.eatReach();
    const despawn = this.ringRadius() + 320;
    const magnet = H.magnetRadius * (1 + this.mods.magnetPct / 100);

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
        c.glow.destroy();
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
      } else if (c.stalker && !edible) {
        // Stalkers never lose the trail, shell or no shell.
        ax = dx / dist;
        ay = dy / dist;
        sp = Math.max(sp, 58) * (this.hidden ? 0.7 : 1.15);
        if (!this.sawBig && dist < 160) this.sawBig = true;
      } else if (c.home && !edible && (this.hidden || dist > 170)) {
        // A nest guard drifts back to its chest when nobody bothers it.
        const hx = c.home.x - c.x;
        const hy = c.home.y - c.y;
        const hd = Math.hypot(hx, hy) || 1;
        ax = hx / hd;
        ay = hy / hd;
        sp = hd > 40 ? sp * 0.6 : 0;
      } else if (!edible && !this.hidden && (c.home !== null || c.def.behavior === 'hunter' || (c.def.behavior === 'ambush' && (dist < 120 || c.dash > 0))) && dist < 190 + danger * 80) {
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
      c.y += ay * sp * dt;
      // Fauna left far behind is gone for good; stalkers and nest guards stay.
      if (dist > despawn && !c.stalker && !c.home) {
        c.hp = 0;
        continue;
      }

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
        } else if (c.stalker && !edible && c.biteT <= 0 && c.stunT <= 0) this.takeBite(c);
      }

      // Visuals.
      c.root.position.set(c.x, c.y);
      c.root.zIndex = c.y;
      const bob = c.def.hover ? Math.sin(this.time * 2.4 + c.ph) * 3 : 0;
      c.body.y = (c.def.hover ? -16 * c.scale : 0) + bob;
      const face = Math.abs(ax) > 0.15 ? (ax > 0 ? 1 : -1) : Math.sign(c.body.scale.x) || 1;
      const wob = 1 + Math.sin(this.time * 6 + c.ph) * 0.04;
      c.body.scale.set((face * c.scale * wob) / 2, (c.scale / wob) / 2);
      c.body.tint = c.flash > 0 ? 0xff8080 : c.stalker ? 0xffb4b4 : this.info.biome === 'trench' ? 0xd8c0ff : 0xffffff;
      c.glow.position.set(c.x, c.y + c.body.y * 0.5);
      c.glow.alpha = c.stalker || (!edible && c.home) ? 0.34 + 0.2 * Math.sin(this.time * 7 + c.ph) : edible ? 0.26 + 0.08 * Math.sin(this.time * 2 + c.ph) : 0.12;
      if (!edible && !c.stalker) c.glow.tint = 0xff6a5a;
      else if (!c.stalker) c.glow.tint = DIET_TINT[c.def.diet] ?? 0xffffff;
      c.body.rotation = c.stunT > 0 ? Math.sin(this.time * 20) * 0.15 : 0;
      c.icon.y = c.body.y - 30 * c.scale;
      c.icon.visible = edible;
      c.root.alpha = !edible && this.hidden ? 0.85 : 1;
    }

    // Morsels drift to the crab and get eaten.
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

    // Pearls dropped by slain predators.
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i] as Drop;
      d.age += dt;
      const dx = this.cx - d.x;
      const dy = this.cy - 10 - d.y;
      const dist = Math.hypot(dx, dy) || 1;
      if (!this.hidden && dist < magnet) {
        const v = (240 + (magnet - dist) * 3) * dt;
        d.x += (dx / dist) * v;
        d.y += (dy / dist) * v;
      }
      d.s.position.set(d.x, d.y + Math.sin(d.age * 4) * 3);
      d.s.zIndex = d.y;
      if (!this.hidden && dist < crabR + 8) {
        this.dropCount += 1;
        this.pearls += 1;
        this.fx.text(d.x, d.y - 26, '+1', 0xfdf7ff, 18);
        this.fx.emit('fx/spark', d.x, d.y, { n: 8, tint: 0xfdf7ff, speed: 90, size: 11, life: 0.5, add: true });
        sfx('collect_pearl');
        haptic('medium');
        d.s.destroy();
        this.drops.splice(i, 1);
      } else if (d.age > 40) {
        d.s.destroy();
        this.drops.splice(i, 1);
      }
    }

    // Finds: stand next to one and it opens by itself. Nothing ever grows back.
    for (const n of this.nodes) {
      if (n.done) continue;
      const d = Math.hypot(n.x - this.cx, n.y - this.cy);
      const near = !this.hidden && d < 46 * cs + 10;
      n.progress = near ? n.progress + dt : Math.max(0, n.progress - dt * 2);
      n.s.rotation = near ? Math.sin(this.time * 30) * 0.06 : 0;
      n.glow.alpha = 0.24 + 0.1 * Math.sin(this.time * 2.2 + n.x);
      const need = n.kind === 'glitter' ? 0.2 : n.kind === 'chest' ? 1.6 : 0.9;
      if (n.progress >= need) {
        n.done = true;
        n.glow.alpha = 0;
        this.taken.add(n.key);
        this.nodeCount[n.kind] += 1;
        const tint = n.kind === 'oyster' ? 0xfdf7ff : n.kind === 'coral' ? 0xff8a7a : 0xffe066;
        this.fx.emit(n.kind === 'coral' ? 'fx/dot' : 'fx/spark', n.x, n.y - 16, { n: n.kind === 'chest' ? 22 : 12, tint, speed: 120, size: 13, life: 0.7, add: true, up: 40, gravity: 160 });
        this.fx.ring(n.x, n.y - 12, 40, tint, 0.45);
        if (n.kind === 'oyster') {
          n.s.texture = tex('node/oyster_open');
          this.pearls += H.oysterPearls;
          this.fx.text(n.x, n.y - 40, `+${H.oysterPearls}`, 0xfdf7ff, 18);
          sfx('collect_pearl');
        } else if (n.kind === 'coral') {
          n.s.alpha = 0.3;
          this.coral += 4;
          this.fx.text(n.x, n.y - 44, '+4', 0xffb0a0, 16);
          sfx('collect_coral');
        } else if (n.kind === 'chest') {
          n.s.alpha = 0.3;
          this.pearls += H.chestPearls;
          this.coral += H.chestCoral;
          this.fx.text(n.x, n.y - 46, `+${H.chestPearls}`, 0xfdf7ff, 22);
          sfx('reward');
        } else {
          n.s.visible = false;
          this.fx.text(n.x, n.y - 40, '✦', 0xffe066, 22);
          sfx('collect_shine');
        }
        haptic('medium');
      }
    }

    // Spawning.
    const rate = ((H.spawnRate[0] as number) + ((H.spawnRate[1] as number) - (H.spawnRate[0] as number)) * danger) * (moving ? 1.3 : 1);
    this.spawnAcc += rate * dt;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      this.spawn(false);
    }

    // Stalkers: they come sooner for a crab that has outgrown the pool, and never stop coming.
    const pressure = Math.max(dangerRaw, this.size >= this.maxTableTier ? 1 : 0);
    const stalkersAlive = this.creatures.reduce((nAlive, c) => nAlive + (c.stalker && c.hp > 0 ? 1 : 0), 0);
    if (pressure >= H.stalkerFrom && !(this.tutorial && this.time < 60)) {
      this.stalkerT -= dt;
      if (this.stalkerT <= 0 && stalkersAlive < H.stalkerMaxAlive) {
        const k = Math.min(1, (pressure - H.stalkerFrom) / 1.4);
        this.stalkerT = (H.stalkerInterval[0] as number) + ((H.stalkerInterval[1] as number) - (H.stalkerInterval[0] as number)) * k;
        this.spawnStalker();
      }
    }

    // A faint trail of light behind a moving crab.
    this.trailT -= dt;
    if (moving && this.trailT <= 0) {
      this.trailT = 0.07;
      this.fx.emit('fx/dot', this.cx - this.facing * 10, this.cy - 4, { n: 1, tint: BIOME_LOOK[this.info.biome].glow, speed: 8, size: 7, life: 0.9, add: true });
    }
    this.crabGlow.position.set(this.cx, this.cy - 12);
    this.crabGlow.alpha = this.hidden ? 0.1 : 0.22;

    // Crab view and camera.
    this.crab.hidden = this.hidden;
    this.crab.moving = moving;
    this.crab.position.set(this.cx, this.cy);
    this.crab.zIndex = this.cy;
    this.crab.scale.set(cs * this.facing, cs);
    this.crab.update(dt);

    const vh = viewHeight() / ZOOM;
    const vw = VIEW_W / ZOOM;
    const tx = this.cx - vw / 2;
    const ty = this.cy - vh * 0.52;
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
    this.deep.resize(w, h);
    this.dark.clear().rect(0, 0, w, h).fill({ color: 0x02040f });
    this.world.scale.set(ZOOM);
    this.camX = this.cx - w / ZOOM / 2;
    this.camY = this.cy - (h / ZOOM) * 0.52;
    this.syncChunks();
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
