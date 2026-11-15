import { signal } from '@preact/signals';

/**
 * Browser fullscreen for the web build: hides tabs and the address bar. Telegram has its own
 * fullscreen (see telegram.ts); iPhone Safari has no Fullscreen API, so the control is hidden there.
 */
export const fullscreen = signal(false);

export function canFullscreen(): boolean {
  return typeof document !== 'undefined' && document.fullscreenEnabled === true;
}

export async function setFullscreen(on: boolean): Promise<void> {
  try {
    if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    else if (!on && document.fullscreenElement) await document.exitFullscreen();
  } catch {
    /* refused by the browser (no user gesture, embedded frame): the toggle simply stays off */
  }
}

export function initFullscreen(): void {
  if (!canFullscreen()) return;
  document.addEventListener('fullscreenchange', () => (fullscreen.value = document.fullscreenElement !== null));
  // F toggles, as in most browser games.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyF' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
    void setFullscreen(!document.fullscreenElement);
  });
}
