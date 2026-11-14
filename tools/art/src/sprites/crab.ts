import { Art, arcPoints, blob, curve, darken, DIET, lighten, PAL, type Diet, type Sprite } from '../kit';

/**
 * The hero is assembled at runtime from parts so it can animate (legs scuttle, claws snap, the body
 * tucks into the shell) and so mutations can swap single parts. Everything faces right.
 */
export interface HeroLook {
  id: string;
  body: string;
  belly: string;
  claw: string;
  leg: string;
  /** Body silhouette: 0 round hermit, 1 wide spiky decorator, 2 long mantis. */
  shape: 0 | 1 | 2;
}

export const HEROES: HeroLook[] = [
  { id: 'hermit', body: PAL.crab, belly: '#ffd9b8', claw: '#ff6a3d', leg: '#f0623a', shape: 0 },
  { id: 'decorator', body: '#3fbfa8', belly: '#d6fff0', claw: '#2fa392', leg: '#2a9484', shape: 1 },
  { id: 'mantis', body: '#57c84d', belly: '#fff2a8', claw: '#ff5a6e', leg: '#3a9fe0', shape: 2 },
];

/** Paid/earned colourways recolour the hermit-shaped parts. */
export const SKINS: Record<string, { body: string; belly: string; claw: string; leg: string }> = {
  crab_azure: { body: '#4aa8ff', belly: '#dff2ff', claw: '#2f86e6', leg: '#2a78d0' },
  crab_coral: { body: '#ff7fa0', belly: '#fff0f3', claw: '#ff5c86', leg: '#e84f79' },
  crab_gold: { body: '#ffc23a', belly: '#fff6c8', claw: '#f0a51e', leg: '#dc9418' },
  crab_abyss: { body: '#6b5cff', belly: '#c9f8ff', claw: '#4a3fd6', leg: '#3fd0e0' },
};

function body(id: string, look: Omit<HeroLook, 'id'>): Sprite {
  const a = new Art(48, 44, 2.2);
  const c = look.body;
  // Eye stalks behind the carapace.
  a.line(curve([[20, 20], [18, 12], [17, 8]]), darken(c, 0.1), 3.2);
  a.line(curve([[31, 20], [33, 12], [35, 7]]), darken(c, 0.1), 3.2);
  if (look.shape === 1) {
    // Decorator: knobbly, wide carapace.
    a.path(blob([[6, 28], [8, 19], [15, 15], [24, 13], [34, 15], [42, 21], [43, 29], [37, 36], [24, 39], [12, 36]]), c);
    for (const [x, y] of [[9, 21], [16, 15], [26, 13], [36, 16], [42, 23]] as const) a.path(`M${x - 2.5} ${y + 1} L${x} ${y - 5} L${x + 2.5} ${y + 1} Z`, lighten(c, 0.15), { sw: 1.6 });
  } else if (look.shape === 2) {
    // Mantis shrimp: longer body with a striped back.
    a.path(blob([[4, 30], [7, 21], [16, 16], [28, 15], [39, 18], [44, 26], [41, 34], [28, 38], [13, 37]]), c);
    for (const x of [12, 18, 24]) a.line(curve([[x, 19], [x - 2, 27], [x, 35]]), darken(c, 0.25), 1.6, { outline: false, opacity: 0.7 });
  } else {
    a.path(blob([[7, 29], [9, 20], [17, 15], [27, 14], [37, 17], [42, 25], [40, 33], [30, 38], [17, 38]]), c);
  }
  // Belly plate and face.
  a.path(blob([[22, 30], [30, 26], [38, 27], [40, 31], [35, 36], [26, 36]]), look.belly, { sw: 1.4, depth: 0.5 });
  a.hi(18, 21, 6, 3, -20, 0.5);
  a.eye(17, 7, 6.2, { dx: 0.5, dy: 0.2 });
  a.eye(36, 6.5, 6.6, { dx: 0.5, dy: 0.2 });
  a.mouth(34, 31, 5, 1);
  a.cheek(28, 31.5, 2.6);
  return a.done(id, { ax: 0.5, ay: 0.75 });
}

