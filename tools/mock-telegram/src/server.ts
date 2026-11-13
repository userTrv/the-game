import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { MockCore } from './core';
import { ControlError, TgApiError } from './errors';
import { renderInvoicePage, renderNotFoundPage } from './invoice-page';
import { Params } from './params';
import type { ControlUser, RateLimitConfig } from './types';

export interface ServerOptions {
  /** When set, any other bot token answers 401 Unauthorized. */
  token?: string;
  logger: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function bodyOf(request: FastifyRequest): Record<string, unknown> {
  return isRecord(request.body) ? request.body : {};
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new ControlError(400, `"${name}" must be a string`);
  return value;
}

function requireString(value: unknown, name: string): string {
  const text = optionalString(value, name);
  if (text === undefined) throw new ControlError(400, `"${name}" is required`);
  return text;
}

function requireInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ControlError(400, `"${name}" must be an integer`);
  }
  return value;
}

function readUser(value: unknown): ControlUser {
  if (!isRecord(value)) throw new ControlError(400, '"from" is required');
  return {
    id: requireInteger(value.id, 'from.id'),
    first_name: optionalString(value.first_name, 'from.first_name'),
    last_name: optionalString(value.last_name, 'from.last_name'),
    username: optionalString(value.username, 'from.username'),
    language_code: optionalString(value.language_code, 'from.language_code'),
  };
}

function nullableCount(value: unknown, name: string): number | null {
  if (value === null) return null;
  const count = requireInteger(value, name);
  if (count < 0) throw new ControlError(400, `"${name}" must not be negative`);
  return count;
}

function isControlPath(url: string): boolean {
  return url.startsWith('/control/') || url.startsWith('/invoice/');
}

