/**
 * Yandex Games SDK. Only the build with VITE_TARGET=yandex loads it; every call is safe without it
 * (local preview, tests), where it falls back to a no-op or to localStorage.
 *
 * Docs: https://yandex.ru/dev/games/doc/ru/sdk/sdk-about
 */

interface YaPlayer {
  getUniqueID(): string;
  getName(): string;
  isAuthorized(): boolean;
  setData(data: Record<string, unknown>, flush?: boolean): Promise<void>;
  getData(keys?: string[]): Promise<Record<string, unknown>>;
}

interface YaAdCallbacks {
  onOpen?: () => void;
  onClose?: (wasShown: boolean) => void;
  onError?: (error: unknown) => void;
  onRewarded?: () => void;
}

export interface YaSdk {
  environment: { app: { id: string }; i18n: { lang: string } };
  features: {
    LoadingAPI?: { ready(): void };
    GameplayAPI?: { start(): void; stop(): void };
  };
  adv: {
    showFullscreenAdv(opts: { callbacks?: YaAdCallbacks }): void;
    showRewardedVideo(opts: { callbacks?: YaAdCallbacks }): void;
  };
  auth: { openAuthDialog(): Promise<void> };
  leaderboards?: {
    setScore(name: string, score: number): Promise<void>;
    getEntries(name: string, opts: { includeUser?: boolean; quantityAround?: number; quantityTop?: number }): Promise<YaLeaderboardEntries>;
  };
  isAvailableMethod?(method: string): Promise<boolean>;
  getPlayer(opts?: { scopes?: boolean; signed?: boolean }): Promise<YaPlayer>;
  serverTime?(): number;
  on(event: 'game_api_pause' | 'game_api_resume', cb: () => void): void;
}

interface YaLeaderboardEntries {
  /** 0 when the player has no entry. */
  userRank: number;
  entries: { rank: number; score: number; player: { publicName: string; uniqueID: string } }[];
}

declare global {
  interface Window {
    YaGames?: { init(): Promise<YaSdk> };
  }
}

export const IS_YANDEX = import.meta.env.VITE_TARGET === 'yandex';

let sdk: YaSdk | null = null;
let yaPlayer: YaPlayer | null = null;

