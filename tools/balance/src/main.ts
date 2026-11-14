import { writeFileSync } from 'node:fs';
import { HEROES } from '@shellter/shared';
import { POLICIES, PROFILES, summarize, type Summary } from './sim';

/**
 * Headless balance run: bots with different diets play hundreds of runs on three town presets.
 *   pnpm balance                 -> table in the console
 *   pnpm balance -- --runs 500   -> more runs per cell
 *   pnpm balance -- --md out.md  -> also writes a markdown report
 */
const args = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const runs = Number(arg('runs') ?? 200);
const md = arg('md');

const pct = (v: number | undefined): string => (v === undefined ? '—' : `${Math.round(v * 100)}%`);
const n1 = (v: number): string => v.toFixed(1);

function table(rows: Summary[], label: (s: Summary) => string, first: string): string {
  const head = `| ${first} | Ср. этап | Страж 3 | Страж 6 | Страж 9 | Страж 12 | Кораллы | Блеск | Размер | ★★ | ★★★ | Мутаций | Лучший набор |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|`;
  const body = rows
    .map((s) => `| ${label(s)} | ${n1(s.avgStage)} | ${pct(s.beat[3])} | ${pct(s.beat[6])} | ${pct(s.beat[9])} | ${pct(s.beat[12])} | ${Math.round(s.avgCoral)} | ${Math.round(s.avgShine)} | ${n1(s.avgSize)} | ${n1(s.avgMerges2)} | ${n1(s.avgMerges3)} | ${n1(s.avgMutations)} | ${n1(s.avgBestSet)} |`)
    .join('\n');
  return `${head}\n${body}`;
}

let report = '';
const section = (title: string, text: string): void => {
  report += `\n### ${title}\n\n${text}\n`;
};

const started = Date.now();
for (const profile of Object.keys(PROFILES)) {
  const rows = POLICIES.map((p) => summarize(p, profile, runs));
  section(`Город «${profile}», герой hermit, предел этапа ${rows[0]?.maxStage ?? '?'}`, table(rows, (s) => s.policy, 'Бот'));
  // Push-your-luck: what carrying out after each guardian is worth compared with going on.
  const omni = rows.find((r) => r.policy === 'omnivore');
  if (omni) {
    const lines = Object.entries(omni.bank).map(([stage, coral]) => `- после стража ${stage}: в среднем ${Math.round(coral)} кораллов в руках, дошли ${pct(omni.beat[Number(stage)])} забегов`);
    section(`Риск и вынос («${profile}», всеядный бот)`, lines.join('\n') || '—');
  }
}
const heroRows = HEROES.map((h) => summarize(POLICIES.find((p) => p.id === 'omnivore') ?? (POLICIES[0] as (typeof POLICIES)[number]), 'late', runs, h.id));
section('Герои (город «late», всеядный бот)', table(heroRows, (s) => s.hero, 'Герой'));

console.log(report);
console.log(`\n${runs} runs per cell, ${((Date.now() - started) / 1000).toFixed(1)} s`);
if (md) writeFileSync(md, report);
