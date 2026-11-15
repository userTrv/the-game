/**
 * Art kit: every sprite in the game is drawn with these helpers, so the whole reef shares one art
 * direction. See docs/ART.md.
 *
 * The look is a living micro-world seen in dark water (think of the cell stage of Spore):
 *  - Bodies are glass: a translucent core, denser towards the rim, so overlapping parts and the water
 *    behind show through.
 *  - No dark outline. Every shape ends in a thin bright rim of its own colour, as if lit from inside.
 *  - Eyes are small dark nuclei with a light ring; there are no faces or expressions.
 *  - `OUTLINE` survives only as the dark ink for nuclei and fine detail.
 */
export const OUTLINE = '#0b1230';
/** How see-through a body is at its centre, half-way and at the rim. */
const GLASS = [0.46, 0.7, 0.94] as const;

export type Diet = 'sting' | 'spike' | 'glow' | 'armor' | 'venom' | 'soft';

/** Diet hues: base, light, dark, accent. Readable against all three biomes. */
export const DIET: Record<Diet, { base: string; light: string; dark: string; accent: string }> = {
  sting: { base: '#ffc24a', light: '#fff0b0', dark: '#c9781e', accent: '#7be3ff' },
  spike: { base: '#ff6b5e', light: '#ffb9a6', dark: '#b8363f', accent: '#ffe08a' },
  glow: { base: '#3fe6d6', light: '#c6fff4', dark: '#16889c', accent: '#f6ff8f' },
  armor: { base: '#5f93ff', light: '#bcd4ff', dark: '#2f52b8', accent: '#ffd38a' },
  venom: { base: '#8fe04a', light: '#dcff9f', dark: '#3f8a2c', accent: '#c88cff' },
  soft: { base: '#ff8cc0', light: '#ffd3e6', dark: '#c94f8c', accent: '#fff3c4' },
};

export const PAL = {
  white: '#ffffff',
  cream: '#fff6e0',
  sand: '#8fb8b0',
  sandDark: '#4f7f86',
  shell: '#e9d8c8',
  shellDark: '#a98a9c',
  crab: '#ff8457',
  crabLight: '#ffc09a',
  crabDark: '#c9463a',
  pearl: '#fdf7ff',
  coral: '#ff8a7a',
  shine: '#ffe066',
  metal: '#7f9bb8',
  metalDark: '#465f7c',
  wood: '#7a6a72',
  woodDark: '#473c4c',
  glass: '#a8f0e6',
  bone: '#f2ead8',
  ink: '#3a2d5c',
  rock: '#55648c',
  rockDark: '#2f3a5c',
};

// --- Colour maths ------------------------------------------------------------------------------

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function hex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return hex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}
export const lighten = (c: string, t: number) => mix(c, '#ffffff', t);
/** Darkening shifts toward deep-water navy instead of black, which keeps shadows colourful. */
export const darken = (c: string, t: number) => mix(c, '#0a1638', t);

// --- Sprite builder ----------------------------------------------------------------------------

export interface Sprite {
  id: string;
  w: number;
  h: number;
  /** Anchor in 0..1 (default: centre-bottom for things standing on the floor). */
  ax: number;
  ay: number;
  svg: string;
  /** Extra data baked into the manifest (e.g. shell slot anchors). */
  meta?: Record<string, unknown>;
}

let uid = 0;

export class Art {
  private defs: string[] = [];
  private body: string[] = [];
  /** Outline width in sprite units. */
  sw: number;

  constructor(public w: number, public h: number, sw?: number) {
    this.sw = sw ?? Math.max(1.6, Math.min(w, h) * 0.045);
  }

  /** Rim colour of the shape being drawn. */
  private rimOf: string | null = null;

  private gid(): string {
    uid += 1;
    return `g${uid}`;
  }

  /** Radial "volume" gradient lit from the top-left. */
  vol(color: string, o: { lx?: number; ly?: number; depth?: number } = {}): string {
    const id = this.gid();
    const d = o.depth ?? 1;
    this.defs.push(
      `<radialGradient id="${id}" cx="${o.lx ?? 0.36}" cy="${o.ly ?? 0.3}" r="0.85" fx="${o.lx ?? 0.36}" fy="${o.ly ?? 0.3}">` +
        `<stop offset="0" stop-color="${lighten(color, 0.5 * d)}" stop-opacity="${GLASS[0]}"/>` +
        `<stop offset="0.55" stop-color="${color}" stop-opacity="${GLASS[1]}"/>` +
        `<stop offset="1" stop-color="${darken(color, 0.22 * d)}" stop-opacity="${GLASS[2]}"/></radialGradient>`,
    );
    return `url(#${id})`;
  }

