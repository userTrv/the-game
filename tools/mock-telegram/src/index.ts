import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { MockCore } from './core';
import { buildServer } from './server';
import type {
  ControlUser,
  MockState,
  MockTelegramOptions,
  PayRequest,
  PayResult,
  RateLimitConfig,
  TgUpdate,
} from './types';

export type * from './types';
export { ControlError, TgApiError } from './errors';

export interface MockTelegram {
  /** The underlying Fastify instance (handy for `app.inject` in tests). */
  readonly app: FastifyInstance;
  /** Base URL of the running server, e.g. `http://127.0.0.1:8081`. Use it as `TELEGRAM_API_ROOT`. */
  readonly url: string;
  /** Starts listening. Port 0 (the default) picks a free port. Resolves with the base URL. */
  listen(port?: number): Promise<string>;
  close(): Promise<void>;

  /** A deep copy of everything the mock recorded so far. */
  state(): MockState;
  reset(): void;
  /** Resolves when `probe(state)` returns a value; re-evaluated on every state change. */
  waitFor<T>(probe: (state: MockState) => T | undefined | null | false, timeoutMs?: number): Promise<T>;

  injectMessage(input: { from: ControlUser; text: string }): TgUpdate;
  injectCallback(input: { from: ControlUser; data: string; messageId?: number }): TgUpdate;
  pay(request: PayRequest): Promise<PayResult>;
  redeliver(chargeId: string): TgUpdate;
  setBlocked(chatId: number, blocked: boolean): void;
  setRateLimit(patch: Partial<RateLimitConfig>): RateLimitConfig;
  /** Makes the next `count` calls of `method` (default `sendMessage`) fail with the given error code. */
  failNext(rule: { method?: string; count: number; errorCode: number; description?: string }): void;
}

export function createMockTelegram(options: MockTelegramOptions = {}): MockTelegram {
  const core = new MockCore({
    botId: options.botId ?? 7000000001,
    botUsername: options.botUsername ?? 'shellter_mock_bot',
    botName: options.botName ?? 'Shellter (mock)',
    preCheckoutTimeoutMs: options.preCheckoutTimeoutMs ?? 10_000,
  });
  const app = buildServer(core, { token: options.token, logger: options.logger ?? false });
  const host = options.host ?? '127.0.0.1';
  const publicUrl = options.publicUrl?.replace(/\/+$/, '');
  let url = '';
  if (publicUrl !== undefined) core.publicUrl = publicUrl;

  return {
    app,
    get url() {
      return url;
    },
    async listen(port = 0) {
      await app.listen({ port, host });
      const address = app.server.address() as AddressInfo;
      const urlHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
      url = `http://${urlHost.includes(':') ? `[${urlHost}]` : urlHost}:${address.port}`;
      if (publicUrl === undefined) core.publicUrl = url;
      return url;
    },
    async close() {
      await app.close();
    },
    state: () => core.state(),
    reset: () => core.reset(),
    waitFor: (probe, timeoutMs) => core.waitFor(probe, timeoutMs),
    injectMessage: (input) => core.injectMessage(input),
    injectCallback: (input) => core.injectCallback(input),
    pay: (request) => core.pay(request),
    redeliver: (chargeId) => core.redeliver(chargeId),
    setBlocked: (chatId, blocked) => core.setBlocked(chatId, blocked),
    setRateLimit: (patch) => core.setRateLimit(patch),
    failNext: (rule) => core.failNext(rule),
  };
}
