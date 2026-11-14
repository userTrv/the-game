import {
  buildFighter, createRng, ratePower, SHELLS, slotCount, TENANTS, zeroDiets, DIETS,
  type BuildSnapshot, type TenantInst,
} from '@shellter/shared';
import { sql } from 'drizzle-orm';
import { randomId } from './auth';
import type { Ctx } from './core';
import { ghosts } from './db/schema';
import { ensureSchedule } from './liveops';

const NAMES = ['Клешня', 'Пузырёк', 'Рифовик', 'Шустрик', 'Барнакл', 'Коралыч', 'Pinchy', 'Bubbles', 'Reefer', 'Shelldon', 'Scuttle', 'Нептуша', 'Жемчуг', 'Тихоход', 'Crabby', 'Tide', 'Мидий', 'Finn'];

/** A plausible bot build for a guardian stage: one main family, some off-family picks, merged copies. */
export function botBuild(stage: number, seed: string): BuildSnapshot {
  const rng = createRng(seed);
  const size = Math.max(2, Math.round(1 + stage * 0.8 + rng.int(-1, 1)));
  const tier = Math.min(4, Math.floor((size - 1) / 2));
  const shells = SHELLS.filter((s) => !s.starter);
  const shell = { id: tier === 0 ? 'periwinkle' : rng.pick(shells).id, tier };
  const n = slotCount('hermit', shell);
  const main = rng.pick(DIETS);
  const genes = zeroDiets();
  for (const d of DIETS) genes[d] = rng.int(0, 4 + stage);
  genes[main] += 8 + stage * 3;
  const slots: (TenantInst | null)[] = [];
  const filled = Math.max(2, Math.min(n, 2 + Math.floor(stage / 2) + rng.int(-1, 0)));
  for (let i = 0; i < n; i++) {
    if (i >= filled) {
      slots.push(null);
      continue;
    }
    const pool = TENANTS.filter((t) => (rng.chance(0.65) ? t.families.includes(main) : true) && t.rarity <= (stage >= 9 ? 3 : 2));
    const star = rng.chance(Math.min(0.6, stage * 0.05)) ? (stage >= 9 && rng.chance(0.25) ? 3 : 2) : 1;
    slots.push({ id: rng.pick(pool.length > 0 ? pool : TENANTS).id, star });
  }
  return { heroId: 'hermit', size, genes, mutations: {}, shell, slots };
}

export async function seedDev(ctx: Ctx): Promise<void> {
  await ensureSchedule(ctx);
  const [have] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(ghosts).where(sql`${ghosts.playerId} is null`);
  if ((have?.n ?? 0) > 0) return;
  const now = ctx.now();
  const rows: (typeof ghosts.$inferInsert)[] = [];
  for (const stage of [6, 9, 15, 18, 21]) {
    for (let i = 0; i < 16; i++) {
      const build = botBuild(stage, `bot/${stage}/${i}`);
      const name = `${NAMES[(i + stage) % NAMES.length]}`;
      rows.push({ id: randomId(), playerId: null, name, stage, power: ratePower(buildFighter(build)), build: { ...build, name }, createdAt: now });
    }
  }
  await ctx.db.insert(ghosts).values(rows);
}
