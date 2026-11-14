import { signal } from '@preact/signals';
import type {
  BattleResult, BuildingId, ClientRunAction, Enemy, LiveopsView, PlayerView, PublicRun, RunEnded, RunEvent,
} from '@shellter/shared';
import { api, ApiError, setToken } from './api';
import { lang, t } from './i18n';
import { loadDurable, loadLocal, removeLocal, saveLocal } from './platform/storage';
import { initPlatform, platformKind, tg } from './platform/telegram';

export type Screen = 'boot' | 'home' | 'hunt' | 'camp' | 'battle' | 'down' | 'result';
export type Panel = null | 'quests' | 'events' | 'shop' | 'settings' | 'inbox' | 'almanac' | 'heroes' | 'talents' | { building: BuildingId };

export interface BattleView {
  result: BattleResult;
  enemy: Enemy;
  won: boolean;
  stage: number;
  rewards?: { pearls: number; shine: number; trophies: number };
  /** The player's side, frozen at battle time. */
  me: PublicRun;
  kraken?: boolean;
}

export const player = signal<PlayerView | null>(null);
export const run = signal<PublicRun | null>(null);
export const liveops = signal<LiveopsView | null>(null);
export const screen = signal<Screen>('boot');
export const panel = signal<Panel>(null);
export const toast = signal<{ text: string; id: number } | null>(null);
export const busy = signal(false);
export const bootError = signal<string | null>(null);
export const ended = signal<(RunEnded & { last: PublicRun }) | null>(null);
export const battle = signal<BattleView | null>(null);
/** Events of the last action; screens animate merges, growth and so on from them. */
export const lastEvents = signal<RunEvent[]>([]);
export const loadProgress = signal(0);
/** Website first visit: the boot screen doubles as a landing page until the visitor taps Play. */
export const landing = signal<(() => void) | null>(null);

export interface Settings {
  music: number;
  sfx: number;
  haptics: boolean;
  calm: boolean;
}
export const settings = signal<Settings>(loadLocal<Settings>('settings', { music: 0.6, sfx: 0.8, haptics: true, calm: false }));

export function setSettings(patch: Partial<Settings>): void {
  settings.value = { ...settings.value, ...patch };
  saveLocal('settings', settings.value);
}

let toastId = 0;
export function showToast(text: string): void {
  toastId += 1;
  const id = toastId;
  toast.value = { text, id };
  setTimeout(() => {
    if (toast.value?.id === id) toast.value = null;
  }, 2400);
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'offline') return t('common.offline');
    if (e.code === 'no_pearls') return t('camp.nopearls');
    if (e.code === 'ad_limit') return t('ad.limit');
  }
  return t('common.error');
}

export function haptic(kind: 'light' | 'medium' | 'heavy' | 'success' | 'error' | 'select'): void {
  if (!settings.value.haptics) return;
  const h = tg()?.HapticFeedback;
  try {
    if (h) {
      if (kind === 'success' || kind === 'error') h.notificationOccurred(kind);
      else if (kind === 'select') h.selectionChanged();
      else h.impactOccurred(kind);
    } else if (navigator.vibrate) {
      navigator.vibrate(kind === 'heavy' ? 25 : kind === 'medium' ? 14 : 8);
    }
  } catch {
    /* not supported */
  }
}

// --- Analytics -----------------------------------------------------------------------------------

const sessionId = Math.random().toString(36).slice(2) + Date.now().toString(36);
const sessionStart = Date.now();
let queue: { type: string; props?: Record<string, unknown>; t: number }[] = [];

export function track(type: string, props?: Record<string, unknown>): void {
  queue.push(props ? { type, props, t: Date.now() } : { type, t: Date.now() });
  if (queue.length >= 20) flushAnalytics();
}

export function flushAnalytics(): void {
  if (queue.length === 0 || !player.value) return;
  const events = queue;
  queue = [];
  api.analytics(sessionId, events).catch(() => undefined);
}

export function sessionSeconds(): number {
  return Math.round((Date.now() - sessionStart) / 1000);
}

// --- Auth and boot ---------------------------------------------------------------------------------

