import { z } from 'zod';
import type { Logger } from './logger';

// -----------------------------------------------------------------------------------------------------
// Contract types (docs/INTERNAL_API.md, "the server accepts from the bot")
// -----------------------------------------------------------------------------------------------------

export interface TgUserInfo {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface NotifySettings {
  enabled: boolean;
  corf: boolean;
  events: boolean;
  kraken: boolean;
}

export type NotifySettingKey = keyof NotifySettings;

export interface BotStartRequest {
  tgUser: TgUserInfo;
  startParam?: string;
}

export interface BotStartResponse {
  ok: true;
  isNew: boolean;
  lang?: 'ru' | 'en';
}

export interface NotifySettingsRequest {
  tgId: number;
  set?: Partial<NotifySettings>;
}

export interface NotifySettingsResponse {
  ok: true;
  settings: NotifySettings;
  lang?: 'ru' | 'en';
}

export interface PreCheckoutRequest {
  tgId: number;
  payload: string;
  currency: string;
  totalAmount: number;
}

export interface PreCheckoutResponse {
  ok: boolean;
  error?: string;
}

export interface SuccessfulPaymentRequest extends PreCheckoutRequest {
  telegramPaymentChargeId: string;
  providerPaymentChargeId?: string;
}

export interface SuccessfulPaymentResponse {
  ok: true;
  duplicate: boolean;
  productTitle?: string;
}

export interface OutboxMessage {
  id: string;
  chatId: number;
  /** HTML */
  text: string;
  button?: { text: string; kind: 'webapp' | 'url'; url: string };
}

export interface OutboxResult {
  id: string;
  status: 'sent' | 'blocked' | 'retry' | 'failed';
  /** Seconds. */
  retryAfter?: number;
  error?: string;
}

/** Everything the bot needs from the game server. Tests replace it with a fake. */
export interface ServerClient {
  botStart(request: BotStartRequest): Promise<BotStartResponse>;
  notifySettings(request: NotifySettingsRequest): Promise<NotifySettingsResponse>;
  /** Must settle within ~3 s: Telegram waits at most 10 s for the pre-checkout answer. */
  preCheckout(request: PreCheckoutRequest): Promise<PreCheckoutResponse>;
  successfulPayment(request: SuccessfulPaymentRequest): Promise<SuccessfulPaymentResponse>;
  claimOutbox(request: { limit: number }): Promise<{ messages: OutboxMessage[] }>;
  reportOutbox(request: { results: OutboxResult[] }): Promise<{ ok: true }>;
}

// -----------------------------------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------------------------------

export type ServerErrorKind = 'network' | 'timeout' | 'http' | 'protocol';

export class ServerClientError extends Error {
  readonly kind: ServerErrorKind;
  readonly status?: number;
  /** True when trying again later may succeed (network trouble, timeouts, 5xx, 408, 429). */
  readonly retryable: boolean;

