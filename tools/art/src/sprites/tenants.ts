import { Art, arcPoints, blob, curve, darken, DIET, lighten, spikes, type Diet, type Sprite } from '../kit';

/**
 * Shell tenants: 40x44 box, anchored at the bottom centre (the point that sits on the shell).
 * Family colour is the main colour; bridge tenants mix the colours of both families.
 * Star levels are not separate drawings: the client scales the sprite and adds a silver / golden aura.
 */
type C = (typeof DIET)[Diet];
const W = 40;
const H = 44;
const BASE = 41;

const art = () => new Art(W, H, 2);
const done = (a: Art, id: string) => a.done(`tenant/${id}`, { ax: 0.5, ay: BASE / H });

function foot(a: Art, c: C, w = 12): void {
  a.path(blob([[20 - w, BASE], [20 - w * 0.7, BASE - 6], [20, BASE - 8], [20 + w * 0.7, BASE - 6], [20 + w, BASE]]), darken(c.base, 0.12));
}

function face(a: Art, x: number, y: number, r = 2.8, gap = 4): void {
  a.eye(x - gap, y, r, { dx: 0.3 });
  a.eye(x + gap, y, r, { dx: 0.3 });
  a.mouth(x, y + r * 1.3, r);
}

function anemone(id: string, c: C, o: { n?: number; tip?: string; shield?: C } = {}): Sprite {
  const a = art();
  const n = o.n ?? 7;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = 8 + t * 24;
    const top = 8 + Math.abs(t - 0.5) * 12;
    a.line(curve([[20 + (x - 20) * 0.5, 26], [x + (t - 0.5) * 6, 18], [x + (t - 0.5) * 10, top]]), i % 2 ? c.light : c.base, 3);
    a.circle(x + (t - 0.5) * 10, top, 2.2, o.tip ?? c.accent, { sw: 1.1 });
  }
  a.path(blob([[9, BASE], [10, 30], [15, 24], [25, 24], [30, 30], [31, BASE]]), o.shield ? o.shield.base : c.dark);
  if (o.shield) a.line('M11 34 L29 34', o.shield.light, 2, { outline: false });
  a.hi(15, 30, 3, 1.5);
  face(a, 20, 32);
  return done(a, id);
}

function coral(id: string, c: C, o: { fire?: boolean; needle?: boolean; soft?: boolean } = {}): Sprite {
  const a = art();
  const branch = (x1: number, y1: number, x2: number, y2: number, w: number): void => {
    a.line(curve([[x1, y1], [(x1 + x2) / 2 + (x2 - x1) * 0.1, (y1 + y2) / 2], [x2, y2]]), c.base, w);
    if (o.needle) a.path(`M${x2 - 2.5} ${y2 + 1} L${x2 + (x2 - x1) * 0.25} ${y2 - 8} L${x2 + 2.5} ${y2 + 1} Z`, c.accent, { sw: 1.1 });
    else a.circle(x2, y2, w * 0.62, o.soft ? c.light : lighten(c.base, 0.25), { sw: 1.2 });
  };
  branch(20, 38, 8, 20, 5);
  branch(20, 38, 32, 18, 5);
  branch(20, 38, 20, 9, 6);
  branch(12, 28, 5, 13, 3.6);
  branch(28, 26, 35, 9, 3.6);
  if (o.fire) for (const [x, y] of [[20, 5], [6, 10], [34, 6]] as const) a.path(blob([[x - 2.5, y + 3], [x, y - 4], [x + 2.5, y + 3]]), '#ff7a3d', { sw: 1 });
  foot(a, c, 9);
  face(a, 20, 33, 2.4, 3.6);
  return done(a, id);
}

function polyps(id: string, c: C, o: { storm?: boolean; glow?: C } = {}): Sprite {
  const a = art();
  for (const [x, h, r] of [[10, 22, 5], [30, 20, 5], [20, 12, 7]] as const) {
    a.line(`M${x} ${BASE - 4} L${x} ${h + 4}`, c.dark, 3.4);
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      a.line(`M${x} ${h} L${x + Math.cos(ang) * (r + 3)} ${h + Math.sin(ang) * (r + 3)}`, (o.glow ?? c).light, 1.6);
    }
    a.circle(x, h, r, c.base);
    if (o.glow) a.glow(x, h, r + 5, o.glow.light, 0.7);
  }
  if (o.storm) {
    a.glow(20, 12, 15, c.accent, 0.7);
    a.path('M18 2 L24 9 L20 10 L25 18 L15 11 L19.5 10 Z', c.light, { sw: 1.1 });
  }
  foot(a, c, 13);
  a.eye(17.5, 12, 2.4, { dx: 0.3 });
  a.eye(22.5, 12, 2.4, { dx: 0.3 });
  return done(a, id);
}