export function ysdk(): YaSdk | null {
  return sdk;
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

/** Loads and initialises the SDK. Resolves null outside Yandex Games (local preview). */
export async function initYandex(): Promise<YaSdk | null> {
  if (!IS_YANDEX) return null;
  if (!window.YaGames && !(await loadScript('/sdk.js', 8000))) return null;
  try {
    sdk = (await window.YaGames?.init()) ?? null;
  } catch {
    sdk = null;
  }
  if (sdk) {
    sdk.on('game_api_pause', () => pauseHandlers.forEach((h) => h(true)));
    sdk.on('game_api_resume', () => pauseHandlers.forEach((h) => h(false)));
  }
  return sdk;
}

const pauseHandlers: ((paused: boolean) => void)[] = [];

/** The platform asks to pause (ads, purchase window, hidden tab) and to resume. */
export function onPlatformPause(cb: (paused: boolean) => void): void {
  pauseHandlers.push(cb);
}

/** Game language from the platform; the game speaks Russian and English. */
export function yandexLang(): 'ru' | 'en' | null {
  const l = sdk?.environment.i18n.lang;
  if (!l) return null;
  return /^(ru|uk|be|kk|uz)$/i.test(l) ? 'ru' : 'en';
}

/** Server time when the SDK offers it: daily quests and events should not follow a moved device clock. */
export function now(): number {
  try {
    const t = sdk?.serverTime?.();
    if (typeof t === 'number' && t > 0) return t;
  } catch {
    /* older SDK */
  }
  return Date.now();
}

export function loadingReady(): void {
  sdk?.features.LoadingAPI?.ready();
}

let playing = false;
/** GameplayAPI.start/stop, called only on a real change. */
export function setGameplay(on: boolean): void {
  if (!sdk || on === playing) return;
  playing = on;
  if (on) sdk.features.GameplayAPI?.start();
  else sdk.features.GameplayAPI?.stop();
}

// --- Player and cloud saves -----------------------------------------------------------------------

export async function getYaPlayer(): Promise<YaPlayer | null> {
  if (!sdk) return null;
  try {
    yaPlayer = await sdk.getPlayer({ scopes: false });
  } catch {
    yaPlayer = null;
  }
  return yaPlayer;
}

export function isAuthorized(): boolean {
  return yaPlayer?.isAuthorized() ?? false;
}

/** Opens the Yandex ID dialog. Resolves true when the player signed in. */
export async function signIn(): Promise<boolean> {
  if (!sdk) return false;
  try {
    await sdk.auth.openAuthDialog();
  } catch {
    return false;
  }
  await getYaPlayer();
  return isAuthorized();
}

export async function cloudLoad(key: string): Promise<unknown> {
  if (!yaPlayer) return null;
  try {
    const data = await yaPlayer.getData([key]);
    return data[key] ?? null;
  } catch {
    return null;
  }
}

export async function cloudSave(key: string, value: unknown, flush: boolean): Promise<boolean> {
  if (!yaPlayer) return false;
  try {
    await yaPlayer.setData({ [key]: value }, flush);
    return true;
  } catch {
    return false;
  }
}

// --- Ads ----------------------------------------------------------------------------------------------

let adOpen = false;

/** Rewarded video. Resolves true only after onRewarded. Sound and gameplay pause via game_api_pause. */
export function showRewarded(): Promise<boolean> {
  const s = sdk;
  if (!s || adOpen) return Promise.resolve(false);
  adOpen = true;
  return new Promise((resolve) => {
    let rewarded = false;
    const done = (): void => {
      adOpen = false;
      resolve(rewarded);
    };
    try {
      s.adv.showRewardedVideo({
        callbacks: {
          onRewarded: () => (rewarded = true),
          onClose: () => done(),
          onError: () => done(),
        },
      });
    } catch {
      done();
    }
  });
}

/**
 * Interstitial between sessions of play. The platform itself limits how often it really shows;
 * a refused call ends in onClose(false).
 */
export function showInterstitial(): Promise<boolean> {
  const s = sdk;
  if (!s || adOpen) return Promise.resolve(false);
  adOpen = true;
  return new Promise((resolve) => {
    const done = (shown: boolean): void => {
      adOpen = false;
      resolve(shown);
    };
    try {
      s.adv.showFullscreenAdv({ callbacks: { onClose: (shown) => done(shown), onError: () => done(false) } });
    } catch {
      done(false);
    }
  });
}

// --- Leaderboard ----------------------------------------------------------------------------------

/** Technical name of the league leaderboard in the developer console (numeric, descending). */
export const LEADERBOARD = 'trophies';
/** setScore allows one call per second. */
const SCORE_GAP_MS = 1100;
/** getEntries allows 20 calls per 5 minutes. */
const ENTRIES_TTL_MS = 30_000;

let scoreSent: number | null = null;
let scorePending: number | null = null;
let scoreTimer: ReturnType<typeof setTimeout> | null = null;
let scoreLastAt = 0;

async function canSetScore(): Promise<boolean> {
  if (!sdk?.leaderboards || !isAuthorized()) return false;
  try {
    return (await sdk.isAvailableMethod?.('leaderboards.setScore')) ?? true;
  } catch {
    return false;
  }
}

async function flushScore(): Promise<void> {
  scoreTimer = null;
  const score = scorePending;
  if (score === null || score === scoreSent || !(await canSetScore())) return;
  scorePending = null;
  scoreLastAt = Date.now();
  try {
    await sdk?.leaderboards?.setScore(LEADERBOARD, score);
    scoreSent = score;
    entriesCache = null;
  } catch {
    // Rate limit or network: the next change sends the current value again.
  }
}

/** Sends the player's trophies to the leaderboard; signed-in players only, at most once per second. */
export function submitTrophies(score: number): void {
  if (!sdk || score === scoreSent) return;
  scorePending = Math.max(0, Math.floor(score));
  if (scoreTimer) return;
  scoreTimer = setTimeout(() => void flushScore(), Math.max(0, scoreLastAt + SCORE_GAP_MS - Date.now()));
}

export interface LeaderboardTop {
  top: { rank: number; name: string; score: number; me: boolean }[];
  myRank: number | null;
}

let entriesCache: { at: number; data: LeaderboardTop } | null = null;

/** Top of the league leaderboard plus the player's own row; cached to respect the request limit. */
export async function leaderboardTop(): Promise<LeaderboardTop | null> {
  if (!sdk?.leaderboards) return null;
  if (entriesCache && Date.now() - entriesCache.at < ENTRIES_TTL_MS) return entriesCache.data;
  try {
    const me = yaPlayer?.getUniqueID();
    const auth = isAuthorized();
    const res = await sdk.leaderboards.getEntries(LEADERBOARD, { quantityTop: 10, includeUser: auth, quantityAround: auth ? 2 : 0 });
    const data: LeaderboardTop = {
      top: res.entries.map((e) => ({ rank: e.rank, name: e.player.publicName || '—', score: e.score, me: !!me && e.player.uniqueID === me })),
      myRank: res.userRank > 0 ? res.userRank : null,
    };
    entriesCache = { at: Date.now(), data };
    return data;
  } catch {
    return null;
  }
}
