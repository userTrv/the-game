/**
 * Icon and cover for the Yandex Games console, drawn from the game's own sprites.
 *   pnpm --filter @shellter/art run promo
 * Writes tools/yandex/promo/icon-512.png (512x512) and cover-800x470.png (800x470).
 * Requirements: not a screenshot, no frames or rounded corners, no UI and no text.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rnd, type Sprite } from '../art/src/kit';
import { spriteInner, svgToPng } from '../art/src/raster';
import { ALL_GROUPS } from '../art/src/sprites';

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'promo');
const byId = new Map(Object.values(ALL_GROUPS).flat().map((s) => [s.id, s]));

function spr(id: string): Sprite {
  const s = byId.get(id);
  if (!s) throw new Error(`no sprite ${id}`);
  return s;
}

/** A sprite placed like a Pixi sprite: its anchor at (x, y), scaled and rotated around it. */
function put(id: string, x: number, y: number, scale = 1, o: { rot?: number; flip?: boolean; opacity?: number } = {}): string {
  const s = spr(id);
  const sx = o.flip ? -scale : scale;
  const op = o.opacity !== undefined ? ` opacity="${o.opacity}"` : '';
  return `<g transform="translate(${x} ${y}) rotate(${o.rot ?? 0}) scale(${sx} ${scale}) translate(${-s.ax * s.w} ${-s.ay * s.h})"${op}>${spriteInner(s)}</g>`;
}

/** The hero as the game assembles it (see apps/client/src/gfx/crabView.ts), origin at its feet. */
function hero(shell: string, tier: number, tenants: { id: string; star: number; slot: number }[]): string {
  const k = 0.82;
  const shellScale = 0.6 + 0.085 * tier;
  const sh = spr(`shell/${shell}`);
  const slots = (sh.meta?.slots as { x: number; y: number; rot: number }[]).map((p) => ({ x: p.x - sh.w * sh.ax, y: p.y - sh.h * sh.ay, rot: p.rot }));
  const placed = tenants.map((t) => {
    const slot = slots[t.slot]!;
    const base = shellScale * (0.62 + 0.17 * (t.star - 1));
    const aura = t.star > 1 ? put('fx/dot', 0, -14 * base, (t.star === 3 ? 1.5 : 1.15) * base, { opacity: 0.5 }) : '';
    return { y: slot.y, svg: `<g transform="translate(${slot.x * shellScale} ${slot.y * shellScale}) rotate(${slot.rot})">${aura}${put(`tenant/${t.id}`, 0, 0, base)}</g>` };
  });
  placed.sort((a, b) => a.y - b.y);
  const legs = [0, 1, 2].map((i) => put('crab/hermit/leg', -2 + i * 8, -9, k, { rot: (i - 1) * 9 })).join('');
  return (
    put('fx/shadow', -6, 2, 0.5 + 0.06 * tier, { opacity: 0.8 }) +
    `<g transform="translate(2 -10)">${put(`shell/${shell}`, 0, 0, shellScale)}${placed.map((p) => p.svg).join('')}</g>` +
    legs +
    put('crab/hermit/antenna', 18, -22, k, { rot: -6 }) +
    put('crab/hermit/body', 8, 0, k) +
    put('crab/hermit/claw', 20, -7, k, { rot: -8 })
  );
}

