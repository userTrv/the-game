import type { Logger } from './logger';
import { describeError } from './logger';
import { isRetryableServerError } from './server-client';
import type { ServerClient, SuccessfulPaymentRequest, SuccessfulPaymentResponse } from './server-client';

export interface PaymentRetryOptions {
  /** Attempts made while the update handler waits (keeps at-least-once delivery across a crash). Default 2. */
  inlineAttempts?: number;
  /** First retry delay; doubles each time. Default 500 ms. */
  baseDelayMs?: number;
  /** Upper bound of the retry delay. Default 30 000 ms. */
  maxDelayMs?: number;
}

export type PaymentOutcome =
  | { kind: 'delivered'; response: SuccessfulPaymentResponse }
  /** The server keeps failing; delivery continues in the background. */
  | { kind: 'delayed' }
  /** The server refused the payment for good (4xx); retrying will not help. */
  | { kind: 'failed' };

export interface PaymentForwarder {
  /**
   * Delivers a successful payment to the game server. `notify` is called once per state change:
   * `delayed` at most once, then eventually `delivered` or `failed`.
   */
  forward(request: SuccessfulPaymentRequest, notify: (outcome: PaymentOutcome) => Promise<void>): Promise<void>;
  /** Number of payments still being retried in the background. */
  pending(): number;
  /** Stops background retries (used on shutdown); undelivered payments are logged for reconciliation. */
  stop(): Promise<void>;
}

/**
 * Forwards `successful_payment` updates to the game server and never gives up on retryable errors:
 * the user has already paid, so losing the delivery would mean taking Stars for nothing.
 */
export function createPaymentForwarder(
  server: Pick<ServerClient, 'successfulPayment'>,
  logger: Logger,
  options: PaymentRetryOptions = {},
): PaymentForwarder {
  const inlineAttempts = Math.max(1, options.inlineAttempts ?? 2);
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  const background = new Set<Promise<void>>();
  const stopController = new AbortController();

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      if (stopController.signal.aborted) {
        resolve();
        return;
      }
      const onAbort = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        stopController.signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      stopController.signal.addEventListener('abort', onAbort, { once: true });
    });

  const safeNotify = async (
    notify: (outcome: PaymentOutcome) => Promise<void>,
    outcome: PaymentOutcome,
  ): Promise<void> => {
    try {
      await notify(outcome);
    } catch (error) {
      logger.warn('payment notification failed', { outcome: outcome.kind, ...describeError(error) });
    }
  };

  const identify = (request: SuccessfulPaymentRequest): Record<string, unknown> => ({
    tgId: request.tgId,
    chargeId: request.telegramPaymentChargeId,
    payload: request.payload,
    totalAmount: request.totalAmount,
  });

  /** Returns `true` when the payment reached a final state (delivered or permanently refused). */
  const tryOnce = async (
    request: SuccessfulPaymentRequest,
    notify: (outcome: PaymentOutcome) => Promise<void>,
    attempt: number,
  ): Promise<boolean> => {
    try {
      const response = await server.successfulPayment(request);
      logger.info('payment delivered to server', { ...identify(request), duplicate: response.duplicate, attempt });
      await safeNotify(notify, { kind: 'delivered', response });
      return true;
    } catch (error) {
      if (!isRetryableServerError(error)) {
        logger.error('payment rejected by server, manual reconciliation needed', {
          ...identify(request),
          ...describeError(error),
        });
        await safeNotify(notify, { kind: 'failed' });
        return true;
      }
      logger.warn('payment delivery failed, will retry', { ...identify(request), attempt, ...describeError(error) });
      return false;
    }
  };

  const delayFor = (attempt: number): number => Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));

  const retryInBackground = async (
    request: SuccessfulPaymentRequest,
    notify: (outcome: PaymentOutcome) => Promise<void>,
  ): Promise<void> => {
    for (let attempt = inlineAttempts + 1; ; attempt += 1) {
      await sleep(delayFor(attempt - 1));
      if (stopController.signal.aborted) {
        logger.error('payment NOT delivered to server before shutdown, manual reconciliation needed', identify(request));
        return;
      }
      if (await tryOnce(request, notify, attempt)) return;
    }
  };

  return {
    async forward(request, notify) {
      for (let attempt = 1; attempt <= inlineAttempts; attempt += 1) {
        if (attempt > 1) await sleep(delayFor(attempt - 1));
        if (await tryOnce(request, notify, attempt)) return;
      }
      await safeNotify(notify, { kind: 'delayed' });
      const task: Promise<void> = retryInBackground(request, notify).finally(() => background.delete(task));
      background.add(task);
    },
    pending: () => background.size,
    async stop() {
      stopController.abort();
      await Promise.all([...background]);
    },
  };
}
