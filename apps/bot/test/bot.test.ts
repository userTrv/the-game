import { afterEach, describe, expect, it } from 'vitest';
import { t } from '../src/i18n';
import { ServerClientError } from '../src/server-client';
import { MINI_APP_URL, inlineButtons, messagesTo, startHarness } from './helpers';
import type { Harness } from './helpers';

const ANNA = { id: 1001, first_name: 'Аня', username: 'anya', language_code: 'ru' };
const BOB = { id: 1002, first_name: 'Bob', language_code: 'en' };

let harness: Harness;

afterEach(async () => {
  await harness.stop();
});

async function createInvoice(payload = 'order-1'): Promise<string> {
  return harness.shellter.bot.api.createInvoiceLink('Pearl pack', 'A handful of pearls', payload, '', 'XTR', [
    { label: 'Pearl pack', amount: 50 },
  ]);
}

describe('commands', () => {
  it('/start with a payload registers the player and replies with a web_app button', async () => {
    harness = await startHarness();
    harness.mock.injectMessage({ from: ANNA, text: '/start ref_42' });
    await harness.settle();

    expect(harness.server.calls.botStart).toEqual([
      {
        tgUser: { id: 1001, first_name: 'Аня', username: 'anya', language_code: 'ru' },
        startParam: 'ref_42',
      },
    ]);
    const [welcome] = messagesTo(harness.mock, ANNA.id);
    expect(welcome?.text).toBe(t('ru', 'start.welcomeNew', { name: 'Аня' }));
    const [button] = inlineButtons(welcome?.reply_markup);
    expect(button?.web_app?.url).toBe(`${MINI_APP_URL}?tgWebAppStartParam=ref_42`);

    // The chat menu button opens the Mini App too.
    expect(harness.mock.state().menuButtons).toContainEqual({
      chat_id: 1001,
      menu_button: { type: 'web_app', text: t('ru', 'menu.play'), web_app: { url: MINI_APP_URL } },
    });
  });

  it("/start prefers the server's language and survives a server outage", async () => {
    harness = await startHarness();
    harness.server.onBotStart = async () => ({ ok: true, isNew: false, lang: 'en' });
    harness.mock.injectMessage({ from: ANNA, text: '/start' });
    harness.server.onBotStart = async () => ({ ok: true, isNew: false, lang: 'en' });
    await harness.settle();
    expect(harness.server.calls.botStart[0]).not.toHaveProperty('startParam');
    expect(messagesTo(harness.mock, ANNA.id)[0]?.text).toBe(t('en', 'start.welcomeBack', { name: 'Аня' }));
    expect(inlineButtons(messagesTo(harness.mock, ANNA.id)[0]?.reply_markup)[0]?.web_app?.url).toBe(MINI_APP_URL);

    // The language is remembered for commands that do not call the server.
    harness.mock.injectMessage({ from: ANNA, text: '/help' });
    // Server down: the welcome still arrives, in the language Telegram reports. Junk payloads are dropped.
    harness.server.onBotStart = async () => {
      throw new ServerClientError('network', 'down');
    };
    harness.mock.injectMessage({ from: BOB, text: '/start not a valid payload!' });
    await harness.settle();
    expect(messagesTo(harness.mock, ANNA.id)[1]?.text).toBe(t('en', 'help.text'));
    expect(harness.server.calls.botStart[1]).not.toHaveProperty('startParam');
    const bobWelcome = messagesTo(harness.mock, BOB.id)[0];
    expect(bobWelcome?.text).toBe(t('en', 'start.welcomeNew', { name: 'Bob' }));
    expect(inlineButtons(bobWelcome?.reply_markup)[0]?.web_app?.url).toBe(MINI_APP_URL);
  });

  it('/play, /paysupport and /terms reply in the right language', async () => {
    harness = await startHarness();
    harness.mock.injectMessage({ from: ANNA, text: '/play' });
    harness.mock.injectMessage({ from: ANNA, text: '/paysupport' });
    harness.mock.injectMessage({ from: ANNA, text: '/terms' });
    harness.mock.injectMessage({ from: BOB, text: '/paysupport' });
    harness.mock.injectMessage({ from: BOB, text: '/terms' });
    await harness.settle();

    const [play, support, terms] = messagesTo(harness.mock, ANNA.id);
    expect(inlineButtons(play?.reply_markup)[0]?.web_app?.url).toBe(MINI_APP_URL);
    expect(support?.parse_mode).toBe('HTML');
    expect(support?.text).toContain('Telegram Stars');
    // The contact is HTML-escaped and the player's id is included for the support request.
    expect(support?.text).toContain('@shellter_support &lt;help@example.test&gt;');
    expect(support?.text).toContain('<code>1001</code>');
    expect(terms?.text).toContain('Условия использования');
    expect(terms?.text).toContain('pay-to-win');

    const [supportEn, termsEn] = messagesTo(harness.mock, BOB.id);
    expect(supportEn?.text).toContain('Help with purchases');
    expect(supportEn?.text).toContain('<code>1002</code>');
    expect(termsEn?.text).toContain('terms of service');
    expect(termsEn?.text).toContain('@shellter_support');
  });

  it('registers commands in both languages and the default menu button', async () => {
    harness = await startHarness({ polling: false });
    await harness.shellter.setupProfile();
    const state = harness.mock.state();
    const byLang = new Map(state.commands.map((record) => [record.language_code, record.commands]));
    expect(byLang.get('')?.find((item) => item.command === 'paysupport')?.description).toBe(t('en', 'cmd.paysupport'));
    expect(byLang.get('ru')?.map((item) => item.command)).toEqual([
      'start',
      'play',
      'settings',
      'help',
      'paysupport',
      'terms',
    ]);
    expect(byLang.get('ru')?.[0]?.description).toBe(t('ru', 'cmd.start'));
    expect(state.menuButtons).toContainEqual({
      chat_id: null,
      menu_button: { type: 'web_app', text: t('ru', 'menu.play'), web_app: { url: MINI_APP_URL } },
    });
  });
});

