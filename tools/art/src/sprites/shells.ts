import { Art, arcPoints, blob, curve, darken, DIET, lighten, PAL, spikes, type Sprite } from '../kit';

/**
 * Shells are drawn in a 96x84 box facing right; the opening (where the crab sits) is at the
 * bottom-right, the spire points up-left. `meta.slots` lists 10 anchor points on the back, from
 * the front (near the crab's head) to the back, where tenants sit. `meta.mouth` is the opening.
 */
const W = 96;
const H = 84;
const MOUTH: [number, number] = [70, 62];

/** Slots sit along the upper contour of the shell; rot is the outward tilt in degrees. */
function slotsAlong(cx: number, cy: number, rx: number, ry: number, from = 335, to = 200): { x: number; y: number; rot: number }[] {
  // Two rows: the outer contour and a slightly inner one, interleaved front to back.
  const outer = arcPoints(cx, cy, rx, ry, from, to, 6);
  const inner = arcPoints(cx, cy + ry * 0.12, rx * 0.56, ry * 0.5, from - 15, to + 20, 4);
  const order: [number, number][] = [outer[0]!, outer[1]!, inner[0]!, outer[2]!, inner[1]!, outer[3]!, inner[2]!, outer[4]!, inner[3]!, outer[5]!];
  return order.map(([x, y]) => ({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, rot: Math.round(((Math.atan2(y - cy, x - cx) * 180) / Math.PI + 90) * 0.5) }));
}

function finish(a: Art, id: string, slots: { x: number; y: number; rot: number }[]): Sprite {
  return a.done(`shell/${id}`, { ax: MOUTH[0] / W, ay: MOUTH[1] / H, meta: { slots, mouth: MOUTH } });
}

function opening(a: Art, color: string): void {
  a.ell(MOUTH[0], MOUTH[1] - 1, 15, 12, darken(color, 0.55), { flat: true, rot: [-18, MOUTH[0], MOUTH[1]] });
  a.raw(`<ellipse cx="${MOUTH[0] + 1}" cy="${MOUTH[1]}" rx="11" ry="8.5" fill="#1d1436" opacity="0.55" transform="rotate(-18 ${MOUTH[0]} ${MOUTH[1]})"/>`);
}

interface SpiralLook {
  base: string;
  stripe: string;
  lip: string;
  /** 0 round snail, 1 tall turret, 2 chunky conch with crown knobs, 3 flat nautilus. */
  form: 0 | 1 | 2 | 3;
}

function spiral(id: string, look: SpiralLook): Sprite {
  const a = new Art(W, H, 2.6);
  const { base, stripe } = look;
  if (look.form === 1) {
    // Tall turret: stacked whorls narrowing to the tip.
    a.path(blob([[20, 10], [30, 12], [44, 22], [62, 34], [80, 50], [84, 64], [72, 74], [50, 74], [36, 62], [26, 44], [18, 24]]), base);
    for (const [x1, y1, x2, y2] of [[24, 28, 38, 18], [30, 44, 52, 28], [40, 60, 68, 40]] as const) a.line(curve([[x1, y1], [(x1 + x2) / 2 - 2, (y1 + y2) / 2 + 3], [x2, y2]]), stripe, 3, { outline: false, opacity: 0.85 });
    a.hi(34, 26, 9, 3.5, 40);
    opening(a, base);
    return finish(a, id, slotsAlong(52, 46, 34, 30, 325, 215));
  }
  if (look.form === 3) {
    // Nautilus: big flat disc with chamber stripes.
    a.path(blob([[14, 44], [20, 24], [40, 12], [62, 14], [80, 30], [86, 52], [78, 70], [58, 76], [36, 74], [20, 62]]), base);
    for (let i = 0; i < 6; i++) {
      const t = 205 + i * 26;
      const [p] = arcPoints(50, 44, 34, 30, t, t, 1);
      a.line(curve([[46, 48], [(46 + p![0]) / 2 + 3, (48 + p![1]) / 2 - 3], p!]), stripe, 4.5, { outline: false, opacity: 0.8 });
    }
    a.circle(44, 48, 7, lighten(base, 0.2), { sw: 1.8 });
    a.hi(34, 26, 10, 4, -30);
    opening(a, base);
    return finish(a, id, slotsAlong(50, 44, 32, 29));
  }
  // Round snail / conch.
  a.path(blob([[10, 30], [16, 18], [30, 14], [44, 12], [62, 16], [78, 28], [86, 46], [84, 62], [72, 74], [50, 76], [32, 68], [22, 54], [14, 42]]), base);
  // Spire tip.
  a.path(blob([[6, 26], [12, 16], [22, 14], [26, 22], [20, 32], [10, 34]]), lighten(base, 0.12));
  a.path(blob([[3, 22], [7, 15], [14, 15], [14, 23], [8, 27]]), lighten(base, 0.25), { sw: 2 });
  // Whorl stripes.
  for (const [r, w] of [[30, 4.5], [20, 4], [10, 3.5]] as const) {
    a.line(curve(arcPoints(52, 48, r, r * 0.86, 190, 330, 6)), stripe, w, { outline: false, opacity: 0.8 });
  }
  if (look.form === 2) {
    for (const [x, y] of arcPoints(52, 46, 34, 31, 215, 325, 5)) a.path(blob([[x - 5, y + 3], [x - 2, y - 6], [x + 3, y - 5], [x + 5, y + 3]]), lighten(base, 0.2), { sw: 2 });
  }
  a.hi(36, 26, 11, 4.5, -28);
  a.path(blob([[58, 60], [70, 48], [84, 50], [88, 62], [80, 74], [66, 76]]), look.lip, { sw: 2.2, depth: 0.6 });
  opening(a, look.lip);
  return finish(a, id, slotsAlong(50, 46, 33, 30));
}