function ball(id: string, c: C, o: { n?: number; long?: number; zap?: C; pencil?: boolean; drip?: C } = {}): Sprite {
  const a = art();
  const n = o.n ?? 11;
  const r = o.long ?? 15;
  if (o.zap) a.glow(20, 25, 19, o.zap.accent, 0.6);
  for (let i = 0; i < n; i++) {
    const ang = Math.PI + (i / (n - 1)) * Math.PI;
    const w = o.pencil ? 0.2 : 0.15;
    const tip: [number, number] = [20 + Math.cos(ang) * r, 27 + Math.sin(ang) * r];
    a.path(`M${20 + Math.cos(ang - w) * 8} ${27 + Math.sin(ang - w) * 8} L${tip[0]} ${tip[1]} L${20 + Math.cos(ang + w) * 8} ${27 + Math.sin(ang + w) * 8} Z`, i % 2 ? c.light : (o.zap ?? c).accent, { sw: 1.2 });
    if (o.drip) a.circle(tip[0], tip[1], 1.6, o.drip.base, { sw: 0.9 });
  }
  a.path(blob([[9, BASE], [9, 28], [14, 19], [26, 19], [31, 28], [31, BASE]]), c.base);
  a.hi(15, 24, 3.5, 1.6);
  face(a, 20, 31);
  return done(a, id);
}

function starfish(id: string, c: C, heart?: C): Sprite {
  const a = art();
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 17 : 8;
    const ang = (i / 10) * Math.PI * 2 - Math.PI / 2;
    pts.push([20 + Math.cos(ang) * r, 24 + Math.sin(ang) * r]);
  }
  a.path(blob(pts, 0.5), c.base);
  if (heart) a.path('M20 34 C12 28 12 20 16.5 20 C19 20 20 22.5 20 22.5 C20 22.5 21 20 23.5 20 C28 20 28 28 20 34 Z', heart.base, { sw: 1.3 });
  else for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * Math.PI * 2 - Math.PI / 2;
    a.spot(20 + Math.cos(ang) * 11, 24 + Math.sin(ang) * 11, 1.4, 1.4, c.accent, 1);
  }
  a.hi(15, 17, 3, 1.5);
  if (!heart) face(a, 20, 23, 2.4, 3.4);
  return done(a, id);
}

function dome(id: string, c: C, o: { cone?: boolean; ridges?: boolean; plates?: boolean; brain?: boolean; pearl?: boolean; moss?: C } = {}): Sprite {
  const a = art();
  if (o.cone) {
    a.path(blob([[6, BASE], [12, 26], [16, 14], [24, 14], [28, 26], [34, BASE]], 0.3), c.base);
    a.ell(20, 14, 5, 2.6, '#2a2140', { flat: true });
    for (const x of [13, 20, 27]) a.line(`M${x} ${BASE - 2} L${16 + (x - 13) * 0.6} 18`, c.dark, 1.4, { outline: false, opacity: 0.5 });
    for (const [x, y] of [[17, 10], [23, 9]] as const) a.line(curve([[20, 14], [x, y + 2], [x + (x - 20), y - 5]]), c.accent, 1.5);
  } else {
    a.path(blob([[5, BASE], [7, 28], [14, 19], [26, 19], [33, 28], [35, BASE]]), c.base);
    if (o.ridges) for (const x of [11, 17, 23, 29]) a.line(curve([[20, 20], [(20 + x) / 2, 28], [x - (20 - x) * 0.3, BASE - 1]]), c.dark, 1.5, { outline: false, opacity: 0.5 });
    if (o.plates) for (const y of [25, 30, 35]) a.line(curve([[7 + (35 - y) * 0.2, y], [20, y - 4], [33 - (35 - y) * 0.2, y]]), c.dark, 1.6, { outline: false, opacity: 0.6 });
    if (o.brain) for (const [x, y] of [[13, 27], [20, 24], [27, 27], [16, 33], [24, 33]] as const) a.line(curve([[x - 3, y], [x, y - 3], [x + 3, y], [x, y + 2.5]]), c.dark, 1.5, { outline: false, opacity: 0.6 });
    if (o.moss) for (const [x, y] of [[10, 24], [18, 19], [27, 20], [32, 27]] as const) a.circle(x, y, 3.4, o.moss.base, { sw: 1.2 });
  }
  if (o.pearl) a.circle(20, 23, 4.5, '#fdf7ff', { sw: 1.3 });
  a.hi(13, 25, 3.5, 1.6);
  face(a, 20, o.brain ? 37 : 34, 2.4, 4);
  return done(a, id);
}