export function buildServer(core: MockCore, options: ServerOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger,
    forceCloseConnections: true,
    bodyLimit: 5 * 1024 * 1024,
  });

  // Telegram accepts JSON, urlencoded forms and (for uploads) multipart. The mock reads the first two
  // and treats everything else as "no parameters in the body".
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (text.trim() === '') {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(text) as unknown);
    } catch {
      const error: Error & { statusCode?: number } = new Error('invalid JSON body');
      error.statusCode = 400;
      done(error);
    }
  });
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    done(null, Object.fromEntries(new URLSearchParams(text)));
  });
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, _body, done) => {
    done(null, {});
  });

  // Permissive CORS for the endpoints a browser talks to (the game's mocked WebApp.openInvoice).
  app.addHook('onRequest', async (request, reply) => {
    if (!isControlPath(request.url)) return;
    reply.header('access-control-allow-origin', '*');
    reply.header('access-control-allow-methods', 'GET, POST, OPTIONS');
    reply.header(
      'access-control-allow-headers',
      request.headers['access-control-request-headers'] ?? 'content-type',
    );
    reply.header('access-control-allow-private-network', 'true');
    reply.header('access-control-max-age', '600');
  });
  app.options('/control/*', async (_request, reply) => reply.code(204).send());
  app.options('/invoice/*', async (_request, reply) => reply.code(204).send());

  app.setErrorHandler((error, request, reply) => {
    if (request.url.startsWith('/bot')) {
      const apiError =
        error instanceof TgApiError ? error : new TgApiError(400, 'Bad Request: invalid request body');
      void reply.code(apiError.errorCode).send(apiError.toEnvelope());
      return;
    }
    if (error instanceof ControlError) {
      void reply.code(error.statusCode).send({ error: error.message });
      return;
    }
    const statusCode = isRecord(error) && typeof error.statusCode === 'number' ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'internal error';
    void reply.code(statusCode).send({ error: message });
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/bot')) {
      void reply.code(404).send(new TgApiError(404, 'Not Found').toEnvelope());
      return;
    }
    void reply.code(404).send({ error: 'not found' });
  });

  // ---------------------------------------------------------------------------------------------------
  // Bot API: /bot<token>/<method>
  // ---------------------------------------------------------------------------------------------------

  const handleBotApi = async (
    request: FastifyRequest<{ Params: { token: string; method: string } }>,
    reply: FastifyReply,
  ): Promise<void> => {
    try {
      if (options.token !== undefined && request.params.token !== options.token) {
        throw new TgApiError(401, 'Unauthorized');
      }
      const params = new Params(request.query, request.body);
      let result: unknown;
      if (request.params.method.toLowerCase() === 'getupdates') {
        const poll = core.pollUpdates(params);
        // `close` fires both when the response is finished and when the client aborts the long poll.
        const onClose = (): void => {
          if (!reply.raw.writableEnded) poll.cancel();
        };
        reply.raw.once('close', onClose);
        try {
          result = await poll.promise;
        } finally {
          reply.raw.off('close', onClose);
        }
      } else {
        result = core.call(request.params.method, params);
      }
      await reply.send({ ok: true, result });
    } catch (error) {
      if (!(error instanceof TgApiError)) throw error;
      await reply.code(error.errorCode).send(error.toEnvelope());
    }
  };
  app.route({ method: ['GET', 'POST'], url: '/bot:token/:method', handler: handleBotApi });

  // ---------------------------------------------------------------------------------------------------
  // Control API
  // ---------------------------------------------------------------------------------------------------

  app.post('/control/message', async (request) => {
    const body = bodyOf(request);
    const update = core.injectMessage({ from: readUser(body.from), text: requireString(body.text, 'text') });
    return { ok: true, update };
  });

  app.post('/control/callback', async (request) => {
    const body = bodyOf(request);
    const update = core.injectCallback({
      from: readUser(body.from),
      data: requireString(body.data, 'data'),
      messageId: body.messageId === undefined ? undefined : requireInteger(body.messageId, 'messageId'),
    });
    return { ok: true, update };
  });

  app.post('/control/pay', async (request) => {
    const body = bodyOf(request);
    return core.pay({
      invoiceId: optionalString(body.invoiceId, 'invoiceId'),
      url: optionalString(body.url, 'url'),
      from: readUser(body.from),
    });
  });

  app.post('/control/redeliver', async (request) => {
    const update = core.redeliver(requireString(bodyOf(request).chargeId, 'chargeId'));
    return { ok: true, update };
  });

  app.get('/control/state', async () => core.state());

  app.post('/control/reset', async () => {
    core.reset();
    return { ok: true };
  });

  app.post('/control/block', async (request) => {
    const body = bodyOf(request);
    const blocked = body.blocked === undefined ? true : body.blocked;
    if (typeof blocked !== 'boolean') throw new ControlError(400, '"blocked" must be a boolean');
    core.setBlocked(requireInteger(body.chatId, 'chatId'), blocked);
    return { ok: true, blockedChats: core.state().blockedChats };
  });

  app.post('/control/rate-limit', async (request) => {
    const body = bodyOf(request);
    const patch: Partial<RateLimitConfig> = {};
    if (body.failNext !== undefined) patch.failNext = nullableCount(body.failNext, 'failNext') ?? 0;
    if (body.retryAfter !== undefined) patch.retryAfter = nullableCount(body.retryAfter, 'retryAfter') ?? 1;
    if (body.maxPerSecond !== undefined) patch.maxPerSecond = nullableCount(body.maxPerSecond, 'maxPerSecond');
    if (body.maxPerChatPerSecond !== undefined) {
      patch.maxPerChatPerSecond = nullableCount(body.maxPerChatPerSecond, 'maxPerChatPerSecond');
    }
    return { ok: true, rateLimit: core.setRateLimit(patch) };
  });

  app.post('/control/fail', async (request) => {
    const body = bodyOf(request);
    const count = requireInteger(body.count, 'count');
    const errorCode = requireInteger(body.errorCode, 'errorCode');
    if (count < 1) throw new ControlError(400, '"count" must be positive');
    if (errorCode < 400 || errorCode > 599) throw new ControlError(400, '"errorCode" must be 400-599');
    core.failNext({
      method: optionalString(body.method, 'method'),
      count,
      errorCode,
      description: optionalString(body.description, 'description'),
    });
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/invoice/:id', async (request, reply) => {
    const invoice = core.getInvoice(request.params.id);
    reply.type('text/html; charset=utf-8');
    if (!invoice) return reply.code(404).send(renderNotFoundPage());
    return reply.send(renderInvoicePage(invoice));
  });

  app.get('/', async () => ({ ok: true, service: 'mock-telegram' }));

  app.addHook('preClose', async () => {
    core.shutdown();
  });

  return app;
}
