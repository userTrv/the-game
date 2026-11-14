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
    '/paysupport — помощь с покупками и возвратами\n' +
    '/terms — условия использования\n' +
    '/help — эта подсказка',

  'cmd.start': 'Начать игру',
  'cmd.play': 'Открыть игру',
  'cmd.settings': 'Настроить уведомления',
  'cmd.help': 'Помощь',
  'cmd.paysupport': 'Помощь с покупками',
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

  'paysupport.text':
    '<b>Помощь с покупками</b>\n' +
    'Покупки в Shellter оплачиваются звёздами Telegram (Telegram Stars). Если звёзды списались, а покупка ' +
    'не пришла, списание было ошибочным или ты хочешь вернуть покупку — напиши нам: {contact}\n\n' +
    'Укажи, что и когда было куплено, и свой Telegram ID: <code>{id}</code>. Мы проверим платёж и, если ' +
    'всё подтвердится, вернём звёзды на твой счёт в Telegram.\n\n' +
    'Поддержка Telegram и @BotSupport не помогают с покупками в ботах — за платежи в Shellter отвечаем мы.',

  'terms.text':
    '<b>Условия использования Shellter</b>\n\n' +
    '1. Shellter — игра. Всё, что продаётся в ней, — цифровые товары, которые действуют только внутри ' +
    'игры и не имеют денежной стоимости за её пределами.\n' +
    '2. Покупки оплачиваются звёздами Telegram (Telegram Stars). Товар начисляется сразу после оплаты; ' +
    'цена и состав показаны до подтверждения платежа.\n' +
    '3. Никакого pay-to-win: победу купить нельзя. Всё, что влияет на силу в забеге, добывается игрой.\n' +
    '4. Возвраты. Если покупка не пришла или списание было ошибочным, мы вернём звёзды. Остальные запросы ' +
    'рассматриваем вручную; при возврате купленное снимается с аккаунта. Как обратиться — /paysupport.\n' +
    '5. Прогресс привязан к аккаунту Telegram. Игра развивается, поэтому баланс и содержимое могут ' +
    'меняться. За читы и злоупотребление ошибками доступ может быть ограничен.\n' +
    '6. Игра предоставляется «как есть». Мы стараемся, чтобы всё работало, но не можем обещать ' +
    'бесперебойную работу.\n\n' +
    'Связь с нами: {contact}',

  'pay.thanks': 'Спасибо! Покупка «{title}» уже в игре. 🐚',
  'pay.thanksGeneric': 'Спасибо за покупку! Она уже ждёт тебя в игре. 🐚',
  'pay.delayed': 'Платёж получен. Начисляем покупку — это может занять пару минут.',
  'pay.failed':
    'Платёж получен, но начислить покупку не удалось. Напиши в поддержку — /paysupport: мы всё исправим ' +
    'или вернём звёзды.',
  'pay.rejected': 'Не получилось оформить покупку. Попробуй ещё раз чуть позже.',
  'pay.unavailable': 'Игра сейчас недоступна, звёзды не списаны. Попробуй ещё раз через пару минут.',

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
    '/paysupport — help with purchases and refunds\n' +
    '/terms — terms of service\n' +
    '/help — this message',

  'cmd.start': 'Start the game',
  'cmd.play': 'Open the game',
  'cmd.settings': 'Notification settings',
  'cmd.help': 'Help',
  'cmd.paysupport': 'Help with purchases',
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

  'paysupport.text':
    '<b>Help with purchases</b>\n' +
    'Purchases in Shellter are paid with Telegram Stars. If Stars were charged but the purchase did not ' +
    'arrive, the charge was a mistake, or you want a refund — write to us: {contact}\n\n' +
    'Tell us what you bought and when, and include your Telegram ID: <code>{id}</code>. We will check the ' +
    'payment and, if it is confirmed, return the Stars to your Telegram balance.\n\n' +
    'Telegram support and @BotSupport cannot help with purchases made in bots — payments in Shellter are ' +
    'our responsibility.',

  'terms.text':
    '<b>Shellter terms of service</b>\n\n' +
    '1. Shellter is a game. Everything sold in it is a digital item that works only inside the game and ' +
    'has no monetary value outside of it.\n' +
    '2. Purchases are paid with Telegram Stars. Items are delivered right after payment; the price and ' +
    'contents are shown before you confirm.\n' +
    '3. No pay-to-win: you cannot buy victory. Everything that affects your strength in a run is earned ' +
    'by playing.\n' +
    '4. Refunds. If a purchase did not arrive or you were charged by mistake, we return the Stars. Other ' +
    'requests are reviewed by hand; a refunded item is removed from your account. See /paysupport.\n' +
    '5. Progress is tied to your Telegram account. The game is evolving, so balance and content may ' +
    'change. Cheating or abusing bugs may lead to restricted access.\n' +
    '6. The game is provided “as is”. We do our best to keep it running but cannot promise uninterrupted ' +
    'service.\n\n' +
    'Contact: {contact}',

  'pay.thanks': 'Thank you! “{title}” is already in the game. 🐚',
  'pay.thanksGeneric': 'Thank you for your purchase! It is already waiting for you in the game. 🐚',
  'pay.delayed': 'Payment received. We are delivering your purchase — this can take a couple of minutes.',
  'pay.failed':
    'Payment received, but we could not deliver the purchase. Please contact support — /paysupport: we ' +
    'will fix it or return your Stars.',
  'pay.rejected': 'The purchase could not be completed. Please try again a bit later.',
  'pay.unavailable': 'The game is unavailable right now and no Stars were charged. Please try again in a couple of minutes.',

  'error.generic': 'Something went wrong. Please try again a bit later.',
};

const dictionaries: Record<Lang, Record<MessageKey, string>> = { ru, en };

/** Returns the text for `key` with `{placeholders}` substituted. Values are inserted verbatim. */
export function t(lang: Lang, key: MessageKey, params: Record<string, string | number> = {}): string {
  return dictionaries[lang][key].replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
