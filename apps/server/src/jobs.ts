import type { Ctx } from './core';
import { ensureSchedule, finalizeEnded } from './liveops';
import { dispatchBroadcasts, triggerNotifications } from './outbox';

/** One pass of every periodic job; safe to call concurrently with requests. */
export async function runJobs(ctx: Ctx): Promise<void> {
  await finalizeEnded(ctx);
  await ensureSchedule(ctx);
  await dispatchBroadcasts(ctx);
  await triggerNotifications(ctx);
}

export function startJobs(ctx: Ctx, onError: (e: unknown) => void, everyMs = 60_000): () => void {
  let busy = false;
  const tick = (): void => {
    if (busy) return;
    busy = true;
    runJobs(ctx).catch(onError).finally(() => {
      busy = false;
    });
  };
  tick();
  const timer = setInterval(tick, everyMs);
  return () => clearInterval(timer);
}