/** Claw variants: default pincer plus one per diet for the claw mutations. */
function claw(id: string, color: string, variant: Diet | null): Sprite {
  const a = new Art(34, 30, 2);
  // Arm segment.
  a.path(blob([[2, 20], [5, 14], [12, 13], [15, 18], [12, 23], [5, 24]]), darken(color, 0.08));
  if (variant === 'spike') {
    // Mace: a spiky ball instead of a pincer.
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      const x = 21 + Math.cos(ang) * 8;
      const y = 14 + Math.sin(ang) * 8;
      a.path(`M${21 + Math.cos(ang - 0.3) * 6} ${14 + Math.sin(ang - 0.3) * 6} L${21 + Math.cos(ang) * 13} ${14 + Math.sin(ang) * 13} L${21 + Math.cos(ang + 0.3) * 6} ${14 + Math.sin(ang + 0.3) * 6} Z`, DIET.spike.accent, { sw: 1.4 });
      void x;
      void y;
    }
    a.circle(21, 14, 8.5, DIET.spike.base);
    a.hi(18, 11, 3, 1.8);
  } else {
    // Upper and lower finger.
    a.path(blob([[11, 15], [14, 6], [23, 2], [31, 5], [32, 10], [25, 12], [20, 16]]), color);
    a.path(blob([[12, 19], [20, 17], [28, 16], [31, 19], [26, 24], [17, 25]]), darken(color, 0.12));
    a.hi(19, 6.5, 4.5, 1.8, -25);
    const v = variant ? DIET[variant] : null;
    if (variant === 'sting') {
      a.glow(27, 12, 9, DIET.sting.accent, 0.8);
      a.path('M24 6 L29 11 L25.5 12 L30 18 L22 13 L25.5 12 Z', DIET.sting.light, { sw: 1.2 });
    } else if (variant === 'glow') {
      a.glow(27, 9, 10, DIET.glow.light, 0.9);
      a.circle(28, 8, 3, DIET.glow.light, { sw: 1.2 });
    } else if (variant === 'armor') {
      a.path(blob([[13, 8], [20, 3], [27, 4], [26, 10], [18, 12]]), DIET.armor.base, { sw: 1.4 });
      a.hi(19, 6, 3, 1.4);
    } else if (variant === 'venom') {
      a.path('M30 6 L34 13 L28.5 11 Z', DIET.venom.light, { sw: 1.2 });
      a.circle(31, 17, 1.8, DIET.venom.base, { sw: 1 });
      a.circle(28.5, 22, 1.3, DIET.venom.base, { sw: 1 });
    } else if (variant === 'soft') {
      for (const [x, y] of [[20, 14.5], [24.5, 13.5], [28.5, 13]] as const) a.circle(x, y, 1.9, DIET.soft.light, { sw: 1 });
    }
    if (v) a.spot(22, 8, 5, 2.4, v.base, 0.55, -20);
  }
  return a.done(id, { ax: 0.18, ay: 0.63 });
}

function leg(id: string, color: string, variant: Diet | null): Sprite {
  const a = new Art(16, 22, 1.8);
  const c = variant ? DIET[variant].base : color;
  a.path(blob([[4, 2], [9, 1], [11, 6], [9, 11], [5, 10]]), c);
  a.path(blob([[6, 9], [10, 9], [13, 15], [12, 21], [9, 20], [7, 15]]), darken(c, 0.12));
  if (variant === 'spike') a.path('M11 12 L16 11 L12.5 15 Z', DIET.spike.accent, { sw: 1 });
  if (variant === 'glow') a.glow(11, 19, 5, DIET.glow.light, 0.9);
  if (variant === 'sting') a.path('M12 13 L15 17 L12.5 17 L14 21 L10 16 L12 16 Z', DIET.sting.light, { sw: 0.8 });
  if (variant === 'soft') a.path(blob([[9, 17], [15, 18], [14, 22], [8, 21.5]]), DIET.soft.light, { sw: 1.2 });
  a.hi(6.5, 4.5, 1.8, 1, -30, 0.5);
  return a.done(id, { ax: 0.42, ay: 0.12 });
}

