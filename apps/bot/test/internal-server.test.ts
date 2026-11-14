import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createInternalServer } from '../src/internal-server';
import { silentLogger } from '../src/logger';
import { t } from '../src/i18n';
import { SECRET, messagesTo, startHarness } from './helpers';
import type { Harness } from './helpers';

const USER = { id: 2001, first_name: 'Ira', language_code: 'ru' };
const INVOICE = { title: 'Pearl pack', description: 'A handful of pearls', payload: 'order-77', amount: 120 };
const AUTH = { 'x-internal-secret': SECRET };

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

    const missing = await app.inject({ method: 'POST', url: '/internal/invoice-link', payload: INVOICE });
    expect(missing.statusCode).toBe(401);
    const wrong = await app.inject({
      method: 'POST',
      url: '/internal/refund',
      headers: { 'x-internal-secret': `${SECRET}x` },
      payload: { tgId: 1, telegramPaymentChargeId: 'c' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ ok: false, error: 'unauthorized' });
    expect(harness.mock.state().invoices).toHaveLength(0);
  });

  it('creates a Telegram Stars invoice link', async () => {
    await setup({ polling: false });
    const response = await app.inject({ method: 'POST', url: '/internal/invoice-link', headers: AUTH, payload: INVOICE });
    expect(response.statusCode).toBe(200);
    const { url } = response.json<{ url: string }>();
    expect(url).toMatch(/\/invoice\/[0-9a-f]+$/);
    expect(harness.mock.state().invoices).toEqual([
      expect.objectContaining({ url, title: 'Pearl pack', payload: 'order-77', currency: 'XTR', amount: 120 }),
    ]);

    const invalid = await app.inject({
      method: 'POST',
      url: '/internal/invoice-link',
      headers: AUTH,
      payload: { ...INVOICE, amount: 0 },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ ok: false, error: 'bad_request' });

    // Telegram refusing the call is reported as 502 with its reason.
    harness.mock.failNext({ method: 'createInvoiceLink', count: 1, errorCode: 400, description: 'Bad Request: NOPE' });
    const refused = await app.inject({ method: 'POST', url: '/internal/invoice-link', headers: AUTH, payload: INVOICE });
    expect(refused.statusCode).toBe(502);
    expect(refused.json()).toEqual({ ok: false, error: 'NOPE' });
  });

  it('refunds a Stars payment once and maps Telegram errors', async () => {
    await setup();
    const link = (
      await app.inject({ method: 'POST', url: '/internal/invoice-link', headers: AUTH, payload: INVOICE })
    ).json<{ url: string }>().url;
    const paid = await harness.mock.pay({ url: link, from: USER });
    const chargeId = paid.status === 'paid' ? paid.chargeId : '';
    expect(chargeId).not.toBe('');

    const refund = () =>
      app.inject({
        method: 'POST',
        url: '/internal/refund',
        headers: AUTH,
        payload: { tgId: USER.id, telegramPaymentChargeId: chargeId },
      });
    const first = await refund();
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ ok: true });
    expect(harness.mock.state().refunds).toEqual([
      expect.objectContaining({ charge_id: chargeId, user_id: USER.id, amount: 120 }),
    ]);

    const second = await refund();
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ ok: false, error: 'CHARGE_ALREADY_REFUNDED' });
    expect(harness.mock.state().refunds).toHaveLength(1);

    const bad = await app.inject({ method: 'POST', url: '/internal/refund', headers: AUTH, payload: { tgId: 'x' } });
    expect(bad.statusCode).toBe(400);
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
