import { effect } from '@preact/signals';
import { createAudioEngine, type MusicMood, type SfxId } from './audio';
import { settings } from './state';

/** The one audio engine of the game, wired to the settings signal. */
export const audio = createAudioEngine();

effect(() => {
  audio.setMusicVolume(settings.value.music);
  audio.setSfxVolume(settings.value.sfx);
});

export function sfx(id: SfxId, opts?: { volume?: number; pitch?: number; pan?: number }): void {
  audio.play(id, opts);
}

export function music(mood: MusicMood): void {
  audio.setMusic(mood);
}

/** Browsers only start audio from a user gesture. */
export function unlockAudioOnGesture(): void {
  const go = (): void => {
    void audio.unlock();
  };
  window.addEventListener('pointerdown', go, { passive: true });
  window.addEventListener('keydown', go);
  document.addEventListener('visibilitychange', () => (document.hidden ? audio.suspend() : audio.resume()));
}
