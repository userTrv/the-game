import { Art, arcPoints, blob, curve, darken, DIET, lighten, PAL, spikes, type Diet, type Sprite } from '../kit';

// --- Resource nodes ------------------------------------------------------------------------------

function oyster(open: boolean): Sprite {
  const a = new Art(52, 46, 2.2);
  const c = '#b9a8d9';
  if (open) {
    a.path(blob([[6, 24], [10, 8], [26, 2], [42, 8], [46, 24], [26, 20]]), c);
    for (const x of [14, 20, 26, 32, 38]) a.line(curve([[26, 20], [(26 + x) / 2, 10], [x, 6 + Math.abs(x - 26) * 0.3]]), darken(c, 0.3), 1.6, { outline: false, opacity: 0.5 });
    a.path(blob([[6, 30], [26, 24], [46, 30], [42, 40], [26, 44], [10, 40]]), '#ffe9f4');
    a.glow(26, 30, 14, '#ffffff', 0.9);
    a.circle(26, 31, 6, PAL.pearl);
    a.hi(24, 28.5, 2.2, 1.2);
  } else {
    a.path(blob([[6, 28], [10, 16], [26, 10], [42, 16], [46, 28], [42, 38], [26, 42], [10, 38]]), c);
    for (const x of [14, 20, 26, 32, 38]) a.line(curve([[26, 30], [(26 + x) / 2, 20], [x, 14 + Math.abs(x - 26) * 0.3]]), darken(c, 0.3), 1.6, { outline: false, opacity: 0.5 });
    a.line(curve([[7, 29], [26, 33], [45, 29]]), '#2a2140', 2, { outline: false });
    a.hi(17, 17, 6, 2.2);
  }
  return a.done(open ? 'node/oyster_open' : 'node/oyster', { ax: 0.5, ay: 0.88 });
}

function coralNode(): Sprite {
  const a = new Art(52, 50, 2.2);
  const c = PAL.coral;
  const br = (x1: number, y1: number, x2: number, y2: number, w: number): void => {
    a.line(curve([[x1, y1], [(x1 + x2) / 2, (y1 + y2) / 2 + 2], [x2, y2]]), c, w);
    a.circle(x2, y2, w * 0.6, lighten(c, 0.3), { sw: 1.2 });
  };
  br(26, 44, 10, 22, 6);
  br(26, 44, 42, 20, 6);
  br(26, 44, 26, 8, 7);
  br(15, 31, 6, 12, 4);
  br(37, 30, 46, 8, 4);
  br(26, 24, 17, 6, 4);
  a.path(blob([[12, 47], [16, 40], [26, 38], [36, 40], [40, 47]]), darken(c, 0.2));
  return a.done('node/coral', { ax: 0.5, ay: 0.92 });
}

function glitter(): Sprite {
  const a = new Art(48, 48, 2.2);
  a.glow(24, 24, 24, PAL.shine, 0.8);
  a.path(spikes(24, 24, 7, 20, 4, 0), PAL.shine);
  a.path(spikes(24, 24, 4, 11, 4, 45), '#fff6c2', { sw: 1.4 });
  a.hi(20, 19, 3, 1.5);
  return a.done('node/glitter', { ax: 0.5, ay: 0.6 });
}

/** A killed creature becomes a tasty morsel the crab can always eat. */
function morsel(d: Diet): Sprite {
  const a = new Art(22, 22, 1.8);
  a.glow(11, 11, 11, DIET[d].light, 0.7);
  a.path(blob([[4, 12], [6, 5], [13, 4], [18, 9], [16, 16], [8, 18]]), DIET[d].base);
  a.hi(9, 8, 2.4, 1.2);
  return a.done(`fx/morsel_${d}`);
}

// --- Icons ---------------------------------------------------------------------------------------

function icon(id: string, draw: (a: Art) => void): Sprite {
  const a = new Art(32, 32, 2);
  draw(a);
  return a.done(`icon/${id}`);
}

const DIET_GLYPH: Record<Diet, (a: Art) => void> = {
  sting: (a) => a.path('M18 3 L8 17 L15 17 L12 29 L24 13 L17 13 Z', DIET.sting.base),
  spike: (a) => a.path(spikes(16, 16, 6.5, 14, 7, -90), DIET.spike.base),
  glow: (a) => {
    a.glow(16, 16, 15, DIET.glow.light, 0.8);
    a.path(spikes(16, 16, 4.5, 13, 4, 0), DIET.glow.base);
  },
  armor: (a) => a.path('M16 3 L27 7 L26 18 Q24 26 16 30 Q8 26 6 18 L5 7 Z', DIET.armor.base),
  venom: (a) => {
    a.path('M16 3 Q26 16 24 22 Q22 29 16 29 Q10 29 8 22 Q6 16 16 3 Z', DIET.venom.base);
    a.hi(12.5, 19, 2, 3.4, 20);
  },
  soft: (a) => a.path('M16 29 C3 19 4 6 11 6 C14.5 6 16 9.5 16 9.5 C16 9.5 17.5 6 21 6 C28 6 29 19 16 29 Z', DIET.soft.base),
};

