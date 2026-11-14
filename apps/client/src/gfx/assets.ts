import { Assets, Rectangle, Sprite, Texture } from 'pixi.js';
import manifestJson from '../assets/generated/manifest.json';

/**
 * Sprites come from baked atlases described by a manifest, so art can be replaced without touching
 * code: redraw a sprite (or swap an atlas image) and re-run `pnpm art`.
 */
export interface Frame {
  atlas: string;
  x: number;
  y: number;
  w: number;
  h: number;
  ax: number;
  ay: number;
  meta?: Record<string, unknown>;
}
interface Manifest {
  scale: number;
  atlases: Record<string, { image: string; w: number; h: number }>;
  frames: Record<string, Frame>;
}

export const manifest = manifestJson as unknown as Manifest;
/** Sprites are baked at this scale; divide pixel sizes by it to get world units. */
export const BAKE = manifest.scale;

const loaded = new Map<string, Texture>();
const textures = new Map<string, Texture>();
const pending = new Map<string, Promise<void>>();

export function atlasUrl(group: string): string {
  return `${import.meta.env.BASE_URL}${manifest.atlases[group]?.image ?? ''}`;
}

export function loadAtlas(group: string): Promise<void> {
  if (loaded.has(group)) return Promise.resolve();
  let p = pending.get(group);
  if (!p) {
    p = Assets.load<Texture>(atlasUrl(group)).then((tex) => {
      loaded.set(group, tex);
    });
    pending.set(group, p);
  }
  return p;
}

export function atlasLoaded(group: string): boolean {
  return loaded.has(group);
}

export function frame(id: string): Frame | undefined {
  return manifest.frames[id];
}

export function hasSprite(id: string): boolean {
  return manifest.frames[id] !== undefined;
}

export function tex(id: string): Texture {
  const cached = textures.get(id);
  if (cached) return cached;
  const f = manifest.frames[id];
  const base = f ? loaded.get(f.atlas) : undefined;
  if (!f || !base) return Texture.EMPTY;
  const t = new Texture({ source: base.source, frame: new Rectangle(f.x, f.y, f.w, f.h) });
  textures.set(id, t);
  return t;
}

/** Sprite in world units (1 unit = 1 logical px of the drawing) with the manifest anchor applied. */
export function sprite(id: string, scale = 1): Sprite {
  const s = new Sprite(tex(id));
  const f = manifest.frames[id];
  s.anchor.set(f?.ax ?? 0.5, f?.ay ?? 0.5);
  s.scale.set(scale / BAKE);
  return s;
}

export function setSprite(s: Sprite, id: string, scale = 1): void {
  s.texture = tex(id);
  const f = manifest.frames[id];
  s.anchor.set(f?.ax ?? 0.5, f?.ay ?? 0.5);
  s.scale.set(scale / BAKE);
}

export interface ShellSlot {
  x: number;
  y: number;
  rot: number;
}

/** Slot anchors of a shell sprite relative to its anchor point (the mouth), in world units. */
export function shellSlots(shellId: string): ShellSlot[] {
  const f = manifest.frames[`shell/${shellId}`];
  const slots = (f?.meta?.slots as ShellSlot[] | undefined) ?? [];
  if (!f) return [];
  const ox = (f.w / BAKE) * f.ax;
  const oy = (f.h / BAKE) * f.ay;
  return slots.map((s) => ({ x: s.x - ox, y: s.y - oy, rot: s.rot }));
}
