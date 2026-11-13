export type SfxId =
  | 'eat_small'
  | 'eat_big'
  | 'grow'
  | 'hide'
  | 'unhide'
  | 'hurt'
  | 'collect_pearl'
  | 'collect_coral'
  | 'collect_shine'
  | 'zap'
  | 'spike'
  | 'flash'
  | 'shield'
  | 'poison'
  | 'heal'
  | 'pull'
  | 'claw_snap'
  | 'crit'
  | 'miss'
  | 'stun'
  | 'enemy_hit'
  | 'victory'
  | 'defeat'
  | 'boss_roar'
  | 'ui_tap'
  | 'ui_back'
  | 'ui_open'
  | 'ui_close'
  | 'ui_error'
  | 'buy'
  | 'reroll'
  | 'card_pick'
  | 'sell'
  | 'merge_2'
  | 'merge_3'
  | 'set_bonus'
  | 'mutation'
  | 'shell_swap'
  | 'level_up'
  | 'reward'
  | 'coin_tick'
  | 'building_upgrade'
  | 'quest_done'
  | 'bubble';

export type MusicMood = 'none' | 'lagoon' | 'wreck' | 'abyss' | 'town' | 'battle' | 'boss';

export interface PlayOptions {
  /** Relative loudness, 0..1 (default 1). */
  volume?: number;
  /** Frequency multiplier, 0.25..4 (default 1). E.g. `2 ** (combo / 12)` raises a semitone per combo step. */
  pitch?: number;
  /** Stereo position, -1 (left) .. 1 (right), default 0. */
  pan?: number;
}

export interface AudioEngine {
  /** Must be called from a user gesture at least once; safe to call repeatedly. */
  unlock(): Promise<void>;
  play(id: SfxId, opts?: PlayOptions): void;
  /** Crossfades to the given mood over ~2 s. */
  setMusic(mood: MusicMood): void;
  /** 0..1 */
  setMusicVolume(v: number): void;
  /** 0..1 */
  setSfxVolume(v: number): void;
  /** 0..1, e.g. danger in a pool: darker, denser music with a low drone. */
  setIntensity(v: number): void;
  /** Page hidden. */
  suspend(): void;
  /** Page shown again. */
  resume(): void;
  dispose(): void;
}

export interface EngineOptions {
  /** Seed for the internal PRNG (variation and generative music). Defaults to the current time. */
  seed?: number;
}