function clamT(id: string, c: C, big: boolean): Sprite {
  const a = art();
  const top = big ? 10 : 16;
  a.path(blob([[4, 28], [8, top + 4], [20, top], [32, top + 4], [36, 28], [20, 26]]), c.base);
  for (const x of [10, 15, 20, 25, 30]) a.line(curve([[20, 27], [(20 + x) / 2, top + 8], [x, top + 3 + Math.abs(x - 20) * 0.3]]), c.dark, 1.5, { outline: false, opacity: 0.5 });
  a.path(blob([[4, 30], [20, 28], [36, 30], [32, BASE - 1], [20, BASE], [8, BASE - 1]]), c.light);
  a.raw('<path d="M7 29 Q20 24.5 33 29 Q20 34 7 29 Z" fill="#2a2140"/>');
  a.circle(20, 29.5, big ? 3.6 : 2.8, '#fdf7ff', { sw: 1.1 });
  a.hi(13, top + 6, 4, 1.8);
  a.eye(12, 30, 2.2, { dx: 0.3 });
  a.eye(28, 30, 2.2, { dx: 0.3 });
  return done(a, id);
}

function tubes(id: string, c: C, o: { toxic?: boolean; vase?: boolean } = {}): Sprite {
  const a = art();
  const tube = (x: number, top: number, w: number): void => {
    a.path(blob([[x - w, BASE], [x - w * 0.8, top + 4], [x - w * 1.05, top], [x + w * 1.05, top], [x + w * 0.8, top + 4], [x + w, BASE]], 0.3), c.base);
    a.ell(x, top, w * 0.85, w * 0.42, '#2a2140', { flat: true, sw: 1.4 });
    if (o.toxic) for (const k of [0, 1]) a.circle(x + (k ? 2 : -2), top - 4 - k * 5, 1.8 - k * 0.4, c.light, { sw: 0.9 });
  };
  if (o.vase) {
    a.path(blob([[10, BASE], [8, 30], [12, 20], [14, 12], [26, 12], [28, 20], [32, 30], [30, BASE]], 0.4), c.base, { opacity: 0.9 });
    a.ell(20, 12, 5.5, 2.6, '#2a2140', { flat: true, sw: 1.4 });
    a.path(blob([[26, 24], [34, 18], [36, 24], [30, 28]]), c.light, { sw: 1.3 });
    a.ell(34.5, 20.5, 1.8, 1.2, '#2a2140', { flat: true, noStroke: true });
  } else {
    tube(11, 20, 5);
    tube(29, 17, 5);
    tube(20, 10, 6.5);
  }
  for (const [x, y] of [[16, 28], [24, 22], [21, 34]] as const) a.spot(x, y, 1.3, 1.6, c.dark, 0.5);
  a.hi(16, 16, 2, 4, 0, 0.5);
  face(a, 20, o.vase ? 30 : 31, 2.4, 3.6);
  return done(a, id);
}

function kelp(id: string, c: C, lure?: C): Sprite {
  const a = art();
  const blade = (x: number, top: number, lean: number, col: string): void => {
    a.path(blob([[x - 3.5, BASE], [x - 4 + lean * 0.4, (BASE + top) / 2], [x + lean, top], [x + 4 + lean * 0.6, (BASE + top) / 2], [x + 3.5, BASE]], 0.6), col);
    a.line(curve([[x, BASE - 2], [x + lean * 0.4, (BASE + top) / 2], [x + lean, top + 3]]), darken(col, 0.25), 1.2, { outline: false, opacity: 0.5 });
  };
  blade(10, 12, -4, c.dark);
  blade(30, 9, 4, c.dark);
  blade(20, 3, 2, c.base);
  if (lure) for (const [x, y] of [[6, 11], [34, 8], [22, 3]] as const) {
    a.glow(x, y, 7, lure.light, 0.9);
    a.circle(x, y, 2.6, lure.light, { sw: 1 });
  }
  foot(a, c, 10);
  face(a, 20, 35, 2.2, 3.4);
  return done(a, id);
}