function can(): Sprite {
  const a = new Art(W, H, 2.6);
  a.group('rotate(-14 48 44)', () => {
    a.path('M14 26 L76 26 L76 72 L14 72 Z', PAL.metal);
    a.ell(14, 49, 7, 23, PAL.metalDark);
    a.ell(76, 49, 8, 23, '#2a2540', { flat: true });
    a.raw(`<ellipse cx="76" cy="49" rx="5" ry="17" fill="#140f28" opacity="0.6"/>`);
    a.path('M24 28 L62 28 L62 70 L24 70 Z', '#ff6b5a', { sw: 1.6 });
    a.path(blob([[34, 42], [46, 38], [54, 46], [50, 56], [38, 58]]), '#fff3c4', { sw: 1.4 });
    for (const x of [20, 66]) a.line(`M${x} 27 L${x} 71`, lighten(PAL.metal, 0.35), 1.6, { outline: false, opacity: 0.8 });
    a.hi(40, 31, 16, 2.2, 0, 0.6);
    // Pulled-back lid.
    a.path(blob([[76, 26], [88, 18], [92, 28], [84, 36]]), lighten(PAL.metal, 0.2), { sw: 2 });
  });
  return finish(a, 'can', slotsAlong(48, 44, 32, 24, 330, 205));
}

function bottle(): Sprite {
  const a = new Art(W, H, 2.6);
  a.group('rotate(-12 48 46)', () => {
    a.path(blob([[30, 30], [72, 28], [84, 38], [84, 62], [72, 72], [30, 70], [24, 60], [24, 40]], 0.35), PAL.glass, { opacity: 0.78 });
    a.path('M8 42 L26 40 L26 60 L8 58 Z', PAL.glass, { opacity: 0.8 });
    a.path('M3 40 L10 40 L10 60 L3 60 Z', PAL.wood, { sw: 2 });
    a.ell(84, 50, 6, 14, '#1d1436', { flat: true, opacity: 0.75 });
    a.hi(46, 35, 20, 3, 0, 0.75);
    a.hi(70, 62, 8, 2, 0, 0.35);
    for (const [x, y, r] of [[40, 56, 2.4], [52, 48, 1.8], [62, 58, 2]] as const) a.raw(`<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="#fff" stroke-width="1" opacity="0.7"/>`);
  });
  return finish(a, 'bottle', slotsAlong(50, 46, 32, 24, 330, 205));
}

function skull(): Sprite {
  const a = new Art(W, H, 2.6);
  a.path(blob([[14, 40], [20, 20], [40, 10], [62, 12], [80, 28], [86, 50], [80, 66], [64, 74], [40, 74], [24, 64]]), PAL.bone);
  a.path(blob([[58, 62], [72, 52], [86, 54], [88, 66], [78, 76], [64, 76]]), darken(PAL.bone, 0.12), { sw: 2.2 });
  opening(a, PAL.bone);
  a.ell(40, 40, 9, 11, '#2a2140', { flat: true });
  a.ell(62, 34, 6.5, 8, '#2a2140', { flat: true, sw: 2 });
  for (let i = 0; i < 4; i++) a.path(`M${24 + i * 8} 66 L${27 + i * 8} 74 L${30 + i * 8} 66 Z`, PAL.white, { sw: 1.6 });
  a.line(curve([[22, 26], [30, 30], [28, 38]]), darken(PAL.bone, 0.3), 1.6, { outline: false, opacity: 0.7 });
  a.hi(34, 20, 11, 4, -25);
  return finish(a, 'skull', slotsAlong(50, 44, 33, 31));
}

