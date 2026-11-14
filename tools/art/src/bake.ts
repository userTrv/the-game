import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { PNG } from 'pngjs';
import type { Sprite } from './kit';
import { ALL_GROUPS } from './sprites';

/**
 * Renders every sprite to pixels at 2x and packs them into texture atlases, one per group, so the
 * client can load the core atlas first and biome atlases lazily. Writes:
 *   apps/client/public/assets/atlas/<group>.png
 *   apps/client/src/assets/generated/manifest.json   (frames, anchors, sprite meta)
 *   tools/art/out/preview.html                       (style guide page with every sprite)
 */
const SCALE = 2;
const PAD = 2;
const MAX_W = 2048;

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const atlasDir = join(root, 'apps/client/public/assets/atlas');
const genDir = join(root, 'apps/client/src/assets/generated');
const outDir = join(root, 'tools/art/out');

interface Frame {
  atlas: string;
  x: number;
  y: number;
  w: number;
  h: number;
  ax: number;
  ay: number;
  meta?: Record<string, unknown>;
}

function render(s: Sprite): { w: number; h: number; data: Buffer } {
  const img = new Resvg(s.svg, { fitTo: { mode: 'zoom', value: SCALE }, font: { loadSystemFonts: false } }).render();
  return { w: img.width, h: img.height, data: Buffer.from(img.pixels) };
}

function pack(items: { id: string; w: number; h: number }[]): { pos: Map<string, { x: number; y: number }>; w: number; h: number } {
  const sorted = items.slice().sort((a, b) => b.h - a.h || b.w - a.w);
  const pos = new Map<string, { x: number; y: number }>();
  let x = PAD;
  let y = PAD;
  let rowH = 0;
  let maxX = 0;
  for (const it of sorted) {
    if (x + it.w + PAD > MAX_W) {
      x = PAD;
      y += rowH + PAD;
      rowH = 0;
    }
    pos.set(it.id, { x, y });
    x += it.w + PAD;
    rowH = Math.max(rowH, it.h);
    maxX = Math.max(maxX, x);
  }
  return { pos, w: maxX, h: y + rowH + PAD };
}

rmSync(atlasDir, { recursive: true, force: true });
mkdirSync(atlasDir, { recursive: true });
mkdirSync(genDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

const frames: Record<string, Frame> = {};
const atlases: Record<string, { image: string; w: number; h: number }> = {};
const seen = new Set<string>();
let totalBytes = 0;
let preview = '';

for (const [group, sprites] of Object.entries(ALL_GROUPS)) {
  const rendered = sprites.map((s) => {
    if (seen.has(s.id)) throw new Error(`duplicate sprite id: ${s.id}`);
    seen.add(s.id);
    return { s, r: render(s) };
  });
  const { pos, w, h } = pack(rendered.map(({ s, r }) => ({ id: s.id, w: r.w, h: r.h })));
  const png = new PNG({ width: w, height: h });
  png.data.fill(0);
  for (const { s, r } of rendered) {
    const p = pos.get(s.id)!;
    for (let row = 0; row < r.h; row++) {
      r.data.copy(png.data, ((p.y + row) * w + p.x) * 4, row * r.w * 4, (row + 1) * r.w * 4);
    }
    const frame: Frame = { atlas: group, x: p.x, y: p.y, w: r.w, h: r.h, ax: s.ax, ay: s.ay };
    if (s.meta) frame.meta = s.meta;
    frames[s.id] = frame;
  }
  const buf = PNG.sync.write(png, { deflateLevel: 9 });
  writeFileSync(join(atlasDir, `${group}.png`), buf);
  totalBytes += buf.length;
  atlases[group] = { image: `assets/atlas/${group}.png`, w, h };
  console.log(`${group}: ${sprites.length} sprites, ${w}x${h}, ${(buf.length / 1024).toFixed(0)} KB`);
  preview += `<h2>${group} <small>${sprites.length}</small></h2><div class="grid">${sprites
    .map((s) => `<figure>${s.svg}<figcaption>${s.id}</figcaption></figure>`)
    .join('')}</div>`;
}

writeFileSync(join(genDir, 'manifest.json'), JSON.stringify({ scale: SCALE, atlases, frames }));
writeFileSync(
  join(outDir, 'preview.html'),
  `<!doctype html><meta charset="utf-8"><title>Shellter sprites</title><style>
body{margin:0;padding:24px;font:14px system-ui;color:#fff;background:linear-gradient(#2aa7c9,#0f4f86 60%,#141a44)}
h2{margin:28px 0 10px;font-size:20px}small{opacity:.6;font-weight:400}
.grid{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end}
figure{margin:0;padding:8px;border-radius:12px;background:rgba(255,255,255,.08);text-align:center}
figcaption{font-size:10px;opacity:.75;margin-top:4px}
svg{display:block;margin:0 auto}</style><h1>Shellter — все спрайты</h1>${preview}`,
);
console.log(`total: ${seen.size} sprites, ${(totalBytes / 1024).toFixed(0)} KB`);