function fan(id: string, c: C): Sprite {
  const a = art();
  for (let i = 0; i < 9; i++) {
    const ang = Math.PI + 0.25 + (i / 8) * (Math.PI - 0.5);
    a.line(curve([[20, 24], [20 + Math.cos(ang) * 10, 24 + Math.sin(ang) * 9], [20 + Math.cos(ang) * 17, 22 + Math.sin(ang) * 19]]), i % 2 ? c.light : c.base, 2.4);
  }
  a.path(blob([[14, BASE], [14, 26], [17, 22], [23, 22], [26, 26], [26, BASE]], 0.3), '#f2e2c4');
  for (const y of [28, 33, 38]) a.line(`M14.5 ${y} L25.5 ${y}`, '#c9a880', 1.3, { outline: false });
  face(a, 20, 30, 2.2, 3);
  return done(a, id);
}

function blobby(id: string, c: C, o: { warts?: boolean; angry?: boolean; rings?: C; arms?: boolean } = {}): Sprite {
  const a = art();
  if (o.arms) for (const [x, s] of [[9, -1], [15, -1], [25, 1], [31, 1]] as const) a.line(curve([[x, 32], [x + s * 4, 38], [x + s * 2, BASE]]), c.base, 3.2);
  a.path(blob([[6, o.arms ? 34 : BASE], [6, 26], [12, 16], [20, 13], [28, 16], [34, 26], [34, o.arms ? 34 : BASE], [20, o.arms ? 36 : BASE]]), c.base);
  if (o.warts) for (const [x, y, r] of [[11, 22, 2.4], [20, 15, 2.8], [29, 21, 2.2], [15, 17, 1.6]] as const) a.circle(x, y, r, c.light, { sw: 1 });
  if (o.rings) for (const [x, y] of [[12, 20], [28, 20], [20, 16], [11, 30], [29, 30]] as const) {
    a.raw(`<circle cx="${x}" cy="${y}" r="2.6" fill="none" stroke="${o.rings.base}" stroke-width="1.6"/>`);
    a.glow(x, y, 4.5, o.rings.light, 0.6);
  }
  a.hi(14, 20, 3.6, 1.6);
  a.eye(15.5, 27, 3, { dx: 0.3, angry: o.angry === true });
  a.eye(24.5, 27, 3, { dx: 0.3, angry: o.angry === true });
  a.mouth(20, 32, 3.4, o.angry ? -0.7 : 1);
  return done(a, id);
}

function shroom(id: string, c: C, ghost?: C): Sprite {
  const a = art();
  a.glow(20, 18, 20, c.light, 0.75);
  a.path(blob([[15, BASE], [16, 26], [24, 26], [25, BASE]], 0.3), ghost ? ghost.light : '#f6f1ff', { opacity: ghost ? 0.85 : 1 });
  a.path(blob([[4, 24], [8, 12], [20, 6], [32, 12], [36, 24], [20, 27]]), ghost ? ghost.base : c.base, { opacity: ghost ? 0.88 : 1 });
  for (const [x, y, r] of [[12, 16, 2.4], [22, 11, 3], [29, 18, 2]] as const) a.spot(x, y, r, r, c.light, 0.95);
  a.hi(13, 13, 4, 1.8);
  face(a, 20, 33, 2.2, 2.8);
  return done(a, id);
}

