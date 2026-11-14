import { Art, arcPoints, blob, curve, darken, DIET, lighten, rnd, spikes, type Diet, type Sprite } from '../kit';

/**
 * Pool fauna. A creature is coloured by its diet so the player reads "what gene is this" at a glance;
 * the silhouette (archetype) tells species apart. All face right, anchored at the bottom centre.
 */
type C = (typeof DIET)[Diet];

function jelly(id: string, c: C, o: { tent?: number; long?: number; spots?: boolean; frill?: boolean; cap?: number } = {}): Sprite {
  const a = new Art(44, 52, 2.2);
  const n = o.tent ?? 4;
  const len = o.long ?? 18;
  for (let i = 0; i < n; i++) {
    const x = 12 + (20 * i) / Math.max(1, n - 1);
    const sway = (i % 2 === 0 ? 1 : -1) * 3;
    a.line(curve([[x, 24], [x + sway, 24 + len * 0.5], [x - sway, 24 + len]]), i % 2 ? c.light : c.base, 2.6);
  }
  if (o.frill) a.path(blob([[8, 24], [14, 30], [22, 27], [30, 31], [36, 24], [22, 22]]), c.light, { sw: 1.6 });
  const top = o.cap ?? 6;
  a.path(blob([[6, 24], [8, 13], [16, top], [28, top], [36, 13], [38, 24], [30, 27], [22, 25], [14, 27]]), c.base, { opacity: 0.94 });
  if (o.spots) for (const [x, y, r] of [[14, 13, 2.2], [27, 11, 2.6], [31, 19, 1.8]] as const) a.spot(x, y, r, r, c.light, 0.9);
  a.hi(15, 12, 6, 2.6);
  a.eye(17, 19, 3.6, { dx: 0.4 });
  a.eye(28, 19, 3.6, { dx: 0.4 });
  a.mouth(22.5, 23, 3);
  return a.done(`creature/${id}`, { ax: 0.5, ay: 0.55 });
}

function plankton(id: string, c: C, legs: boolean): Sprite {
  const a = new Art(34, 34, 1.8);
  a.glow(17, 17, 16, c.light, 0.85);
  if (legs) for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    a.line(`M${17 + Math.cos(ang) * 6} ${17 + Math.sin(ang) * 6} L${17 + Math.cos(ang) * 13} ${17 + Math.sin(ang) * 13}`, c.base, 1.6);
  }
  else a.path(spikes(17, 17, 6, 12, 6, 15), c.light, { sw: 1.4 });
  a.circle(17, 17, 7.5, c.base);
  a.hi(14.5, 14, 2.6, 1.4);
  a.eye(14.5, 17.5, 2.4, { dx: 0.4 });
  a.eye(20.5, 17.5, 2.4, { dx: 0.4 });
  return a.done(`creature/${id}`, { ax: 0.5, ay: 0.6 });
}

function worm(id: string, c: C, o: { segs?: number; bristle?: boolean; bone?: boolean } = {}): Sprite {
  const a = new Art(50, 32, 2);
  const n = o.segs ?? 5;
  for (let i = 0; i < n; i++) {
    const x = 8 + i * (30 / n);
    const y = 21 - Math.sin((i / n) * Math.PI * 1.4) * 6;
    const r = 5.2 + i * 0.5;
    if (o.bristle) for (const s of [-1, 1]) a.line(`M${x} ${y} L${x + s * 2} ${y - 9}`, c.accent, 1.4);
    a.circle(x, y, r, i % 2 ? c.base : lighten(c.base, 0.15));
  }
  a.circle(40, 15, 8, o.bone ? '#f2ead8' : c.base);
  a.hi(37, 11.5, 3, 1.5);
  a.eye(42.5, 13.5, 3, { dx: 0.5 });
  a.mouth(43, 19, 3.5);
  a.cheek(38, 18.5, 1.8);
  return a.done(`creature/${id}`, { ax: 0.5, ay: 0.85 });
}

