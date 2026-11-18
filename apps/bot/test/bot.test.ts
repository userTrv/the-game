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

  it('/play and /terms reply in the right language', async () => {
    harness = await startHarness();
    harness.mock.injectMessage({ from: ANNA, text: '/play' });
    harness.mock.injectMessage({ from: ANNA, text: '/terms' });
    harness.mock.injectMessage({ from: BOB, text: '/terms' });
    await harness.settle();

    const [play, terms] = messagesTo(harness.mock, ANNA.id);
    expect(inlineButtons(play?.reply_markup)[0]?.web_app?.url).toBe(MINI_APP_URL);
    expect(terms?.text).toContain('Условия использования');
    expect(terms?.text).toContain('Покупок за деньги в игре нет');
    // The contact is HTML-escaped.
    expect(terms?.text).toContain('@shellter_support &lt;help@example.test&gt;');

    const [termsEn] = messagesTo(harness.mock, BOB.id);
    expect(termsEn?.text).toContain('terms of service');
    expect(termsEn?.text).toContain('@shellter_support');
  });

  it('registers commands in both languages and the default menu button', async () => {
    harness = await startHarness({ polling: false });
    await harness.shellter.setupProfile();
    const state = harness.mock.state();
    const byLang = new Map(state.commands.map((record) => [record.language_code, record.commands]));
    expect(byLang.get('')?.find((item) => item.command === 'terms')?.description).toBe(t('en', 'cmd.terms'));
    expect(byLang.get('ru')?.map((item) => item.command)).toEqual([
      'start',
      'play',
      'settings',
      'help',
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