function orb(id: string, c: C, o: { prism?: boolean; lamp?: boolean } = {}): Sprite {
  const a = art();
  a.glow(20, 20, 20, c.light, 0.85);
  if (o.prism) {
    a.path('M20 4 L31 16 L26 34 L14 34 L9 16 Z', c.base, { opacity: 0.9 });
    a.path('M20 4 L20 34 M9 16 L31 16', '#ffffff', { flat: true, noStroke: false, stroke: '#ffffff', sw: 1, opacity: 0.6 });
    for (const [x, col] of [[13, '#ff6a88'], [20, '#ffd166'], [27, '#7bff9a']] as const) a.spot(x, 26, 2.4, 4, col, 0.75);
    foot(a, c, 9);
  } else if (o.lamp) {
    a.line(curve([[20, BASE - 4], [12, 26], [18, 12]]), c.dark, 3);
    foot(a, c, 8);
    a.circle(19, 11, 8, c.light);
    a.glow(19, 11, 13, '#ffffff', 0.7);
    a.eye(16.5, 11, 2.2, { dx: 0.3 });
    a.eye(21.5, 11, 2.2, { dx: 0.3 });
    return done(a, id);
  } else {
    a.path(spikes(20, 22, 8, 15, 8, 22), c.light, { sw: 1.3 });
    a.circle(20, 22, 9, c.base);
    foot(a, c, 7);
  }
  a.hi(16, 17, 3, 1.5);
  face(a, 20, o.prism ? 20 : 22, 2.2, 3.2);
  return done(a, id);
}

function stalk(id: string, c: C): Sprite {
  const a = art();
  for (const [x, top, lean] of [[12, 14, -4], [28, 12, 4], [20, 6, 0]] as const) {
    a.line(curve([[20 + (x - 20) * 0.4, BASE - 4], [x, (BASE + top) / 2], [x + lean, top + 5]]), c.dark, 2.6);
    a.glow(x + lean, top, 8, c.light, 0.9);
    a.path(blob([[x + lean - 4, top + 3], [x + lean, top - 5], [x + lean + 4, top + 3], [x + lean, top + 6]]), c.base, { sw: 1.4 });
  }
  foot(a, c, 9);
  face(a, 20, 36, 2.2, 3.2);
  return done(a, id);
}

function squidT(id: string, c: C): Sprite {
  const a = art();
  for (let i = 0; i < 5; i++) a.line(curve([[12 + i * 4, 28], [10 + i * 5, 35], [11 + i * 4.5, BASE]]), i % 2 ? c.light : c.base, 2.4);
  a.path(blob([[9, 28], [10, 14], [20, 5], [30, 14], [31, 28], [20, 31]]), c.base);
  a.path(blob([[8, 14], [2, 10], [6, 20]]), c.light, { sw: 1.4 });
  a.path(blob([[32, 14], [38, 10], [34, 20]]), c.light, { sw: 1.4 });
  for (const [x, y] of [[14, 13], [25, 11], [20, 17]] as const) {
    a.glow(x, y, 4, c.accent, 0.9);
    a.spot(x, y, 1.4, 1.4, c.accent, 1);
  }
  face(a, 20, 24, 2.8, 4.2);
  return done(a, id);
}

function slugT(id: string, c: C): Sprite {
  const a = art();
  for (let i = 0; i < 4; i++) a.path(blob([[9 + i * 6, 26], [11 + i * 6, 14 + (i % 2) * 3], [14 + i * 6, 26]]), i % 2 ? c.accent : c.light, { sw: 1.3 });
  a.path(blob([[4, BASE], [6, 31], [14, 25], [28, 25], [35, 30], [36, BASE]]), c.base);
  for (const x of [28, 33]) {
    a.line(`M${x} 27 L${x + 1} 20`, c.dark, 1.6);
    a.circle(x + 1, 19, 1.8, c.accent, { sw: 0.9 });
  }
  a.hi(12, 30, 4, 1.5);
  face(a, 28, 34, 2.2, 3.2);
  return done(a, id);
}

function cone(id: string, c: C): Sprite {
  const a = art();
  a.path(blob([[6, BASE], [8, 30], [20, 6], [32, 30], [34, BASE]], 0.25), '#fff3d8');
  for (const [y, w] of [[14, 3], [22, 6.5], [30, 9.5], [37, 11.5]] as const) a.line(curve([[20 - w, y + 1], [20, y - 1.5], [20 + w, y + 1]]), c.base, 2.6, { outline: false });
  a.line(curve([[30, 36], [36, 33], [39, 27]]), c.dark, 1.8);
  a.path('M39 27 L36.5 22 L41 23 Z', c.accent, { sw: 0.9 });
  a.hi(15, 20, 2, 5, 22, 0.5);
  face(a, 20, 33, 2.2, 3.4);
  return done(a, id);
}

