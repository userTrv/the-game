/**
 * Art kit: every sprite in the game is drawn with these helpers, so the whole reef shares one art
 * direction. See docs/ART.md.
 *
 *  - Outline: one dark plum colour, round joins, width proportional to the sprite.
 *  - Light: from the top-left. Volumes are radial gradients (light core up-left, darker rim),
 *    plus a soft white highlight blob and an optional bounce light at the bottom-right.
 *  - Faces: big round eyes with a glint; mouths are tiny.
 */
export const OUTLINE = '#2b2140';

export type Diet = 'sting' | 'spike' | 'glow' | 'armor' | 'venom' | 'soft';

/** Diet hues: base, light, dark, accent. Readable against all three biomes. */
export const DIET: Record<Diet, { base: string; light: string; dark: string; accent: string }> = {
  sting: { base: '#ffc93c', light: '#fff0a8', dark: '#e08a1e', accent: '#7be3ff' },
  spike: { base: '#ff6a55', light: '#ffb199', dark: '#c93a3a', accent: '#ffe08a' },
  glow: { base: '#3fe0d0', light: '#c6fff4', dark: '#1a9aa8', accent: '#f6ff8f' },
  armor: { base: '#5b8cff', light: '#b8d0ff', dark: '#3558c4', accent: '#ffd38a' },
  venom: { base: '#8fd93f', light: '#dcff9f', dark: '#4f9a2a', accent: '#c05cff' },
  soft: { base: '#ff8fb8', light: '#ffd3e3', dark: '#d9578c', accent: '#fff3c4' },
};

export const PAL = {
  white: '#ffffff',
  cream: '#fff6e0',
  sand: '#f3d9a4',
  sandDark: '#d9b074',
  shell: '#f6e2c8',
  shellDark: '#d8b08c',
  crab: '#ff7a4d',
  crabLight: '#ffb48a',
  crabDark: '#d9482f',
  pearl: '#fdf7ff',
  coral: '#ff8a7a',
  shine: '#ffe066',
  metal: '#9fb3c8',
  metalDark: '#62788f',
  wood: '#b07a4a',
  woodDark: '#7a4e2c',
  glass: '#a8f0e6',
  bone: '#f2ead8',
  ink: '#3a2d5c',
  rock: '#8a8fb0',
  rockDark: '#5a5f85',
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
/** Darkening shifts toward plum instead of black, which keeps shadows colourful. */
export const darken = (c: string, t: number) => mix(c, '#3a1f5c', t);

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
        `<stop offset="0" stop-color="${lighten(color, 0.38 * d)}"/><stop offset="0.5" stop-color="${color}"/>` +
        `<stop offset="1" stop-color="${darken(color, 0.34 * d)}"/></radialGradient>`,
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
    const sw = o.sw ?? this.sw;
    const stroke = o.noStroke ? '' : ` stroke="${o.stroke ?? OUTLINE}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"`;
    const op = o.opacity !== undefined ? ` opacity="${o.opacity}"` : '';
    const tr = o.rot ? ` transform="rotate(${o.rot[0]} ${o.rot[1]} ${o.rot[2]})"` : '';
    return ` fill="${fill}"${stroke}${op}${tr}`;
  }

  /** Filled path with volume shading and outline. */
  path(d: string, color: string, o: ShapeOpts = {}): this {
    const fill = o.flat ? color : color.startsWith('url(') ? color : this.vol(color, o);
    this.body.push(`<path d="${d}"${this.attrs(fill, o)}/>`);
    return this;
  }

  ell(cx: number, cy: number, rx: number, ry: number, color: string, o: ShapeOpts = {}): this {
    const fill = o.flat ? color : color.startsWith('url(') ? color : this.vol(color, o);
    this.body.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"${this.attrs(fill, o)}/>`);
    return this;
  }

  circle(cx: number, cy: number, r: number, color: string, o: ShapeOpts = {}): this {
    return this.ell(cx, cy, r, r, color, o);
  }

  /** Open stroke (tentacles, whiskers, legs). */
  line(d: string, color: string, width: number, o: { outline?: boolean; opacity?: number } = {}): this {
    if (o.outline !== false) {
      this.body.push(`<path d="${d}" fill="none" stroke="${OUTLINE}" stroke-width="${width + this.sw * 1.7}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
    this.body.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${o.opacity !== undefined ? ` opacity="${o.opacity}"` : ''}/>`);
    return this;
  }

  /** White highlight blob. */
  hi(cx: number, cy: number, rx: number, ry: number, rot = -25, opacity = 0.55): this {
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

  /** Cute eye: white ball, dark pupil looking along (dx, dy), glint. */
  eye(cx: number, cy: number, r: number, o: { dx?: number; dy?: number; lid?: number; angry?: boolean } = {}): this {
    const dx = (o.dx ?? 0.25) * r * 0.45;
    const dy = (o.dy ?? 0.1) * r * 0.45;
    this.body.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff" stroke="${OUTLINE}" stroke-width="${Math.min(this.sw, r * 0.5)}"/>`);
    this.body.push(`<circle cx="${cx + dx}" cy="${cy + dy}" r="${r * 0.58}" fill="${OUTLINE}"/>`);
    this.body.push(`<circle cx="${cx + dx - r * 0.2}" cy="${cy + dy - r * 0.24}" r="${r * 0.22}" fill="#fff"/>`);
    if (o.angry) {
      this.body.push(`<path d="M${cx - r * 1.2} ${cy - r * 1.15} L${cx + r * 1.1} ${cy - r * 0.45}" stroke="${OUTLINE}" stroke-width="${this.sw * 1.2}" stroke-linecap="round" fill="none"/>`);
    }
    return this;
  }

  /** Small smile or frown. */
  mouth(cx: number, cy: number, w: number, curve = 1): this {
    this.body.push(`<path d="M${cx - w / 2} ${cy} Q${cx} ${cy + w * 0.5 * curve} ${cx + w / 2} ${cy}" fill="none" stroke="${OUTLINE}" stroke-width="${this.sw * 0.8}" stroke-linecap="round"/>`);
    return this;
  }

  /** Blush cheek. */
  cheek(cx: number, cy: number, r: number): this {
    return this.spot(cx, cy, r, r * 0.6, '#ff5d7a', 0.35);
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
