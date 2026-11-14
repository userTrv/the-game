/**
 * SFX recipes: every sound is a handful of enveloped oscillators and noise bursts (see `tone` / `noise`).
 *
 * Conventions: `d` is close to a T60, so a sound is perceived as roughly half as long. Noise is given 2-3x
 * the gain of a tone to sound equally loud. Low thumps keep some energy above 300 Hz, because phone speakers
 * reproduce nothing below that. Notes are MIDI numbers (60 = C4).
 */
import type { SfxId } from './types';
import type { Voice } from './nodes';
import { mtof, noise, tone } from './nodes';

export interface Recipe {
  /** Builds the sound into the voice. */
  b: (v: Voice) => void;
  /** Reverb send, 0..1 (default 0.15). */
  rev?: number;
  /** Random pitch variation per play, +- semitones (default 0.35). */
  vary?: number;
}

/** FM bell: bright metallic onset that mellows into a sine tail. */
const bell = (v: Voice, note: number, at: number, d: number, g: number, fm = 3.5, fmI = 0.6): void =>
  tone(v, { f: mtof(note), at, a: 0.002, d, g, fm, fmI });

const arp = (
  v: Voice,
  notes: readonly number[],
  gap: number,
  d: number,
  g: number,
  at = 0,
  fm?: number,
  fmI?: number,
): void => notes.forEach((n, i) => bell(v, n, at + i * gap, d, g, fm, fmI));

/** Soft mallet-like pluck. */
const pluck = (v: Voice, note: number, at: number, d: number, g: number): void =>
  tone(v, { w: 'triangle', f: mtof(note), at, a: 0.003, d, g, lp: 3600, lpTo: 1000 });

/** Hollow knock on a shell. */
const knock = (v: Voice, f: number, at: number, g: number): void => {
  noise(v, { f, q: 6, at, a: 0.001, d: 0.08, g: g * 3 });
  tone(v, { w: 'triangle', f: f * 0.4, to: f * 0.27, gl: 0.04, at, a: 0.001, d: 0.1, g });
};

/** Airy high sparkle. */
const shimmer = (v: Voice, at: number, d: number, g: number): void =>
  noise(v, { ft: 'highpass', f: 6500, at, a: d * 0.15, d, g });

/** Short click of a claw: filtered noise tick plus a pitched "tok". */
const snap = (v: Voice, g: number): void => {
  noise(v, { f: 2800, q: 1.2, a: 0.001, d: 0.045, g: g * 1.8 });
  tone(v, { f: 1500, to: 520, gl: 0.03, a: 0.001, d: 0.07, g });
};