  /** Vertical gradient. */
  lin(top: string, bottom: string): string {
    const id = this.gid();
    this.defs.push(`<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`);
    return `url(#${id})`;
  }

  /** Soft glow gradient (opaque centre, transparent rim). */
  glowFill(color: string, alpha = 0.9): string {
    const id = this.gid();
    this.defs.push(`<radialGradient id="${id}"><stop offset="0" stop-color="${color}" stop-opacity="${alpha}"/><stop offset="0.45" stop-color="${color}" stop-opacity="${alpha * 0.45}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`);
    return `url(#${id})`;
  }

  raw(svg: string): this {
    this.body.push(svg);
    return this;
  }

  private attrs(fill: string, o: ShapeOpts): string {
    // The rim: thin and bright, in the shape's own colour.
    const sw = (o.sw ?? this.sw) * 0.55;
    const rim = o.stroke ?? (this.rimOf ?? '#dff4ff');
    const stroke = o.noStroke ? '' : ` stroke="${rim}" stroke-opacity="0.85" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"`;
    const op = o.opacity !== undefined ? ` opacity="${o.opacity}"` : '';
    const tr = o.rot ? ` transform="rotate(${o.rot[0]} ${o.rot[1]} ${o.rot[2]})"` : '';
    return ` fill="${fill}"${stroke}${op}${tr}`;
  }

  /** Filled path with volume shading and outline. */
  path(d: string, color: string, o: ShapeOpts = {}): this {
    this.rimOf = color.startsWith('#') ? lighten(color, 0.55) : null;
    const fill = o.flat ? color : color.startsWith('url(') ? color : this.vol(color, o);
    this.body.push(`<path d="${d}"${this.attrs(fill, o)}/>`);
    return this;
  }

  ell(cx: number, cy: number, rx: number, ry: number, color: string, o: ShapeOpts = {}): this {
    this.rimOf = color.startsWith('#') ? lighten(color, 0.55) : null;
    const fill = o.flat ? color : color.startsWith('url(') ? color : this.vol(color, o);
    this.body.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"${this.attrs(fill, o)}/>`);
    return this;
  }

  circle(cx: number, cy: number, r: number, color: string, o: ShapeOpts = {}): this {
    return this.ell(cx, cy, r, r, color, o);
  }