  constructor(kind: ServerErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'ServerClientError';
    this.kind = kind;
    this.status = status;
    this.retryable =
      kind === 'network' || kind === 'timeout' || (kind === 'http' && (status === 408 || status === 429 || (status ?? 0) >= 500));
  }
}

/** Unknown errors (e.g. thrown by a fake client) are treated as retryable. */
export function isRetryableServerError(error: unknown): boolean {
  return error instanceof ServerClientError ? error.retryable : true;
}

// -----------------------------------------------------------------------------------------------------
// Response schemas
// -----------------------------------------------------------------------------------------------------

const lang = z.enum(['ru', 'en']).optional().catch(undefined);

const schemas = {
  botStart: z.object({ ok: z.literal(true), isNew: z.boolean(), lang }),
  notifySettings: z.object({
    ok: z.literal(true),
    settings: z.object({ enabled: z.boolean(), corf: z.boolean(), events: z.boolean(), kraken: z.boolean() }),
    lang,
  }),
  preCheckout: z.object({ ok: z.boolean(), error: z.string().optional() }),
  successfulPayment: z.object({
    ok: z.literal(true),
    duplicate: z.boolean(),
    productTitle: z.string().optional(),
  }),
  claimOutbox: z.object({
    messages: z.array(
      z.object({
        id: z.string(),
        chatId: z.number(),
        text: z.string(),
        button: z
          .object({ text: z.string(), kind: z.enum(['webapp', 'url']), url: z.string() })
          .nullish()
          .transform((button) => button ?? undefined),
      }),
    ),
  }),
  reportOutbox: z.object({ ok: z.literal(true) }),
};

// -----------------------------------------------------------------------------------------------------
// HTTP implementation
// -----------------------------------------------------------------------------------------------------

export interface HttpServerClientOptions {
  /** Base URL of the game server, e.g. http://server:3000 (no trailing slash). */
  baseUrl: string;
  secret: string;
  logger: Logger;
  fetch?: typeof fetch;
  /** Per-attempt timeout for ordinary calls. Default 5000 ms. */
  timeoutMs?: number;
  /** Total budget of the pre-checkout call including retries. Default 3000 ms. */
  preCheckoutBudgetMs?: number;
  /** Delay before the first retry; doubles on every further retry. Default 250 ms. */
  retryBaseDelayMs?: number;
}

interface RequestPolicy {
  /** Total number of attempts (1 = no retries). */
  attempts: number;
  timeoutMs: number;
  /** When set, all attempts together must finish before this many milliseconds elapse. */
  budgetMs?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function createHttpServerClient(options: HttpServerClientOptions): ServerClient {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5000;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 250;
  const baseUrl = options.baseUrl.replace(/\/+$/, '');

  async function attempt<T>(path: string, body: unknown, schema: z.ZodType<T>, attemptTimeoutMs: number): Promise<T> {
    let response: Response;
    let text: string;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-secret': options.secret },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(attemptTimeoutMs),
      });
      text = await response.text();
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new ServerClientError('timeout', `${path}: no answer within ${attemptTimeoutMs} ms`);
      }
      throw new ServerClientError('network', `${path}: game server is unreachable`);
    }
    if (!response.ok) {
      throw new ServerClientError('http', `${path}: HTTP ${response.status}`, response.status);
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ServerClientError('protocol', `${path}: response is not JSON`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ServerClientError('protocol', `${path}: unexpected response shape`);
    }
    return parsed.data;
  }

  async function request<T>(path: string, body: unknown, schema: z.ZodType<T>, policy: RequestPolicy): Promise<T> {
    const deadline = policy.budgetMs === undefined ? undefined : Date.now() + policy.budgetMs;
    let lastError: unknown;
    for (let index = 0; index < policy.attempts; index += 1) {
      if (index > 0) {
        const delay = retryBaseDelayMs * 2 ** (index - 1);
        if (deadline !== undefined && Date.now() + delay >= deadline) break;
        await sleep(delay);
      }
      const remaining = deadline === undefined ? policy.timeoutMs : Math.min(policy.timeoutMs, deadline - Date.now());
      if (remaining <= 0) break;
      try {
        return await attempt(path, body, schema, remaining);
      } catch (error) {
        lastError = error;
        if (!isRetryableServerError(error)) break;
        options.logger.debug('server request failed', { path, attempt: index + 1, error: (error as Error).message });
      }
    }
    throw lastError ?? new ServerClientError('timeout', `${path}: time budget exhausted`);
  }

  const preCheckoutBudgetMs = options.preCheckoutBudgetMs ?? 3000;

  return {
    botStart: (body) => request('/internal/bot/start', body, schemas.botStart, { attempts: 2, timeoutMs }),
    notifySettings: (body) =>
      request('/internal/bot/notify-settings', body, schemas.notifySettings, { attempts: 2, timeoutMs }),
    preCheckout: (body) =>
      request('/internal/payments/pre-checkout', body, schemas.preCheckout, {
        attempts: 3,
        timeoutMs: preCheckoutBudgetMs,
        budgetMs: preCheckoutBudgetMs,
      }),
    // The server is idempotent by telegramPaymentChargeId, so retrying is always safe.
    successfulPayment: (body) =>
      request('/internal/payments/successful', body, schemas.successfulPayment, { attempts: 3, timeoutMs: 10_000 }),
    // The worker loop is the retry mechanism for claims.
    claimOutbox: (body) => request('/internal/outbox/claim', body, schemas.claimOutbox, { attempts: 1, timeoutMs }),
    reportOutbox: (body) => request('/internal/outbox/report', body, schemas.reportOutbox, { attempts: 3, timeoutMs }),
  };
}
