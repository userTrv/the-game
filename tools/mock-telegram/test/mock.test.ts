import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockTelegram } from '../src/index';
import type { MockState, MockTelegram, PayResult, TgUpdate } from '../src/index';

const TOKEN = '123456:TEST-TOKEN';
const USER = { id: 42, first_name: 'Ann', username: 'ann', language_code: 'ru' };

interface Envelope<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

let mock: MockTelegram;
let stopBots: (() => Promise<void>)[] = [];

async function api<T = unknown>(
  method: string,
  params?: Record<string, unknown>,
  baseUrl = mock.url,
): Promise<Envelope<T>> {
  const response = await fetch(`${baseUrl}/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params ?? {}),
  });
  return (await response.json()) as Envelope<T>;
}

async function control<T = unknown>(path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const response = await fetch(`${mock.url}/control/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json()) as T };
}

async function createInvoice(overrides: Record<string, unknown> = {}): Promise<Envelope<string>> {
  return api<string>('createInvoiceLink', {
    title: 'Pearl pack',
    description: 'A handful of pearls',
    payload: 'order-1',
    provider_token: '',
    currency: 'XTR',
    prices: [{ label: 'Pearl pack', amount: 50 }],
    ...overrides,
  });
}

/** Answers every pre-checkout query the way a bot would, then stops when `stop()` is called. */
function runCheckoutBot(decide: (update: TgUpdate) => { ok: boolean; error_message?: string }): {
  seen: TgUpdate[];
  stop: () => Promise<void>;
} {
  const seen: TgUpdate[] = [];
  const target = mock;
  let running = true;
  let offset = 0;
  const loop = (async () => {
    while (running) {
      const updates = (await api<TgUpdate[]>('getUpdates', { offset, timeout: 1 }, target.url)).result ?? [];
      for (const update of updates) {
        offset = update.update_id + 1;
        seen.push(update);
        if (update.pre_checkout_query) {
          await api(
            'answerPreCheckoutQuery',
            { pre_checkout_query_id: update.pre_checkout_query.id, ...decide(update) },
            target.url,
          );
        }
      }
    }
  })().catch(() => undefined);
  const stop = async (): Promise<void> => {
    if (!running) return;
    running = false;
    // Wake the pending long poll so the loop can finish right away.
    target.injectMessage({ from: USER, text: 'bye' });
    await loop;
  };
  stopBots.push(stop);
  return { seen, stop };
}

beforeEach(async () => {
  mock = createMockTelegram({ token: TOKEN });
  await mock.listen(0);
});

afterEach(async () => {
  await Promise.all(stopBots.map((stop) => stop()));
  stopBots = [];
  await mock.close();
});

