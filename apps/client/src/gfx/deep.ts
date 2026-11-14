import type { BiomeId } from '@shellter/shared';
import { Assets, Container, Graphics, Sprite, Texture, TilingSprite } from 'pixi.js';
import { tex } from './assets';

/**
 * Look of a biome. The world is seen from above, deep in dark water: the backdrop is almost black
 * towards the edges and everything alive glows. `glow` is the accent of the biome's light.
 */
export interface BiomeLook {
  top: string;
  bottom: string;
  /** Tint of drifting silhouettes and haze. */
  haze: number;
  glow: number;
  ray: number;
  /** Strength of light shafts and caustics (sunlit biomes only). */
  light: number;
  /** Extra darkness over the playfield. */
  dark: number;
}

export const BIOME_LOOK: Record<BiomeId, BiomeLook> = {
  lagoon: { top: '#0f6a78', bottom: '#052434', haze: 0x39c6b8, glow: 0x8ff5e0, ray: 0xd8fff0, light: 1, dark: 0 },
  wreck: { top: '#0d4660', bottom: '#04141f', haze: 0x3f8fb8, glow: 0x9fd8ff, ray: 0xbfe8ff, light: 0.55, dark: 0.06 },
  abyss: { top: '#161c5c', bottom: '#04051a', haze: 0x5a52d8, glow: 0x9a8cff, ray: 0x8a9cff, light: 0.15, dark: 0.12 },
  trench: { top: '#2c1050', bottom: '#070214', haze: 0xa040c8, glow: 0xff86dc, ray: 0xd08cff, light: 0.1, dark: 0.16 },
};

const cache = new Map<string, Texture>();

function canvasTexture(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) draw(g);
  const t = Texture.from(c);
  cache.set(key, t);
  return t;
}

function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** Soft round light: white core fading to nothing. Tint it to colour a glow. */
export function glowTexture(): Texture {
  return canvasTexture('glow', 128, 128, (g) => {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.5)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.14)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  });
}

function gradientTexture(top: string, bottom: string): Texture {
  return canvasTexture(`grad:${top}:${bottom}`, 4, 256, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
  });
}

/** Draws something at (x, y) and at its eight wrapped copies so the tile has no seams. */
function wrapped(size: number, x: number, y: number, fn: (px: number, py: number) => void): void {
  for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) fn(x + ox, y + oy);
}

