import type { BiomeId } from '@shellter/shared';
import { Container, Graphics, Sprite, Texture, TilingSprite } from 'pixi.js';
import { tex } from './assets';

/** Colours of a biome: water gradient (top, bottom), floor tint, light shaft tint. */
export const BIOME_LOOK: Record<BiomeId, { top: string; bottom: string; floor: number; floor2: number; ray: number; caustic: number; dark: number }> = {
  lagoon: { top: '#3fd0e8', bottom: '#1d7fb8', floor: 0xf3d9a4, floor2: 0xe6c488, ray: 0xfff6c8, caustic: 0.34, dark: 0.0 },
  wreck: { top: '#2a8fb0', bottom: '#13456e', floor: 0x9aa58f, floor2: 0x7f8c7c, ray: 0xc8f0ff, caustic: 0.2, dark: 0.12 },
  abyss: { top: '#1b2a6b', bottom: '#0a0f33', floor: 0x3a3f78, floor2: 0x2c3166, ray: 0x7be3ff, caustic: 0.08, dark: 0.3 },
  trench: { top: '#2a1658', bottom: '#0a0624', floor: 0x3d2f70, floor2: 0x2c2258, ray: 0xc38bff, caustic: 0.06, dark: 0.36 },
};

function gradientTexture(top: string, bottom: string): Texture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
  }
  return Texture.from(c);
}

let causticTex: Texture | null = null;

/** Procedural tileable caustics: wobbly bright cells drawn once to a small canvas. */
function caustics(): Texture {
  if (causticTex) return causticTex;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  if (g) {
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    // Soft edges where the browser supports canvas filters; crisp lines elsewhere are fine too.
    try {
      g.filter = 'blur(1.6px)';
    } catch {
      /* no filter support */
    }
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 20; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const r = 20 + rnd() * 24;
      const ph = rnd() * 6;
      const lw = 1.6 + rnd() * 2;
      // Draw each wobbly cell 9 times so it wraps across tile edges.
      for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
        g.lineWidth = lw;
        g.beginPath();
        for (let a = 0; a <= 24; a++) {
          const ang = (a / 24) * Math.PI * 2;
          const rr = r * (0.8 + 0.22 * Math.sin(ang * 3 + ph) + 0.1 * Math.sin(ang * 5 + ph * 2));
          const px = x + ox + Math.cos(ang) * rr;
          const py = y + oy + Math.sin(ang) * rr * 0.75;
          if (a === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
        g.stroke();
      }
    }
  }
  causticTex = Texture.from(c);
  return causticTex;
}

/**
 * Animated underwater backdrop: gradient water, drifting caustics, light shafts and rising bubbles.
 * Used behind menus (screen space) and as the arena floor (world space).
 */
export class Water {
  readonly root = new Container();
  private bg: Sprite;
  private c1: TilingSprite;
  private c2: TilingSprite;
  private rays = new Container();
  private bubbles: { s: Sprite; v: number; ph: number }[] = [];
  private t = 0;
  private w = 390;
  private h = 844;

  constructor(private biome: BiomeId, bubbleCount = 14) {
    const look = BIOME_LOOK[biome];
    this.bg = new Sprite(gradientTexture(look.top, look.bottom));
    this.c1 = new TilingSprite({ texture: caustics(), width: 400, height: 900 });
    this.c2 = new TilingSprite({ texture: caustics(), width: 400, height: 900 });
    this.c1.alpha = look.caustic;
    this.c2.alpha = look.caustic * 0.7;
    this.c1.blendMode = 'add';
    this.c2.blendMode = 'add';
    this.c2.tileScale.set(1.6);
    this.root.addChild(this.bg, this.c1, this.c2, this.rays);
    for (let i = 0; i < 4; i++) {
      const g = new Graphics();
      g.blendMode = 'add';
      g.x = 20 + i * 100;
      this.rays.addChild(g);
    }
    for (let i = 0; i < bubbleCount; i++) {
      const s = new Sprite(tex('fx/bubble'));
      s.anchor.set(0.5);
      s.alpha = 0.55;
      this.root.addChild(s);
      this.bubbles.push({ s, v: 14 + Math.random() * 26, ph: Math.random() * 6 });
    }
    this.resize(390, 844);
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.bg.width = w;
    this.bg.height = h;
    this.c1.width = w;
    this.c1.height = h;
    this.c2.width = w;
    this.c2.height = h;
    // Light shafts span the whole screen and dissolve towards the bottom instead of ending abruptly.
    const look = BIOME_LOOK[this.biome];
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
        g.poly([xl(a), len * a, xr(a), len * a, xr(b), len * b + 0.5, xl(b), len * b + 0.5]).fill({ color: look.ray, alpha: 0.075 * (1 - a) * (1 - a) });
      }
    });
    for (const b of this.bubbles) {
      b.s.x = Math.random() * w;
      b.s.y = Math.random() * h;
      b.s.scale.set((0.25 + Math.random() * 0.5) / 2);
    }
  }

  update(dt: number): void {
    this.t += dt;
    this.c1.tilePosition.set(this.t * 9, this.t * 5);
    this.c2.tilePosition.set(-this.t * 6, this.t * 8);
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
