import type {
  AdIntentView, AdPlacement, AuthResponse, BuildingId, ClientRunAction, Cost, InboxItem, KrakenAttackResponse, LiveopsView, MeResponse,
  PlayerView, PublicRun, RunActionResponse,
} from '@shellter/shared';

import { ApiError } from './apiError';
import { localApi } from './local/backend';

export { ApiError };

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
let token: string | null = null;

export function setToken(t: string | null): void {
  token = t;
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError('offline', 0);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(err?.code ?? 'internal', res.status, err?.message);
  }
  return data as T;
}

type P = { player: PlayerView };

const httpApi = {
  authTelegram: (initData: string) => call<AuthResponse>('POST', '/api/auth/telegram', { initData }),
  authGuest: (secret?: string) => call<AuthResponse>('POST', '/api/auth/guest', secret ? { secret } : {}),
  authLink: (initData: string) => call<AuthResponse>('POST', '/api/auth/link', { initData }),
  authWidget: (data: Record<string, string | number>) => call<AuthResponse>('POST', '/api/auth/widget', data),
  me: () => call<MeResponse>('GET', '/api/me'),
  settings: (body: { lang?: 'ru' | 'en'; name?: string }) => call<P>('POST', '/api/me/settings', body),
  notifyGet: () => call<{ settings: Record<string, boolean>; telegram: boolean }>('GET', '/api/me/notify'),
  notifySet: (body: Record<string, boolean>) => call<{ settings: Record<string, boolean> }>('POST', '/api/me/notify', body),
  runStart: (heroId: string) => call<{ run: PublicRun; player: PlayerView }>('POST', '/api/run/start', { heroId }),
  runAction: (runId: string, seq: number, action: ClientRunAction) => call<RunActionResponse>('POST', '/api/run/action', { runId, seq, action }),
  runAbandon: (runId: string) => call<RunActionResponse>('POST', '/api/run/abandon', { runId }),
  runDouble: (runId: string, adIntentId: string) => call<P & { gained: Cost }>('POST', '/api/run/double', { runId, adIntentId }),
  upgrade: (building: BuildingId) => call<P>('POST', '/api/town/upgrade', { building }),
  talent: (id: string) => call<P>('POST', '/api/town/talent', { id }),
  hero: (heroId: string) => call<P>('POST', '/api/town/hero', { heroId }),
  garden: (off: string[]) => call<P>('POST', '/api/town/garden', { off }),
  corf: (adIntentId?: string) => call<P & { gained: number }>('POST', '/api/corf/collect', adIntentId ? { adIntentId } : {}),
  almanacClaim: (id: string) => call<P & { reward: Cost }>('POST', '/api/almanac/claim', { id }),
  questClaim: (id: string) => call<P & { reward: Cost }>('POST', '/api/quests/claim', { id }),
  passClaim: (level: number, track: 'free' | 'premium') => call<P>('POST', '/api/pass/claim', { level, track }),
  equip: (id: string) => call<P>('POST', '/api/cosmetics/equip', { id }),
  liveops: () => call<LiveopsView>('GET', '/api/liveops'),
  krakenAttack: () => call<KrakenAttackResponse>('POST', '/api/kraken/attack', {}),
  krakenClaim: (pct: number) => call<P & { reward: Cost }>('POST', '/api/kraken/claim', { pct }),
  inbox: () => call<{ items: InboxItem[] }>('GET', '/api/inbox'),
  inboxClaim: (id: string) => call<P>('POST', '/api/inbox/claim', { id }),
  adIntent: (placement: AdPlacement) => call<AdIntentView>('POST', '/api/ads/intent', { placement }),
  adStatus: (id: string) => call<AdIntentView>('GET', `/api/ads/intent/${id}`),
  adChest: (id: string) => call<P & { reward: Cost }>('POST', '/api/ads/chest', { id }),
  adUnlock: (id: string, adIntentId: string) => call<P & { unlocked: boolean }>('POST', '/api/ads/unlock', { id, adIntentId }),
  analytics: (sessionId: string, events: { type: string; props?: Record<string, unknown>; t: number }[]) => call<{ ok: true }>('POST', '/api/analytics', { sessionId, events }),
  devInitData: (user: { id: number; first_name: string; language_code: string }, startParam?: string) =>
    call<{ initData: string }>('POST', '/api/dev/init-data', startParam ? { user, startParam } : { user }),
  devAdWatch: () => call<{ ok: boolean }>('POST', '/api/dev/ad-watch', {}),
};

export type Api = typeof httpApi;

/** The Yandex Games build runs without a server: the same calls are answered in the browser. */
export const api: Api = import.meta.env.VITE_TARGET === 'yandex' ? localApi : httpApi;