  /** Open stroke (tentacles, whiskers, legs). */
  line(d: string, color: string, width: number, o: { outline?: boolean; opacity?: number } = {}): this {
    if (o.outline !== false && color.startsWith('#')) {
      // A soft halo instead of an outline: strands glow in the dark.
      this.body.push(`<path d="${d}" fill="none" stroke="${lighten(color, 0.3)}" stroke-opacity="0.22" stroke-width="${width + this.sw * 1.6}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
    this.body.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${o.opacity !== undefined ? ` opacity="${o.opacity}"` : ''}/>`);
    return this;
  }

  /** White highlight blob. */
  hi(cx: number, cy: number, rx: number, ry: number, rot = -25, opacity = 0.4): this {
    this.body.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#fff" opacity="${opacity}" transform="rotate(${rot} ${cx} ${cy})"/>`);
    return this;
  }

  /** Flat decorative spot/stripe without outline. */
  spot(cx: number, cy: number, rx: number, ry: number, color: string, opacity = 1, rot = 0): this {
    this.body.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${color}" opacity="${opacity}"${rot ? ` transform="rotate(${rot} ${cx} ${cy})"` : ''}/>`);
    return this;
  }

  glow(cx: number, cy: number, r: number, color: string, alpha = 0.9): this {
    this.body.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${this.glowFill(color, alpha)}"/>`);
    return this;
  }

  /** An eye is a small dark nucleus with a light ring and a glint: alive, but not a face. */
  eye(cx: number, cy: number, r: number, o: { dx?: number; dy?: number; lid?: number; angry?: boolean } = {}): this {
    const k = 0.62;
    const dx = (o.dx ?? 0.25) * r * 0.2;
    const dy = (o.dy ?? 0.1) * r * 0.2;
    this.body.push(`<circle cx="${cx}" cy="${cy}" r="${r * k}" fill="${OUTLINE}" fill-opacity="0.85" stroke="${o.angry ? '#ff8a8a' : '#e8fbff'}" stroke-opacity="0.8" stroke-width="${Math.max(0.5, r * 0.16)}"/>`);
    this.body.push(`<circle cx="${cx + dx - r * 0.16}" cy="${cy + dy - r * 0.18}" r="${r * 0.15}" fill="#fff" opacity="0.9"/>`);
    return this;
  }

  /** Faces are gone: creatures have no mouths or blush. Kept so sprite code stays untouched. */
  mouth(_cx: number, _cy: number, _w: number, _curve = 1): this {
    return this;
  }

  cheek(_cx: number, _cy: number, _r: number): this {
    return this;
  }

  group(transform: string, fn: () => void): this {
    this.body.push(`<g transform="${transform}">`);
    fn();
    this.body.push('</g>');
    return this;
  }

  done(id: string, o: { ax?: number; ay?: number; meta?: Record<string, unknown> } = {}): Sprite {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${this.w}" height="${this.h}" viewBox="0 0 ${this.w} ${this.h}">` +
      (this.defs.length ? `<defs>${this.defs.join('')}</defs>` : '') +
      this.body.join('') +
      '</svg>';
    const s: Sprite = { id, w: this.w, h: this.h, ax: o.ax ?? 0.5, ay: o.ay ?? 0.5, svg };
    if (o.meta) s.meta = o.meta;
    return s;
  }
}

export interface ShapeOpts {
  flat?: boolean;
  noStroke?: boolean;
  stroke?: string;
  sw?: number;
  opacity?: number;
  lx?: number;
  ly?: number;
  depth?: number;
  rot?: [number, number, number];
}

// --- Geometry helpers --------------------------------------------------------------------------

const f = (v: number) => Math.round(v * 100) / 100;

/** Smooth closed blob through points (Catmull-Rom to cubic Bezier). */
export function blob(points: [number, number][], tension = 0.5): string {
  const n = points.length;
  let d = `M${f(points[0]![0])} ${f(points[0]![1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n]!;
    const p1 = points[i]!;
    const p2 = points[(i + 1) % n]!;
    const p3 = points[(i + 2) % n]!;
    const c1x = p1[0] + ((p2[0] - p0[0]) * tension) / 3;
    const c1y = p1[1] + ((p2[1] - p0[1]) * tension) / 3;
    const c2x = p2[0] - ((p3[0] - p1[0]) * tension) / 3;
    const c2y = p2[1] - ((p3[1] - p1[1]) * tension) / 3;
    d += ` C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d} Z`;
}

/** Smooth open curve through points. */
export function curve(points: [number, number][], tension = 0.5): string {
  const n = points.length;
  let d = `M${f(points[0]![0])} ${f(points[0]![1])}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(n - 1, i + 2)]!;
    d += ` C${f(p1[0] + ((p2[0] - p0[0]) * tension) / 3)} ${f(p1[1] + ((p2[1] - p0[1]) * tension) / 3)} ${f(p2[0] - ((p3[0] - p1[0]) * tension) / 3)} ${f(p2[1] - ((p3[1] - p1[1]) * tension) / 3)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

/** Points on an ellipse; angles in degrees, 0 = right, 90 = down. */
export function arcPoints(cx: number, cy: number, rx: number, ry: number, from: number, to: number, n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = ((from + ((to - from) * i) / Math.max(1, n - 1)) * Math.PI) / 180;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

/** Star/spike ball outline. */
export function spikes(cx: number, cy: number, rIn: number, rOut: number, n: number, rot = 0): string {
  let d = '';
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? rOut : rIn;
    const a = (i * Math.PI) / n + (rot * Math.PI) / 180;
    d += `${i === 0 ? 'M' : 'L'}${f(cx + Math.cos(a) * r)} ${f(cy + Math.sin(a) * r)} `;
  }
  return `${d}Z`;
}

/** Deterministic pseudo-random in [0,1) from an integer, for scattering details. */
export function rnd(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
