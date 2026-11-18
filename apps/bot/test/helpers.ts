import { createMockTelegram } from '../../../tools/mock-telegram/src/index';
import type { MockTelegram, MockTelegramOptions } from '../../../tools/mock-telegram/src/index';
import { ALLOWED_UPDATES, createBot } from '../src/bot';
import type { BotDeps, ShellterBot } from '../src/bot';
import type { BotConfig } from '../src/config';
import { silentLogger } from '../src/logger';
import type {
  BotStartRequest,
  BotStartResponse,
  NotifySettings,
  NotifySettingsRequest,
  NotifySettingsResponse,
  OutboxMessage,
  OutboxResult,
  ServerClient,
} from '../src/server-client';

export const TOKEN = '123456:TEST-bot-token';
export const SECRET = 'test-internal-secret';
export const MINI_APP_URL = 'https://game.example.test/app';

export function testConfig(apiRoot: string, overrides: Partial<BotConfig> = {}): BotConfig {
  return {
    botToken: TOKEN,
    telegramApiRoot: apiRoot,
    internalSecret: SECRET,
    serverInternalUrl: 'http://127.0.0.1:9',
    internalPort: 0,
    internalHost: '127.0.0.1',
    miniAppUrl: MINI_APP_URL,
    mode: 'polling',
    supportContact: '@shellter_support <help@example.test>',
    broadcastRps: 25,
    logLevel: 'silent',
    ...overrides,
  };
}

/** An in-memory stand-in for the game server. Every call is recorded; behaviour is overridable per test. */
export class FakeServer implements ServerClient {
  calls = {
    botStart: [] as BotStartRequest[],
    notifySettings: [] as NotifySettingsRequest[],
    claimOutbox: [] as { limit: number }[],
    reportOutbox: [] as { results: OutboxResult[] }[],
  };

  lang: 'ru' | 'en' | undefined = undefined;
  settings: NotifySettings = { enabled: true, corf: true, events: true, kraken: false };
  queue: OutboxMessage[] = [];

  onBotStart: (request: BotStartRequest) => Promise<BotStartResponse> = async () => ({
    ok: true,
    isNew: true,
    lang: this.lang,
  });

  async botStart(request: BotStartRequest): Promise<BotStartResponse> {
    this.calls.botStart.push(request);
    return this.onBotStart(request);
  }

  async notifySettings(request: NotifySettingsRequest): Promise<NotifySettingsResponse> {
    this.calls.notifySettings.push(request);
    this.settings = { ...this.settings, ...request.set };
    return { ok: true, settings: { ...this.settings }, lang: this.lang };
  }

  async claimOutbox(request: { limit: number }): Promise<{ messages: OutboxMessage[] }> {
    this.calls.claimOutbox.push(request);
    return { messages: this.queue.splice(0, request.limit) };
  }

  async reportOutbox(request: { results: OutboxResult[] }): Promise<{ ok: true }> {
    this.calls.reportOutbox.push(request);
    return { ok: true };
  }

  get reported(): OutboxResult[] {
    return this.calls.reportOutbox.flatMap((call) => call.results);
  }
}

export interface Harness {
  mock: MockTelegram;
  server: FakeServer;
  config: BotConfig;
  shellter: ShellterBot;
  /**
   * Resolves once the bot has handled every update injected so far (updates are handled in order, so
   * a reply to a sentinel `/play` proves everything before it is done).
   */
  settle(): Promise<void>;
  stop(): Promise<void>;
}

export interface HarnessOptions {
  mock?: MockTelegramOptions;
  config?: Partial<BotConfig>;
  deps?: Partial<BotDeps>;
  /** Start long polling against the mock (default true). */
  polling?: boolean;
}

const SENTINEL_USER = { id: 999_000_999, first_name: 'Sentinel' };

export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  const mock = createMockTelegram({ token: TOKEN, ...options.mock });
  await mock.listen(0);
  const server = new FakeServer();
  const config = testConfig(mock.url, options.config);
  const shellter = createBot(config, {
    server,
    logger: silentLogger,
    ...options.deps,
  });
  await shellter.bot.init();
  let polling: Promise<void> | undefined;
  if (options.polling !== false) {
    polling = shellter.bot.start({ allowed_updates: ALLOWED_UPDATES, timeout: 10 });
  }

  let sentinels = 0;
  return {
    mock,
    server,
    config,
    shellter,
    async settle() {
      sentinels += 1;
      const expected = sentinels;
      mock.injectMessage({ from: SENTINEL_USER, text: '/play' });
      await mock.waitFor(
        (state) => state.messages.filter((message) => message.chat_id === SENTINEL_USER.id).length >= expected,
      );
    },
    async stop() {
      await shellter.bot.stop();
      await polling;
      await mock.close();
    },
  };
}

/** Messages the bot sent to a chat, in order. */
export function messagesTo(mock: MockTelegram, chatId: number): ReturnType<MockTelegram['state']>['messages'] {
  return mock.state().messages.filter((message) => message.chat_id === chatId);
}

interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
  web_app?: { url: string };
}

export function inlineButtons(markup: unknown): InlineButton[] {
  const keyboard = (markup as { inline_keyboard?: InlineButton[][] } | undefined)?.inline_keyboard ?? [];
  return keyboard.flat();
}
