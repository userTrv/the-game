import {
  applyQuestDeltas, applyRunAction, applyRunEnd, buildOf, eventScore, publicRun, questDeltasForRun, QUEST_BY_ID, ratePower,
  runConfigFor, runFighter, RunError, startRun, stageInfo, createRng, STAGES_PER_SEGMENT,
  type ClientRunAction, type Enemy, type PublicRun, type RunAction, type RunActionResponse, type RunEnded, type RunEvent,
  type RunState, type LiveEventConfig,
} from '@shellter/shared';
import { and, eq, gte, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { randomId } from './auth';
import { consumeAd } from './ads';
import { ApiFail, playerView, refreshPlayer, track, withPlayer, type Ctx, type PlayerRow } from './core';
import type { Tx } from './db';
import { ghosts, liveEvents, runs } from './db/schema';
import { addEventScore, currentEvent } from './liveops';

type RunRow = typeof runs.$inferSelect;

export async function activeRun(tx: Tx | Ctx['db'], playerId: string, slot = 0): Promise<RunRow | null> {
  const [row] = await tx.select().from(runs).where(and(eq(runs.playerId, playerId), eq(runs.slot, slot), eq(runs.status, 'active')));
  return row ?? null;
}

export async function activePublicRun(tx: Tx | Ctx['db'], playerId: string): Promise<PublicRun | null> {
  const row = await activeRun(tx, playerId);
  return row ? publicRun(row.state, row.seq) : null;
}

export async function startNewRun(ctx: Ctx, playerId: string, heroId: string, slot: number) {
  const now = ctx.now();
  return withPlayer(ctx, playerId, async (tx, row) => {
    if (slot >= row.perks.saveSlots) throw new ApiFail('slot_locked');
    if (await activeRun(tx, playerId, slot)) throw new ApiFail('run_active');
    const ev = await currentEvent(tx, now);
    let cfg;
    try {
      cfg = runConfigFor(row.profile, heroId, ev ? { id: ev.id, ...ev.config.modifier } : undefined);
    } catch {
      throw new ApiFail('hero_locked');
    }
    const id = randomId();
    const state = startRun(id, randomId(18), cfg);
    await tx.insert(runs).values({
      id, playerId, slot, state, status: 'active', seq: 0, huntStartedAt: now, startedAt: now, updatedAt: now,
      heroId, stageReached: 1, eventId: ev?.id ?? null,
    });
    if (row.profile.heroId !== heroId) row.profile = { ...row.profile, heroId };
    await track(tx, now, playerId, 'run_start', { hero: heroId, tutorial: cfg.tutorial, maxStage: cfg.maxStage });
    return { run: publicRun(state), player: await playerView(tx, row, now) };
  });
}

/** Picks an asynchronous rival for a guardian stage, or null for the regular guardian. */
async function pickGhost(tx: Tx, row: PlayerRow, state: RunState, stage: number): Promise<Extract<Enemy, { kind: 'ghost' }> | null> {
  const info = stageInfo(stage);
  if (info.kind !== 'guardian') return null;
  const bossStage = (stage / STAGES_PER_SEGMENT) % 4 === 0;
  if (stage < 6 || bossStage || row.profile.stats.runs < 2) return null;
  if (!createRng(`${state.seed}/ghost/${stage}`).chance(0.5)) return null;
  const power = ratePower(runFighter(state));
  const lo = Math.floor(power * 0.75);
  const hi = Math.ceil(power * 1.2);
  const [g] = await tx
    .select()
    .from(ghosts)
    .where(and(eq(ghosts.stage, stage), gte(ghosts.power, lo), lte(ghosts.power, hi), or(isNull(ghosts.playerId), ne(ghosts.playerId, row.id))))
    .orderBy(sql`abs(${ghosts.power} - ${power})`)
    .limit(1);
  return g ? { kind: 'ghost', ghostId: g.id, name: g.name, build: g.build, power: g.power } : null;
}

async function saveGhost(tx: Tx, now: number, row: PlayerRow, state: RunState, stage: number): Promise<void> {
  const build = { ...buildOf(state), name: row.name, skin: { crab: row.cosmetics.equipped.crab, shell: row.cosmetics.equipped.shell } };
  const power = ratePower(runFighter(state));
  await tx
    .insert(ghosts)
    .values({ id: randomId(), playerId: row.id, name: row.name, stage, power, build, createdAt: now })
    .onConflictDoUpdate({ target: [ghosts.playerId, ghosts.stage], set: { build, power, name: row.name, createdAt: now } });
}

/** End-of-run bookkeeping; must run inside the transaction that marks the run ended. */
async function finishRun(tx: Tx, ctx: Ctx, row: PlayerRow, run: RunRow, state: RunState): Promise<RunEnded> {
  const now = ctx.now();
  const { profile, summary } = applyRunEnd(row.profile, state);
  row.profile = profile;
  row.lastBuild = { ...buildOf(state), name: row.name };
  refreshPlayer(row, now);
  const before = row.quests;
  const after = before ? applyQuestDeltas(before, questDeltasForRun(state)) : before;
  const questsCompleted: string[] = [];
  if (before && after) {
    const done = (list: typeof after.daily, old: typeof after.daily) =>
      list.forEach((q, i) => {
        const def = QUEST_BY_ID.get(q.id);
        if (def && q.progress >= def.need && (old[i]?.progress ?? 0) < def.need) questsCompleted.push(q.id);
      });
    done(after.daily, before.daily);
    done(after.weekly, before.weekly);
    row.quests = after;
  }
  const ended: RunEnded = { result: state.result ?? 'defeat', summary, questsCompleted, runId: run.id };
  if (run.eventId) {
    const [ev] = await tx.select().from(liveEvents).where(eq(liveEvents.id, run.eventId));
    if (ev && ev.endsAt > now) {
      const score = eventScore(state, ev.config as LiveEventConfig);
      await addEventScore(tx, ev.id, row.id, score);
      ended.eventScore = score;
    }
  }
  await track(tx, now, row.id, 'run_end', {
    hero: state.cfg.heroId, stage: state.stats.maxStage, result: state.result, seconds: Math.round((now - run.startedAt) / 1000),
    huntSeconds: Math.round(state.stats.huntSeconds), diets: state.stats.eatenByDiet, sets: state.stats.maxSet, merges: state.stats.merges,
    coral: summary.coral, shine: summary.shine, tutorial: state.cfg.tutorial,
  });
  return ended;
}

export async function runAction(ctx: Ctx, playerId: string, runId: string, seq: number, action: ClientRunAction): Promise<RunActionResponse> {
  const now = ctx.now();
  return withPlayer(ctx, playerId, async (tx, row) => {
    const [run] = await tx.select().from(runs).where(and(eq(runs.id, runId), eq(runs.playerId, playerId))).for('update');
    if (!run) throw new ApiFail('run_not_found', 404);
    if (seq === run.seq && run.lastResponse) return run.lastResponse as RunActionResponse;
    if (run.status !== 'active') throw new ApiFail('run_ended');
    if (seq !== run.seq + 1) throw new ApiFail('bad_seq', 409);

    let state = run.state;
    let mapped: RunAction;
    switch (action.type) {
      case 'reroll':
        if (action.adIntentId) {
          if (state.flags.adReroll) throw new ApiFail('ad_reroll_used');
          if (!(await consumeAd(tx, ctx, row, action.adIntentId, 'reroll'))) throw new ApiFail('ad_not_verified');
          mapped = { type: 'reroll', free: true };
        } else mapped = { type: 'reroll' };
        break;
      case 'second_chance':
        if (state.phase !== 'down' || state.flags.secondChance) throw new ApiFail('bad_phase');
        if (row.perks.secondChanceTokens > 0 && !action.adIntentId) {
          row.perks = { ...row.perks, secondChanceTokens: row.perks.secondChanceTokens - 1 };
        } else if (!action.adIntentId || !(await consumeAd(tx, ctx, row, action.adIntentId, 'second_chance'))) {
          throw new ApiFail('ad_not_verified');
        }
        mapped = { type: 'second_chance' };
        break;
      case 'descend': {
        const next = (state.camp?.after ?? state.stage) + 1;
        const keep = state.battle && state.battle.stage === next && state.battle.enemy.kind === 'ghost' ? state.battle.enemy : null;
        const ghost = keep ?? (await pickGhost(tx, row, state, next));
        mapped = ghost ? { type: 'descend', ghost } : { type: 'descend' };
        break;
      }
      default:
        mapped = action;
    }

    let events: RunEvent[];
    try {
      const ctxRun = action.type === 'hunt_done' ? { huntElapsedS: Math.max(0, (now - (run.huntStartedAt ?? now)) / 1000) } : {};
      const out = applyRunAction(state, mapped, ctxRun);
      state = out.state;
      events = out.events;
    } catch (e) {
      if (e instanceof RunError) throw new ApiFail(e.code);
      throw e;
    }

    const clamped = events.filter((e) => e.type === 'clamped');
    if (clamped.length > 0) await track(tx, now, playerId, 'suspicious', { runId, stage: run.state.stage, what: clamped.map((c) => (c.type === 'clamped' ? c.what : '')) });
    const battle = events.find((e) => e.type === 'battle');
    if (battle && battle.type === 'battle') {
      await track(tx, now, playerId, 'battle', { stage: run.state.battle?.stage, enemy: battle.enemy.kind === 'guardian' ? battle.enemy.id : 'ghost', won: battle.won, hero: state.cfg.heroId });
      if (battle.won && run.state.battle) await saveGhost(tx, now, row, run.state, run.state.battle.stage);
    }

    const response: RunActionResponse = { run: state.phase === 'ended' ? null : publicRun(state, seq), events: events.filter((e) => e.type !== 'clamped') };
    let rewards: RunRow['rewards'] = null;
    if (state.phase === 'ended') {
      response.ended = await finishRun(tx, ctx, row, run, state);
      rewards = { coral: response.ended.summary.coral, shine: response.ended.summary.shine, doubled: false };
    }
    if (state.phase === 'ended' || action.type === 'second_chance') response.player = await playerView(tx, row, now);

    await tx
      .update(runs)
      .set({
        state, seq, lastResponse: response, updatedAt: now, stageReached: state.stats.maxStage,
        status: state.phase === 'ended' ? 'ended' : 'active', result: state.result, rewards,
        huntStartedAt: state.phase === 'hunt' && run.state.phase !== 'hunt' ? now : run.huntStartedAt,
      })
      .where(eq(runs.id, runId));
    return response;
  });
}

export async function abandonRun(ctx: Ctx, playerId: string, runId: string): Promise<RunActionResponse> {
  const now = ctx.now();
  return withPlayer(ctx, playerId, async (tx, row) => {
    const [run] = await tx.select().from(runs).where(and(eq(runs.id, runId), eq(runs.playerId, playerId))).for('update');
    if (!run) throw new ApiFail('run_not_found', 404);
    if (run.status !== 'active') throw new ApiFail('run_ended');
    const state: RunState = { ...run.state, phase: 'ended', result: 'defeat', camp: null, battle: null };
    const ended = await finishRun(tx, ctx, row, run, state);
    await tx.update(runs).set({ state, status: 'ended', result: 'defeat', updatedAt: now, rewards: { coral: ended.summary.coral, shine: ended.summary.shine, doubled: false } }).where(eq(runs.id, runId));
    return { run: null, events: [{ type: 'ended', result: 'defeat' }], ended, player: await playerView(tx, row, now) };
  });
}

/** Rewarded ad after a successful run: grants the carried loot once more. */
export async function doubleLoot(ctx: Ctx, playerId: string, runId: string, adIntentId: string) {
  const now = ctx.now();
  return withPlayer(ctx, playerId, async (tx, row) => {
    const [run] = await tx.select().from(runs).where(and(eq(runs.id, runId), eq(runs.playerId, playerId))).for('update');
    if (!run || run.status !== 'ended' || !run.rewards) throw new ApiFail('run_not_found', 404);
    if (run.result === 'defeat') throw new ApiFail('double_defeat');
    if (run.rewards.doubled) throw new ApiFail('double_used');
    if (now - run.updatedAt > 30 * 60_000) throw new ApiFail('double_expired');
    if (!(await consumeAd(tx, ctx, row, adIntentId, 'double_loot'))) throw new ApiFail('ad_not_verified');
    row.profile = { ...row.profile, coral: row.profile.coral + run.rewards.coral, shine: row.profile.shine + run.rewards.shine };
    await tx.update(runs).set({ rewards: { ...run.rewards, doubled: true } }).where(eq(runs.id, runId));
    return { player: await playerView(tx, row, now), gained: { coral: run.rewards.coral, shine: run.rewards.shine } };
  });
}