function teapot(): Sprite {
  const a = new Art(W, H, 2.6);
  const c = '#fff4f0';
  a.line(curve([[20, 34], [6, 38], [8, 56], [22, 58]]), c, 6);
  a.path(blob([[18, 46], [22, 26], [40, 18], [62, 20], [80, 34], [86, 54], [78, 70], [56, 76], [34, 74], [22, 62]]), c);
  a.path(blob([[36, 20], [42, 12], [58, 12], [64, 20], [50, 24]]), DIET.soft.base, { sw: 2.2 });
  a.circle(50, 10, 4, DIET.soft.light, { sw: 2 });
  for (const [x, y] of [[36, 44], [50, 56], [34, 62], [52, 36]] as const) {
    a.spot(x, y, 4.5, 4.5, DIET.soft.base, 0.9);
    a.spot(x, y, 1.8, 1.8, '#ffe38a', 1);
  }
  a.hi(34, 30, 10, 4, -30);
  a.path(blob([[58, 60], [72, 50], [86, 52], [88, 64], [80, 76], [66, 76]]), darken(c, 0.14), { sw: 2.2 });
  opening(a, c);
  return finish(a, 'teapot', slotsAlong(50, 46, 32, 29));
}

function urchinTest(): Sprite {
  const a = new Art(W, H, 2.6);
  const c = DIET.spike.light;
  a.path(spikes(48, 46, 30, 38, 14, 8), DIET.spike.base, { sw: 2.2 });
  a.path(blob([[14, 46], [20, 26], [40, 14], [62, 16], [80, 30], [86, 52], [78, 68], [58, 76], [36, 74], [20, 64]]), c);
  for (let i = 0; i < 5; i++) {
    const pts = arcPoints(48, 46, 8 + i * 0.1, 30, 250 + i * 0.1, 290, 2);
    void pts;
    a.line(curve(arcPoints(48 + (i - 2) * 11, 46, 3 + Math.abs(i - 2) * 2, 28, 265, 95, 5)), DIET.spike.base, 2.4, { outline: false, opacity: 0.7 });
  }
  for (const [x, y] of arcPoints(48, 46, 22, 20, 200, 340, 6)) a.circle(x, y, 2.2, PAL.white, { sw: 1 });
  a.hi(34, 26, 10, 4, -28);
  a.path(blob([[58, 60], [72, 50], [86, 52], [88, 64], [80, 76], [66, 76]]), darken(c, 0.2), { sw: 2.2 });
  opening(a, c);
  return finish(a, 'urchin_test', slotsAlong(50, 46, 32, 29));
}

function boot(): Sprite {
  const a = new Art(W, H, 2.6);
  const c = '#9a6a48';
  a.path(blob([[20, 10], [44, 8], [48, 30], [52, 44], [74, 50], [88, 60], [88, 72], [70, 76], [30, 76], [18, 68], [16, 40]], 0.4), c);
  a.path('M16 70 L88 70 L88 76 L20 78 Z', darken(c, 0.35), { sw: 2 });
  a.path(blob([[18, 10], [46, 7], [47, 15], [19, 18]]), lighten(c, 0.25), { sw: 2 });
  for (const y of [26, 34, 42]) {
    a.circle(40, y, 1.8, PAL.shine, { sw: 1 });
    a.line(`M40 ${y} L30 ${y + 3}`, PAL.cream, 1.4, { outline: false });
  }
  a.path(blob([[60, 58], [72, 52], [78, 60], [68, 66]]), '#d9a15c', { sw: 1.6 });
  a.hi(26, 28, 4, 12, 0, 0.35);
  a.ell(76, 62, 10, 7, '#1d1436', { flat: true, opacity: 0.8, rot: [20, 76, 62] });
  return finish(a, 'boot', slotsAlong(46, 48, 30, 34, 320, 215));
}

function clam(): Sprite {
  const a = new Art(W, H, 2.6);
  const c = DIET.armor.light;
  a.path(blob([[10, 54], [14, 34], [30, 18], [52, 12], [72, 18], [86, 34], [88, 50], [70, 58], [40, 60]]), c);
  for (let i = 0; i < 7; i++) {
    const [p] = arcPoints(50, 40, 38, 28, 195 + i * 25, 195 + i * 25, 1);
    a.line(curve([[52, 58], [(52 + p![0]) / 2, (58 + p![1]) / 2 - 4], p!]), DIET.armor.base, 2.6, { outline: false, opacity: 0.6 });
  }
  a.path(blob([[10, 58], [40, 62], [70, 60], [88, 54], [84, 68], [66, 76], [36, 76], [16, 70]]), darken(c, 0.18));
  a.path('M12 56 Q50 66 88 52', '#1d1436', { flat: true, noStroke: true, opacity: 0.0 });
  a.line(curve([[12, 57], [40, 62], [70, 60], [88, 53]]), '#2a2140', 2.2, { outline: false });
  a.circle(60, 61, 4.5, PAL.pearl, { sw: 1.6 });
  a.hi(34, 26, 12, 4.5, -25);
  return finish(a, 'clam', slotsAlong(50, 42, 34, 27, 335, 200));
}

