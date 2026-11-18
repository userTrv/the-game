import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createInternalServer } from '../src/internal-server';
import { silentLogger } from '../src/logger';
import { t } from '../src/i18n';
import { SECRET, messagesTo, startHarness } from './helpers';
import type { Harness } from './helpers';

const USER = { id: 2001, first_name: 'Ira', language_code: 'ru' };

let harness: Harness;
let app: FastifyInstance;

async function setup(options: Parameters<typeof startHarness>[0] = {}): Promise<void> {
  harness = await startHarness(options);
  app = createInternalServer(harness.config, { bot: harness.shellter.bot, logger: silentLogger });
}

afterEach(async () => {
  await app.close();
  await harness.stop();
});

describe('internal HTTP server', () => {
  it('answers /health without a secret and 401 for /internal/* without the right one', async () => {
    await setup({ polling: false });
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ ok: true });

    const missing = await app.inject({ method: 'POST', url: '/internal/anything', payload: {} });
    expect(missing.statusCode).toBe(401);
    const wrong = await app.inject({ method: 'POST', url: '/internal/anything', headers: { 'x-internal-secret': `${SECRET}x` }, payload: {} });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ ok: false, error: 'unauthorized' });
  });

  it('serves the Telegram webhook only in webhook mode and checks its secret token', async () => {
    await setup({ polling: false });
    const absent = await app.inject({ method: 'POST', url: '/telegram/webhook', payload: { update_id: 1 } });
    expect(absent.statusCode).toBe(404);
    await app.close();

    app = createInternalServer(
      { ...harness.config, mode: 'webhook', webhookUrl: 'https://bot.example.test/telegram/webhook', webhookSecret: 'hook-secret' },
      { bot: harness.shellter.bot, logger: silentLogger },
    );
    const update = {
      update_id: 5,
      message: {
        message_id: 1,
        date: 0,
        chat: { id: USER.id, type: 'private', first_name: 'Ira' },
        from: { id: USER.id, is_bot: false, first_name: 'Ira', language_code: 'ru' },
        text: '/play',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
      },
    };
    const unauthorized = await app.inject({ method: 'POST', url: '/telegram/webhook', payload: update });
    expect(unauthorized.statusCode).toBe(401);
    expect(messagesTo(harness.mock, USER.id)).toHaveLength(0);

    const accepted = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'hook-secret' },
      payload: update,
    });
    expect(accepted.statusCode).toBe(200);
    expect(messagesTo(harness.mock, USER.id).map((message) => message.text)).toEqual([t('ru', 'play.text')]);
  });
});