/** Deep water: lagoon gradient, a lit patch, light shafts, drifting motes. */
function water(w: number, h: number, light: { x: number; y: number; r: number }, seed: number): string {
  const motes = Array.from({ length: Math.round((w * h) / 2600) }, (_, i) => {
    const x = rnd(seed + i * 3) * w;
    const y = rnd(seed + i * 3 + 1) * h;
    const r = 0.8 + rnd(seed + i * 3 + 2) * 2.2;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="#c6fff4" opacity="${(0.12 + rnd(seed + i * 7) * 0.4).toFixed(2)}"/>`;
  }).join('');
  const rays = [0.18, 0.42, 0.63, 0.86]
    .map((t, i) => {
      const x = t * w;
      const spread = w * (0.05 + 0.03 * (i % 2));
      return `<path d="M${x - spread * 0.4} 0 L${x + spread * 0.4} 0 L${x + spread * 2.2 - w * 0.12} ${h} L${x - spread * 1.2 - w * 0.12} ${h} Z" fill="url(#ray)"/>`;
    })
    .join('');
  return (
    `<defs>` +
    `<linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#127c8a"/><stop offset="0.55" stop-color="#0b4258"/><stop offset="1" stop-color="#061a2c"/></linearGradient>` +
    `<radialGradient id="lit" cx="${light.x / w}" cy="${light.y / h}" r="${light.r / Math.max(w, h)}" gradientUnits="objectBoundingBox"><stop offset="0" stop-color="#8ff5e0" stop-opacity="0.42"/><stop offset="0.5" stop-color="#39c6b8" stop-opacity="0.16"/><stop offset="1" stop-color="#39c6b8" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="ray" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d8fff0" stop-opacity="0.16"/><stop offset="1" stop-color="#d8fff0" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f6f78" stop-opacity="0"/><stop offset="1" stop-color="#1c4a58" stop-opacity="0.9"/></linearGradient>` +
    `</defs>` +
    `<rect width="${w}" height="${h}" fill="url(#sea)"/>${rays}<rect width="${w}" height="${h}" fill="url(#lit)"/>${motes}`
  );
}

function svg(w: number, h: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}

const HERO = hero('conch', 2, [
  { id: 'anemone', star: 2, slot: 0 },
  { id: 'glow_shroom', star: 1, slot: 1 },
  { id: 'starfish', star: 1, slot: 3 },
  { id: 'kelp', star: 2, slot: 5 },
  { id: 'brain_coral', star: 1, slot: 7 },
  { id: 'sea_sparkle', star: 1, slot: 9 },
]);

// --- Icon: the hero alone, large and centred ---------------------------------------------------
const icon = svg(
  512,
  512,
  water(512, 512, { x: 256, y: 250, r: 300 }, 11) +
    `<path d="M0 452 Q128 420 256 436 T512 430 L512 512 L0 512 Z" fill="url(#floor)"/>` +
    put('fx/bubble', 96, 118, 1.6, { opacity: 0.7 }) +
    put('fx/bubble', 70, 170, 1.0, { opacity: 0.55 }) +
    put('fx/bubble', 430, 96, 1.2, { opacity: 0.6 }) +
    `<g transform="translate(276 372) scale(3.7)">${HERO}</g>`,
);

// --- Cover: the hero on the reef with pool creatures around ------------------------------------
const cover = svg(
  800,
  470,
  water(800, 470, { x: 400, y: 250, r: 460 }, 29) +
    `<path d="M0 404 Q160 380 330 396 T620 390 T800 384 L800 470 L0 470 Z" fill="url(#floor)"/>` +
    put('decor/fan_coral', 92, 452, 1.5) +
    put('decor/glow_weed', 728, 456, 1.6) +
    put('decor/rock_coral', 640, 466, 1.5) +
    put('decor/seagrass_tall', 168, 462, 1.3) +
    put('creature/moon_jelly', 150, 150, 1.7, { rot: -8 }) +
    put('creature/lantern_fry', 640, 160, 1.6, { flip: true }) +
    put('creature/puffer', 670, 300, 1.4, { flip: true }) +
    put('creature/plankton_spark', 250, 300, 1.4) +
    put('creature/plankton_spark', 560, 90, 1.1) +
    put('creature/baby_shrimp', 104, 330, 1.4, { rot: -10 }) +
    put('creature/sea_star', 262, 448, 1.3, { rot: 12 }) +
    put('fx/bubble', 300, 90, 1.4, { opacity: 0.7 }) +
    put('fx/bubble', 330, 50, 0.9, { opacity: 0.55 }) +
    put('fx/bubble', 470, 120, 1.1, { opacity: 0.6 }) +
    `<g transform="translate(410 420) scale(3.3)">${HERO}</g>`,
);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'icon-512.png'), svgToPng(icon, 512));
writeFileSync(join(outDir, 'cover-800x470.png'), svgToPng(cover, 800));
console.log(`written to ${outDir}`);