/** Far layer: big blurred shapes of life out of focus. */
function hazeTexture(): Texture {
  const size = 512;
  return canvasTexture('haze', size, size, (g) => {
    const rnd = lcg(11);
    for (let i = 0; i < 16; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const r = 50 + rnd() * 110;
      const a = 0.05 + rnd() * 0.09;
      wrapped(size, x, y, (px, py) => {
        const grad = g.createRadialGradient(px, py, 0, px, py, r);
        grad.addColorStop(0, `rgba(255,255,255,${a})`);
        grad.addColorStop(0.5, `rgba(255,255,255,${a * 0.45})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(px - r, py - r, r * 2, r * 2);
      });
    }
    // A few ring-shaped cells, like diatoms far below.
    for (let i = 0; i < 7; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const r = 18 + rnd() * 34;
      wrapped(size, x, y, (px, py) => {
        const grad = g.createRadialGradient(px, py, r * 0.55, px, py, r);
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(0.75, 'rgba(255,255,255,0.07)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(px - r, py - r, r * 2, r * 2);
      });
    }
  });
}

/** Suspended matter: many tiny lights, a few brighter ones. */
function motesTexture(seed: number, count: number, big: number): Texture {
  const size = 512;
  return canvasTexture(`motes:${seed}`, size, size, (g) => {
    const rnd = lcg(seed);
    for (let i = 0; i < count; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const r = (1.2 + rnd() * 2.6) * (rnd() < 0.12 ? big : 1);
      const a = 0.25 + rnd() * 0.6;
      wrapped(size, x, y, (px, py) => {
        const grad = g.createRadialGradient(px, py, 0, px, py, r * 2.4);
        grad.addColorStop(0, `rgba(255,255,255,${a})`);
        grad.addColorStop(0.4, `rgba(255,255,255,${a * 0.35})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(px - r * 2.4, py - r * 2.4, r * 4.8, r * 4.8);
      });
    }
  });
}

/** Wobbly bright cells of light on the water, drawn once. */
function causticsTexture(): Texture {
  const size = 256;
  return canvasTexture('caustics', size, size, (g) => {
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const rnd = lcg(7);
    for (let i = 0; i < 20; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const r = 20 + rnd() * 24;
      const ph = rnd() * 6;
      const lw = 1.2 + rnd() * 1.6;
      wrapped(size, x, y, (cx, cy) => {
        g.lineWidth = lw;
        g.beginPath();
        for (let a = 0; a <= 24; a++) {
          const ang = (a / 24) * Math.PI * 2;
          const rr = r * (0.8 + 0.22 * Math.sin(ang * 3 + ph) + 0.1 * Math.sin(ang * 5 + ph * 2));
          const px = cx + Math.cos(ang) * rr;
          const py = cy + Math.sin(ang) * rr * 0.75;
          if (a === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
        g.stroke();
      });
    }
  });
}

/** Darkens the corners so the eye stays on the crab. */
function vignetteTexture(): Texture {
  return canvasTexture('vignette', 256, 256, (g) => {
    const grad = g.createRadialGradient(128, 128, 60, 128, 128, 182);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.6, 'rgba(0,4,14,0.28)');
    grad.addColorStop(1, 'rgba(0,4,14,0.82)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
  });
}

let painted: Texture | null | undefined;
const PAINT_TINT: Record<string, number> = { lagoon: 0xffffff, wreck: 0xe8f0c8, abyss: 0xb9c2ff, trench: 0xd9a8ff };

/** Painted far backdrop (`public/assets/img/deep.jpg`), shared by all biomes and tinted per biome. Optional. */
export async function loadBackdrop(): Promise<void> {
  if (painted !== undefined) return;
  painted = null;
  try {
    const t = await Assets.load<Texture>(`${import.meta.env.BASE_URL}assets/img/deep.jpg`);
    t.source.addressMode = 'mirror-repeat';
    painted = t;
  } catch {
    /* no painted backdrop: the procedural layers are enough */
  }
}

interface Layer {
  s: TilingSprite;
  /** How much of the camera movement the layer follows (0 = fixed, 1 = with the world). */
  k: number;
  vx: number;
  vy: number;
}

/**
 * Living backdrop of deep water built from parallax layers: painted or procedural haze far below,
 * suspended lights, caustics and light shafts in sunlit biomes, out-of-focus specks in front.
 * `root` goes under the scene, `front` over it. Menus leave the camera at rest; the pool moves it.
 */
export class Deep {
  readonly root = new Container();
  readonly front = new Container();
  private bg: Sprite;
  private layers: Layer[] = [];
  private rays = new Container();
  private bubbles: { s: Sprite; v: number; ph: number }[] = [];
  private vignette: Sprite;
  private look: BiomeLook;
  private t = 0;
  private w = 390;
  private h = 844;
  private camX = 0;
  private camY = 0;

  constructor(readonly biome: BiomeId, bubbleCount = 10) {
    const look = BIOME_LOOK[biome];
    this.look = look;
    this.bg = new Sprite(gradientTexture(look.top, look.bottom));
    this.root.addChild(this.bg);

    const add = (texture: Texture, k: number, opts: { alpha: number; tint?: number; scale?: number; add?: boolean; vx?: number; vy?: number; front?: boolean }): Layer => {
      const s = new TilingSprite({ texture, width: 400, height: 900 });
      s.alpha = opts.alpha;
      if (opts.tint !== undefined) s.tint = opts.tint;
      if (opts.scale) s.tileScale.set(opts.scale);
      if (opts.add) s.blendMode = 'add';
      (opts.front ? this.front : this.root).addChild(s);
      const layer = { s, k, vx: opts.vx ?? 0, vy: opts.vy ?? 0 };
      this.layers.push(layer);
      return layer;
    };

    const art = painted;
    if (art) add(art, 0.3, { alpha: 0.9, scale: 0.75, tint: PAINT_TINT[biome] ?? 0xffffff });
    add(hazeTexture(), 0.18, { alpha: art ? 0.5 : 0.9, tint: look.haze, scale: 2.2, add: true, vx: 2, vy: 1 });
    add(hazeTexture(), 0.42, { alpha: art ? 0.35 : 0.6, tint: look.glow, scale: 1.1, add: true, vx: -3, vy: 2 });
    add(motesTexture(3, 90, 2), 0.62, { alpha: 0.5, tint: look.glow, add: true, vx: 3, vy: -4 });
    add(motesTexture(5, 60, 2.6), 0.9, { alpha: 0.75, tint: 0xffffff, scale: 1.4, add: true, vx: -4, vy: -7 });
    if (look.light > 0.05) {
      add(causticsTexture(), 1, { alpha: 0.1 * look.light, tint: look.ray, scale: 1.5, add: true, vx: 9, vy: 5 });
      this.root.addChild(this.rays);
      for (let i = 0; i < 4; i++) {
        const g = new Graphics();
        g.blendMode = 'add';
        g.x = 20 + i * 100;
        this.rays.addChild(g);
      }
    }
    for (let i = 0; i < bubbleCount; i++) {
      const s = new Sprite(tex('fx/bubble'));
      s.anchor.set(0.5);
      s.alpha = 0.3;
      this.root.addChild(s);
      this.bubbles.push({ s, v: 10 + Math.random() * 22, ph: Math.random() * 6 });
    }
    // In front of the scene: big blurred specks close to the lens, then the vignette.
    add(motesTexture(9, 14, 5), 1.7, { alpha: 0.16, tint: look.glow, scale: 3.2, add: true, vx: -6, vy: -10, front: true });
    this.vignette = new Sprite(vignetteTexture());
    this.front.addChild(this.vignette);
    this.resize(390, 844);
  }

  /** Camera position in screen units (the pool passes world position times its zoom). */
  setCamera(x: number, y: number): void {
    this.camX = x;
    this.camY = y;
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.bg.width = w;
    this.bg.height = h;
    for (const l of this.layers) {
      l.s.width = w;
      l.s.height = h;
    }
    this.vignette.width = w;
    this.vignette.height = h;
    // Light shafts span the whole screen and dissolve towards the bottom instead of ending abruptly.
    const steps = 14;
    const len = h * 0.92;
    this.rays.children.forEach((r) => {
      const g = r as Graphics;
      g.clear();
      for (let s = 0; s < steps; s++) {
        const a = s / steps;
        const b = (s + 1) / steps;
        const xl = (k: number): number => 40 * k;
        const xr = (k: number): number => 46 + 104 * k;
        g.poly([xl(a), len * a, xr(a), len * a, xr(b), len * b + 0.5, xl(b), len * b + 0.5]).fill({ color: this.look.ray, alpha: 0.06 * this.look.light * (1 - a) * (1 - a) });
      }
    });
    for (const b of this.bubbles) {
      b.s.x = Math.random() * w;
      b.s.y = Math.random() * h;
      b.s.scale.set((0.2 + Math.random() * 0.4) / 2);
    }
  }

  update(dt: number): void {
    this.t += dt;
    for (const l of this.layers) {
      l.s.tilePosition.set(-this.camX * l.k + this.t * l.vx, -this.camY * l.k + this.t * l.vy);
    }
    this.rays.children.forEach((r, i) => {
      r.alpha = 0.6 + 0.4 * Math.sin(this.t * 0.5 + i * 1.7);
      r.skew.x = 0.06 * Math.sin(this.t * 0.3 + i);
    });
    for (const b of this.bubbles) {
      b.s.y -= b.v * dt;
      b.s.x += Math.sin(this.t * 1.5 + b.ph) * 8 * dt;
      if (b.s.y < -12) {
        b.s.y = this.h + 12;
        b.s.x = Math.random() * this.w;
      }
    }
  }
}