function shrimp(id: string, c: C, o: { glass?: boolean } = {}): Sprite {
  const a = new Art(48, 36, 2);
  const op = o.glass ? 0.75 : 1;
  for (const x of [20, 26, 32]) a.line(`M${x} 25 L${x - 2} 33`, c.dark, 1.6);
  a.line(curve([[38, 12], [44, 6], [47, 3]]), c.dark, 1.3);
  a.line(curve([[38, 13], [45, 10], [48, 9]]), c.dark, 1.3);
  // Tail fan and curled segmented body.
  a.path(blob([[3, 12], [10, 14], [9, 21], [3, 24], [1, 18]]), c.light, { sw: 1.6, opacity: op });
  const seg = arcPoints(22, 24, 13, 11, 190, 300, 5);
  seg.forEach(([x, y], i) => a.ell(x, y, 6.5, 6 - i * 0.2, i % 2 ? c.base : lighten(c.base, 0.18), { sw: 1.8, opacity: op }));
  a.path(blob([[26, 12], [34, 9], [41, 13], [42, 21], [35, 25], [28, 22]]), c.base, { opacity: op });
  a.hi(30, 13, 4, 1.6);
  a.eye(37.5, 15.5, 3.2, { dx: 0.5 });
  return a.done(`creature/${id}`, { ax: 0.5, ay: 0.85 });
}

function slug(id: string, c: C, o: { horns?: boolean; frills?: number; ears?: boolean; legs?: boolean; ink?: boolean } = {}): Sprite {
  const a = new Art(50, 36, 2);
  if (o.legs) for (const x of [14, 22, 30]) a.path(blob([[x - 3, 26], [x + 3, 26], [x + 2, 34], [x - 2, 34]]), c.light, { sw: 1.5 });
  const fr = o.frills ?? 0;
  for (let i = 0; i < fr; i++) {
    const x = 10 + (i * 22) / Math.max(1, fr - 1);
    a.path(blob([[x - 3, 14], [x, 3 + (i % 2) * 2], [x + 3, 14]]), i % 2 ? c.accent : c.light, { sw: 1.5 });
  }
  a.path(blob([[3, 27], [8, 18], [20, 13], [34, 13], [44, 18], [47, 26], [40, 31], [14, 32]]), c.base);
  if (o.ink) for (const [x, y] of [[14, 22], [22, 19], [30, 23]] as const) a.spot(x, y, 2.6, 2, c.dark, 0.7);
  if (o.ears) for (const x of [34, 41]) a.path(blob([[x - 3, 14], [x - 1, 2], [x + 3, 4], [x + 3, 14]]), c.light, { sw: 1.6 });
  if (o.horns) for (const x of [36, 42]) {
    a.line(`M${x} 15 L${x + 1.5} 7`, c.dark, 1.8);
    a.circle(x + 1.5, 6, 2, c.accent, { sw: 1.1 });
  }
  a.hi(16, 17.5, 6, 2.2, -8);
  a.eye(36, 21, 3.4, { dx: 0.5 });
  a.eye(43, 22, 2.8, { dx: 0.5 });
  a.mouth(40, 27, 3.5);
  return a.done(`creature/${id}`, { ax: 0.5, ay: 0.88 });
}

function urchin(id: string, c: C, o: { n?: number; long?: number; legs?: boolean } = {}): Sprite {
  const a = new Art(52, 50, 2);
  const n = o.n ?? 12;
  const r = o.long ?? 20;
  if (o.legs) for (let i = 0; i < 6; i++) {
    const s = i < 3 ? -1 : 1;
    const k = i % 3;
    a.line(curve([[26, 30], [26 + s * (12 + k * 3), 22 + k * 5], [26 + s * (18 + k * 3), 44]]), c.dark, 2);
  }
  else for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + 0.2;
    const len = r + rnd(i + n) * 4;
    a.path(`M${26 + Math.cos(ang - 0.16) * 9} ${28 + Math.sin(ang - 0.16) * 9} L${26 + Math.cos(ang) * len} ${28 + Math.sin(ang) * len} L${26 + Math.cos(ang + 0.16) * 9} ${28 + Math.sin(ang + 0.16) * 9} Z`, i % 2 ? c.light : c.accent, { sw: 1.4 });
  }
  a.circle(26, 28, o.legs ? 9 : 12, c.base);
  a.hi(22, 23, 4, 2);
  a.eye(22, 28, 3.2, { dx: 0.4 });
  a.eye(30, 28, 3.2, { dx: 0.4 });
  a.mouth(26, 33, 3, 1);
  return a.done(`creature/${id}`, { ax: 0.5, ay: 0.8 });
}