function iconSprites(): Sprite[] {
  const out: Sprite[] = [];
  for (const d of Object.keys(DIET) as Diet[]) out.push(icon(`diet_${d}`, DIET_GLYPH[d]));
  out.push(
    icon('pearl', (a) => {
      a.circle(16, 16, 11, PAL.pearl);
      a.spot(19, 20, 6, 4, '#d9c4ff', 0.5, -30);
      a.hi(12, 11, 3.6, 2);
    }),
    icon('coral', (a) => {
      a.line(curve([[16, 28], [9, 18], [7, 8]]), PAL.coral, 4.5);
      a.line(curve([[16, 28], [23, 18], [25, 7]]), PAL.coral, 4.5);
      a.line(curve([[16, 28], [16, 14], [16, 4]]), PAL.coral, 5);
      for (const [x, y] of [[7, 8], [25, 7], [16, 4]] as const) a.circle(x, y, 2.6, lighten(PAL.coral, 0.35), { sw: 1.2 });
    }),
    icon('shine', (a) => {
      a.glow(16, 16, 15, PAL.shine, 0.7);
      a.path(spikes(16, 16, 5, 14, 4, 0), PAL.shine);
      a.hi(13, 12, 2.2, 1.2);
    }),
    icon('heart', (a) => {
      DIET_GLYPH.soft(a);
      a.hi(11, 12, 2.6, 1.6);
    }),
    icon('life', (a) => {
      a.path(blob([[5, 18], [8, 9], [16, 5], [24, 9], [27, 18], [22, 26], [10, 26]]), PAL.shell);
      a.line(curve(arcPoints(16, 17, 6, 5, 200, 470, 7)), '#e0a878', 2, { outline: false });
      a.hi(11, 11, 3, 1.5);
    }),
    icon('trophy', (a) => {
      a.line(curve([[9, 9], [3, 11], [9, 17]]), PAL.shine, 2.4);
      a.line(curve([[23, 9], [29, 11], [23, 17]]), PAL.shine, 2.4);
      a.path('M8 5 L24 5 L23 15 Q16 23 9 15 Z', PAL.shine);
      a.path('M13 21 L19 21 L20 27 L12 27 Z', darken(PAL.shine, 0.2), { sw: 1.6 });
      a.hi(12, 9, 2, 3.4, 10);
    }),
    icon('star', (a) => {
      a.path(spikes(16, 17, 6, 13.5, 5, -90), PAL.shine);
      a.hi(13, 13, 2.2, 1.2);
    }),
    icon('stars', (a) => {
      a.glow(16, 16, 15, '#ffd76a', 0.6);
      a.path(spikes(16, 17, 6.5, 14, 5, -90), '#ffb02e');
      a.hi(13, 12.5, 2.4, 1.3);
    }),
    icon('power', (a) => {
      a.path(blob([[6, 20], [8, 10], [15, 5], [24, 7], [27, 13], [21, 15], [17, 20], [24, 21], [26, 25], [18, 28], [10, 27]]), PAL.crab);
      a.hi(13, 10, 3.4, 1.6);
    }),
    icon('front', (a) => {
      a.path('M16 3 L27 7 L26 18 Q24 26 16 30 Q8 26 6 18 L5 7 Z', '#ff9a5a');
      a.path('M11 14 L16 9 L21 14 M16 9 L16 22', '#ffffff', { flat: true, stroke: '#ffffff', sw: 2.4 });
    }),
    icon('back', (a) => {
      a.circle(16, 16, 12, '#7fd6ff');
      a.path('M16 9 L16 23 M9 16 L23 16', '#ffffff', { flat: true, stroke: '#ffffff', sw: 3 });
    }),
    icon('lock', (a) => {
      a.line(curve([[10, 15], [10, 6], [22, 6], [22, 15]]), PAL.metal, 3);
      a.path('M6 14 L26 14 L26 28 L6 28 Z', PAL.metalDark);
      a.circle(16, 21, 2.6, '#2a2140', { flat: true, noStroke: true });
    }),
    icon('ad', (a) => {
      a.path('M4 8 L28 8 L28 25 L4 25 Z', '#8a6cff');
      a.path('M13 12 L21 16.5 L13 21 Z', '#ffffff', { sw: 1.4 });
    }),
    icon('bubble', (a) => {
      a.raw('<circle cx="16" cy="16" r="11" fill="#ffffff" opacity="0.18" stroke="#ffffff" stroke-width="1.6" stroke-opacity="0.75"/>');
      a.hi(12, 11, 3.2, 1.8, -30, 0.85);
    }),
    icon('claws', (a) => {
      a.path(blob([[5, 20], [8, 9], [18, 4], [27, 8], [26, 14], [18, 15], [14, 20]]), PAL.crab);
      a.path(blob([[9, 23], [18, 19], [26, 20], [24, 26], [13, 28]]), PAL.crabDark);
    }),
    icon('carapace', (a) => {
      a.path(blob([[4, 22], [7, 11], [16, 6], [25, 11], [28, 22], [16, 26]]), PAL.crab);
      a.line(curve([[9, 20], [16, 13], [23, 20]]), PAL.crabDark, 2, { outline: false });
      a.hi(11, 12, 3, 1.5);
    }),
    icon('legs', (a) => {
      for (const x of [8, 16, 24]) {
        a.path(blob([[x - 3, 5], [x + 2, 4], [x + 4, 12], [x, 15]]), PAL.crab, { sw: 1.6 });
        a.path(blob([[x - 1, 13], [x + 4, 13], [x + 5, 27], [x + 1, 27]]), PAL.crabDark, { sw: 1.6 });
      }
    }),
    icon('antennae', (a) => {
      a.line(curve([[14, 28], [10, 16], [4, 6]]), PAL.crab, 2.6);
      a.line(curve([[18, 28], [22, 16], [28, 6]]), PAL.crab, 2.6);
      a.circle(4, 6, 2.4, PAL.crabLight, { sw: 1.1 });
      a.circle(28, 6, 2.4, PAL.crabLight, { sw: 1.1 });
    }),
  );
  return out;
}