function antenna(id: string, color: string, variant: Diet | null): Sprite {
  const a = new Art(26, 26, 1.6);
  const c = variant ? DIET[variant].base : color;
  a.line(curve([[3, 24], [8, 12], [20, 5]]), c, 2);
  if (variant === 'glow') {
    a.glow(21, 5, 6, DIET.glow.light, 1);
    a.circle(21, 5, 2.6, DIET.glow.light, { sw: 1 });
  } else if (variant === 'sting') {
    a.path('M19 1 L24 5 L20.5 6 L24 10 L17 6.5 L20 5.5 Z', DIET.sting.light, { sw: 0.9 });
  } else if (variant === 'spike') {
    a.path('M18 2 L26 2 L20.5 8.5 Z', DIET.spike.accent, { sw: 1 });
  } else if (variant === 'armor') {
    a.path(blob([[17, 2], [24, 2], [24, 8], [20.5, 10], [17, 8]]), DIET.armor.base, { sw: 1 });
  } else if (variant === 'venom') {
    a.circle(21, 5, 2.6, DIET.venom.accent, { sw: 1 });
  } else if (variant === 'soft') {
    for (const [x, y] of [[18, 4], [22, 3], [21, 7.5]] as const) a.circle(x, y, 1.8, DIET.soft.light, { sw: 0.9 });
  } else {
    a.circle(20.5, 5, 1.6, lighten(c, 0.3), { sw: 0.9 });
  }
  return a.done(id, { ax: 0.1, ay: 0.92 });
}

/** Carapace overlay for carapace mutations: drawn on top of the body. */
function carapace(diet: Diet): Sprite {
  const a = new Art(48, 44, 2);
  const d = DIET[diet];
  const pts = arcPoints(23, 26, 14, 10, 200, 330, 5);
  if (diet === 'spike' || diet === 'sting') {
    for (const [x, y] of pts) a.path(`M${x - 3} ${y + 2} L${x - 0.5} ${y - 7} L${x + 3} ${y + 2} Z`, diet === 'spike' ? d.accent : d.light, { sw: 1.4 });
    if (diet === 'sting') a.glow(23, 18, 13, d.accent, 0.5);
  } else if (diet === 'armor') {
    a.path(blob([[9, 24], [14, 16], [24, 13], [34, 16], [38, 22], [30, 20], [22, 19], [14, 22]]), d.base, { sw: 1.8 });
    for (const x of [16, 23, 30]) a.circle(x, 17.5, 1.2, d.accent, { sw: 0.8 });
    a.hi(18, 16.5, 4, 1.4);
  } else if (diet === 'glow') {
    a.path(blob([[11, 22], [17, 16], [26, 14.5], [34, 17], [28, 18], [18, 20]]), d.light, { sw: 1.4, opacity: 0.9 });
    a.hi(20, 17, 5, 1.6, -15, 0.9);
    a.glow(22, 18, 14, d.light, 0.45);
  } else if (diet === 'venom') {
    for (const [x, y, r] of [[13, 21, 2.6], [20, 16.5, 3], [28, 15.5, 2.4], [35, 19, 2.6]] as const) a.circle(x, y, r, d.accent, { sw: 1.1 });
  } else {
    a.path(blob([[8, 25], [12, 17], [23, 12], [35, 15], [40, 23], [32, 19], [22, 17], [13, 21]]), d.light, { sw: 1.6 });
    a.hi(18, 16, 5, 1.6);
  }
  return a.done(`crab/carapace_${diet}`, { ax: 0.5, ay: 0.75 });
}

export function crabSprites(): Sprite[] {
  const out: Sprite[] = [];
  const diets: Diet[] = ['sting', 'spike', 'glow', 'armor', 'venom', 'soft'];
  for (const h of HEROES) {
    out.push(body(`crab/${h.id}/body`, h), claw(`crab/${h.id}/claw`, h.claw, null), leg(`crab/${h.id}/leg`, h.leg, null), antenna(`crab/${h.id}/antenna`, h.leg, null));
  }
  for (const [skin, look] of Object.entries(SKINS)) {
    out.push(body(`crab/${skin}/body`, { ...look, shape: 0 }), claw(`crab/${skin}/claw`, look.claw, null), leg(`crab/${skin}/leg`, look.leg, null), antenna(`crab/${skin}/antenna`, look.leg, null));
  }
  for (const d of diets) {
    out.push(claw(`crab/claw_${d}`, PAL.crab, d), leg(`crab/leg_${d}`, PAL.crab, d), antenna(`crab/antenna_${d}`, PAL.crab, d), carapace(d));
  }
  return out;
}