function fuzzy(id: string, c: C): Sprite {
  const a = art();
  const pts = arcPoints(20, 34, 13, 20, 195, 345, 6);
  pts.forEach(([x, y], i) => {
    for (const s of [-1, 1]) a.line(`M${x} ${y} L${x + s * 3 + (x - 20) * 0.35} ${y - 8}`, '#ffffff', 1.4);
    a.circle(x, y, 5.2 - Math.abs(i - 2.5) * 0.4, i % 2 ? c.base : '#ff7a3d');
  });
  a.eye(pts[5]![0] - 1.2, pts[5]![1] - 1, 2.2, { dx: 0.4 });
  return done(a, id);
}

function chainT(id: string, c: C): Sprite {
  const a = art();
  a.line(curve([[20, BASE - 2], [14, 28], [24, 18], [18, 6]]), c.dark, 2);
  for (const [x, y, r] of [[16, 32, 5], [22, 22, 5.5], [19, 10, 6.5]] as const) {
    a.glow(x, y, r + 5, c.accent, 0.6);
    a.path(blob([[x - r, y + 3], [x - r * 0.8, y - 3], [x, y - r], [x + r * 0.8, y - 3], [x + r, y + 3], [x, y + 1.5]]), c.base, { opacity: 0.92, sw: 1.5 });
  }
  a.eye(16.5, 9, 2.2, { dx: 0.3 });
  a.eye(21.5, 9, 2.2, { dx: 0.3 });
  foot(a, c, 7);
  return done(a, id);
}

export function tenantSprites(): Sprite[] {
  const D = DIET;
  const two = (x: C, y: C): C => ({ base: x.base, light: y.light, dark: x.dark, accent: y.base });
  return [
    // Sting
    anemone('anemone', D.sting, { tip: D.sting.accent }),
    coral('fire_coral', D.sting, { fire: true }),
    polyps('hydroid', D.sting),
    anemone('sea_nettle', D.sting, { n: 9, tip: '#ffffff' }),
    chainT('siphonophore', D.sting),
    polyps('storm_polyp', D.sting, { storm: true }),
    // Spike
    ball('urchin', D.spike),
    coral('needle_coral', D.spike, { needle: true }),
    starfish('starfish', D.spike),
    ball('pencil_urchin', D.spike, { n: 7, long: 18, pencil: true }),
    ball('crown_thorns', D.spike, { n: 15, long: 13 }),
    cone('murex', D.spike),
    // Glow
    shroom('glow_shroom', D.glow),
    orb('sea_sparkle', D.glow),
    stalk('lantern_weed', D.glow),
    squidT('firefly_squid', D.glow),
    orb('prism_coral', D.glow, { prism: true }),
    orb('angler_lamp', D.glow, { lamp: true }),
    // Armor
    dome('barnacle', D.armor, { cone: true }),
    dome('limpet', D.armor, { ridges: true }),
    clamT('oyster', D.armor, false),
    dome('brain_coral', D.armor, { brain: true }),
    dome('chiton', D.armor, { plates: true }),
    clamT('giant_clam', D.armor, true),
    // Venom
    slugT('nudibranch', D.venom),
    cone('cone_snail', D.venom),
    tubes('toxic_sponge', D.venom, { toxic: true }),
    fuzzy('fire_worm', D.venom),
    blobby('blue_ring', D.venom, { rings: D.armor, arms: true }),
    blobby('stonefish', D.venom, { warts: true, angry: true }),
    // Soft
    tubes('sea_sponge', D.soft),
    kelp('kelp', D.soft),
    fan('feather_worm', D.soft),
    blobby('sea_cucumber', D.soft, { warts: true }),
    coral('soft_coral', D.soft, { soft: true }),
    tubes('sea_squirt', D.soft, { vase: true }),
    // Bridges
    ball('electric_urchin', two(D.spike, D.sting), { zap: D.sting }),
    polyps('spark_polyp', D.sting, { glow: D.glow }),
    anemone('shell_anemone', D.sting, { n: 5, shield: D.armor }),
    ball('venom_spine', two(D.spike, D.venom), { n: 9, long: 17, drip: D.venom }),
    dome('pearl_moss', D.armor, { moss: D.soft, pearl: true }),
    shroom('ghost_shroom', D.glow, D.venom),
    starfish('coral_heart', D.spike, D.soft),
    kelp('lure_kelp', D.soft, D.glow),
  ];
}
