import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { Bot } from 'grammy';
import type { Update } from 'grammy/types';
import { WEBHOOK_PATH } from './config';
import type { BotConfig } from './config';
import { describeError } from './logger';
import type { Logger } from './logger';

export interface InternalServerDeps {
  bot: Bot;
  logger: Logger;
}

/** Compares two secrets without leaking where they differ (or their lengths) through timing. */
export function secretsEqual(received: unknown, expected: string): boolean {
  if (typeof received !== 'string') return false;
  const a = createHash('sha256').update(received).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
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
        // Answer 200 anyway: Telegram would redeliver a failing update forever.
        const cause = (error as { error?: unknown }).error ?? error;
        logger.error('update handler failed', { updateId: update.update_id, ...describeError(cause) });
      }
      return { ok: true };
    });
  }

  return app;
}
