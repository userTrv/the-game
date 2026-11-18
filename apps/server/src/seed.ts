import { botGhosts, BOT_STAGES } from '@shellter/shared';
import { sql } from 'drizzle-orm';
import { randomId } from './auth';
import type { Ctx } from './core';
import { ghosts } from './db/schema';
import { ensureSchedule } from './liveops';

export async function seedDev(ctx: Ctx): Promise<void> {
  await ensureSchedule(ctx);
  const have = await ctx.db.select({ stage: ghosts.stage }).from(ghosts).where(sql`${ghosts.playerId} is null`).groupBy(ghosts.stage);
  const seeded = new Set(have.map((h) => h.stage));
  const now = ctx.now();
  const rows: (typeof ghosts.$inferInsert)[] = [];
  // Every stage gets bots, so a camp always has a rival even before real players reach it.
  for (let stage = BOT_STAGES.from; stage <= BOT_STAGES.to; stage++) {
    if (seeded.has(stage)) continue;
    for (const g of botGhosts(stage)) rows.push({ id: randomId(), playerId: null, name: g.name, stage, power: g.power, build: g.build, createdAt: now });
  }
  if (rows.length > 0) await ctx.db.insert(ghosts).values(rows);
}