// --- Particles (white, tinted at runtime) --------------------------------------------------------

function fxSprites(): Sprite[] {
  const dot = new Art(32, 32);
  dot.glow(16, 16, 16, '#ffffff', 1);
  const spark = new Art(32, 32);
  spark.raw('<path d="M16 1 L19 13 L31 16 L19 19 L16 31 L13 19 L1 16 L13 13 Z" fill="#fff"/>');
  const ring = new Art(64, 64);
  ring.raw('<circle cx="32" cy="32" r="27" fill="none" stroke="#fff" stroke-width="5"/>');
  const bubble = new Art(24, 24);
  bubble.raw('<circle cx="12" cy="12" r="9.5" fill="#fff" fill-opacity="0.12" stroke="#fff" stroke-width="1.6" stroke-opacity="0.8"/><ellipse cx="8.6" cy="8" rx="2.6" ry="1.5" fill="#fff" opacity="0.9" transform="rotate(-35 8.6 8)"/>');
  const shadow = new Art(64, 24);
  shadow.raw(`<ellipse cx="32" cy="12" rx="30" ry="10" fill="${shadow.glowFill('#0a1030', 0.55)}"/>`);
  const bolt = new Art(48, 16);
  bolt.raw('<path d="M1 9 L12 4 L18 10 L28 3 L34 9 L47 6" fill="none" stroke="#fff" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"/>');
  const slash = new Art(48, 48);
  slash.raw('<path d="M6 40 Q20 8 44 6 Q28 20 6 40 Z" fill="#fff"/>');
  const ray = new Art(64, 64);
  ray.raw(`<path d="${spikes(32, 32, 8, 31, 10, 0)}" fill="#fff" opacity="0.9"/>`);
  const shield = new Art(64, 64);
  shield.raw('<circle cx="32" cy="32" r="28" fill="#fff" fill-opacity="0.16" stroke="#fff" stroke-width="3" stroke-opacity="0.85"/><path d="M14 22 Q24 10 38 10" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity="0.9"/>');
  return [dot.done('fx/dot'), spark.done('fx/spark'), ring.done('fx/ring'), bubble.done('fx/bubble'), shadow.done('fx/shadow'), bolt.done('fx/bolt', { ax: 0, ay: 0.5 }), slash.done('fx/slash'), ray.done('fx/ray'), shield.done('fx/shield')];
}

// --- Arena decor ---------------------------------------------------------------------------------

