import { GrammyError, InlineKeyboard } from 'grammy';
import type { Api } from 'grammy';
import { describeError } from './logger';
import type { Logger } from './logger';
import type { OutboxMessage, OutboxResult, ServerClient } from './server-client';

export interface OutboxWorkerOptions {
  api: Pick<Api, 'sendMessage'>;
  server: Pick<ServerClient, 'claimOutbox' | 'reportOutbox'>;
  logger: Logger;
  /** Overall send rate, messages per second (BROADCAST_RPS). */
  rps: number;
  /** Token bucket capacity. 1 (default) spaces sends evenly, so no one-second window exceeds `rps`. */
  burst?: number;
  /** Minimum interval between two messages to the same chat. Default 1000 ms. */
  perChatIntervalMs?: number;
  /** Messages claimed per request. Default: about four seconds of work, at most 100. */
  claimLimit?: number;
  /** Sends in flight at once. Default 8. */
  concurrency?: number;
  /** Polling interval while the queue is empty; grows up to `maxIdleMs`. Default 1000 ms. */
  idleMs?: number;
  /** Default 5000 ms. */
  maxIdleMs?: number;
  /** Results are reported once this many are collected... Default 50. */
  reportBatchSize?: number;
  /** ...or this much time has passed since the last report. Default 1000 ms. */
  reportIntervalMs?: number;
  /** `retryAfter` (seconds) reported for network errors and Telegram 5xx. Default 5. */
  transientRetryAfter?: number;
  /**
   * The server takes a claimed message back after 60 s. Messages still unsent this long after the claim
   * are released (reported as `retry`) instead of being sent late and possibly twice. Default 45 000 ms.
   */
  leaseSafetyMs?: number;
}

export interface OutboxWorker {
  start(): void;
  /** Stops claiming, waits for in-flight sends, releases unsent messages and flushes reports. */
  stop(): Promise<void>;
  /** Timestamp (ms) until which sending is paused because of a 429, or 0. */
  pausedUntil(): number;
}

const MAX_BUFFERED_RESULTS = 10_000;

export function buildOutboxKeyboard(button: OutboxMessage['button']): InlineKeyboard | undefined {
  if (!button) return undefined;
  return button.kind === 'webapp'
    ? new InlineKeyboard().webApp(button.text, button.url)
    : new InlineKeyboard().url(button.text, button.url);
}

