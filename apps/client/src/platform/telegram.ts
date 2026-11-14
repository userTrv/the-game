/**
 * Thin, typed wrapper around `window.Telegram.WebApp` plus a mock for plain browsers and Playwright.
 * Everything Telegram-specific goes through `tg()`; the rest of the game never touches the global.
 */
export interface TgInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface TgWebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name?: string; language_code?: string }; start_param?: string };
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  isFullscreen?: boolean;
  safeAreaInset?: TgInsets;
  contentSafeAreaInset?: TgInsets;
  ready(): void;
  expand(): void;
  close(): void;
  isVersionAtLeast?(v: string): boolean;
  requestFullscreen?(): void;
  disableVerticalSwipes?(): void;
  enableVerticalSwipes?(): void;
  setHeaderColor?(c: string): void;
  setBackgroundColor?(c: string): void;
  setBottomBarColor?(c: string): void;
  onEvent(event: string, cb: () => void): void;
  offEvent(event: string, cb: () => void): void;
  openInvoice(url: string, cb?: (status: 'paid' | 'cancelled' | 'failed' | 'pending') => void): void;
  openTelegramLink(url: string): void;
  openLink?(url: string): void;
  shareMessage?(id: string, cb?: (ok: boolean) => void): void;
  addToHomeScreen?(): void;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
  CloudStorage?: {
    setItem(key: string, value: string, cb?: (err: unknown, ok?: boolean) => void): void;
    getItem(key: string, cb: (err: unknown, value?: string) => void): void;
    removeItem(key: string, cb?: (err: unknown, ok?: boolean) => void): void;
  };
  DeviceStorage?: {
    setItem(key: string, value: string, cb?: (err: unknown, ok?: boolean) => void): void;
    getItem(key: string, cb: (err: unknown, value?: string | null) => void): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
    /** Calls recorded by the mock, for e2e assertions. */
    __tgMock?: { calls: string[]; back: (() => void)[] };
  }
}

export type Platform = 'telegram' | 'mock' | 'web';

let platform: Platform = 'web';

export function platformKind(): Platform {
  return platform;
}

export function tg(): TgWebApp | null {
  return platform === 'web' ? null : (window.Telegram?.WebApp ?? null);
}

function loadScript(src: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const el = document.createElement('script');
    const timer = setTimeout(() => resolve(false), timeoutMs);
    el.src = src;
    el.async = true;
    el.onload = () => {
      clearTimeout(timer);
      resolve(true);
    };
    el.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    document.head.appendChild(el);
  });
}

/** Installs a fake Telegram WebApp. `signInitData` asks the dev server for correctly signed initData. */
async function installMock(signInitData: (user: { id: number; first_name: string; language_code: string }, startParam?: string) => Promise<string>): Promise<void> {
  const q = new URLSearchParams(location.search);
  const id = Number(q.get('tgid') ?? localStorage.getItem('mock_tg_id') ?? 0) || 100000 + Math.floor(Math.random() * 900000);
  localStorage.setItem('mock_tg_id', String(id));
  const user = { id, first_name: q.get('tgname') ?? 'Тестер', language_code: q.get('tglang') ?? 'ru' };
  const startParam = q.get('startapp') ?? undefined;
  const initData = await signInitData(user, startParam);
  const calls: string[] = [];
  const back: (() => void)[] = [];
  window.__tgMock = { calls, back };
  const rec = (name: string) => (...args: unknown[]) => {
    calls.push(`${name}(${args.map((a) => (typeof a === 'function' ? 'fn' : JSON.stringify(a))).join(',')})`);
  };
  const store = (prefix: string) => ({
    setItem(key: string, value: string, cb?: (err: unknown, ok?: boolean) => void) {
      localStorage.setItem(prefix + key, value);
      cb?.(null, true);
    },
    getItem(key: string, cb: (err: unknown, value?: string) => void) {
      cb(null, localStorage.getItem(prefix + key) ?? '');
    },
    removeItem(key: string, cb?: (err: unknown, ok?: boolean) => void) {
      localStorage.removeItem(prefix + key);
      cb?.(null, true);
    },
  });
  const mockTgUrl = (import.meta.env.VITE_MOCK_TG_URL as string | undefined) ?? 'http://localhost:8081';
  const app: TgWebApp = {
    initData,
    initDataUnsafe: startParam ? { user, start_param: startParam } : { user },
    version: '9.1',
    platform: 'mock',
    colorScheme: q.get('tgtheme') === 'light' ? 'light' : 'dark',
    safeAreaInset: { top: Number(q.get('safetop') ?? 0), bottom: Number(q.get('safebottom') ?? 0), left: 0, right: 0 },
    contentSafeAreaInset: { top: Number(q.get('contenttop') ?? 0), bottom: 0, left: 0, right: 0 },
    ready: rec('ready'),
    expand: rec('expand'),
    close: rec('close'),
    isVersionAtLeast: () => true,
    requestFullscreen: rec('requestFullscreen'),
    disableVerticalSwipes: rec('disableVerticalSwipes'),
    enableVerticalSwipes: rec('enableVerticalSwipes'),
    setHeaderColor: rec('setHeaderColor'),
    setBackgroundColor: rec('setBackgroundColor'),
    setBottomBarColor: rec('setBottomBarColor'),
    onEvent: rec('onEvent'),
    offEvent: rec('offEvent'),
    openInvoice(url, cb) {
      calls.push(`openInvoice(${url})`);
      // The mock Bot API plays the user's part: pre-checkout, then successful_payment.
      fetch(`${mockTgUrl}/control/pay`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url, from: user }) })
        .then((r) => r.json() as Promise<{ status: string }>)
        .then((r) => cb?.(r.status === 'paid' ? 'paid' : 'failed'))
        .catch(() => cb?.('failed'));
    },
    openTelegramLink: rec('openTelegramLink'),
    openLink: rec('openLink'),
    shareMessage(idMsg, cb) {
      calls.push(`shareMessage(${idMsg})`);
      cb?.(true);
    },
    addToHomeScreen: rec('addToHomeScreen'),
    BackButton: {
      show: rec('BackButton.show'),
      hide: rec('BackButton.hide'),
      onClick: (cb) => void back.push(cb),
      offClick: (cb) => void back.splice(back.indexOf(cb), 1),
    },
    HapticFeedback: { impactOccurred: rec('haptic.impact'), notificationOccurred: rec('haptic.notify'), selectionChanged: rec('haptic.select') },
    CloudStorage: store('tgcloud_'),
    DeviceStorage: store('tgdevice_'),
  };
  window.Telegram = { WebApp: app };
}