function decorSprites(): Record<'lagoon' | 'wreck' | 'abyss', Sprite[]> {
  const rock = (id: string, c: string, moss: string | null): Sprite => {
    const a = new Art(84, 60, 2.6);
    a.path(blob([[4, 54], [8, 30], [24, 12], [48, 8], [70, 22], [80, 54]], 0.6), c);
    a.path(blob([[30, 56], [36, 34], [52, 28], [66, 40], [70, 56]], 0.6), lighten(c, 0.12), { sw: 2 });
    if (moss) for (const [x, y, r] of [[18, 22, 7], [34, 12, 8], [54, 12, 6], [66, 24, 5]] as const) a.circle(x, y, r, moss, { sw: 1.6 });
    a.hi(26, 22, 9, 3.5, -20, 0.4);
    return a.done(`decor/${id}`, { ax: 0.5, ay: 0.9 });
  };
  const weed = (id: string, c: string, glowC?: string): Sprite => {
    const a = new Art(48, 76, 2.2);
    for (const [x, top, lean] of [[14, 22, -6], [34, 16, 6], [24, 4, 2]] as const) {
      a.path(blob([[x - 4, 72], [x - 5 + lean * 0.4, 46], [x + lean, top], [x + 5 + lean * 0.6, 46], [x + 4, 72]], 0.7), c);
      if (glowC) {
        a.glow(x + lean, top + 2, 10, glowC, 0.9);
        a.circle(x + lean, top + 2, 3, glowC, { sw: 1.1 });
      }
    }
    return a.done(`decor/${id}`, { ax: 0.5, ay: 0.95 });
  };
  const fanCoral = (): Sprite => {
    const a = new Art(70, 70, 2.4);
    for (let i = 0; i < 7; i++) {
      const ang = Math.PI + 0.3 + (i / 6) * (Math.PI - 0.6);
      a.line(curve([[35, 62], [35 + Math.cos(ang) * 18, 60 + Math.sin(ang) * 24], [35 + Math.cos(ang) * 30, 60 + Math.sin(ang) * 54]]), i % 2 ? '#ff8fb8' : '#ff6a88', 5);
    }
    a.path(blob([[22, 66], [26, 58], [44, 58], [48, 66]]), '#c94f7a');
    return a.done('decor/fan_coral', { ax: 0.5, ay: 0.93 });
  };
  const plank = (): Sprite => {
    const a = new Art(110, 46, 2.6);
    a.group('rotate(-8 55 23)', () => {
      a.path('M6 12 L104 12 L100 34 L10 34 Z', PAL.wood);
      for (const x of [34, 66]) a.line(`M${x} 12 L${x - 2} 34`, PAL.woodDark, 2, { outline: false });
      for (const x of [16, 50, 86]) a.circle(x, 22, 2.4, PAL.metalDark, { sw: 1.2 });
      a.hi(40, 16, 22, 1.6, 0, 0.3);
    });
    return a.done('decor/plank', { ax: 0.5, ay: 0.7 });
  };
  const anchor = (): Sprite => {
    const a = new Art(70, 86, 2.6);
    a.raw('<circle cx="35" cy="12" r="8" fill="none" stroke="#2b2140" stroke-width="9"/><circle cx="35" cy="12" r="8" fill="none" stroke="#9fb3c8" stroke-width="4.5"/>');
    a.line('M35 20 L35 74', PAL.metal, 6);
    a.line('M20 32 L50 32', PAL.metal, 5);
    a.line(curve([[8, 54], [18, 74], [35, 78], [52, 74], [62, 54]]), PAL.metal, 6);
    for (const [x, y] of [[8, 54], [62, 54]] as const) a.path(`M${x - 7} ${y + 4} L${x} ${y - 9} L${x + 7} ${y + 4} Z`, PAL.metal, { sw: 2 });
    for (const [x, y, r] of [[30, 44, 4], [40, 62, 3.4], [50, 70, 3]] as const) a.circle(x, y, r, '#6fbf8a', { sw: 1.2 });
    return a.done('decor/anchor', { ax: 0.5, ay: 0.92 });
  };
  const barrel = (): Sprite => {
    const a = new Art(64, 64, 2.6);
    a.path(blob([[10, 14], [32, 8], [54, 14], [58, 34], [54, 54], [32, 60], [10, 54], [6, 34]], 0.5), PAL.wood);
    for (const y of [20, 46]) a.line(curve([[9, y], [32, y + 4], [55, y]]), PAL.metalDark, 4, { outline: false });
    for (const x of [22, 42]) a.line(curve([[x, 11], [x - 2 + (x > 32 ? 4 : 0), 34], [x, 57]]), PAL.woodDark, 1.6, { outline: false });
    a.hi(20, 28, 3, 12, 0, 0.3);
    return a.done('decor/barrel', { ax: 0.5, ay: 0.9 });
  };
  const vent = (): Sprite => {
    const a = new Art(64, 84, 2.6);
    a.glow(32, 22, 26, '#ff9a5a', 0.6);
    a.path(blob([[10, 80], [16, 44], [24, 24], [40, 24], [48, 44], [54, 80]], 0.5), '#4a4470');
    a.ell(32, 25, 9, 4, '#ff7a3d', { sw: 2 });
    a.glow(32, 24, 10, '#ffe08a', 0.9);
    for (const [x, y, r] of [[26, 14, 4], [36, 8, 3], [30, 2, 2]] as const) a.raw(`<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="0.35"/>`);
    a.hi(22, 46, 3, 10, 14, 0.25);
    return a.done('decor/vent', { ax: 0.5, ay: 0.95 });
  };
  const crystal = (): Sprite => {
    const a = new Art(64, 72, 2.4);
    a.glow(32, 36, 34, '#7be3ff', 0.55);
    for (const [x, top, w, col] of [[18, 26, 9, '#6b8cff'], [46, 22, 9, '#b98cff'], [32, 6, 12, '#7be3ff']] as const) {
      a.path(`M${x - w} 66 L${x - w * 0.7} ${top + 12} L${x} ${top} L${x + w * 0.7} ${top + 12} L${x + w} 66 Z`, col, { opacity: 0.92 });
      a.hi(x - w * 0.3, top + 22, 1.6, 9, 8, 0.6);
    }
    return a.done('decor/crystal', { ax: 0.5, ay: 0.93 });
  };
  const bones = (): Sprite => {
    const a = new Art(90, 56, 2.4);
    for (let i = 0; i < 5; i++) a.line(curve([[16 + i * 14, 50], [14 + i * 14, 26], [24 + i * 14, 8 + Math.abs(i - 2) * 5]]), PAL.bone, 5);
    a.line('M8 50 L82 48', PAL.bone, 6);
    return a.done('decor/bones', { ax: 0.5, ay: 0.92 });
  };
  return {
    lagoon: [rock('rock_sand', '#c9b28a', '#7ed08a'), rock('rock_coral', '#e89a8a', '#ffd0a8'), weed('seagrass', '#4fc48a'), weed('seagrass_tall', '#7ad06a'), fanCoral()],
    wreck: [rock('rock_dark', '#7a84a6', '#5aa08a'), plank(), anchor(), barrel(), weed('kelp_dark', '#3f8f7a')],
    abyss: [rock('rock_abyss', '#3f3f72', null), vent(), crystal(), bones(), weed('glow_weed', '#2a6f8f', '#7bffe0')],
  };
}