export const SFX: Record<SfxId, Recipe> = {
  /* ------------------------------------------------------------- pool */
  eat_small: {
    b(v) {
      // "nom": the lowpass closes like a mouth.
      tone(v, { w: 'triangle', f: 250, to: 370, gl: 0.05, a: 0.006, d: 0.16, g: 0.3, lp: 2200, lpTo: 450, q: 2 });
      tone(v, { f: 520, to: 880, gl: 0.06, at: 0.01, d: 0.1, g: 0.1 });
    },
    rev: 0.1,
    vary: 0.6,
  },
  eat_big: {
    b(v) {
      tone(v, { w: 'triangle', f: 150, to: 230, gl: 0.07, a: 0.008, d: 0.24, g: 0.3, lp: 1800, lpTo: 350, q: 3 });
      tone(v, { w: 'triangle', f: 210, to: 120, gl: 0.12, at: 0.11, a: 0.008, d: 0.22, g: 0.24, lp: 1400, lpTo: 300, q: 2 });
      noise(v, { f: 1100, q: 1.2, a: 0.003, d: 0.07, g: 0.2 });
      tone(v, { f: 420, to: 700, gl: 0.07, at: 0.2, d: 0.12, g: 0.08 });
    },
    rev: 0.1,
    vary: 0.6,
  },
  grow: {
    b(v) {
      tone(v, { f: 220, to: 880, gl: 0.38, a: 0.05, d: 0.45, g: 0.12, vib: 8, vibHz: 7 });
      noise(v, { f: 500, to: 3000, q: 1.5, a: 0.2, d: 0.3, g: 0.12 });
      [72, 76, 79, 84].forEach((n, i) => pluck(v, n, 0.06 + i * 0.075, 0.3, 0.09));
    },
    rev: 0.3,
  },
  hide: {
    b(v) {
      tone(v, { f: 520, to: 150, gl: 0.13, d: 0.2, g: 0.22 });
      noise(v, { ft: 'lowpass', f: 900, to: 300, at: 0.11, a: 0.002, d: 0.09, g: 0.3 });
      tone(v, { w: 'triangle', f: 180, to: 110, at: 0.11, a: 0.002, d: 0.14, g: 0.2 });
    },
  },
  unhide: {
    b(v) {
      tone(v, { f: 170, to: 560, gl: 0.13, a: 0.01, d: 0.2, g: 0.22 });
      tone(v, { f: 900, to: 1500, gl: 0.04, at: 0.13, a: 0.003, d: 0.09, g: 0.12 });
    },
  },
  hurt: {
    b(v) {
      tone(v, { w: 'triangle', f: 340, to: 150, gl: 0.2, a: 0.005, d: 0.3, g: 0.22, lp: 1500, lpTo: 500 });
      // A slightly sour second voice instead of a harsh buzz.
      tone(v, { w: 'triangle', f: 318, to: 139, gl: 0.2, a: 0.005, d: 0.3, g: 0.13, lp: 1500, lpTo: 500 });
      noise(v, { ft: 'lowpass', f: 700, to: 200, a: 0.002, d: 0.1, g: 0.3 });
    },
  },
  collect_pearl: {
    b(v) {
      bell(v, 88, 0, 0.5, 0.14);
      bell(v, 93, 0.07, 0.7, 0.14);
    },
    rev: 0.35,
  },
  collect_coral: {
    b(v) {
      noise(v, { f: 2500, q: 2, a: 0.001, d: 0.03, g: 0.1 });
      tone(v, { w: 'triangle', f: mtof(74), a: 0.003, d: 0.25, g: 0.2, lp: 3000, lpTo: 700 });
      tone(v, { w: 'triangle', f: mtof(81), at: 0.06, a: 0.003, d: 0.3, g: 0.17, lp: 3000, lpTo: 700 });
    },
    rev: 0.2,
  },
  collect_shine: {
    b(v) {
      [96, 100, 103, 108].forEach((n, i) => tone(v, { f: mtof(n), at: i * 0.04, a: 0.002, d: 0.22, g: 0.07 }));
      shimmer(v, 0, 0.3, 0.07);
    },
    rev: 0.45,
  },

  /* -------------------------------------------------------- abilities */
  zap: {
    b(v) {
      // Fast frequency wobble gives the buzz; the lowpass keeps it from getting harsh.
      tone(v, { w: 'sawtooth', f: 950, to: 180, gl: 0.16, a: 0.002, d: 0.24, g: 0.13, lp: 3000, lpTo: 900, vib: 220, vibHz: 55 });
      noise(v, { ft: 'highpass', f: 3500, a: 0.001, d: 0.09, g: 0.12 });
      tone(v, { f: 1900, to: 600, gl: 0.08, d: 0.12, g: 0.06 });
    },
  },
  spike: {
    b(v) {
      noise(v, { f: 3200, to: 6500, q: 5, a: 0.002, d: 0.16, g: 0.3 });
      tone(v, { f: 1700, to: 2900, gl: 0.07, a: 0.002, d: 0.14, g: 0.08 });
      tone(v, { w: 'triangle', f: 320, to: 130, gl: 0.03, a: 0.001, d: 0.06, g: 0.2 });
    },
  },
  flash: {
    b(v) {
      noise(v, { ft: 'highpass', f: 1500, to: 7000, a: 0.015, d: 0.45, g: 0.14 });
      tone(v, { f: 300, to: 1200, gl: 0.08, a: 0.01, d: 0.15, g: 0.08 });
      bell(v, 91, 0, 0.7, 0.09);
      bell(v, 98, 0.02, 0.7, 0.07);
    },
    rev: 0.55,
  },
  shield: {
    b(v) {
      tone(v, { f: 196, to: 294, gl: 0.22, a: 0.03, d: 0.8, g: 0.2 });
      tone(v, { w: 'triangle', f: 392, to: 588, gl: 0.22, a: 0.03, d: 0.7, g: 0.1, lp: 1800 });
      tone(v, { f: 1176, a: 0.12, d: 0.7, g: 0.045, vib: 14 });
    },
    rev: 0.4,
  },
  poison: {
    b(v) {
      [720, 560, 430].forEach((f, i) =>
        tone(v, { f, to: f * 0.62, gl: 0.1, at: i * 0.085, a: 0.005, d: 0.16, g: 0.15, vib: f * 0.06, vibHz: 19 }),
      );
      noise(v, { ft: 'lowpass', f: 500, a: 0.05, d: 0.35, g: 0.2 });
    },
  },
  heal: {
    b(v) {
      arp(v, [72, 76, 79, 84], 0.09, 0.8, 0.1, 0, 2, 0.4);
      tone(v, { f: mtof(72), a: 0.1, d: 0.8, g: 0.05 });
    },
    rev: 0.55,
  },
  pull: {
    b(v) {
      // Suction: everything swells and is cut short.
      noise(v, { f: 300, to: 2200, q: 2, a: 0.26, d: 0.08, g: 0.4 });
      tone(v, { f: 140, to: 430, gl: 0.27, a: 0.24, d: 0.08, g: 0.14 });
      tone(v, { f: 300, to: 140, gl: 0.05, at: 0.29, a: 0.002, d: 0.09, g: 0.16 });
    },
  },

  /* ----------------------------------------------------------- combat */
  claw_snap: {
    b(v) {
      snap(v, 0.26);
      tone(v, { w: 'triangle', f: 240, to: 150, gl: 0.04, a: 0.001, d: 0.09, g: 0.2 });
      // The second pincer tip lands a moment later.
      noise(v, { f: 3600, q: 1.5, at: 0.016, a: 0.001, d: 0.03, g: 0.25 });
    },
    rev: 0.1,
  },
  crit: {
    b(v) {
      snap(v, 0.22);
      tone(v, { w: 'triangle', f: 200, to: 70, gl: 0.12, a: 0.002, d: 0.2, g: 0.24 });
      bell(v, 93, 0.03, 0.5, 0.08);
      bell(v, 100, 0.05, 0.5, 0.06);
    },
    rev: 0.3,
  },
  miss: {
    b(v) {
      noise(v, { f: 1400, to: 450, q: 1.2, a: 0.03, d: 0.22, g: 0.3 });
      tone(v, { f: 620, to: 300, gl: 0.16, a: 0.02, d: 0.18, g: 0.05 });
    },
  },
  stun: {
    b(v) {
      noise(v, { ft: 'lowpass', f: 800, to: 250, a: 0.002, d: 0.08, g: 0.3 });
      tone(v, { f: 880, a: 0.01, d: 0.7, g: 0.1, vib: 70, vibHz: 9 });
      tone(v, { f: 1320, at: 0.05, a: 0.01, d: 0.6, g: 0.07, vib: 100, vibHz: 9 });
    },
    rev: 0.3,
  },
  enemy_hit: {
    b(v) {
      noise(v, { ft: 'lowpass', f: 1400, to: 300, a: 0.001, d: 0.09, g: 0.45 });
      tone(v, { w: 'triangle', f: 260, to: 95, gl: 0.07, a: 0.001, d: 0.13, g: 0.3 });
    },
    rev: 0.1,
  },
  victory: {
    b(v) {
      [72, 76, 79].forEach((n, i) => {
        pluck(v, n, i * 0.13, 0.4, 0.12);
        bell(v, n + 12, i * 0.13, 0.4, 0.05);
      });
      arp(v, [84, 88, 91], 0.015, 1.2, 0.08, 0.42);
      tone(v, { w: 'triangle', f: mtof(60), at: 0.42, a: 0.01, d: 0.9, g: 0.1 });
      shimmer(v, 0.42, 0.6, 0.05);
    },
    rev: 0.5,
    vary: 0.1,
  },
  defeat: {
    b(v) {
      [67, 63, 60].forEach((n, i) =>
        tone(v, {
          w: 'triangle',
          f: mtof(n),
          to: i === 2 ? mtof(n) * 0.94 : undefined,
          gl: 0.6,
          at: i * 0.24,
          a: 0.02,
          d: i === 2 ? 1.1 : 0.7,
          g: 0.18,
          lp: 1400,
          lpTo: 500,
        }),
      );
      tone(v, { f: mtof(48), at: 0.48, a: 0.03, d: 0.9, g: 0.1 });
    },
    rev: 0.5,
    vary: 0.1,
  },
  boss_roar: {
    b(v) {
      tone(v, { w: 'sawtooth', f: 85, to: 52, gl: 1.1, a: 0.12, h: 0.35, d: 0.9, g: 0.2, lp: 950, lpTo: 280, q: 4, vib: 7, vibHz: 23 });
      tone(v, { w: 'sawtooth', f: 127, to: 76, gl: 1.1, a: 0.15, h: 0.3, d: 0.8, g: 0.09, lp: 700, lpTo: 250, q: 2, vib: 9, vibHz: 17 });
      noise(v, { ft: 'lowpass', f: 500, to: 160, a: 0.1, h: 0.3, d: 0.9, g: 0.36 });
      tone(v, { f: 58, to: 40, gl: 1, a: 0.1, h: 0.4, d: 0.8, g: 0.18 });
    },
    rev: 0.5,
    vary: 0.8,
  },

  /* --------------------------------------------------------------- ui */
  ui_tap: {
    b(v) {
      tone(v, { f: 700, to: 1050, gl: 0.03, a: 0.002, d: 0.07, g: 0.16 });
      noise(v, { f: 3000, a: 0.001, d: 0.012, g: 0.08 });
    },
    rev: 0.05,
  },
  ui_back: {
    b(v) {
      tone(v, { f: 640, to: 400, gl: 0.06, a: 0.003, d: 0.1, g: 0.16 });
    },
    rev: 0.05,
  },
  ui_open: {
    b(v) {
      tone(v, { f: 440, to: 660, gl: 0.06, d: 0.12, g: 0.13 });
      tone(v, { f: 660, to: 990, gl: 0.06, at: 0.07, d: 0.16, g: 0.13 });
      noise(v, { f: 800, to: 2600, a: 0.08, d: 0.1, g: 0.1 });
    },
  },
  ui_close: {
    b(v) {
      tone(v, { f: 880, to: 590, gl: 0.06, d: 0.12, g: 0.13 });
      tone(v, { f: 590, to: 390, gl: 0.06, at: 0.07, d: 0.16, g: 0.13 });
      noise(v, { f: 2400, to: 700, a: 0.01, d: 0.16, g: 0.1 });
    },
  },
  ui_error: {
    b(v) {
      // Gentle "uh-oh": two muffled notes a major third apart.
      [311, 247].forEach((f, i) =>
        tone(v, { w: 'triangle', f, at: i * 0.12, a: 0.004, d: 0.14, g: 0.24, lp: 1100, lpTo: 600 }),
      );
    },
    vary: 0.1,
  },
  buy: {
    b(v) {
      tone(v, { w: 'triangle', f: 220, to: 150, gl: 0.04, a: 0.002, d: 0.07, g: 0.16 });
      noise(v, { f: 4500, q: 2, a: 0.001, d: 0.03, g: 0.2 });
      bell(v, 95, 0.05, 0.45, 0.12);
      bell(v, 100, 0.12, 0.7, 0.12);
    },
    rev: 0.3,
  },
  reroll: {
    b(v) {
      // Shells rattling in a cup.
      for (let i = 0; i < 6; i++) {
        noise(v, { f: 1400 + v.rng() * 2200, q: 6, at: i * 0.04 + v.rng() * 0.012, a: 0.001, d: 0.045, g: 0.4 });
      }
      tone(v, { f: 400, to: 800, gl: 0.24, a: 0.05, d: 0.24, g: 0.07 });
    },
  },
  card_pick: {
    b(v) {
      noise(v, { ft: 'highpass', f: 2500, to: 5000, a: 0.012, d: 0.09, g: 0.16 });
      tone(v, { w: 'triangle', f: mtof(79), to: mtof(81), gl: 0.05, at: 0.03, a: 0.003, d: 0.26, g: 0.18, lp: 3200, lpTo: 900 });
    },
    rev: 0.2,
  },
  sell: {
    b(v) {
      arp(v, [100, 95, 91], 0.065, 0.3, 0.11);
      tone(v, { f: 500, to: 300, gl: 0.08, at: 0.2, d: 0.12, g: 0.09 });
    },
    rev: 0.25,
  },

  /* ------------------------------------------------------ progression */
  merge_2: {
    b(v) {
      arp(v, [84, 88, 91], 0.065, 0.7, 0.12);
      tone(v, { f: mtof(72), a: 0.01, d: 0.4, g: 0.07 });
    },
    rev: 0.45,
    vary: 0.15,
  },
  merge_3: {
    b(v) {
      arp(v, [84, 88, 91, 96, 100], 0.055, 0.8, 0.1);
      arp(v, [84, 91, 96], 0, 1.3, 0.06, 0.3);
      tone(v, { w: 'triangle', f: mtof(60), a: 0.01, d: 0.7, g: 0.12, lp: 1500 });
      shimmer(v, 0.25, 0.5, 0.07);
    },
    rev: 0.55,
    vary: 0.15,
  },
  set_bonus: {
    b(v) {
      // Chord swell: the filter opens as the notes bloom.
      [62, 69, 74, 78].forEach((n, i) =>
        tone(v, { w: 'triangle', f: mtof(n), at: i * 0.03, a: 0.09, h: 0.15, d: 1, g: 0.075, lp: 700, lpTo: 3200, q: 1 }),
      );
      bell(v, 90, 0.2, 1, 0.08);
      bell(v, 86, 0.32, 1, 0.06);
    },
    rev: 0.6,
    vary: 0.1,
  },
  mutation: {
    b(v) {
      // Two saws through opposite resonant sweeps: a wobbly "wah" morph.
      tone(v, { w: 'sawtooth', f: 196, to: 392, gl: 0.45, a: 0.03, d: 0.55, g: 0.11, lp: 400, lpTo: 2600, q: 9, vib: 10, vibHz: 11 });
      tone(v, { w: 'sawtooth', f: 199, to: 294, gl: 0.45, a: 0.03, d: 0.55, g: 0.09, lp: 2600, lpTo: 400, q: 9 });
      tone(v, { f: 300, to: 900, gl: 0.2, at: 0.1, d: 0.25, g: 0.08, vib: 60, vibHz: 24 });
      bell(v, 87, 0.42, 0.6, 0.09, 1.41, 1.2);
    },
    rev: 0.35,
  },
  shell_swap: {
    b(v) {
      knock(v, 650, 0, 0.2);
      noise(v, { f: 900, q: 7, at: 0.13, a: 0.001, d: 0.06, g: 0.4 });
      tone(v, { f: 480, to: 960, gl: 0.05, at: 0.13, a: 0.003, d: 0.12, g: 0.18 });
    },
  },
  level_up: {
    b(v) {
      [67, 71, 74, 79, 83].forEach((n, i) => pluck(v, n, i * 0.06, 0.25, 0.12));
      arp(v, [79, 83, 86, 91], 0.012, 1.1, 0.07, 0.32);
      shimmer(v, 0.3, 0.5, 0.06);
    },
    rev: 0.5,
    vary: 0.1,
  },
  reward: {
    b(v) {
      const hi = [91, 93, 96, 98, 100, 103];
      bell(v, 79, 0, 0.9, 0.1, 2, 0.5);
      bell(v, 86, 0.02, 0.9, 0.08, 2, 0.5);
      for (let i = 0; i < 6; i++) {
        bell(v, hi[Math.floor(v.rng() * hi.length)] ?? 96, 0.1 + i * 0.05, 0.45, 0.06, 2, 0.5);
      }
      shimmer(v, 0, 0.6, 0.06);
    },
    rev: 0.55,
    vary: 0.15,
  },
  coin_tick: {
    b(v) {
      bell(v, 100, 0, 0.12, 0.11, 2.76, 0.5);
      noise(v, { f: 5000, q: 2, a: 0.001, d: 0.015, g: 0.1 });
    },
    rev: 0.1,
    vary: 1.2,
  },
  building_upgrade: {
    b(v) {
      knock(v, 520, 0, 0.2);
      knock(v, 560, 0.13, 0.2);
      arp(v, [74, 78, 81, 86], 0.07, 0.6, 0.09, 0.28);
    },
    rev: 0.35,
    vary: 0.15,
  },
  quest_done: {
    b(v) {
      // "Ta-da": a short dominant, then the tonic chord.
      [74, 78].forEach((n) => pluck(v, n, 0, 0.16, 0.13));
      [79, 83, 86].forEach((n) => pluck(v, n, 0.15, 0.8, 0.1));
      bell(v, 91, 0.15, 0.9, 0.07);
    },
    rev: 0.45,
    vary: 0.1,
  },
  bubble: {
    b(v) {
      tone(v, { f: 420, to: 1250, gl: 0.07, a: 0.006, d: 0.11, g: 0.2 });
      if (v.rng() < 0.4) tone(v, { f: 700, to: 1700, gl: 0.05, at: 0.09, d: 0.08, g: 0.09 });
    },
    rev: 0.25,
    vary: 3,
  },
};

export const SFX_IDS = Object.keys(SFX) as SfxId[];