/**
 * Decides where the game runs: inside Telegram (launch params in the URL hash), in the mock
 * (`?mock=tg`, dev builds only) or on the plain website.
 */
export async function initPlatform(signInitData: Parameters<typeof installMock>[0]): Promise<Platform> {
  const inTelegram = /tgWebAppData=/.test(location.hash) || /tgWebAppData=/.test(location.search);
  if (inTelegram) {
    if (!window.Telegram?.WebApp) await loadScript('https://telegram.org/js/telegram-web-app.js', 6000);
    if (window.Telegram?.WebApp?.initData) platform = 'telegram';
  } else if (new URLSearchParams(location.search).get('mock') === 'tg') {
    try {
      await installMock(signInitData);
      platform = 'mock';
    } catch {
      platform = 'web';
    }
  }
  const app = tg();
  if (app) {
    app.ready();
    app.expand();
    try {
      app.requestFullscreen?.();
    } catch {
      /* older clients */
    }
    // The game paints its own colours; Telegram's light or dark theme must not leak in.
    app.setHeaderColor?.('#0e3a66');
    app.setBackgroundColor?.('#0e3a66');
    app.setBottomBarColor?.('#0b2748');
    applySafeArea();
    for (const ev of ['safeAreaChanged', 'contentSafeAreaChanged', 'fullscreenChanged', 'viewportChanged']) app.onEvent(ev, applySafeArea);
  }
  return platform;
}

/** Publishes safe-area insets as CSS variables used by every screen. */
export function applySafeArea(): void {
  const app = tg();
  const s = app?.safeAreaInset;
  const c = app?.contentSafeAreaInset;
  const root = document.documentElement.style;
  root.setProperty('--safe-top', `${(s?.top ?? 0) + (c?.top ?? 0)}px`);
  root.setProperty('--safe-bottom', `${(s?.bottom ?? 0) + (c?.bottom ?? 0)}px`);
}

/** Vertical swipes close the Mini App; they must be off while a finger steers the crab. */
export function setGameplaySwipes(playing: boolean): void {
  const app = tg();
  if (!app) return;
  if (playing) app.disableVerticalSwipes?.();
  else app.enableVerticalSwipes?.();
}

let backHandler: (() => void) | null = null;

/** Shows Telegram's BackButton bound to `handler`, or hides it for null. */
export function setBackButton(handler: (() => void) | null): void {
  const app = tg();
  if (!app) return;
  if (backHandler) app.BackButton.offClick(backHandler);
  backHandler = handler;
  if (handler) {
    app.BackButton.onClick(handler);
    app.BackButton.show();
  } else {
    app.BackButton.hide();
  }
}
