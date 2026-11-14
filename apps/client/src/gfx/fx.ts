import { Container, Sprite, Text } from 'pixi.js';
import { tex } from './assets';

/**
 * Pooled particles and floating numbers. Everything is plain sprites reused from a pool, so a long
 * session allocates nothing after warm-up.
 */
interface Particle {
  s: Sprite;
  vx: number;
  vy: number;
  g: number;
  life: number;
  max: number;
  s0: number;
  s1: number;
  spin: number;
  fade: boolean;
}

interface Floater {
  t: Text;
  life: number;
  max: number;
  vy: number;
}

export const calm = { on: false };

export class Fx {
  readonly layer = new Container();
  private parts: Particle[] = [];
  private pool: Sprite[] = [];
  private floaters: Floater[] = [];
  private textPool: Text[] = [];
  shake = 0;

  private take(id: string): Sprite {
    const s = this.pool.pop() ?? new Sprite();
    s.texture = tex(id);
    s.anchor.set(0.5);
    s.rotation = 0;
    s.alpha = 1;
    s.tint = 0xffffff;
    s.blendMode = 'normal';
    s.visible = true;
    this.layer.addChild(s);
    return s;
  }

  emit(id: string, x: number, y: number, o: { n?: number; speed?: number; life?: number; size?: number; size1?: number; tint?: number; gravity?: number; spread?: number; angle?: number; add?: boolean; spin?: number; up?: number } = {}): void {
    const n = o.n ?? 6;
    if (this.parts.length > 260) return;
    for (let i = 0; i < n; i++) {
      const s = this.take(id);
      const a = (o.angle ?? 0) + (Math.random() - 0.5) * (o.spread ?? Math.PI * 2);
      const v = (o.speed ?? 60) * (0.5 + Math.random() * 0.8);
      const size = (o.size ?? 10) * (0.7 + Math.random() * 0.6);
      s.position.set(x, y);
      s.tint = o.tint ?? 0xffffff;
      if (o.add) s.blendMode = 'add';
      const base = size / (s.texture.width || 32);
      s.scale.set(base);
      this.parts.push({
        s, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (o.up ?? 0), g: o.gravity ?? 0,
        life: 0, max: (o.life ?? 0.5) * (0.7 + Math.random() * 0.6), s0: base, s1: base * (o.size1 ?? 0.2) , spin: (o.spin ?? 0) * (Math.random() - 0.5), fade: true,
      });
    }
  }

  /** Expanding ring (ability pulse, eat pop). */
  ring(x: number, y: number, radius: number, tint: number, life = 0.35): void {
    const s = this.take('fx/ring');
    s.position.set(x, y);
    s.tint = tint;
    s.blendMode = 'add';
    const k = (radius * 2) / (s.texture.width || 128);
    s.scale.set(k * 0.25);
    this.parts.push({ s, vx: 0, vy: 0, g: 0, life: 0, max: life, s0: k * 0.25, s1: k, spin: 0, fade: true });
  }

  text(x: number, y: number, str: string, color = 0xffffff, size = 16): void {
    if (this.floaters.length > 40) return;
    const t = this.textPool.pop() ?? new Text({ text: '', style: { fontFamily: 'Nunito, system-ui, sans-serif', fontWeight: '900', fontSize: 16, fill: 0xffffff, stroke: { color: 0x2b2140, width: 4, join: 'round' } } });
    t.text = str;
    t.style.fontSize = size;
    t.style.fill = color;
    t.anchor.set(0.5);
    t.position.set(x + (Math.random() - 0.5) * 12, y);
    t.alpha = 1;
    t.scale.set(0.6);
    this.layer.addChild(t);
    this.floaters.push({ t, life: 0, max: 0.9, vy: -46 });
  }

  addShake(amount: number): void {
    if (calm.on) amount *= 0.25;
    this.shake = Math.min(10, this.shake + amount);
  }

  update(dt: number): void {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i] as Particle;
      p.life += dt;
      const k = p.life / p.max;
      if (k >= 1) {
        this.layer.removeChild(p.s);
        this.pool.push(p.s);
        this.parts[i] = this.parts[this.parts.length - 1] as Particle;
        this.parts.pop();
        continue;
      }
      p.vy += p.g * dt;
      p.s.x += p.vx * dt;
      p.s.y += p.vy * dt;
      p.s.rotation += p.spin * dt;
      p.s.scale.set(p.s0 + (p.s1 - p.s0) * k);
      p.s.alpha = 1 - k * k;
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i] as Floater;
      f.life += dt;
      const k = f.life / f.max;
      if (k >= 1) {
        this.layer.removeChild(f.t);
        this.textPool.push(f.t);
        this.floaters.splice(i, 1);
        continue;
      }
      f.t.y += f.vy * dt * (1 - k * 0.6);
      // Pop in with a little overshoot, fade out at the end.
      f.t.scale.set(k < 0.15 ? 0.6 + (k / 0.15) * 0.6 : 1.2 - Math.min(0.2, (k - 0.15) * 0.8));
      f.t.alpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
    }
    this.shake = Math.max(0, this.shake - dt * 30);
  }

  clear(): void {
    for (const p of this.parts) {
      this.layer.removeChild(p.s);
      this.pool.push(p.s);
    }
    this.parts.length = 0;
    for (const f of this.floaters) {
      this.layer.removeChild(f.t);
      this.textPool.push(f.t);
    }
    this.floaters.length = 0;
  }
}

export const DIET_TINT: Record<string, number> = {
  sting: 0xffc93c,
  spike: 0xff6a55,
  glow: 0x3fe0d0,
  armor: 0x5b8cff,
  venom: 0x8fd93f,
  soft: 0xff8fb8,
};
