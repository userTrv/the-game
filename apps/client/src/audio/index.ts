/**
 * Procedural audio for Shellter: every sound effect and all music is synthesised with the Web Audio API.
 *
 * ```ts
 * const audio = createAudioEngine();
 * window.addEventListener('pointerdown', () => void audio.unlock());   // every gesture: cheap and idempotent
 * document.addEventListener('visibilitychange', () => (document.hidden ? audio.suspend() : audio.resume()));
 * audio.setMusic('lagoon');
 * audio.play('eat_small', { pitch: 2 ** (combo / 12) });
 * ```
 */
export type { AudioEngine, EngineOptions, MusicMood, PlayOptions, SfxId } from './types';
export { createAudioEngine } from './engine';
export { SFX_IDS } from './sfx';
