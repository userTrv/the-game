import type { AdPlacement } from '@shellter/shared';
import { api, ApiError } from '../api';
import { platformKind } from './telegram';

/**
 * Rewarded ads behind a provider-agnostic interface. A provider only shows the ad; the reward is
 * granted by the server after the ad network's server-to-server callback, never by this code.
 */
export interface AdProvider {
  id: string;
  available(): boolean;
  /** Resolves true when the ad was watched to the end as far as the SDK can tell. */
  show(placement: AdPlacement): Promise<boolean>;
}

interface AdsgramController {
  show(): Promise<{ done: boolean }>;
}
declare global {
  interface Window {
    Adsgram?: { init(opts: { blockId: string }): AdsgramController };
  }
}

const ADSGRAM_BLOCK = (import.meta.env.VITE_ADSGRAM_BLOCK_ID as string | undefined) ?? '';

function loadScript(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve(true);
    el.onerror = () => resolve(false);
    setTimeout(() => resolve(false), 8000);
    document.head.appendChild(el);
  });
}

/** AdsGram: the main rewarded network for Telegram Mini Apps. */
const adsgram: AdProvider = {
  id: 'adsgram',
  available: () => platformKind() === 'telegram' && ADSGRAM_BLOCK !== '',
  async show() {
    if (!window.Adsgram && !(await loadScript('https://sad.adsgram.ai/js/sad.min.js'))) return false;
    try {
      const res = await window.Adsgram?.init({ blockId: ADSGRAM_BLOCK }).show();
      return res?.done === true;
    } catch {
      return false;
    }
  },
};

/** Dev/e2e provider: a short fake "ad", then the dev server plays the ad network's callback. */
const mock: AdProvider = {
  id: 'mock',
  available: () => import.meta.env.VITE_MOCK_ADS === 'true' || (import.meta.env.DEV && platformKind() !== 'telegram'),
  async show() {
    const el = document.createElement('div');
    el.className = 'mock-ad';
    el.textContent = 'AD';
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 600));
    el.remove();
    try {
      return (await api.devAdWatch()).ok;
    } catch {
      return false;
    }
  },
};

/** Add further networks (Monetag, ...) here; the first available one is used. */
const PROVIDERS: AdProvider[] = [adsgram, mock];

export function adsAvailable(): boolean {
  return PROVIDERS.some((p) => p.available());
}

export type AdResult = { ok: true; intentId: string } | { ok: false; reason: 'limit' | 'failed' | 'unavailable' };

/**
 * Full rewarded flow: server intent -> ad -> wait until the server has seen the network's callback.
 * `noAds` players get an already rewarded intent and skip the ad.
 */
export async function watchAd(placement: AdPlacement, noAds: boolean): Promise<AdResult> {
  const provider = PROVIDERS.find((p) => p.available());
  if (!provider && !noAds) return { ok: false, reason: 'unavailable' };
  let intent;
  try {
    intent = await api.adIntent(placement);
  } catch (e) {
    return { ok: false, reason: e instanceof ApiError && e.code === 'ad_limit' ? 'limit' : 'failed' };
  }
  if (intent.status === 'rewarded') return { ok: true, intentId: intent.id };
  if (!provider || !(await provider.show(placement))) return { ok: false, reason: 'failed' };
  for (let i = 0; i < 12; i++) {
    try {
      if ((await api.adStatus(intent.id)).status === 'rewarded') return { ok: true, intentId: intent.id };
    } catch {
      /* keep polling */
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return { ok: false, reason: 'failed' };
}
