export type Lang = 'ru' | 'en';

/** Languages whose speakers are better served by the Russian texts. */
export const RU_LANGUAGE_CODES = new Set(['ru', 'uk', 'be', 'kk', 'ky', 'uz', 'tg', 'hy', 'az']);

/** Picks the language: the server's answer wins, Telegram's `language_code` is the fallback. */
export function resolveLang(serverLang: string | undefined | null, languageCode: string | undefined): Lang {
  if (serverLang === 'ru' || serverLang === 'en') return serverLang;
  if (languageCode === undefined) return 'ru';
  const base = languageCode.toLowerCase().split('-')[0] ?? '';
  return RU_LANGUAGE_CODES.has(base) ? 'ru' : 'en';
}

export function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

const ru = {
  'btn.play': '🦀 Играть',
  'menu.play': 'Играть',

  'start.welcomeNew':
    '🦀 Привет, {name}! Ты — маленький рак-отшельник, а риф большой и зубастый.\n' +
    'Найди раковину покрепче, обживи свой уголок и загляни поглубже — там интереснее.\n' +
    'Жми «Играть» — прилив уже начался.',
  'start.welcomeBack':
    '🦀 С возвращением, {name}! Риф скучал, а раковина ещё тёплая.\n' +
    'Жми «Играть» — течение как раз попутное.',
  'play.text': 'Риф ждёт. Жми «Играть» — и в путь, клешни вперёд!',

  'help.text':
    '<b>Shellter</b> — рогалик про рака-отшельника: ищи раковины, исследуй риф, не попадайся Кракену.\n\n' +
    '/play — открыть игру\n' +
    '/settings — уведомления\n' +
    '/terms — условия использования\n' +
    '/help — эта подсказка',

  'cmd.start': 'Начать игру',
  'cmd.play': 'Открыть игру',
  'cmd.settings': 'Настроить уведомления',
  'cmd.help': 'Помощь',
  'cmd.terms': 'Условия использования',

  'settings.title':
    '<b>Уведомления</b>\nВыбери, о чём напоминать. Нажми на строку, чтобы включить или выключить.',
  'settings.allOff': '\n\nСейчас все уведомления выключены — бот не будет писать первым.',
  'settings.enabled': 'Все уведомления',
  'settings.corf': 'Садок полон',
  'settings.events': 'События',
  'settings.kraken': 'Кракен',
  'settings.saved': 'Сохранено',
  'settings.error': 'Не получилось сохранить. Попробуй ещё раз чуть позже.',
  'settings.unavailable': 'Не получилось загрузить настройки. Попробуй ещё раз чуть позже.',

  'terms.text':
    '<b>Условия использования Shellter</b>\n\n' +
    '1. Shellter — бесплатная игра. Внутриигровые предметы действуют только в игре и не имеют денежной ' +
    'стоимости. Покупок за деньги в игре нет.\n' +
    '2. Облики и премиум-дорожку сезона можно открыть просмотром рекламы. Ничто из этого не влияет на силу в забеге.\n' +
    '3. Прогресс привязан к аккаунту Telegram. Игра развивается, поэтому баланс и содержимое могут ' +
    'меняться. За читы и злоупотребление ошибками доступ может быть ограничен.\n' +
    '4. Игра предоставляется «как есть». Мы стараемся, чтобы всё работало, но не можем обещать ' +
    'бесперебойную работу.\n\n' +
    'Связь с нами: {contact}',

  'error.generic': 'Что-то пошло не так. Попробуй ещё раз чуть позже.',
} as const;

export type MessageKey = keyof typeof ru;

const en: Record<MessageKey, string> = {
  'btn.play': '🦀 Play',
  'menu.play': 'Play',

  'start.welcomeNew':
    "🦀 Hi, {name}! You're a tiny hermit crab, and the reef is big and full of teeth.\n" +
    "Find a sturdier shell, make a corner your own, and dive a little deeper — that's where it gets interesting.\n" +
    'Tap “Play” — the tide is already coming in.',
  'start.welcomeBack':
    '🦀 Welcome back, {name}! The reef missed you, and your shell is still warm.\n' +
    'Tap “Play” — the current is on your side.',
  'play.text': 'The reef is waiting. Tap “Play” and off you go, claws first!',

  'help.text':
    '<b>Shellter</b> is a roguelike about a hermit crab: find shells, explore the reef, stay away from the Kraken.\n\n' +
    '/play — open the game\n' +
    '/settings — notifications\n' +
    '/terms — terms of service\n' +
    '/help — this message',

  'cmd.start': 'Start the game',
  'cmd.play': 'Open the game',
  'cmd.settings': 'Notification settings',
  'cmd.help': 'Help',
  'cmd.terms': 'Terms of service',

  'settings.title': '<b>Notifications</b>\nChoose what to be reminded about. Tap a row to turn it on or off.',
  'settings.allOff': '\n\nAll notifications are off right now — the bot will not message you first.',
  'settings.enabled': 'All notifications',
  'settings.corf': 'Corf is full',
  'settings.events': 'Events',
  'settings.kraken': 'Kraken',
  'settings.saved': 'Saved',
  'settings.error': 'Could not save that. Please try again a bit later.',
  'settings.unavailable': 'Could not load your settings. Please try again a bit later.',

  'terms.text':
    '<b>Shellter terms of service</b>\n\n' +
    '1. Shellter is a free game. In-game items work only inside the game and have no monetary value. ' +
    'There are no purchases for money.\n' +
    '2. Looks and the premium season track can be unlocked by watching ads. None of it affects strength in a run.\n' +
    '3. Progress is tied to your Telegram account. The game is evolving, so balance and content may ' +
    'change. Cheating or abusing bugs may lead to restricted access.\n' +
    '4. The game is provided “as is”. We do our best to keep it running but cannot promise uninterrupted ' +
    'service.\n\n' +
    'Contact: {contact}',

  'error.generic': 'Something went wrong. Please try again a bit later.',
};

const dictionaries: Record<Lang, Record<MessageKey, string>> = { ru, en };

/** Returns the text for `key` with `{placeholders}` substituted. Values are inserted verbatim. */
export function t(lang: Lang, key: MessageKey, params: Record<string, string | number> = {}): string {
  return dictionaries[lang][key].replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