function star(id: string, c: C): Sprite {
  const a = new Art(50, 48, 2.2);
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 22 : 10;
    const ang = (i / 10) * Math.PI * 2 - Math.PI / 2;
    pts.push([25 + Math.cos(ang) * r, 25 + Math.sin(ang) * r]);
  }
  a.path(blob(pts, 0.55), c.base);
  for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * Math.PI * 2 - Math.PI / 2;
    for (const t of [0.45, 0.7]) a.spot(25 + Math.cos(ang) * 22 * t, 25 + Math.sin(ang) * 22 * t, 1.6, 1.6, c.accent, 0.95);
  }
  a.hi(19, 17, 4, 2);
  a.eye(21, 25, 3.4, { dx: 0.4 });
  a.eye(29, 25, 3.4, { dx: 0.4 });
  a.mouth(25, 30, 4);
  a.cheek(18, 29, 2);
  a.cheek(32, 29, 2);
  return a.done(`creature/${id}`, { ax: 0.5, ay: 0.85 });
}

function crabby(id: string, c: C, o: { bigClaw?: boolean; box?: boolean; iso?: boolean; spiky?: boolean } = {}): Sprite {
  const a = new Art(58, 44, 2.2);
  if (o.iso) {
    // Giant isopod: armoured segmented oval.
    for (const x of [14, 22, 30, 38]) a.line(`M${x} 32 L${x - 2} 41`, c.dark, 1.8);
    a.line(curve([[46, 20], [53, 14], [57, 12]]), c.dark, 1.4);
    a.path(blob([[5, 28], [10, 16], [26, 10], [42, 13], [51, 23], [48, 32], [28, 35], [10, 34]]), c.base);
    for (const x of [16, 24, 32, 40]) a.line(curve([[x, 12 + Math.abs(x - 28) * 0.15], [x - 3, 23], [x, 34]]), c.dark, 1.5, { outline: false, opacity: 0.6 });
    a.hi(22, 15, 8, 2.4, -6);
    a.eye(45, 22, 3.4, { dx: 0.5, angry: true });
    return a.done(`creature/${id}`, { ax: 0.5, ay: 0.9 });
  }
  for (const s of [-1, 1]) for (const k of [0, 1, 2]) a.line(curve([[29 + s * 10, 28], [29 + s * (19 + k * 2), 26 + k * 3], [29 + s * (22 + k * 2), 40]]), c.dark, 2);
  if (o.spiky) for (const [x, y] of arcPoints(29, 26, 16, 12, 200, 340, 6)) a.path(`M${x - 3} ${y + 2} L${x} ${y - 8} L${x + 3} ${y + 2} Z`, c.accent, { sw: 1.4 });
  if (o.box) a.path('M12 14 L46 14 L49 32 L9 32 Z', c.base);
  else a.path(blob([[10, 26], [14, 16], [29, 12], [44, 16], [48, 26], [42, 34], [16, 34]]), c.base);
  if (o.box) {
    a.line('M11 22 L47 22', c.accent, 2.2, { outline: false });
    a.path('M26 19 L32 19 L32 26 L26 26 Z', c.accent, { sw: 1.2 });
  }
  a.hi(21, 18, 6, 2);
  // Claws.
  a.path(blob([[44, 22], [50, 12], [57, 14], [55, 22], [49, 26]]), c.light, { sw: 1.8 });
  const big = o.bigClaw ? 1.7 : 1;
  a.group(`translate(12 20) scale(${big}) translate(-12 -20)`, () => a.path(blob([[14, 22], [8, 12], [1, 14], [3, 22], [9, 26]]), c.light, { sw: 1.8 / big }));
  a.eye(24, 24, 3.6, { dx: 0.4, angry: true });
  a.eye(34, 24, 3.6, { dx: 0.4, angry: true });
  a.mouth(29, 30, 4, -0.6);
  return a.done(`creature/${id}`, { ax: 0.5, ay: 0.9 });
}

