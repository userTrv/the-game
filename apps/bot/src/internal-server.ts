import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { GrammyError } from 'grammy';
import type { Bot } from 'grammy';
import type { Update } from 'grammy/types';
import { z } from 'zod';
import { WEBHOOK_PATH } from './config';
import type { BotConfig } from './config';
import { describeError } from './logger';
import type { Logger } from './logger';

export interface InternalServerDeps {
  bot: Bot;
  logger: Logger;
}

const invoiceBody = z.object({
  title: z.string().min(1).max(32),
  description: z.string().min(1).max(255),
  payload: z
    .string()
    .min(1)
    .refine((value) => Buffer.byteLength(value, 'utf8') <= 128, 'payload must be at most 128 bytes'),
  amount: z.number().int().min(1),
});

const refundBody = z.object({
  tgId: z.number().int(),
  telegramPaymentChargeId: z.string().min(1),
});

/** Compares two secrets without leaking where they differ (or their lengths) through timing. */
export function secretsEqual(received: unknown, expected: string): boolean {
  if (typeof received !== 'string') return false;
  const a = createHash('sha256').update(received).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function telegramErrorText(error: GrammyError): string {
  return error.description.replace(/^Bad Request: /, '');
}

/**
 * The bot's HTTP side: endpoints the game server calls (`/internal/*`, guarded by `x-internal-secret`),
 * `/health`, and in webhook mode the Telegram webhook.
 */
export function createInternalServer(config: BotConfig, deps: InternalServerDeps): FastifyInstance {
  const { bot, logger } = deps;
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/internal/')) return;
    if (!secretsEqual(request.headers['x-internal-secret'], config.internalSecret)) {
      logger.warn('internal request rejected: bad secret', { path: request.url.split('?')[0] });
      return reply.code(401).send({ ok: false, error: 'unauthorized' });
    }
  });

  app.addHook('onResponse', async (request, reply) => {
    logger.debug('http request', {
      method: request.method,
      path: request.url.split('?')[0],
      status: reply.statusCode,
      ms: Math.round(reply.elapsedTime),
    });
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode =
      typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
    if (statusCode >= 500) {
      logger.error('http handler failed', { path: request.url.split('?')[0], ...describeError(error) });
      void reply.code(500).send({ ok: false, error: 'internal_error' });
      return;
    }
    void reply.code(statusCode).send({ ok: false, error: 'bad_request' });
  });

  app.setNotFoundHandler((_request, reply) => {
    void reply.code(404).send({ ok: false, error: 'not_found' });
  });

  app.get('/health', async () => ({ ok: true }));

  app.post('/internal/invoice-link', async (request, reply) => {
    const body = invoiceBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ ok: false, error: 'bad_request', details: z.prettifyError(body.error) });
    }
    const { title, description, payload, amount } = body.data;
    try {
      // Telegram Stars: currency XTR, empty provider token, exactly one price.
      const url = await bot.api.createInvoiceLink(title, description, payload, '', 'XTR', [{ label: title, amount }]);
      return { url };
    } catch (error) {
      logger.error('createInvoiceLink failed', describeError(error));
      const text = error instanceof GrammyError ? telegramErrorText(error) : 'telegram_unreachable';
      return reply.code(502).send({ ok: false, error: text });
    }
  });

  app.post('/internal/refund', async (request, reply) => {
    const body = refundBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ ok: false, error: 'bad_request', details: z.prettifyError(body.error) });
    }
    const { tgId, telegramPaymentChargeId } = body.data;
    try {
      await bot.api.refundStarPayment(tgId, telegramPaymentChargeId);
      logger.info('star payment refunded', { tgId, chargeId: telegramPaymentChargeId });
      return { ok: true };
    } catch (error) {
      logger.warn('refundStarPayment failed', { tgId, chargeId: telegramPaymentChargeId, ...describeError(error) });
      if (error instanceof GrammyError) {
        // Telegram said no (e.g. CHARGE_ALREADY_REFUNDED): a definitive answer, so HTTP 200.
        return { ok: false, error: telegramErrorText(error) };
      }
      return reply.code(502).send({ ok: false, error: 'telegram_unreachable' });
    }
  });

  if (config.mode === 'webhook') {
    const webhookSecret = config.webhookSecret ?? '';
    app.post(WEBHOOK_PATH, async (request, reply) => {
      if (webhookSecret === '' || !secretsEqual(request.headers['x-telegram-bot-api-secret-token'], webhookSecret)) {
        return reply.code(401).send({ ok: false, error: 'unauthorized' });
      }
      const update = request.body as Partial<Update> | null;
      if (update === null || typeof update !== 'object' || typeof update.update_id !== 'number') {
        return reply.code(400).send({ ok: false, error: 'bad_request' });
      }
      try {
        await bot.handleUpdate(update as Update);
      } catch (error) {
        // Answer 200 anyway: Telegram would redeliver a failing update forever. Payment delivery has
        // its own retry loop and never throws.
        const cause = (error as { error?: unknown }).error ?? error;
        logger.error('update handler failed', { updateId: update.update_id, ...describeError(cause) });
      }
      return { ok: true };
    });
  }

  return app;
}
