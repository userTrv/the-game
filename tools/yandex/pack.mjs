// Checks a Yandex Games build and packs it into a zip for the developer console.
// Usage: node tools/yandex/pack.mjs <dist dir>
// Requirements checked: index.html in the root (1.22), ASCII names without spaces (1.22),
// at most 100 MB unpacked (1.21), no absolute games.s3.yandex.net URLs (1.7), no external scripts.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? 'dist-yandex');
const out = resolve(dir, '..', 'shellter-yandex.zip');
const problems = [];

function walk(d) {
  return readdirSync(d).flatMap((name) => {
    const p = join(d, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

if (!existsSync(join(dir, 'index.html'))) problems.push('index.html is missing in the archive root');
let total = 0;
for (const file of walk(dir)) {
  const rel = relative(dir, file);
  total += statSync(file).size;
  if (!/^[A-Za-z0-9._\-/]+$/.test(rel)) problems.push(`bad file name: ${rel}`);
  if (/\.(js|html|css)$/.test(rel)) {
    const text = readFileSync(file, 'utf8');
    if (text.includes('games.s3.yandex.net')) problems.push(`absolute games.s3.yandex.net URL in ${rel}`);
    for (const m of text.matchAll(/https:\/\/(t\.me|telegram\.org|sad\.adsgram\.ai)[^"'`\s)]*/g)) problems.push(`external link ${m[0]} in ${rel}`);
  }
}
if (total > 100 * 1024 * 1024) problems.push(`unpacked size ${(total / 1048576).toFixed(1)} MB is over 100 MB`);

if (problems.length > 0) {
  console.error(`Yandex build check failed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
rmSync(out, { force: true });
execFileSync('zip', ['-qr', '-X', out, '.'], { cwd: dir });
console.log(`${relative(process.cwd(), out)}: ${(statSync(out).size / 1048576).toFixed(1)} MB packed, ${(total / 1048576).toFixed(1)} MB unpacked`);
