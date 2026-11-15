import { effect } from '@preact/signals';
import { render } from 'preact';
import { hunt, startDirector } from './director';
import { loadAtlas } from './gfx/assets';
import { loadBackdrop } from './gfx/deep';
import { initFullscreen } from './platform/fullscreen';
import { calm } from './gfx/fx';
import { initStage, setPaused, takeFps } from './gfx/stage';
import { t } from './i18n';
import { loadLocal, saveLocal } from './platform/storage';
import { platformKind } from './platform/telegram';
import { unlockAudioOnGesture } from './sound';
import { authenticate, bootError, landing, flushAnalytics, loadProgress, panel, player, refreshMe, run, screen, screenForRun, sessionSeconds, settings, startRun, track } from './state';
import './styles.css';
import { App } from './ui/App';

async function boot(): Promise<void> {
  const ui = document.getElementById('ui') as HTMLElement;
  const stage = document.getElementById('stage') as HTMLElement;
  render(<App />, ui);
  unlockAudioOnGesture();
  effect(() => {
    calm.on = settings.value.calm;
  });
  try {
    // Renderer, core art and the session load in parallel; the bar shows real progress.
    const step = (): void => {
      loadProgress.value = Math.min(1, loadProgress.value + 0.25);
    };
    await Promise.all([
      initStage(stage).then(step),
      loadAtlas('core').then(step),
      loadBackdrop(),
      authenticate().then(step),
    ]);
    await refreshMe().catch(() => undefined);
    step();
    startDirector();
    track('session_start', { platform: platformKind() });
    // Biome art is fetched in the background so pools start instantly.
    void loadAtlas('lagoon');
    void loadAtlas('town');
    const p = player.value;
    if (platformKind() === 'web' && !loadLocal('played', false) && !new URLSearchParams(location.search).has('play')) {
      await new Promise<void>((resolve) => (landing.value = resolve));
      landing.value = null;
    }
    saveLocal('played', true);
    if (run.value) screen.value = screenForRun(run.value);
    else if (p && !p.profile.tutorialDone) {
      // First launch: straight into the first pool. Menus come after the first run.
      track('tutorial_step', { step: 'start' });
      if (!(await startRun('hermit'))) screen.value = 'home';
    } else screen.value = 'home';
  } catch (e) {
    console.error(e);
    bootError.value = t('common.offline');
  }
}

initFullscreen();

// Esc closes the open panel, or opens the settings (which pauses the pool).
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' || e.repeat) return;
  if (panel.value) panel.value = null;
  else if (player.value) {
    hunt()?.setPaused(true);
    panel.value = 'settings';
  }
});

document.addEventListener('visibilitychange', () => {
  setPaused(document.hidden);
  if (document.hidden) {
    track('session_end', { seconds: sessionSeconds() });
    flushAnalytics();
  }
});
setInterval(() => {
  if (!document.hidden && player.value) {
    track('fps_report', takeFps());
    flushAnalytics();
  }
}, 60_000);
window.addEventListener('error', (e) => track('client_error', { message: String(e.message).slice(0, 200) }));

void boot();