export function applyAuth(res: { token: string; secret?: string; player: PlayerView; run: PublicRun | null }): void {
  setToken(res.token);
  if (res.secret) saveLocal('guest_secret', res.secret, true);
  player.value = res.player;
  run.value = res.run;
  lang.value = res.player.lang;
  document.documentElement.lang = res.player.lang;
}

export async function authenticate(): Promise<void> {
  const kind = await initPlatform(async (user, startParam) => (await api.devInitData(user, startParam)).initData);
  const app = tg();
  if (kind !== 'web' && app?.initData) {
    applyAuth(await api.authTelegram(app.initData));
    return;
  }
  const secret = await loadDurable<string | null>('guest_secret', null);
  if (secret) {
    try {
      applyAuth(await api.authGuest(secret));
      return;
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) throw e;
      removeLocal('guest_secret');
    }
  }
  applyAuth(await api.authGuest());
  // A browser language other than Russian switches a fresh guest to English.
  if (!/^(ru|uk|be|kk)/i.test(navigator.language) && player.value) {
    setLang('en');
  }
}

export function setLang(l: 'ru' | 'en'): void {
  lang.value = l;
  document.documentElement.lang = l;
  api.settings({ lang: l }).then((r) => (player.value = r.player)).catch(() => undefined);
}

export async function refreshMe(): Promise<void> {
  const me = await api.me();
  player.value = me.player;
  run.value = me.run;
  liveops.value = me.liveops;
}

export function screenForRun(r: PublicRun | null): Screen {
  if (!r) return 'home';
  if (r.phase === 'hunt') return 'hunt';
  if (r.phase === 'battle') return 'camp';
  if (r.phase === 'down') return 'down';
  return 'camp';
}

// --- Run actions -----------------------------------------------------------------------------------

/** Sends one run action. Retries once with the same seq on a network error (the server dedups). */
export async function act(action: ClientRunAction): Promise<RunEvent[] | null> {
  const r = run.value;
  if (!r || busy.value) return null;
  busy.value = true;
  try {
    const seq = r.seq + 1;
    let res;
    try {
      res = await api.runAction(r.id, seq, action);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'offline') {
        await new Promise((ok) => setTimeout(ok, 1200));
        res = await api.runAction(r.id, seq, action);
      } else throw e;
    }
    if (res.player) player.value = res.player;
    lastEvents.value = res.events;
    const b = res.events.find((e) => e.type === 'battle');
    if (b && b.type === 'battle') {
      const view: BattleView = { result: b.result, enemy: b.enemy, won: b.won, stage: r.battle?.stage ?? r.stage, me: r };
      if (b.rewards) view.rewards = b.rewards;
      battle.value = view;
    }
    if (res.ended) ended.value = { ...res.ended, last: r };
    run.value = res.run;
    return res.events;
  } catch (e) {
    if (e instanceof ApiError && (e.code === 'bad_seq' || e.code === 'run_ended' || e.code === 'run_not_found')) {
      // Local state went stale (another device?): resync.
      await refreshMe().catch(() => undefined);
      screen.value = screenForRun(run.value);
    }
    showToast(errorText(e));
    return null;
  } finally {
    busy.value = false;
  }
}

export async function startRun(heroId: string): Promise<boolean> {
  if (busy.value) return false;
  busy.value = true;
  try {
    const res = await api.runStart(heroId);
    player.value = res.player;
    run.value = res.run;
    ended.value = null;
    battle.value = null;
    removeLocal('hunt');
    screen.value = 'hunt';
    return true;
  } catch (e) {
    showToast(errorText(e));
    return false;
  } finally {
    busy.value = false;
  }
}

/** Wraps a meta request: sets the fresh player on success, shows a toast on failure. */
export async function meta<T extends { player: PlayerView }>(fn: () => Promise<T>): Promise<T | null> {
  if (busy.value) return null;
  busy.value = true;
  try {
    const res = await fn();
    player.value = res.player;
    return res;
  } catch (e) {
    showToast(errorText(e));
    return null;
  } finally {
    busy.value = false;
  }
}

export function isTelegram(): boolean {
  return platformKind() !== 'web';
}