function fish(id: string, c: C, o: { round?: boolean; spines?: boolean; lantern?: boolean; teeth?: boolean; stripes?: boolean; fan?: boolean; flat?: boolean; long?: boolean; angry?: boolean } = {}): Sprite {
  const a = new Art(60, 48, 2.2);
  const cy = 26;
  if (o.fan) for (let i = 0; i < 7; i++) {
    const ang = (-150 + i * 20) * (Math.PI / 180);
    a.line(`M24 ${cy} L${24 + Math.cos(ang) * 24} ${cy + Math.sin(ang) * 22}`, i % 2 ? c.accent : c.light, 2.4);
  }
  // Tail.
  a.path(blob([[12, cy], [2, cy - 10], [4, cy], [2, cy + 10]]), c.light, { sw: 1.8 });
  if (o.spines) for (const [x, y] of arcPoints(32, cy, 18, 15, 190, 350, 7)) a.path(`M${x - 2.5} ${y + 2} L${x} ${y - 7} L${x + 2.5} ${y + 2} Z`, c.accent, { sw: 1.3 });
  // Dorsal fin.
  if (!o.spines) a.path(blob([[22, cy - 11], [30, cy - 20], [38, cy - 12]]), c.light, { sw: 1.8 });
  const body: [number, number][] = o.round
    ? [[12, cy], [18, cy - 13], [32, cy - 16], [46, cy - 11], [52, cy], [46, cy + 12], [32, cy + 15], [18, cy + 12]]
    : o.flat
      ? [[12, cy], [20, cy - 14], [34, cy - 15], [46, cy - 8], [52, cy], [46, cy + 6], [32, cy + 16], [20, cy + 8]]
      : o.long
        ? [[8, cy], [18, cy - 7], [36, cy - 9], [50, cy - 5], [57, cy + 1], [48, cy + 8], [30, cy + 9], [16, cy + 6]]
        : [[12, cy], [20, cy - 10], [34, cy - 12], [47, cy - 7], [53, cy], [46, cy + 9], [32, cy + 11], [20, cy + 8]];
  a.path(blob(body), c.base);
  a.path(blob([[20, cy + 4], [30, cy + 2], [44, cy + 4], [40, cy + 9], [26, cy + 9]]), lighten(c.base, 0.45), { noStroke: true, flat: true, opacity: 0.55 });
  if (o.stripes) for (const x of [22, 29, 36]) a.line(curve([[x, cy - 9], [x - 2, cy], [x, cy + 8]]), c.dark, 2.2, { outline: false, opacity: 0.6 });
  a.path(blob([[28, cy + 3], [22, cy + 11], [32, cy + 9]]), c.light, { sw: 1.5 });
  a.hi(27, cy - 7, 7, 2.4, -8);
  if (o.lantern) {
    a.line(curve([[40, cy - 9], [44, cy - 22], [53, cy - 17]]), c.dark, 1.6);
    a.glow(54, cy - 16, 9, c.accent, 1);
    a.circle(54, cy - 16, 3, c.accent, { sw: 1.2 });
  }
  a.eye(43, cy - 3, 4.4, { dx: 0.5, angry: o.angry === true });
  if (o.teeth) {
    a.path(`M44 ${cy + 4} L56 ${cy + 2} L50 ${cy + 8} Z`, '#2a2140', { flat: true, sw: 1.4 });
    for (const x of [46, 49.5, 53]) a.path(`M${x - 1.4} ${cy + 3.4} L${x} ${cy + 7} L${x + 1.4} ${cy + 3.2} Z`, '#fff', { flat: true, sw: 0.8 });
  } else a.mouth(49, cy + 4, 3.5, o.angry ? -0.6 : 1);
  return a.done(`creature/${id}`, { ax: 0.5, ay: 0.6 });
}

function squid(id: string, c: C, o: { cape?: boolean; small?: boolean } = {}): Sprite {
  const a = new Art(56, 46, 2.2);
  for (let i = 0; i < 5; i++) {
    const y = 14 + i * 5;
    a.line(curve([[20, y], [10, y + (i - 2) * 2], [3, y + (i - 2) * 4]]), i % 2 ? c.light : c.base, 2.6);
  }
  if (o.cape) a.path(blob([[22, 10], [10, 4], [4, 14], [12, 24], [6, 34], [14, 42], [24, 36]]), c.dark, { sw: 1.8, opacity: 0.92 });
  // Fins and mantle.
  a.path(blob([[40, 8], [50, 4], [52, 14], [44, 16]]), c.light, { sw: 1.6 });
  a.path(blob([[40, 38], [50, 42], [52, 32], [44, 30]]), c.light, { sw: 1.6 });
  a.path(blob([[18, 23], [22, 12], [36, 9], [50, 16], [54, 23], [50, 30], [36, 37], [22, 34]]), c.base);
  a.hi(34, 14, 7, 2.2, 8);
  if (!o.cape) for (const [x, y] of [[44, 20], [40, 28], [47, 26]] as const) a.spot(x, y, 1.6, 1.6, c.accent, 1);
  a.eye(27, 20, 4.6, { dx: -0.4 });
  a.eye(29, 29, 3.4, { dx: -0.4 });
  return a.done(`creature/${id}`, { ax: 0.5, ay: 0.6 });
}

