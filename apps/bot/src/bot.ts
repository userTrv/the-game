import { Bot, GrammyError, InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import type { BotConfig } from './config';
import { RU_LANGUAGE_CODES, escapeHtml, resolveLang, t } from './i18n';
import type { Lang, MessageKey } from './i18n';
import { describeError } from './logger';
import type { Logger } from './logger';
import type { NotifySettingKey, NotifySettings, ServerClient, TgUserInfo } from './server-client';

export interface BotDeps {
  server: ServerClient;
  logger: Logger;
  /** Skips the initial `getMe` when provided. */
  botInfo?: UserFromGetMe;
}

export interface ShellterBot {
  bot: Bot;
  /** Registers the command list (ru + en) and the default menu button. Call once on startup. */
  setupProfile(): Promise<void>;
}

/** Update types the bot handles; pass to `bot.start` / `setWebhook`. */
export const ALLOWED_UPDATES = ['message', 'callback_query'] as const;

/** Deep-link payloads Telegram can deliver: up to 64 characters of A-Z, a-z, 0-9, _ and -. */
const START_PARAM = /^[A-Za-z0-9_-]{1,64}$/;
const SETTINGS_CALLBACK = /^ns:(enabled|corf|events|kraken):([01])$/;
const SETTING_KEYS: readonly NotifySettingKey[] = ['enabled', 'corf', 'events', 'kraken'];
const COMMANDS = ['start', 'play', 'settings', 'help', 'terms'] as const;
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

function isNotModified(error: unknown): boolean {
  return error instanceof GrammyError && error.description.includes('message is not modified');
}

export function createBot(config: BotConfig, deps: BotDeps): ShellterBot {
  const { server, logger } = deps;
  const bot = new Bot(config.botToken, {
    client: { apiRoot: config.telegramApiRoot },
    ...(deps.botInfo ? { botInfo: deps.botInfo } : {}),
  });

  // The server knows the player's language; remember its last answer so that commands which do not
  // call the server (/help, /terms) use the same language.
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

  const commandsFor = (lang: Lang): { command: string; description: string }[] =>
    COMMANDS.map((command) => ({ command, description: t(lang, `cmd.${command}`) }));

  return {
    bot,
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
