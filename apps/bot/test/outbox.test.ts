import { Api } from 'grammy';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockTelegram } from '../../../tools/mock-telegram/src/index';
import type { MockTelegram } from '../../../tools/mock-telegram/src/index';
import { silentLogger } from '../src/logger';
import { createOutboxWorker } from '../src/outbox';
import type { OutboxWorker, OutboxWorkerOptions } from '../src/outbox';
import type { OutboxMessage } from '../src/server-client';
import { ServerClientError } from '../src/server-client';
import { FakeServer, TOKEN, inlineButtons } from './helpers';

let mock: MockTelegram;
let server: FakeServer;
let worker: OutboxWorker | undefined;

function message(id: number, chatId = 5000 + id, extra: Partial<OutboxMessage> = {}): OutboxMessage {
  return { id: `m${id}`, chatId, text: `<b>news</b> ${id}`, ...extra };
}

function startWorker(overrides: Partial<OutboxWorkerOptions> = {}): OutboxWorker {
  worker = createOutboxWorker({
    api: new Api(TOKEN, { apiRoot: mock.url }),
    server,
    logger: silentLogger,
    rps: 50,
    idleMs: 10,
    maxIdleMs: 20,
    reportIntervalMs: 20,
    ...overrides,
  });
  worker.start();
  return worker;
}

async function waitForReports(count: number, timeoutMs = 5000): Promise<void> {
  await vi.waitFor(() => expect(server.reported.length).toBeGreaterThanOrEqual(count), {
    timeout: timeoutMs,
    interval: 10,
  });
}

beforeEach(async () => {
  mock = createMockTelegram({ token: TOKEN });
  await mock.listen(0);
  server = new FakeServer();
});

afterEach(async () => {
  await worker?.stop();
  worker = undefined;
  await mock.close();
});