function clam(id: string, c: C): Sprite {
  const a = new Art(46, 40, 2.2);
  a.path(blob([[5, 24], [9, 12], [23, 6], [37, 12], [41, 24], [23, 22]]), c.base);
  for (const x of [13, 23, 33]) a.line(curve([[23, 22], [(23 + x) / 2, 13], [x, 9 + Math.abs(x - 23) * 0.3]]), c.dark, 1.6, { outline: false, opacity: 0.55 });
  a.path(blob([[5, 26], [23, 24], [41, 26], [36, 35], [23, 37], [10, 35]]), c.light);
  a.raw('<path d="M8 25 Q23 21 38 25 Q23 30 8 25 Z" fill="#2a2140"/>');
  a.eye(18, 25, 3, { dx: 0.3 });
  a.eye(28, 25, 3, { dx: 0.3 });
  a.hi(16, 12, 5, 2);
  return a.done(`creature/${id}`, { ax: 0.5, ay: 0.9 });
}

function snail(id: string, c: C): Sprite {
  const a = new Art(50, 42, 2.2);
  a.path(blob([[6, 34], [14, 28], [36, 28], [46, 30], [47, 36], [30, 39], [10, 39]]), lighten(c.base, 0.3));
  for (const [x, y] of arcPoints(22, 20, 15, 14, 190, 350, 6)) a.path(`M${x - 3} ${y + 2} L${x} ${y - 7} L${x + 3} ${y + 2} Z`, c.accent, { sw: 1.3 });
  a.path(blob([[8, 26], [10, 13], [22, 7], [34, 12], [36, 26], [22, 31]]), c.base);
  a.line(curve(arcPoints(22, 21, 8, 7, 200, 480, 8)), c.dark, 2, { outline: false, opacity: 0.6 });
  a.hi(16, 13, 4.5, 2);
  for (const x of [40, 45]) {
    a.line(`M${x} 30 L${x + 1} 22`, c.dark, 1.6);
    a.eye(x + 1, 20, 2.8, { dx: 0.4 });
  }
  return a.done(`creature/${id}`, { ax: 0.5, ay: 0.92 });
}

/** Siphonophore: a chain of little bells. */
function chain(id: string, c: C, bubble: boolean): Sprite {
  const a = new Art(48, 56, 2.2);
  if (bubble) {
    // Man o' war: a sail-float with trailing stingers.
    for (let i = 0; i < 5; i++) a.line(curve([[12 + i * 6, 22], [10 + i * 6 + (i % 2 ? 3 : -3), 36], [13 + i * 6, 52]]), i % 2 ? c.accent : c.base, 2.2);
    a.path(blob([[6, 22], [12, 10], [26, 4], [40, 12], [44, 22], [26, 26]]), c.accent, { opacity: 0.9 });
    a.path(blob([[14, 12], [26, 2], [38, 12]]), c.light, { sw: 1.6, opacity: 0.85 });
    a.hi(17, 14, 6, 2.2);
    a.eye(19, 19, 3.2, { dx: 0.4, angry: true });
    a.eye(31, 19, 3.2, { dx: 0.4, angry: true });
    return a.done(`creature/${id}`, { ax: 0.5, ay: 0.5 });
  }
  a.line(curve([[24, 6], [28, 20], [20, 34], [26, 50]]), c.dark, 2);
  const pts: [number, number][] = [[24, 9], [27, 20], [22, 31], [24, 42]];
  pts.forEach(([x, y], i) => {
    a.path(blob([[x - 9, y + 4], [x - 7, y - 5], [x, y - 8], [x + 7, y - 5], [x + 9, y + 4], [x, y + 2]]), i % 2 ? c.light : c.base, { opacity: 0.92 });
    a.glow(x, y - 1, 7, c.accent, 0.6);
  });
  a.eye(21, 8, 2.8, { dx: 0.4, angry: true });
  a.eye(28, 8, 2.8, { dx: 0.4, angry: true });
  return a.done(`creature/${id}`, { ax: 0.5, ay: 0.5 });
}