// --- Town buildings ------------------------------------------------------------------------------

function buildingSprites(): Sprite[] {
  const W = 120;
  const H = 124;
  const base = (a: Art, c: string): void => {
    a.raw(`<ellipse cx="60" cy="112" rx="52" ry="9" fill="#0a1030" opacity="0.28"/>`);
    a.path(blob([[10, 112], [18, 100], [60, 96], [102, 100], [110, 112], [60, 118]]), c, { sw: 2.6 });
  };
  const door = (a: Art, x: number, y: number, w: number, h: number): void => {
    a.path(`M${x - w / 2} ${y} L${x - w / 2} ${y - h * 0.6} Q${x} ${y - h * 1.15} ${x + w / 2} ${y - h * 0.6} L${x + w / 2} ${y} Z`, '#3a2d5c', { sw: 2.2 });
    a.glow(x, y - h * 0.4, w * 0.6, '#ffe08a', 0.55);
  };
  const window = (a: Art, x: number, y: number, r: number): void => {
    a.circle(x, y, r, '#ffe9a8', { sw: 2 });
    a.glow(x, y, r * 1.8, '#ffe08a', 0.5);
    a.hi(x - r * 0.3, y - r * 0.3, r * 0.35, r * 0.2, -30, 0.9);
  };
  const out: Sprite[] = [];
  const mk = (id: string, fn: (a: Art) => void): void => {
    const a = new Art(W, H, 2.8);
    fn(a);
    out.push(a.done(`building/${id}`, { ax: 0.5, ay: 0.92 }));
  };
  mk('lighthouse', (a) => {
    base(a, PAL.sand);
    a.glow(60, 22, 34, '#fff3a8', 0.75);
    a.path('M40 104 L48 34 L72 34 L80 104 Z', '#fff4ea');
    for (const y of [50, 78]) a.path(`M${46.5 - (y - 34) * 0.115} ${y} L${73.5 + (y - 34) * 0.115} ${y} L${74.6 + (y - 34) * 0.115} ${y + 12} L${45.4 - (y - 34) * 0.115} ${y + 12} Z`, '#ff6a55', { sw: 2 });
    a.path('M44 34 L76 34 L72 14 L48 14 Z', '#7be3ff', { opacity: 0.9 });
    a.circle(60, 24, 6, '#fff6c2', { sw: 2 });
    a.path('M42 14 L60 2 L78 14 Z', '#ff6a55');
    door(a, 60, 104, 14, 18);
  });
  mk('garden', (a) => {
    base(a, '#8ad6a0');
    a.path(blob([[14, 104], [16, 70], [36, 48], [60, 42], [84, 48], [104, 70], [106, 104]], 0.5), '#bff4e0', { opacity: 0.6 });
    for (const [x, c] of [[30, DIET.sting.base], [46, DIET.soft.base], [62, DIET.glow.base], [78, DIET.spike.base], [92, DIET.venom.base]] as const) {
      a.line(curve([[x, 104], [x - 3, 88], [x, 74]]), '#3f9a6a', 3.4);
      a.circle(x, 70, 8, c);
      a.hi(x - 2.5, 67, 2.4, 1.3);
    }
    a.hi(34, 60, 12, 4, -30, 0.5);
  });
  mk('lab', (a) => {
    base(a, PAL.rock);
    a.path(blob([[14, 106], [18, 60], [40, 34], [70, 30], [96, 50], [106, 106]], 0.5), PAL.rockDark);
    a.path(blob([[36, 106], [38, 76], [60, 60], [82, 76], [84, 106]], 0.5), '#2a2140', { sw: 2.4 });
    a.glow(60, 86, 26, DIET.venom.base, 0.7);
    a.path(blob([[50, 100], [52, 84], [56, 80], [56, 72], [64, 72], [64, 80], [68, 84], [70, 100]], 0.3), '#d8f5c8', { sw: 2, opacity: 0.9 });
    a.path(blob([[52, 99], [53, 90], [67, 90], [68, 99]], 0.3), DIET.venom.base, { sw: 1.4 });
    for (const [x, y, r] of [[58, 66, 3], [63, 58, 2.2], [59, 52, 1.6]] as const) a.raw(`<circle cx="${x}" cy="${y}" r="${r}" fill="${DIET.venom.light}" opacity="0.9"/>`);
    a.hi(32, 50, 10, 4, -35, 0.3);
  });
  mk('workshop', (a) => {
    base(a, PAL.sand);
    a.path(blob([[16, 106], [14, 70], [28, 46], [52, 34], [78, 38], [98, 56], [106, 82], [102, 106]], 0.5), '#ffb37a');
    for (const r of [34, 22, 10]) a.line(curve(arcPoints(62, 74, r, r * 0.86, 185, 335, 6)), '#fff0d8', 5, { outline: false, opacity: 0.8 });
    door(a, 62, 106, 22, 28);
    a.path('M82 30 L98 22 L100 30 L86 38 Z', PAL.metal, { sw: 2 });
    a.line('M86 34 L76 54', PAL.wood, 4);
    a.hi(36, 54, 12, 4.5, -30);
  });
  mk('hatchery', (a) => {
    base(a, '#f0c8d8');
    for (const [x, y, r, c] of [[38, 84, 22, '#ffd3e3'], [82, 86, 20, '#c6fff4'], [60, 66, 28, '#fff6e0']] as const) {
      a.ell(x, y, r * 0.82, r, c);
      a.hi(x - r * 0.3, y - r * 0.45, r * 0.22, r * 0.12, -30, 0.8);
    }
    a.path('M46 60 L52 66 L58 58 L64 67 L70 60 L74 66', '#2a2140', { flat: true, sw: 2.2, stroke: '#2a2140' });
    a.eye(54, 76, 4.4, { dx: 0.3 });
    a.eye(67, 76, 4.4, { dx: 0.3 });
    a.mouth(60.5, 83, 5);
  });
  mk('corf', (a) => {
    base(a, PAL.sand);
    a.path(blob([[18, 106], [14, 78], [24, 58], [60, 50], [96, 58], [106, 78], [102, 106]], 0.5), PAL.wood);
    for (const x of [30, 45, 60, 75, 90]) a.line(curve([[x, 54 + Math.abs(x - 60) * 0.12], [x + (x - 60) * 0.1, 80], [x, 106]]), PAL.woodDark, 2.4, { outline: false });
    for (const y of [70, 92]) a.line(curve([[15 + (y - 70) * 0.1, y], [60, y + 6], [105 - (y - 70) * 0.1, y]]), '#e8c890', 4, { outline: false });
    a.ell(60, 54, 36, 9, '#3a2d5c', { sw: 2.4 });
    for (const [x, y] of [[44, 52], [60, 56], [76, 52], [52, 48], [68, 48]] as const) a.circle(x, y, 5, PAL.coral, { sw: 1.6 });
  });
  mk('school', (a) => {
    base(a, '#9fd6ff');
    a.path('M20 106 L20 66 L100 66 L100 106 Z', '#fff4ea');
    a.path('M12 68 L60 34 L108 68 Z', '#5b8cff');
    for (const x of [30, 46, 74, 90]) a.path(`M${x - 4} 104 L${x - 4} 74 L${x + 4} 74 L${x + 4} 104 Z`, '#e8f2ff', { sw: 1.8 });
    door(a, 60, 106, 16, 24);
    window(a, 60, 54, 6);
    a.line(curve([[84, 40], [96, 26], [108, 30]]), '#7be3ff', 3);
    a.line(curve([[88, 48], [100, 38], [112, 44]]), '#7be3ff', 2.4);
  });
  mk('almanac', (a) => {
    base(a, '#d9c4ff');
    a.path(blob([[18, 106], [18, 50], [30, 40], [90, 40], [102, 50], [102, 106]], 0.3), '#8a6cff');
    a.path('M28 100 L28 50 L92 50 L92 100 Z', '#fff6e0', { sw: 2 });
    a.line('M60 50 L60 100', '#d8c8a8', 2, { outline: false });
    a.path(spikes(44, 74, 5, 11, 5, -90), DIET.spike.base, { sw: 1.6 });
    a.path(blob([[68, 80], [70, 68], [78, 64], [86, 68], [88, 80], [78, 78]]), DIET.sting.base, { sw: 1.6 });
    a.path('M56 40 L64 40 L64 62 L60 57 L56 62 Z', '#ff6a55', { sw: 1.6 });
    a.hi(34, 46, 10, 2, 0, 0.4);
  });
  return out;
}