export function createOutboxWorker(options: OutboxWorkerOptions): OutboxWorker {
  const { api, server, logger } = options;
  const rps = Math.max(1, options.rps);
  const burst = Math.max(1, options.burst ?? 1);
  const perChatIntervalMs = options.perChatIntervalMs ?? 1000;
  const claimLimit = options.claimLimit ?? Math.min(100, Math.max(1, Math.round(rps * 4)));
  const concurrency = Math.max(1, options.concurrency ?? 8);
  const idleMs = options.idleMs ?? 1000;
  const maxIdleMs = Math.max(idleMs, options.maxIdleMs ?? 5000);
  const reportBatchSize = options.reportBatchSize ?? 50;
  const reportIntervalMs = options.reportIntervalMs ?? 1000;
  const transientRetryAfter = options.transientRetryAfter ?? 5;
  const leaseSafetyMs = options.leaseSafetyMs ?? 45_000;

  let running = false;
  let loop: Promise<void> | null = null;
  let stopController = new AbortController();
  let pausedUntil = 0;

  // Token bucket: `tokens` refill at `rps` per second up to `burst`.
  let tokens = burst;
  let refilledAt = Date.now();
  // Earliest time the next message may go to a chat.
  const chatReadyAt = new Map<number, number>();

  let results: OutboxResult[] = [];
  let lastReportAt = Date.now();
  let reporting: Promise<void> = Promise.resolve();

  /** Resolves after `ms`, or immediately once the worker is stopping. */
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const signal = stopController.signal;
      if (ms <= 0 || signal.aborted) {
        resolve();
        return;
      }
      const onAbort = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    });

  const takeToken = async (): Promise<void> => {
    for (;;) {
      const now = Date.now();
      tokens = Math.min(burst, tokens + ((now - refilledAt) / 1000) * rps);
      refilledAt = now;
      if (tokens >= 1) {
        tokens -= 1;
        return;
      }
      if (!running) return;
      await sleep(Math.ceil(((1 - tokens) / rps) * 1000));
    }
  };

  const flush = (): Promise<void> => {
    reporting = reporting.then(async () => {
      if (results.length === 0) return;
      const batch = results;
      results = [];
      lastReportAt = Date.now();
      try {
        for (let index = 0; index < batch.length; index += reportBatchSize) {
          await server.reportOutbox({ results: batch.slice(index, index + reportBatchSize) });
        }
      } catch (error) {
        // Keep the results for the next flush. If the server stays down past the claim lease it will
        // hand the messages out again; that is the server's at-least-once trade-off.
        results = [...batch, ...results].slice(-MAX_BUFFERED_RESULTS);
        logger.warn('outbox report failed, will retry', { pending: results.length, ...describeError(error) });
      }
    });
    return reporting;
  };

  const record = (result: OutboxResult): void => {
    results.push(result);
    if (results.length >= reportBatchSize || Date.now() - lastReportAt >= reportIntervalMs) void flush();
  };

  const pause = (seconds: number): void => {
    const until = Date.now() + seconds * 1000;
    if (until > pausedUntil) {
      pausedUntil = until;
      logger.warn('outbox paused by Telegram flood control', { retryAfter: seconds });
    }
  };

  const send = async (message: OutboxMessage): Promise<OutboxResult> => {
    try {
      await api.sendMessage(message.chatId, message.text, {
        parse_mode: 'HTML',
        reply_markup: buildOutboxKeyboard(message.button),
      });
      return { id: message.id, status: 'sent' };
    } catch (error) {
      if (error instanceof GrammyError) {
        if (error.error_code === 429) {
          const retryAfter = Math.max(1, Math.ceil(error.parameters.retry_after ?? 1));
          pause(retryAfter);
          return { id: message.id, status: 'retry', retryAfter, error: error.description };
        }
        if (error.error_code === 403) {
          return { id: message.id, status: 'blocked', error: error.description };
        }
        if (error.error_code >= 500) {
          return { id: message.id, status: 'retry', retryAfter: transientRetryAfter, error: error.description };
        }
        return { id: message.id, status: 'failed', error: error.description };
      }
      logger.debug('outbox send: network error', describeError(error));
      return { id: message.id, status: 'retry', retryAfter: transientRetryAfter, error: 'network error' };
    }
  };

  const release = (messages: OutboxMessage[], retryAfter: number, reason: string): void => {
    for (const message of messages) record({ id: message.id, status: 'retry', retryAfter, error: reason });
  };

  const processBatch = async (messages: OutboxMessage[], claimedAt: number): Promise<void> => {
    const pending = [...messages];
    const inFlight = new Set<Promise<void>>();
    const leaseEnd = claimedAt + leaseSafetyMs;

    while (pending.length > 0 && running) {
      const now = Date.now();
      if (now >= leaseEnd) {
        release(pending.splice(0), 0, 'released: claim lease is about to expire');
        break;
      }
      if (pausedUntil > now) {
        if (pausedUntil >= leaseEnd) {
          release(pending.splice(0), Math.ceil((pausedUntil - now) / 1000), 'released: worker paused by flood control');
          break;
        }
        await sleep(pausedUntil - now);
        continue;
      }
      if (inFlight.size >= concurrency) {
        await Promise.race(inFlight);
        continue;
      }
      // Prefer a message whose chat is ready; otherwise wait for the chat that becomes ready first.
      let index = -1;
      let earliest = Number.POSITIVE_INFINITY;
      for (let position = 0; position < pending.length; position += 1) {
        const readyAt = chatReadyAt.get(pending[position]?.chatId ?? 0) ?? 0;
        if (readyAt <= now) {
          index = position;
          break;
        }
        earliest = Math.min(earliest, readyAt);
      }
      if (index === -1) {
        await sleep(Math.min(earliest, leaseEnd) - now);
        continue;
      }
      await takeToken();
      // Waiting for a token takes time: re-check stop, pause and lease before sending.
      if (!running || pausedUntil > Date.now() || Date.now() >= leaseEnd) continue;

      const [message] = pending.splice(index, 1);
      if (!message) continue;
      chatReadyAt.set(message.chatId, Date.now() + perChatIntervalMs);
      const task: Promise<void> = send(message)
        .then(record)
        .finally(() => inFlight.delete(task));
      inFlight.add(task);
    }

    await Promise.all([...inFlight]);
    if (pending.length > 0) release(pending, 0, 'released: worker is stopping');
    await flush();
  };

  const pruneChats = (): void => {
    if (chatReadyAt.size < 10_000) return;
    const now = Date.now();
    for (const [chatId, readyAt] of chatReadyAt) {
      if (readyAt <= now) chatReadyAt.delete(chatId);
    }
  };

  const run = async (): Promise<void> => {
    let idle = idleMs;
    while (running) {
      const now = Date.now();
      if (pausedUntil > now) {
        await sleep(pausedUntil - now);
        continue;
      }
      let messages: OutboxMessage[];
      const claimedAt = Date.now();
      try {
        messages = (await server.claimOutbox({ limit: claimLimit })).messages;
      } catch (error) {
        logger.warn('outbox claim failed', describeError(error));
        await sleep(idle);
        idle = Math.min(maxIdleMs, idle * 2);
        continue;
      }
      if (messages.length === 0) {
        if (results.length > 0) await flush();
        await sleep(idle);
        idle = Math.min(maxIdleMs, Math.ceil(idle * 1.5));
        continue;
      }
      idle = idleMs;
      logger.debug('outbox batch claimed', { count: messages.length });
      await processBatch(messages, claimedAt);
      pruneChats();
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      stopController = new AbortController();
      loop = run().catch((error: unknown) => {
        logger.error('outbox worker crashed', describeError(error));
      });
    },
    async stop() {
      if (!running) return;
      running = false;
      stopController.abort();
      await loop;
      loop = null;
      await flush();
      if (results.length > 0) logger.error('outbox results could not be reported before shutdown', { lost: results.length });
    },
    pausedUntil: () => pausedUntil,
  };
}