describe('outbox worker', () => {
  it('sends HTML messages with optional buttons and reports them as sent', async () => {
    server.queue = [
      message(1),
      message(2, 5002, { button: { text: 'Open', kind: 'webapp', url: 'https://game.example.test/app' } }),
      message(3, 5003, { button: { text: 'Read', kind: 'url', url: 'https://example.test/news' } }),
    ];
    startWorker();
    await waitForReports(3);

    expect(server.reported).toEqual([
      { id: 'm1', status: 'sent' },
      { id: 'm2', status: 'sent' },
      { id: 'm3', status: 'sent' },
    ]);
    const sent = mock.state().messages;
    expect(sent.map((item) => [item.chat_id, item.text, item.parse_mode])).toEqual([
      [5001, '<b>news</b> 1', 'HTML'],
      [5002, '<b>news</b> 2', 'HTML'],
      [5003, '<b>news</b> 3', 'HTML'],
    ]);
    expect(sent[0]?.reply_markup).toBeUndefined();
    expect(inlineButtons(sent[1]?.reply_markup)).toEqual([
      { text: 'Open', web_app: { url: 'https://game.example.test/app' } },
    ]);
    expect(inlineButtons(sent[2]?.reply_markup)).toEqual([{ text: 'Read', url: 'https://example.test/news' }]);
  });

  it('throttles to the configured rate', async () => {
    const count = 12;
    const rps = 20;
    server.queue = Array.from({ length: count }, (_unused, index) => message(index + 1));
    startWorker({ rps });
    await waitForReports(count);

    const times = mock.state().sendAttempts.map((attempt) => attempt.at);
    expect(times).toHaveLength(count);
    const elapsedMs = Math.max(...times) - Math.min(...times);
    // Evenly spaced sends: N messages take (N - 1) / rps seconds, which is above the N / rps - 1 bound.
    expect(elapsedMs).toBeGreaterThanOrEqual(((count - 1) / rps) * 1000 * 0.9);
    expect(elapsedMs / 1000).toBeGreaterThanOrEqual(count / rps - 1);
    expect(elapsedMs).toBeLessThan(3000);
    expect(server.reported.every((result) => result.status === 'sent')).toBe(true);
  });

  it('keeps messages to the same chat apart and sends other chats meanwhile', async () => {
    server.queue = [message(1, 7000), message(2, 7000), message(3, 7001)];
    startWorker({ perChatIntervalMs: 300 });
    await waitForReports(3);

    const attempts = mock.state().sendAttempts;
    const sameChat = attempts.filter((attempt) => attempt.chat_id === 7000);
    expect((sameChat[1]?.at ?? 0) - (sameChat[0]?.at ?? 0)).toBeGreaterThanOrEqual(280);
    // The message for the other chat did not wait behind the throttled one.
    expect(attempts.map((attempt) => attempt.chat_id)).toEqual([7000, 7001, 7000]);
  });

  it('reports 403 as blocked', async () => {
    mock.setBlocked(5002, true);
    server.queue = [message(1), message(2), message(3)];
    startWorker();
    await waitForReports(3);

    const byId = new Map(server.reported.map((result) => [result.id, result]));
    expect(byId.get('m1')?.status).toBe('sent');
    expect(byId.get('m2')).toEqual({
      id: 'm2',
      status: 'blocked',
      error: 'Forbidden: bot was blocked by the user',
    });
    expect(byId.get('m3')?.status).toBe('sent');
  });

  it('reports 429 as retry with retryAfter and pauses the whole worker', async () => {
    mock.setRateLimit({ failNext: 1, retryAfter: 1 });
    server.queue = [message(1), message(2), message(3)];
    const started = startWorker({ rps: 5 });
    await waitForReports(1);
    expect(server.reported[0]).toEqual({
      id: 'm1',
      status: 'retry',
      retryAfter: 1,
      error: 'Too Many Requests: retry after 1',
    });
    expect(started.pausedUntil()).toBeGreaterThan(0);

    await waitForReports(3);
    const attempts = mock.state().sendAttempts;
    expect(attempts.map((attempt) => attempt.ok)).toEqual([false, true, true]);
    // Nothing was sent to anyone until retry_after had passed.
    expect((attempts[1]?.at ?? 0) - (attempts[0]?.at ?? 0)).toBeGreaterThanOrEqual(950);
    expect(server.reported.slice(1).map((result) => result.status)).toEqual(['sent', 'sent']);
  });

  it('reports Telegram 5xx as retry and other 4xx as failed', async () => {
    mock.failNext({ count: 1, errorCode: 500 });
    mock.failNext({ count: 1, errorCode: 400, description: 'Bad Request: chat not found' });
    server.queue = [message(1), message(2), message(3)];
    startWorker({ rps: 20, concurrency: 1, transientRetryAfter: 7 });
    await waitForReports(3);

    expect(server.reported).toEqual([
      { id: 'm1', status: 'retry', retryAfter: 7, error: 'Internal Server Error' },
      { id: 'm2', status: 'failed', error: 'Bad Request: chat not found' },
      { id: 'm3', status: 'sent' },
    ]);
  });

  it('reports network errors as retry', async () => {
    worker = createOutboxWorker({
      // Nothing listens on the discard port.
      api: new Api(TOKEN, { apiRoot: 'http://127.0.0.1:9' }),
      server,
      logger: silentLogger,
      rps: 50,
      idleMs: 10,
      transientRetryAfter: 3,
    });
    server.queue = [message(1)];
    worker.start();
    await waitForReports(1);
    expect(server.reported).toEqual([{ id: 'm1', status: 'retry', retryAfter: 3, error: 'network error' }]);
  });

  it('keeps results when a report fails and delivers them with the next one', async () => {
    const report = server.reportOutbox.bind(server);
    let failures = 1;
    server.reportOutbox = async (request) => {
      if (failures > 0) {
        failures -= 1;
        throw new ServerClientError('network', 'down');
      }
      return report(request);
    };
    server.queue = [message(1)];
    startWorker();
    await waitForReports(1);
    expect(server.reported).toEqual([{ id: 'm1', status: 'sent' }]);
  });

  it('on stop releases unsent messages and flushes the reports', async () => {
    server.queue = [message(1), message(2), message(3), message(4)];
    const started = startWorker({ rps: 2, reportIntervalMs: 60_000 });
    await mock.waitFor((state) => state.messages.length >= 1);
    await started.stop();

    const reported = server.reported;
    expect(reported).toHaveLength(4);
    const sent = reported.filter((result) => result.status === 'sent');
    const released = reported.filter((result) => result.status === 'retry');
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent.length + released.length).toBe(4);
    expect(released.every((result) => result.retryAfter === 0)).toBe(true);
    expect(mock.state().messages).toHaveLength(sent.length);

    // A stopped worker claims nothing more.
    const claims = server.calls.claimOutbox.length;
    server.queue = [message(9)];
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.calls.claimOutbox).toHaveLength(claims);
  });
});