describe('Bot API basics', () => {
  it('answers getMe and rejects a wrong token and unknown methods', async () => {
    const me = await api<{ is_bot: boolean; username: string }>('getMe');
    expect(me.ok).toBe(true);
    expect(me.result?.is_bot).toBe(true);

    const wrongToken = await fetch(`${mock.url}/bot999:WRONG/getMe`);
    expect(wrongToken.status).toBe(401);
    expect(await wrongToken.json()).toMatchObject({ ok: false, error_code: 401 });

    const unknown = await api('noSuchMethod');
    expect(unknown).toEqual({ ok: false, error_code: 404, description: 'Not Found: method not found' });
  });

  it('accepts GET with query parameters and urlencoded forms', async () => {
    const viaGet = await fetch(`${mock.url}/bot${TOKEN}/sendMessage?chat_id=42&text=hello`);
    expect(await viaGet.json()).toMatchObject({ ok: true, result: { text: 'hello', chat: { id: 42 } } });

    const markup = { inline_keyboard: [[{ text: 'Play', web_app: { url: 'https://example.test/' } }]] };
    const viaForm = await fetch(`${mock.url}/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ chat_id: '42', text: 'form', reply_markup: JSON.stringify(markup) }),
    });
    expect(await viaForm.json()).toMatchObject({ ok: true, result: { text: 'form' } });

    const state = mock.state();
    expect(state.messages.map((message) => message.text)).toEqual(['hello', 'form']);
    expect(state.messages[1]?.reply_markup).toEqual(markup);
  });

  it('records commands, menu buttons, edits and deletions', async () => {
    expect((await api('setMyCommands', { commands: [{ command: 'start', description: 'Start' }] })).ok).toBe(true);
    expect((await api('setMyCommands', { commands: [{ command: 'Bad Command', description: 'x' }] })).ok).toBe(false);
    expect(
      (await api('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Play', web_app: { url: 'https://x.test' } } }))
        .ok,
    ).toBe(true);

    const sent = await api<{ message_id: number }>('sendMessage', { chat_id: 42, text: 'one' });
    const messageId = sent.result?.message_id;
    expect((await api('editMessageText', { chat_id: 42, message_id: messageId, text: 'two' })).ok).toBe(true);
    const unchanged = await api('editMessageText', { chat_id: 42, message_id: messageId, text: 'two' });
    expect(unchanged.description).toContain('message is not modified');
    expect((await api('deleteMessage', { chat_id: 42, message_id: messageId })).ok).toBe(true);
    expect((await api('editMessageText', { chat_id: 42, message_id: messageId, text: 'three' })).ok).toBe(false);

    const state = mock.state();
    expect(state.commands).toHaveLength(1);
    expect(state.menuButtons).toEqual([
      { chat_id: null, menu_button: { type: 'web_app', text: 'Play', web_app: { url: 'https://x.test' } } },
    ]);
    expect(state.messages[0]).toMatchObject({ text: 'two', edits: 1, deleted: true });
  });
});

describe('getUpdates long polling', () => {
  it('resolves a waiting long poll as soon as an update is injected', async () => {
    const startedAt = Date.now();
    const pending = api<TgUpdate[]>('getUpdates', { timeout: 20 });
    // Give the request time to reach the server and start waiting.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const injected = await control<{ update: TgUpdate }>('message', { from: USER, text: '/start ref_7' });
    expect(injected.status).toBe(200);

    const updates = (await pending).result ?? [];
    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.message).toMatchObject({
      text: '/start ref_7',
      from: { id: 42, is_bot: false, language_code: 'ru' },
      chat: { id: 42, type: 'private' },
      entities: [{ type: 'bot_command', offset: 0, length: 6 }],
    });
  });

  it('keeps updates until they are confirmed with offset and honours timeout', async () => {
    mock.injectMessage({ from: USER, text: 'first' });
    mock.injectMessage({ from: USER, text: 'second' });

    const all = (await api<TgUpdate[]>('getUpdates')).result ?? [];
    expect(all.map((update) => update.message?.text)).toEqual(['first', 'second']);
    // Not confirmed yet: the same updates are returned again.
    expect((await api<TgUpdate[]>('getUpdates', { limit: 1 })).result).toHaveLength(1);

    const firstId = all[0]?.update_id ?? 0;
    const rest = (await api<TgUpdate[]>('getUpdates', { offset: firstId + 1 })).result ?? [];
    expect(rest.map((update) => update.message?.text)).toEqual(['second']);

    const startedAt = Date.now();
    const empty = await api<TgUpdate[]>('getUpdates', { offset: firstId + 2, timeout: 0.2 });
    expect(empty.result).toEqual([]);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(150);
  });

  it('drops update types that are not in allowed_updates and terminates a superseded poll', async () => {
    const first = api<TgUpdate[]>('getUpdates', { timeout: 20, allowed_updates: ['callback_query'] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    mock.injectMessage({ from: USER, text: 'ignored' });
    const second = api<TgUpdate[]>('getUpdates', { timeout: 20 });
    expect(await first).toMatchObject({ ok: false, error_code: 409 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    mock.injectCallback({ from: USER, data: 'tap' });
    const updates = (await second).result ?? [];
    expect(updates).toHaveLength(1);
    expect(updates[0]?.callback_query).toMatchObject({ data: 'tap', from: { id: 42 } });
    expect(updates[0]?.callback_query?.message).toBeUndefined();
  });

  it('attaches the last bot message to an injected callback query', async () => {
    const sent = await api<{ message_id: number }>('sendMessage', { chat_id: 42, text: 'menu' });
    const update = mock.injectCallback({ from: USER, data: 'ns:corf:0' });
    expect(update.callback_query?.message?.message_id).toBe(sent.result?.message_id);
    const answered = await api('answerCallbackQuery', { callback_query_id: update.callback_query?.id, text: 'ok' });
    expect(answered.ok).toBe(true);
    expect(mock.state().callbackAnswers).toEqual([{ callback_query_id: update.callback_query?.id, text: 'ok' }]);
    expect((await api('answerCallbackQuery', { callback_query_id: 'nope' })).ok).toBe(false);
  });
});

describe('invoices and payments', () => {
  it('validates createInvoiceLink', async () => {
    const good = await createInvoice();
    expect(good.ok).toBe(true);
    expect(good.result).toMatch(new RegExp(`^${mock.url}/invoice/[0-9a-f]+$`));

    expect((await createInvoice({ currency: 'USD' })).description).toContain('CURRENCY_INVALID');
    expect((await createInvoice({ provider_token: 'stripe-token' })).ok).toBe(false);
    expect((await createInvoice({ provider_token: undefined })).ok).toBe(true);
    expect(
      (
        await createInvoice({
          prices: [
            { label: 'a', amount: 1 },
            { label: 'b', amount: 2 },
          ],
        })
      ).ok,
    ).toBe(false);
    expect((await createInvoice({ prices: [] })).ok).toBe(false);
    expect((await createInvoice({ prices: [{ label: 'a', amount: 0 }] })).ok).toBe(false);
    expect((await createInvoice({ payload: 'x'.repeat(129) })).ok).toBe(false);

    const invoices = mock.state().invoices;
    expect(invoices).toHaveLength(2);
    expect(invoices[0]).toMatchObject({ title: 'Pearl pack', payload: 'order-1', currency: 'XTR', amount: 50 });
  });

  it('runs the pay flow: pre-checkout, successful payment, redelivery', async () => {
    const link = (await createInvoice()).result ?? '';
    const bot = runCheckoutBot(() => ({ ok: true }));

    const paid = await control<PayResult>('pay', { url: link, from: USER });
    expect(paid.status).toBe(200);
    expect(paid.json.status).toBe('paid');
    const chargeId = paid.json.status === 'paid' ? paid.json.chargeId : '';
    expect(chargeId).not.toBe('');

    await vi.waitFor(() => expect(bot.seen.some((update) => update.message?.successful_payment)).toBe(true));
    expect(bot.seen[0]?.pre_checkout_query).toMatchObject({
      from: { id: 42 },
      currency: 'XTR',
      total_amount: 50,
      invoice_payload: 'order-1',
    });
    const paymentUpdate = bot.seen.find((update) => update.message?.successful_payment);
    expect(paymentUpdate?.message?.successful_payment).toMatchObject({
      currency: 'XTR',
      total_amount: 50,
      invoice_payload: 'order-1',
      telegram_payment_charge_id: chargeId,
    });
    expect(paymentUpdate?.message?.successful_payment?.provider_payment_charge_id).toBeTruthy();

    const redelivered = await control('redeliver', { chargeId });
    expect(redelivered.status).toBe(200);
    await vi.waitFor(() =>
      expect(bot.seen.filter((update) => update.message?.successful_payment)).toHaveLength(2),
    );
    const deliveries = bot.seen.filter((update) => update.message?.successful_payment);
    expect(deliveries[1]?.message).toEqual(deliveries[0]?.message);
    expect(deliveries[1]?.update_id).not.toBe(deliveries[0]?.update_id);

    await bot.stop();
    const state = (await control<MockState>('state')).json;
    expect(state.payments).toHaveLength(1);
    expect(state.payments[0]).toMatchObject({ charge_id: chargeId, user_id: 42, amount: 50, deliveries: 2 });
    expect(state.checkouts[0]?.status).toBe('approved');
    expect((await control('redeliver', { chargeId: 'missing' })).status).toBe(404);
  });

  it('reports a rejected pre-checkout and a missing invoice', async () => {
    const link = (await createInvoice()).result ?? '';
    const invoiceId = link.split('/').at(-1) ?? '';
    const bot = runCheckoutBot(() => ({ ok: false, error_message: 'Sold out' }));

    const rejected = await control<PayResult>('pay', { invoiceId, from: USER });
    expect(rejected.json).toEqual({ status: 'failed', error: 'Sold out' });
    await bot.stop();
    expect(mock.state().payments).toHaveLength(0);
    expect(bot.seen.some((update) => update.message?.successful_payment)).toBe(false);

    expect((await control('pay', { invoiceId: 'nope', from: USER })).status).toBe(404);
    expect((await control('pay', { from: USER })).status).toBe(400);
    expect((await control('pay', { invoiceId })).status).toBe(400);
  });

  it('times out when nobody answers the pre-checkout query and rejects a late answer', async () => {
    await mock.close();
    mock = createMockTelegram({ token: TOKEN, preCheckoutTimeoutMs: 100 });
    await mock.listen(0);
    const link = (await createInvoice()).result ?? '';

    const result = await control<PayResult>('pay', { url: link, from: USER });
    expect(result.json).toEqual({ status: 'timeout' });

    const updates = (await api<TgUpdate[]>('getUpdates')).result ?? [];
    const queryId = updates[0]?.pre_checkout_query?.id;
    const late = await api('answerPreCheckoutQuery', { pre_checkout_query_id: queryId, ok: true });
    expect(late).toMatchObject({ ok: false, error_code: 400 });
    expect(mock.state().checkouts[0]?.status).toBe('timeout');
  });

  it('refunds a charge once', async () => {
    const link = (await createInvoice()).result ?? '';
    const bot = runCheckoutBot(() => ({ ok: true }));
    const paid = await mock.pay({ url: link, from: USER });
    await bot.stop();
    const chargeId = paid.status === 'paid' ? paid.chargeId : '';

    const unknown = await api('refundStarPayment', { user_id: 42, telegram_payment_charge_id: 'nope' });
    expect(unknown).toMatchObject({ ok: false, error_code: 400, description: 'Bad Request: CHARGE_NOT_FOUND' });
    const wrongUser = await api('refundStarPayment', { user_id: 43, telegram_payment_charge_id: chargeId });
    expect(wrongUser.ok).toBe(false);

    const first = await api('refundStarPayment', { user_id: 42, telegram_payment_charge_id: chargeId });
    expect(first).toEqual({ ok: true, result: true });
    const second = await api('refundStarPayment', { user_id: 42, telegram_payment_charge_id: chargeId });
    expect(second).toMatchObject({
      ok: false,
      error_code: 400,
      description: 'Bad Request: CHARGE_ALREADY_REFUNDED',
    });

    const state = mock.state();
    expect(state.refunds).toHaveLength(1);
    expect(state.refunds[0]).toMatchObject({ charge_id: chargeId, user_id: 42, amount: 50 });
    expect(state.payments[0]?.refunded).toBe(true);

    const transactions = await api<{ transactions: { id: string }[] }>('getStarTransactions');
    expect(transactions.result?.transactions).toHaveLength(2);
  });
});

describe('failure simulation', () => {
  it('answers 403 for blocked chats', async () => {
    expect((await control('block', { chatId: 42, blocked: true })).status).toBe(200);
    const blocked = await api('sendMessage', { chat_id: 42, text: 'hi' });
    expect(blocked).toEqual({
      ok: false,
      error_code: 403,
      description: 'Forbidden: bot was blocked by the user',
    });
    expect((await api('sendMessage', { chat_id: 43, text: 'hi' })).ok).toBe(true);
    await control('block', { chatId: 42, blocked: false });
    expect((await api('sendMessage', { chat_id: 42, text: 'hi' })).ok).toBe(true);
  });

  it('answers a programmed 429 for the next K sends', async () => {
    await control('rate-limit', { failNext: 2, retryAfter: 3 });
    const limited = await api('sendMessage', { chat_id: 42, text: 'a' });
    expect(limited).toEqual({
      ok: false,
      error_code: 429,
      description: 'Too Many Requests: retry after 3',
      parameters: { retry_after: 3 },
    });
    expect((await api('sendMessage', { chat_id: 42, text: 'b' })).error_code).toBe(429);
    expect((await api('sendMessage', { chat_id: 42, text: 'c' })).ok).toBe(true);
    const state = mock.state();
    expect(state.sendAttempts.map((attempt) => attempt.ok)).toEqual([false, false, true]);
    expect(state.messages).toHaveLength(1);
  });

  it('enforces a per-second rate limit when configured', async () => {
    mock.setRateLimit({ maxPerSecond: 2, retryAfter: 1 });
    const results = [];
    for (let index = 0; index < 4; index += 1) {
      results.push(await api('sendMessage', { chat_id: 100 + index, text: 'x' }));
    }
    expect(results.map((result) => result.ok)).toEqual([true, true, false, false]);
    expect(results[2]?.parameters).toEqual({ retry_after: 1 });

    mock.setRateLimit({ maxPerSecond: null, maxPerChatPerSecond: 1 });
    expect((await api('sendMessage', { chat_id: 500, text: 'x' })).ok).toBe(true);
    expect((await api('sendMessage', { chat_id: 500, text: 'x' })).error_code).toBe(429);
    expect((await api('sendMessage', { chat_id: 501, text: 'x' })).ok).toBe(true);
  });

  it('fails the next calls of a method with a custom error and resets', async () => {
    await control('fail', { method: 'sendMessage', count: 1, errorCode: 500 });
    expect(await api('sendMessage', { chat_id: 42, text: 'x' })).toMatchObject({ ok: false, error_code: 500 });
    expect((await api('sendMessage', { chat_id: 42, text: 'x' })).ok).toBe(true);

    await control('block', { chatId: 42 });
    expect((await control('reset', {})).status).toBe(200);
    const state = mock.state();
    expect(state.messages).toEqual([]);
    expect(state.blockedChats).toEqual([]);
    expect((await api('sendMessage', { chat_id: 42, text: 'x' })).ok).toBe(true);
  });
});

describe('browser-facing endpoints', () => {
  it('serves CORS headers for control endpoints and an HTML page for invoices', async () => {
    const preflight = await fetch(`${mock.url}/control/pay`, {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:5173', 'access-control-request-headers': 'content-type' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
    expect(preflight.headers.get('access-control-allow-headers')).toBe('content-type');

    const state = await fetch(`${mock.url}/control/state`);
    expect(state.headers.get('access-control-allow-origin')).toBe('*');

    const link = (await createInvoice({ title: '<b>Shell</b>' })).result ?? '';
    const page = await fetch(link);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    const html = await page.text();
    expect(html).toContain('&lt;b&gt;Shell&lt;/b&gt;');
    expect(html).not.toContain('<b>Shell</b>');
    expect(html).toContain('Pay (mock)');

    expect((await fetch(`${mock.url}/invoice/unknown`)).status).toBe(404);
  });
});