// --- Guardians -----------------------------------------------------------------------------------

function guardianSprites(): Sprite[] {
  const out: Sprite[] = [];
  // All face LEFT (toward the player's crab) in a 220x200 box, anchored at the bottom centre.
  const mk = (id: string, fn: (a: Art) => void): void => {
    const a = new Art(220, 200, 4);
    fn(a);
    out.push(a.done(`guardian/${id}`, { ax: 0.5, ay: 0.92 }));
  };

  mk('moray', (a) => {
    const c = '#5fbf7a';
    a.path(blob([[150, 190], [190, 150], [196, 96], [170, 60], [128, 54], [96, 78], [100, 108], [130, 104], [150, 120], [140, 160], [110, 190]], 0.7), c);
    for (const [x, y, r] of [[170, 100, 9], [160, 140, 8], [176, 128, 6], [150, 80, 7], [182, 86, 5]] as const) a.spot(x, y, r, r * 0.8, darken(c, 0.25), 0.55);
    a.path(blob([[128, 54], [150, 30], [176, 44], [170, 62]]), lighten(c, 0.2), { sw: 3 });
    // Head.
    a.path(blob([[26, 104], [44, 70], [84, 56], [120, 66], [132, 96], [116, 124], [76, 132], [42, 126]]), c);
    a.path('M28 106 L92 100 L80 124 L44 124 Z', '#3a1f3c', { flat: true, sw: 3 });
    for (const x of [38, 50, 62, 74]) a.path(`M${x - 4} 105 L${x} 116 L${x + 4} 104.5 Z`, '#fff', { flat: true, sw: 1.6 });
    for (const x of [48, 60, 72]) a.path(`M${x - 4} 124 L${x} 114 L${x + 4} 124 Z`, '#fff', { flat: true, sw: 1.6 });
    a.hi(84, 68, 16, 5, -12);
    a.eye(78, 84, 12, { dx: -0.5, angry: true });
  });

  mk('gate_crab', (a) => {
    const c = '#e8743a';
    for (const s of [-1, 1]) for (const k of [0, 1, 2]) a.line(curve([[110 + s * 44, 130], [110 + s * (76 + k * 8), 120 + k * 12], [110 + s * (84 + k * 9), 184]]), darken(c, 0.15), 9);
    a.path(blob([[36, 128], [48, 84], [110, 62], [172, 84], [184, 128], [160, 162], [60, 162]]), c);
    for (const [x, y] of arcPoints(110, 112, 62, 42, 205, 335, 6)) a.path(`M${x - 9} ${y + 6} L${x} ${y - 18} L${x + 9} ${y + 6} Z`, '#ffd38a', { sw: 3 });
    // Key-shaped lock on the belly: he is the gatekeeper.
    a.path(blob([[90, 150], [92, 128], [110, 120], [128, 128], [130, 150], [110, 158]]), '#ffd166', { sw: 3 });
    a.circle(110, 136, 6, '#3a2d5c', { flat: true, noStroke: true });
    a.path('M107 138 L113 138 L115 152 L105 152 Z', '#3a2d5c', { flat: true, noStroke: true });
    // Huge claws.
    for (const s of [-1, 1]) {
      const x = 110 + s * 78;
      a.path(blob([[x - 26, 78], [x - 30, 40], [x - 6, 18], [x + 22, 26], [x + 26, 52], [x + 8, 60], [x + 2, 84]]), lighten(c, 0.12));
      a.path(blob([[x - 20, 88], [x + 4, 76], [x + 26, 70], [x + 24, 92], [x, 104]]), darken(c, 0.1));
      a.hi(x - 10, 40, 10, 4, -30);
    }
    a.hi(84, 86, 20, 6, -14);
    a.eye(92, 104, 12, { dx: -0.4, angry: true });
    a.eye(128, 104, 12, { dx: -0.4, angry: true });
    a.mouth(110, 122, 14, -0.7);
  });

  mk('octopus', (a) => {
    const c = '#b06cff';
    const arms: [number, number][][] = [
      [[70, 130], [30, 150], [14, 186]], [[90, 140], [60, 170], [58, 192]], [[110, 144], [110, 176], [96, 194]],
      [[130, 142], [150, 172], [140, 194]], [[150, 134], [186, 156], [182, 190]], [[156, 118], [200, 120], [212, 150]],
      [[66, 116], [20, 112], [8, 136]],
    ];
    arms.forEach((p, i) => a.line(curve(p), i % 2 ? lighten(c, 0.15) : c, 16));
    arms.forEach((p) => {
      for (const t of [0.35, 0.6, 0.85]) {
        const x = p[0]![0] + (p[2]![0] - p[0]![0]) * t;
        const y = p[0]![1] + (p[2]![1] - p[0]![1]) * t + 4;
        a.spot(x, y, 3, 3, '#ffd3f0', 0.8);
      }
    });
    a.path(blob([[56, 120], [50, 70], [76, 30], [116, 20], [152, 36], [170, 76], [162, 122], [110, 142]]), c);
    for (const [x, y, r] of [[80, 52, 9], [130, 44, 11], [150, 78, 7], [104, 36, 6]] as const) a.spot(x, y, r, r * 0.8, lighten(c, 0.3), 0.5);
    a.hi(84, 40, 18, 7, -30);
    a.eye(86, 96, 15, { dx: -0.4, angry: true });
    a.eye(128, 96, 15, { dx: -0.4, angry: true });
    a.path(blob([[98, 118], [106, 112], [116, 118], [107, 126]]), '#3a1f3c', { flat: true, sw: 3 });
    // Ink puff.
    for (const [x, y, r] of [[30, 60, 14], [18, 80, 10], [40, 80, 8]] as const) a.raw(`<circle cx="${x}" cy="${y}" r="${r}" fill="#2a2140" opacity="0.55"/>`);
  });

  mk('angler', (a) => {
    const c = '#3d4a8f';
    a.glow(52, 34, 46, '#aaffee', 0.9);
    a.path(blob([[190, 96], [214, 66], [208, 100], [216, 134]]), lighten(c, 0.15), { sw: 3 });
    a.path(blob([[120, 44], [150, 14], [176, 48]]), lighten(c, 0.15), { sw: 3 });
    a.path(blob([[30, 110], [44, 60], [96, 36], [156, 44], [194, 88], [190, 136], [150, 172], [84, 176], [42, 152]]), c);
    a.path(blob([[60, 150], [100, 140], [150, 146], [170, 156], [150, 172], [84, 176]]), lighten(c, 0.2), { noStroke: true, flat: true, opacity: 0.5 });
    // Lure.
    a.line(curve([[110, 40], [96, 6], [56, 16], [52, 30]]), darken(c, 0.2), 5);
    a.circle(52, 34, 11, '#d6fff6', { sw: 3 });
    a.glow(52, 34, 20, '#ffffff', 0.8);
    // Mouth with needle teeth.
    a.path(blob([[30, 112], [70, 96], [116, 104], [120, 130], [84, 152], [44, 146]]), '#2a1438', { flat: true, sw: 3.4 });
    for (let i = 0; i < 7; i++) a.path(`M${38 + i * 11} ${103 + (i % 2) * 2 + i * 0.6} L${42 + i * 11} ${126} L${47 + i * 11} ${103 + i * 0.6} Z`, '#fff', { flat: true, sw: 1.6 });
    for (let i = 0; i < 6; i++) a.path(`M${46 + i * 11} 148 L${50 + i * 11} 128 L${55 + i * 11} 146 Z`, '#fff', { flat: true, sw: 1.6 });
    for (const [x, y] of [[150, 70], [170, 96], [160, 124], [136, 60]] as const) {
      a.glow(x, y, 9, '#7bffe0', 0.9);
      a.spot(x, y, 3, 3, '#c6fff4', 1);
    }
    a.hi(96, 52, 22, 6, -8, 0.35);
    a.eye(96, 78, 12, { dx: -0.5, angry: true });
  });

  mk('kraken', (a) => {
    const c = '#e0495a';
    const arms: [number, number][][] = [
      [[60, 130], [22, 120], [10, 70], [34, 50]], [[80, 150], [40, 170], [30, 196]], [[104, 156], [100, 180], [84, 198]],
      [[128, 156], [140, 180], [160, 196]], [[150, 148], [190, 164], [204, 192]], [[160, 128], [200, 116], [210, 66], [186, 48]],
    ];
    arms.forEach((p, i) => a.line(curve(p), i % 2 ? lighten(c, 0.12) : c, 18));
    a.path(blob([[56, 134], [52, 84], [70, 36], [110, 8], [150, 36], [168, 84], [164, 134], [110, 158]]), c);
    a.path(blob([[70, 36], [50, 20], [56, 54]]), lighten(c, 0.15), { sw: 3 });
    a.path(blob([[150, 36], [170, 20], [164, 54]]), lighten(c, 0.15), { sw: 3 });
    for (const [x, y, r] of [[86, 48, 9], [128, 40, 11], [146, 76, 7]] as const) a.spot(x, y, r, r * 0.8, lighten(c, 0.3), 0.5);
    a.hi(88, 36, 18, 7, -34);
    a.eye(86, 104, 17, { dx: -0.3, angry: true });
    a.eye(134, 104, 17, { dx: -0.3, angry: true });
    a.path(blob([[98, 132], [110, 124], [122, 132], [110, 142]]), '#3a1f3c', { flat: true, sw: 3 });
  });
  return out;
}