function comb(id: string, c: C): Sprite {
  const a = new Art(40, 46, 2.2);
  a.glow(20, 23, 20, c.accent, 0.5);
  a.path(blob([[8, 24], [10, 10], [20, 4], [30, 10], [32, 24], [28, 38], [20, 42], [12, 38]]), c.base, { opacity: 0.85 });
  const rainbow = ['#ff6a88', '#ffd166', '#7bff9a', '#7be3ff', '#c38bff'];
  for (const x of [13, 20, 27]) for (let i = 0; i < 5; i++) a.spot(x + (x === 20 ? 0 : (x < 20 ? 1 : -1) * i * 0.4), 11 + i * 6, 1.5, 2.2, rainbow[i]!, 0.95);
  a.hi(14, 12, 3.5, 1.8);
  a.eye(16, 24, 3, { dx: 0.3 });
  a.eye(24, 24, 3, { dx: 0.3 });
  return a.done(`creature/${id}`, { ax: 0.5, ay: 0.55 });
}

export function creatureSprites(): Record<'lagoon' | 'wreck' | 'abyss', Sprite[]> {
  const D = DIET;
  return {
    lagoon: [
      plankton('plankton_spark', D.glow, false),
      jelly('moon_jelly', D.sting, { tent: 4, long: 14 }),
      worm('sand_worm', D.soft, { segs: 4 }),
      shrimp('baby_shrimp', D.armor),
      slug('sea_slug', D.venom, { horns: true, frills: 3 }),
      urchin('mini_urchin', D.spike, { n: 10, long: 17 }),
      clam('hopper_clam', D.soft),
      jelly('compass_jelly', D.sting, { tent: 5, long: 22, spots: true, frill: true }),
      fish('lantern_fry', D.glow, { round: true }),
      star('sea_star', D.spike),
      crabby('fiddler_crab', D.armor, { bigClaw: true }),
      fish('puffer', D.venom, { round: true, spines: true }),
      fish('lionfish', D.venom, { fan: true, stripes: true, angry: true }),
    ],
    wreck: [
      shrimp('rust_shrimp', { ...D.armor, base: '#6f8fe0', dark: '#8a5a3a', light: '#c9a27a' }),
      jelly('bottle_jelly', D.sting, { tent: 3, long: 12, cap: 2 }),
      worm('ship_worm', D.soft, { segs: 6, bristle: true }),
      squid('glow_squidling', D.glow, { small: true }),
      snail('spiny_snail', D.spike),
      slug('ink_slug', D.venom, { horns: true, ink: true }),
      slug('sea_hare', D.soft, { ears: true }),
      chain('man_o_war', D.sting, true),
      urchin('long_urchin', D.spike, { n: 16, long: 22 }),
      fish('lantern_fish', D.glow, { lantern: true }),
      crabby('box_crab', D.armor, { box: true }),
      fish('scorpionfish', D.venom, { spines: true, angry: true, teeth: true }),
    ],
    abyss: [
      plankton('abyss_copepod', D.glow, true),
      comb('comb_jelly', D.sting),
      worm('bone_worm', D.soft, { segs: 5, bone: true }),
      shrimp('glass_shrimp', D.armor, { glass: true }),
      slug('sea_pig', D.soft, { legs: true, horns: true }),
      slug('toxic_nudi', D.venom, { frills: 5, horns: true }),
      chain('siphon_chain', D.sting, false),
      urchin('spider_urchin', D.spike, { legs: true }),
      fish('hatchetfish', D.glow, { flat: true }),
      crabby('giant_isopod', D.armor, { iso: true }),
      squid('vampire_squid', D.venom, { cape: true }),
      crabby('spike_crab', D.spike, { spiky: true }),
      fish('viperfish', D.glow, { long: true, teeth: true, lantern: true, angry: true }),
    ],
  };
}
