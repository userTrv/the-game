import { tg } from './telegram';

/**
 * Small persistent key-value store. localStorage is the base; inside Telegram the same values are
 * mirrored to DeviceStorage (survives a cleared WebView) and, for tiny cross-device values such as
 * the guest secret, to CloudStorage.
 */
const PREFIX = 'shellter_';

export function loadLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function saveLocal(key: string, value: unknown, cloud = false): void {
  const raw = JSON.stringify(value);
  try {
    localStorage.setItem(PREFIX + key, raw);
  } catch {
    /* private mode or quota: the game still works, it just forgets */
  }
  const app = tg();
  try {
    app?.DeviceStorage?.setItem(PREFIX + key, raw);
    if (cloud && raw.length < 4000) app?.CloudStorage?.setItem(PREFIX + key, raw);
  } catch {
    /* storage APIs are optional */
  }
}

export function removeLocal(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/** Reads a value that may only exist in Telegram's storages (e.g. after the WebView was wiped). */
export function loadDurable<T>(key: string, fallback: T): Promise<T> {
  const local = loadLocal<T | null>(key, null);
  if (local !== null) return Promise.resolve(local);
  const app = tg();
  return new Promise((resolve) => {
    const done = (raw: string | null | undefined): void => {
      try {
        resolve(raw ? (JSON.parse(raw) as T) : fallback);
      } catch {
        resolve(fallback);
      }
    };
    const timer = setTimeout(() => resolve(fallback), 1500);
    const finish = (raw: string | null | undefined): void => {
      clearTimeout(timer);
      done(raw);
    };
    try {
      if (app?.DeviceStorage) app.DeviceStorage.getItem(PREFIX + key, (_e, v) => (v ? finish(v) : app.CloudStorage ? app.CloudStorage.getItem(PREFIX + key, (_e2, v2) => finish(v2)) : finish(null)));
      else if (app?.CloudStorage) app.CloudStorage.getItem(PREFIX + key, (_e, v) => finish(v));
      else finish(null);
    } catch {
      finish(null);
    }
  });
}