describe('notification settings', () => {
  it('shows toggles and applies a toggle round trip', async () => {
    harness = await startHarness();
    harness.mock.injectMessage({ from: ANNA, text: '/settings' });
    await harness.settle();

    expect(harness.server.calls.notifySettings).toEqual([{ tgId: 1001 }]);
    const [menu] = messagesTo(harness.mock, ANNA.id);
    expect(inlineButtons(menu?.reply_markup).map((button) => [button.text, button.callback_data])).toEqual([
      ['✅ Все уведомления', 'ns:enabled:0'],
      ['✅ Садок полон', 'ns:corf:0'],
      ['✅ События', 'ns:events:0'],
      ['⬜ Кракен', 'ns:kraken:1'],
    ]);

    harness.mock.injectCallback({ from: ANNA, data: 'ns:corf:0', messageId: menu?.message_id });
    harness.mock.injectCallback({ from: ANNA, data: 'ns:kraken:1', messageId: menu?.message_id });
    await harness.settle();

    expect(harness.server.calls.notifySettings.slice(1)).toEqual([
      { tgId: 1001, set: { corf: false } },
      { tgId: 1001, set: { kraken: true } },
    ]);
    const [edited] = messagesTo(harness.mock, ANNA.id);
    expect(edited?.edits).toBe(2);
    expect(inlineButtons(edited?.reply_markup).map((button) => button.callback_data)).toEqual([
      'ns:enabled:0',
      'ns:corf:1',
      'ns:events:0',
      'ns:kraken:0',
    ]);
    expect(harness.mock.state().callbackAnswers.map((answer) => answer.text)).toEqual([
      t('ru', 'settings.saved'),
      t('ru', 'settings.saved'),
    ]);

    // A repeated tap with the same value changes nothing but is still answered; so is a stale button.
    harness.mock.injectCallback({ from: ANNA, data: 'ns:kraken:1', messageId: menu?.message_id });
    harness.mock.injectCallback({ from: ANNA, data: 'something-old', messageId: menu?.message_id });
    harness.mock.injectMessage({ from: ANNA, text: '/notifications' });
    await harness.settle();
    expect(messagesTo(harness.mock, ANNA.id)[0]?.edits).toBe(2);
    expect(harness.mock.state().callbackAnswers).toHaveLength(4);
    expect(messagesTo(harness.mock, ANNA.id)).toHaveLength(2);
  });
});