function lamp(): Sprite {
  const a = new Art(W, H, 2.6);
  a.glow(46, 40, 44, DIET.glow.light, 0.5);
  a.path(blob([[18, 40], [24, 20], [44, 10], [66, 14], [80, 30], [82, 50], [70, 66], [48, 70], [28, 62]]), '#eaffff', { opacity: 0.85 });
  a.line(curve([[40, 54], [36, 36], [46, 28], [56, 36], [52, 54]]), DIET.sting.base, 2.6);
  a.glow(46, 36, 16, DIET.sting.light, 0.9);
  a.path('M56 62 L84 54 L90 70 L64 78 Z', PAL.metal, { sw: 2.2 });
  for (const t of [0.3, 0.6]) a.line(`M${56 + 30 * t} ${62 - 8 * t} L${62 + 28 * t} ${77 - 8 * t}`, PAL.metalDark, 1.6, { outline: false });
  a.hi(34, 24, 10, 4, -30, 0.8);
  return finish(a, 'lamp', slotsAlong(48, 42, 31, 29));
}

function flask(): Sprite {
  const a = new Art(W, H, 2.6);
  a.path(blob([[16, 52], [22, 34], [40, 24], [48, 8], [60, 8], [62, 24], [80, 38], [86, 56], [76, 72], [52, 76], [28, 70]], 0.4), '#d8f5c8', { opacity: 0.82 });
  a.path(blob([[20, 54], [36, 46], [56, 50], [82, 48], [84, 58], [75, 70], [52, 74], [30, 68]]), DIET.venom.base, { sw: 1.6 });
  for (const [x, y, r] of [[36, 58, 3], [52, 62, 2.2], [66, 56, 2.6], [46, 40, 1.8]] as const) a.circle(x, y, r, DIET.venom.light, { sw: 1 });
  a.path('M44 4 L64 4 L64 10 L44 10 Z', PAL.wood, { sw: 2 });
  a.hi(32, 36, 9, 3.5, -40, 0.7);
  a.ell(74, 62, 9, 7, '#1d1436', { flat: true, opacity: 0.7 });
  return finish(a, 'flask', slotsAlong(50, 48, 32, 28, 330, 205));
}

function crown(): Sprite {
  const a = new Art(W, H, 2.6);
  const c = '#ffd166';
  a.path(blob([[12, 44], [18, 26], [36, 16], [60, 16], [80, 28], [86, 48], [80, 66], [62, 76], [38, 74], [20, 64]]), '#ff9a8a');
  a.path('M14 40 L10 14 L26 28 L40 6 L52 26 L68 8 L72 30 L88 20 L82 46 Z', c, { sw: 2.4 });
  const gems = [DIET.sting.base, DIET.glow.base, DIET.venom.base, DIET.armor.base, DIET.soft.base];
  gems.forEach((g, i) => a.circle(24 + i * 12.5, 36 - (i % 2) * 3, 3.6, g, { sw: 1.4 }));
  a.hi(30, 22, 8, 2.5, -30, 0.7);
  a.path(blob([[58, 60], [72, 50], [86, 52], [88, 64], [80, 76], [66, 76]]), '#e87a6c', { sw: 2.2 });
  opening(a, '#ff9a8a');
  return finish(a, 'crown', slotsAlong(50, 48, 32, 27));
}

/** Shell paint cosmetics: recolours of the round snail used on top of any gameplay shell kind. */
export const SHELL_PAINTS: Record<string, { base: string; stripe: string; lip: string }> = {
  shell_candy: { base: '#ff9ecf', stripe: '#ffffff', lip: '#ffd0e6' },
  shell_galaxy: { base: '#5a4fd6', stripe: '#7be3ff', lip: '#b9a8ff' },
  shell_pearl: { base: '#f4f0ff', stripe: '#c9b8ff', lip: '#ffffff' },
};

export function shellSprites(): Sprite[] {
  const out = [
    spiral('periwinkle', { base: PAL.shell, stripe: '#e0a878', lip: '#ffe9d2', form: 0 }),
    spiral('spiral', { base: '#ffb37a', stripe: '#fff0d8', lip: '#ffd9b0', form: 1 }),
    spiral('conch', { base: '#ffa3b5', stripe: '#fff0e0', lip: '#ffd0d8', form: 2 }),
    spiral('nautilus', { base: '#fff1dc', stripe: '#e8744f', lip: '#ffe2c0', form: 3 }),
    can(), bottle(), skull(), teapot(), urchinTest(), boot(), clam(), lamp(), flask(), crown(),
  ];
  for (const [id, p] of Object.entries(SHELL_PAINTS)) out.push(spiral(`paint_${id}`, { ...p, form: 0 }));
  return out;
}
