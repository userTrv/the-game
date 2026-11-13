import { Bot, GrammyError, HttpError, InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import type { BotConfig } from './config';
import { RU_LANGUAGE_CODES, escapeHtml, resolveLang, t } from './i18n';
import type { Lang, MessageKey } from './i18n';
import { describeError } from './logger';
import type { Logger } from './logger';
import { createPaymentForwarder } from './payments';
import type { PaymentForwarder, PaymentRetryOptions } from './payments';
import type { NotifySettingKey, NotifySettings, ServerClient, TgUserInfo } from './server-client';

export interface BotDeps {
  server: ServerClient;
  logger: Logger;
  /** Skips the initial `getMe` when provided. */
  botInfo?: UserFromGetMe;
  /** Hard limit for the server's pre-checkout answer. Default 3000 ms. */
  preCheckoutTimeoutMs?: number;
  paymentRetry?: PaymentRetryOptions;
}

export interface ShellterBot {
  bot: Bot;
  payments: PaymentForwarder;
  /** Registers the command list (ru + en) and the default menu button. Call once on startup. */
  setupProfile(): Promise<void>;
}

/** Update types the bot handles; pass to `bot.start` / `setWebhook`. */
export const ALLOWED_UPDATES = ['message', 'callback_query', 'pre_checkout_query'] as const;

/** Deep-link payloads Telegram can deliver: up to 64 characters of A-Z, a-z, 0-9, _ and -. */
const START_PARAM = /^[A-Za-z0-9_-]{1,64}$/;
const SETTINGS_CALLBACK = /^ns:(enabled|corf|events|kraken):([01])$/;
const SETTING_KEYS: readonly NotifySettingKey[] = ['enabled', 'corf', 'events', 'kraken'];
const COMMANDS = ['start', 'play', 'settings', 'help', 'paysupport', 'terms'] as const;
const LANG_CACHE_SIZE = 20_000;

/** The Mini App URL, with the deep-link payload passed the way Telegram does it for direct links. */
export function miniAppUrl(config: Pick<BotConfig, 'miniAppUrl'>, startParam?: string): string {
  if (startParam === undefined) return config.miniAppUrl;
  const url = new URL(config.miniAppUrl);
  url.searchParams.set('tgWebAppStartParam', startParam);
  return url.toString();
}

export function playKeyboard(config: Pick<BotConfig, 'miniAppUrl'>, lang: Lang, startParam?: string): InlineKeyboard {
  return new InlineKeyboard().webApp(t(lang, 'btn.play'), miniAppUrl(config, startParam));
}

export function settingsKeyboard(lang: Lang, settings: NotifySettings): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const key of SETTING_KEYS) {
    const on = settings[key];
    const label: MessageKey = `settings.${key}`;
    // The callback carries the desired new value, so a double tap cannot toggle twice.
    keyboard.text(`${on ? '✅' : '⬜'} ${t(lang, label)}`, `ns:${key}:${on ? 0 : 1}`).row();
  }
  return keyboard;
}

function settingsText(lang: Lang, settings: NotifySettings): string {
  return t(lang, 'settings.title') + (settings.enabled ? '' : t(lang, 'settings.allOff'));
}