function logo(): Sprite {
  const a = new Art(96, 96, 3);
  a.glow(48, 48, 48, '#fff3a8', 0.5);
  a.path(blob([[14, 40], [20, 22], [40, 12], [62, 16], [78, 32], [82, 54], [72, 72], [50, 78], [30, 70], [18, 56]]), PAL.shell);
  for (const r of [26, 17, 8]) a.line(curve(arcPoints(50, 48, r, r * 0.86, 190, 330, 6)), '#e0a878', 4.5, { outline: false, opacity: 0.85 });
  a.path(blob([[52, 62], [66, 52], [84, 56], [86, 70], [74, 82], [58, 80]]), PAL.crab, { sw: 2.6 });
  a.eye(66, 52, 6.5, { dx: 0.4 });
  a.eye(80, 54, 6, { dx: 0.4 });
  a.mouth(74, 72, 6);
  a.hi(34, 26, 10, 4, -28);
  return a.done('ui/logo');
}

export function miscSprites(): { core: Sprite[]; decor: Record<'lagoon' | 'wreck' | 'abyss', Sprite[]>; big: Sprite[]; town: Sprite[] } {
  const diets = Object.keys(DIET) as Diet[];
  return {
    core: [oyster(false), oyster(true), coralNode(), glitter(), ...diets.map(morsel), ...iconSprites(), ...fxSprites(), logo()],
    decor: decorSprites(),
    big: guardianSprites(),
    town: buildingSprites(),
  };
}