describe('payments', () => {
  it('approves the pre-checkout, forwards the payment once and thanks the player', async () => {
    harness = await startHarness();
    const link = await createInvoice();

    const result = await harness.mock.pay({ url: link, from: ANNA });
    expect(result.status).toBe('paid');
    const chargeId = result.status === 'paid' ? result.chargeId : '';
    await harness.settle();

    expect(harness.server.calls.preCheckout).toEqual([
      { tgId: 1001, payload: 'order-1', currency: 'XTR', totalAmount: 50 },
    ]);
    expect(harness.server.calls.successfulPayment).toHaveLength(1);
    expect(harness.server.calls.successfulPayment[0]).toMatchObject({
      tgId: 1001,
      payload: 'order-1',
      currency: 'XTR',
      totalAmount: 50,
      telegramPaymentChargeId: chargeId,
    });
    expect(harness.server.calls.successfulPayment[0]?.providerPaymentChargeId).toBeTruthy();
    expect(messagesTo(harness.mock, ANNA.id).map((message) => message.text)).toEqual([
      t('ru', 'pay.thanks', { title: 'Pearl pack' }),
    ]);

    // Telegram delivers the same update again: forwarded again, but no second thank-you.
    harness.mock.redeliver(chargeId);
    await harness.settle();
    expect(harness.server.calls.successfulPayment).toHaveLength(2);
    expect(harness.server.calls.successfulPayment[1]?.telegramPaymentChargeId).toBe(chargeId);
    expect(messagesTo(harness.mock, ANNA.id)).toHaveLength(1);
  });

  it('answers false when the server rejects the pre-checkout', async () => {
    harness = await startHarness();
    const link = await createInvoice();

    harness.server.onPreCheckout = async () => ({ ok: false, error: 'offer_expired' });
    expect(await harness.mock.pay({ url: link, from: ANNA })).toEqual({
      status: 'failed',
      error: t('ru', 'pay.rejected'),
    });

    // A sentence from the server is shown to the player as is.
    harness.server.onPreCheckout = async () => ({ ok: false, error: 'This offer has ended' });
    expect(await harness.mock.pay({ url: link, from: BOB })).toEqual({
      status: 'failed',
      error: 'This offer has ended',
    });

    await harness.settle();
    expect(harness.server.calls.successfulPayment).toHaveLength(0);
    expect(harness.mock.state().payments).toHaveLength(0);
  });

  it('answers false when the server is down or too slow during pre-checkout', async () => {
    harness = await startHarness({ deps: { preCheckoutTimeoutMs: 100 } });
    const link = await createInvoice();

    harness.server.onPreCheckout = async () => {
      throw new ServerClientError('network', 'game server is unreachable');
    };
    expect(await harness.mock.pay({ url: link, from: ANNA })).toEqual({
      status: 'failed',
      error: t('ru', 'pay.unavailable'),
    });

    // A server that never answers must not leave the query hanging.
    harness.server.onPreCheckout = () => new Promise(() => undefined);
    const startedAt = Date.now();
    expect(await harness.mock.pay({ url: link, from: BOB })).toEqual({
      status: 'failed',
      error: t('en', 'pay.unavailable'),
    });
    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(harness.server.calls.successfulPayment).toHaveLength(0);
  });

  it('keeps retrying the payment delivery until the server accepts it', async () => {
    harness = await startHarness();
    const link = await createInvoice('order-2');
    let failures = 3;
    harness.server.onSuccessfulPayment = async () => {
      if (failures > 0) {
        failures -= 1;
        throw new ServerClientError('http', 'HTTP 503', 503);
      }
      return { ok: true, duplicate: false };
    };

    expect((await harness.mock.pay({ url: link, from: ANNA })).status).toBe('paid');
    await harness.mock.waitFor(() => messagesTo(harness.mock, ANNA.id).length === 2);

    // Two attempts while handling the update, the rest in the background.
    expect(harness.server.calls.successfulPayment).toHaveLength(4);
    expect(messagesTo(harness.mock, ANNA.id).map((message) => message.text)).toEqual([
      t('ru', 'pay.delayed'),
      t('ru', 'pay.thanksGeneric'),
    ]);
    for (let i = 0; i < 50 && harness.shellter.payments.pending() > 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(harness.shellter.payments.pending()).toBe(0);
  });

  it('does not retry a payment the server refuses for good and tells the player', async () => {
    harness = await startHarness();
    const link = await createInvoice('order-3');
    harness.server.onSuccessfulPayment = async () => {
      throw new ServerClientError('http', 'HTTP 400', 400);
    };

    expect((await harness.mock.pay({ url: link, from: ANNA })).status).toBe('paid');
    await harness.settle();
    expect(harness.server.calls.successfulPayment).toHaveLength(1);
    expect(messagesTo(harness.mock, ANNA.id).map((message) => message.text)).toEqual([t('ru', 'pay.failed')]);
  });
});