function toTgUser(from: NonNullable<Context['from']>): TgUserInfo {
  return {
    id: from.id,
    first_name: from.first_name,
    ...(from.last_name !== undefined ? { last_name: from.last_name } : {}),
    ...(from.username !== undefined ? { username: from.username } : {}),
    ...(from.language_code !== undefined ? { language_code: from.language_code } : {}),
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function isNotModified(error: unknown): boolean {
  return error instanceof GrammyError && error.description.includes('message is not modified');
}

/**
 * The server's `error` may be a machine code or a sentence meant for the player. Only text that looks
 * like a sentence is shown; codes are replaced with a generic localized message.
 */
function playerFacingError(error: string | undefined): string | undefined {
  if (error === undefined) return undefined;
  const text = error.trim();
  return /\s/.test(text) ? text.slice(0, 200) : undefined;
}

export function createBot(config: BotConfig, deps: BotDeps): ShellterBot {
  const { server, logger } = deps;
  const preCheckoutTimeoutMs = deps.preCheckoutTimeoutMs ?? 3000;
  const bot = new Bot(config.botToken, {
    client: { apiRoot: config.telegramApiRoot },
    ...(deps.botInfo ? { botInfo: deps.botInfo } : {}),
  });
  const payments = createPaymentForwarder(server, logger.child({ scope: 'payments' }), deps.paymentRetry);

  // The server knows the player's language; remember its last answer so that commands which do not
  // call the server (/help, /terms, payment messages) use the same language.
  const langCache = new Map<number, Lang>();
  const rememberLang = (tgId: number, lang: Lang): Lang => {
    langCache.delete(tgId);
    langCache.set(tgId, lang);
    if (langCache.size > LANG_CACHE_SIZE) {
      const oldest = langCache.keys().next();
      if (!oldest.done) langCache.delete(oldest.value);
    }
    return lang;
  };
  const langOf = (from: { id: number; language_code?: string } | undefined): Lang =>
    from === undefined ? 'ru' : resolveLang(langCache.get(from.id), from.language_code);

  bot.catch((error) => {
    logger.error('update handler failed', { updateId: error.ctx.update.update_id, ...describeError(error.error) });
  });

  const privateChat = bot.chatType('private');

  privateChat.command('start', async (ctx) => {
    const payload = ctx.match.trim();
    const startParam = START_PARAM.test(payload) ? payload : undefined;
    let lang = langOf(ctx.from);
    let isNew = true;
    try {
      const result = await server.botStart({ tgUser: toTgUser(ctx.from), ...(startParam ? { startParam } : {}) });
      lang = rememberLang(ctx.from.id, resolveLang(result.lang, ctx.from.language_code));
      isNew = result.isNew;
    } catch (error) {
      // The Mini App can still register the player itself, so the welcome is sent anyway.
      logger.warn('bot start: server call failed', { tgId: ctx.from.id, ...describeError(error) });
    }
    await ctx.reply(t(lang, isNew ? 'start.welcomeNew' : 'start.welcomeBack', { name: ctx.from.first_name }), {
      reply_markup: playKeyboard(config, lang, startParam),
    });
    try {
      await ctx.api.setChatMenuButton({
        chat_id: ctx.chat.id,
        menu_button: { type: 'web_app', text: t(lang, 'menu.play'), web_app: { url: config.miniAppUrl } },
      });
    } catch (error) {
      logger.warn('setChatMenuButton failed', { tgId: ctx.from.id, ...describeError(error) });
    }
  });

  privateChat.command('play', async (ctx) => {
    const lang = langOf(ctx.from);
    await ctx.reply(t(lang, 'play.text'), { reply_markup: playKeyboard(config, lang) });
  });

  privateChat.command('help', async (ctx) => {
    const lang = langOf(ctx.from);
    await ctx.reply(t(lang, 'help.text'), { parse_mode: 'HTML', reply_markup: playKeyboard(config, lang) });
  });

  privateChat.command('paysupport', async (ctx) => {
    const lang = langOf(ctx.from);
    await ctx.reply(
      t(lang, 'paysupport.text', { contact: escapeHtml(config.supportContact), id: ctx.from.id }),
      { parse_mode: 'HTML', link_preview_options: { is_disabled: true } },
    );
  });

  privateChat.command('terms', async (ctx) => {
    const lang = langOf(ctx.from);
    await ctx.reply(t(lang, 'terms.text', { contact: escapeHtml(config.supportContact) }), {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  });

  privateChat.command(['settings', 'notifications'], async (ctx) => {
    let lang = langOf(ctx.from);
    try {
      const result = await server.notifySettings({ tgId: ctx.from.id });
      lang = rememberLang(ctx.from.id, resolveLang(result.lang, ctx.from.language_code));
      await ctx.reply(settingsText(lang, result.settings), {
        parse_mode: 'HTML',
        reply_markup: settingsKeyboard(lang, result.settings),
      });
    } catch (error) {
      logger.warn('notify settings: load failed', { tgId: ctx.from.id, ...describeError(error) });
      await ctx.reply(t(lang, 'settings.unavailable'));
    }
  });

  bot.callbackQuery(SETTINGS_CALLBACK, async (ctx) => {
    const key = ctx.match[1] as NotifySettingKey;
    const value = ctx.match[2] === '1';
    let lang = langOf(ctx.from);
    let settings: NotifySettings;
    try {
      const result = await server.notifySettings({ tgId: ctx.from.id, set: { [key]: value } });
      lang = rememberLang(ctx.from.id, resolveLang(result.lang, ctx.from.language_code));
      settings = result.settings;
    } catch (error) {
      logger.warn('notify settings: save failed', { tgId: ctx.from.id, ...describeError(error) });
      await ctx.answerCallbackQuery({ text: t(lang, 'settings.error'), show_alert: true });
      return;
    }
    try {
      await ctx.editMessageText(settingsText(lang, settings), {
        parse_mode: 'HTML',
        reply_markup: settingsKeyboard(lang, settings),
      });
    } catch (error) {
      if (!isNotModified(error)) logger.warn('settings message edit failed', describeError(error));
    }
    await ctx.answerCallbackQuery({ text: t(lang, 'settings.saved') });
  });

  // Any other button: just stop the loading spinner.
  bot.on('callback_query', async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  // ---------------------------------------------------------------------------------------------------
  // Payments (Telegram Stars)
  // ---------------------------------------------------------------------------------------------------

  bot.on('pre_checkout_query', async (ctx) => {
    const query = ctx.preCheckoutQuery;
    const lang = langOf(query.from);
    let ok = false;
    let errorMessage = t(lang, 'pay.unavailable');
    try {
      const result = await withTimeout(
        server.preCheckout({
          tgId: query.from.id,
          payload: query.invoice_payload,
          currency: query.currency,
          totalAmount: query.total_amount,
        }),
        preCheckoutTimeoutMs,
      );
      ok = result.ok;
      if (!ok) {
        errorMessage = playerFacingError(result.error) ?? t(lang, 'pay.rejected');
        logger.info('pre-checkout rejected by server', { tgId: query.from.id, reason: result.error });
      }
    } catch (error) {
      logger.warn('pre-checkout: server did not answer', { tgId: query.from.id, ...describeError(error) });
    }
    // Telegram waits 10 s at most; the query must be answered whatever happened above.
    const answer = (): Promise<true> =>
      ctx.answerPreCheckoutQuery(ok, ok ? undefined : { error_message: errorMessage });
    try {
      await answer();
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      await answer();
    }
  });

  bot.on('message:successful_payment', async (ctx) => {
    const payment = ctx.message.successful_payment;
    const from = ctx.from;
    const chatId = ctx.chat.id;
    const lang = langOf(from);
    await payments.forward(
      {
        tgId: from.id,
        payload: payment.invoice_payload,
        currency: payment.currency,
        totalAmount: payment.total_amount,
        telegramPaymentChargeId: payment.telegram_payment_charge_id,
        ...(payment.provider_payment_charge_id ? { providerPaymentChargeId: payment.provider_payment_charge_id } : {}),
      },
      async (outcome) => {
        if (outcome.kind === 'delayed') {
          await bot.api.sendMessage(chatId, t(lang, 'pay.delayed'));
        } else if (outcome.kind === 'failed') {
          await bot.api.sendMessage(chatId, t(lang, 'pay.failed'));
        } else if (!outcome.response.duplicate) {
          const title = outcome.response.productTitle;
          await bot.api.sendMessage(chatId, title ? t(lang, 'pay.thanks', { title }) : t(lang, 'pay.thanksGeneric'));
        }
      },
    );
  });

  const commandsFor = (lang: Lang): { command: string; description: string }[] =>
    COMMANDS.map((command) => ({ command, description: t(lang, `cmd.${command}`) }));

  return {
    bot,
    payments,
    async setupProfile() {
      // English is the default list; Russian is registered for every language served in Russian.
      await bot.api.setMyCommands(commandsFor('en'));
      for (const code of RU_LANGUAGE_CODES) {
        await bot.api.setMyCommands(commandsFor('ru'), { language_code: code as 'ru' });
      }
      await bot.api.setChatMenuButton({
        menu_button: { type: 'web_app', text: t('ru', 'menu.play'), web_app: { url: config.miniAppUrl } },
      });
    },
  };
}
