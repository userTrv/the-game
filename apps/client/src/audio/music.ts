/**
 * Generative underwater ambient. A mood is a "scene": a few persistent nodes (pad filter with a slow LFO,
 * water noise bed, low drone, echo) plus short-lived notes placed by a lookahead scheduler on a grid of
 * eight steps per bar. Switching moods crossfades two scenes.
 */
import type { MusicMood } from './types';
import type { Graph, Rng, Voice } from './nodes';
import { clamp, mtof, newVoice, noise, release, seal, sweep, tone } from './nodes';

interface MoodDef {
  /** MIDI note of the tonic in the pad register. */
  root: number;
  /** Seven-note scale, semitones above the root. */
  scale: readonly number[];
  /** Chord roots as scale degrees. */
  prog: readonly number[];
  /** Scale degrees the melody may use (a pentatonic subset, so any note fits any chord). */
  mel: readonly number[];
  /** Seconds per step at zero intensity. */
  step: number;
  /** Bars per chord. */
  bars: number;
  /** Pad lowpass cutoff, Hz: the brightness of the mood. */
  cut: number;
  /** Pad level. */
  pad: number;
  /** Colour tone added to the pad triad, in scale degrees above the chord root (0 = none). */
  add: number;
  /** Chance of a melody note per step. */
  dens: number;
  /** Melody timbre: 0 = soft pluck, otherwise the FM ratio of a bell. */
  fm: number;
  fmI: number;
  /** Melody register, octaves above the root. */
  oct: number;
  /** Melody note decay, s. */
  ring: number;
  /** Bass pulse level per step. */
  pulse: readonly number[];
  /** Shaker level per step. */
  tick: readonly number[];
  /** Drone level at zero intensity. */
  drone: number;
  /** Water bed and bubble amount. */
  water: number;
  /** Chance of a wooden creak per bar. */
  creak: number;
  /** Reverb send. */
  rev: number;
  /** Echo send of the melody. */
  echo: number;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const PENTA_MAJOR = [0, 1, 2, 4, 5];
const PENTA_MINOR = [0, 2, 3, 4, 6];
const NONE: readonly number[] = [];
const WALK = [-2, -1, -1, 1, 1, 2];

const MOODS: Record<Exclude<MusicMood, 'none'>, MoodDef> = {
  // Warm and sunny: F lydian, I-V-vi-II, soft plucks.
  lagoon: {
    root: 53, scale: LYDIAN, prog: [0, 4, 5, 1], mel: PENTA_MAJOR, step: 0.4, bars: 2, cut: 1900, pad: 1, add: 8,
    dens: 0.3, fm: 0, fmI: 0, oct: 1, ring: 1.1, pulse: NONE, tick: NONE, drone: 0, water: 1, creak: 0,
    rev: 0.35, echo: 0.3,
  },
  // Mysterious: D minor, hollow bells, creaking timbers.
  wreck: {
    root: 50, scale: AEOLIAN, prog: [0, 5, 0, 3], mel: PENTA_MINOR, step: 0.5, bars: 2, cut: 1100, pad: 0.9, add: 6,
    dens: 0.16, fm: 2, fmI: 0.9, oct: 1, ring: 1.8, pulse: NONE, tick: NONE, drone: 0.16, water: 1.1, creak: 0.3,
    rev: 0.5, echo: 0.4,
  },
  // Deep and sparse: two slow A lydian chords, glassy bells with long echoes.
  abyss: {
    root: 45, scale: LYDIAN, prog: [0, 1], mel: PENTA_MINOR, step: 0.6, bars: 4, cut: 750, pad: 1, add: 10,
    dens: 0.1, fm: 3.5, fmI: 0.5, oct: 2, ring: 3.2, pulse: NONE, tick: NONE, drone: 0.35, water: 0.8, creak: 0,
    rev: 0.7, echo: 0.5,
  },
  // Cozy and slightly rhythmic: G major, I-vi-IV-V, light bass and shaker.
  town: {
    root: 55, scale: MAJOR, prog: [0, 5, 3, 4], mel: PENTA_MAJOR, step: 0.3, bars: 2, cut: 1700, pad: 0.8, add: 0,
    dens: 0.38, fm: 0, fmI: 0, oct: 1, ring: 0.7, pulse: [1, 0, 0, 0.4, 0.8, 0, 0, 0],
    tick: [0, 0, 0.7, 0, 0, 0, 0.7, 0.35], drone: 0, water: 0.6, creak: 0, rev: 0.25, echo: 0.2,
  },
  // Gentle drive: E dorian with a steady eighth-note pulse.
  battle: {
    root: 52, scale: DORIAN, prog: [0, 3, 0, 6], mel: PENTA_MINOR, step: 0.24, bars: 2, cut: 1500, pad: 0.85, add: 6,
    dens: 0.3, fm: 0, fmI: 0, oct: 1, ring: 0.6, pulse: [1, 0.45, 0.6, 0.45, 0.9, 0.45, 0.6, 0.55],
    tick: [0, 0, 0.6, 0, 0, 0, 0.6, 0], drone: 0.12, water: 0.5, creak: 0, rev: 0.25, echo: 0.25,
  },
  // Darker: C phrygian, 3+3+2 heartbeat over a low drone.
  boss: {
    root: 48, scale: PHRYGIAN, prog: [0, 1, 0, 6], mel: PENTA_MINOR, step: 0.27, bars: 2, cut: 950, pad: 0.75, add: 6,
    dens: 0.2, fm: 2, fmI: 1.2, oct: 1, ring: 1.3, pulse: [0.7, 0, 0, 0.55, 0, 0, 0.5, 0], tick: NONE, drone: 0.3,
    water: 0.7, creak: 0.12, rev: 0.45, echo: 0.3,
  },
};

interface Scene {
  def: MoodDef;
  /** Scene fader into the music bus. */
  out: GainNode;
  /** Scene fader into the reverb. */
  send: GainNode;
  /** Melodic bus: dry, echo and reverb. */
  mel: GainNode;
  pad: BiquadFilterNode;
  lfoDepth: GainNode;
  drone: GainNode;
  nodes: AudioNode[];
  srcs: AudioScheduledSourceNode[];
  voices: Voice[];
  /** Context time of the next step. */
  next: number;
  /** Step counter. */
  i: number;
  /** Melody position: index into the pentatonic ladder. */
  pos: number;
  /** Context time when a fading scene is torn down; 0 while it is the current one. */
  dieAt: number;
}

export interface Music {
  set(mood: MusicMood): void;
  intensity(v: number): void;
  /** Starts or pauses the scheduler (unlock, page hidden / shown). */
  run(on: boolean): void;
  dispose(): void;
}

const LOOKAHEAD = 0.4;
const TICK_MS = 100;
const FADE = 2;

const at = (a: readonly number[], i: number): number => a[i % a.length] ?? 0;

/** MIDI note of a scale degree; degrees outside 0..6 continue into neighbouring octaves. */
const note = (d: MoodDef, deg: number): number =>
  d.root + at(d.scale, ((deg % 7) + 7) % 7) + 12 * Math.floor(deg / 7);

export function createMusic(g: Graph, rng: Rng): Music {
  const { ctx } = g;
  const scenes: Scene[] = [];
  let cur: Scene | null = null;
  /** Requested mood, and the mood of the scene that is actually playing. */
  let mood: MusicMood = 'none';
  let shown: MusicMood = 'none';
  let intensity = 0;
  let active = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tune = (sc: Scene, t: number): void => {
    const cut = sc.def.cut * (1 - 0.55 * intensity);
    sc.pad.frequency.setTargetAtTime(cut, t, 0.5);
    sc.lfoDepth.gain.setTargetAtTime(cut * 0.3, t, 0.5);
    sc.drone.gain.setTargetAtTime((sc.def.drone + 0.6 * intensity) * 0.07, t, 0.5);
  };

  const open = (def: MoodDef, t: number): Scene => {
    const nodes: AudioNode[] = [];
    const srcs: AudioScheduledSourceNode[] = [];
    const gain = (value: number, dest: AudioNode): GainNode => {
      const n = ctx.createGain();
      n.gain.value = value;
      n.connect(dest);
      nodes.push(n);
      return n;
    };
    const biquad = (type: BiquadFilterType, f: number, q: number, dest: AudioNode): BiquadFilterNode => {
      const n = ctx.createBiquadFilter();
      n.type = type;
      n.frequency.value = f;
      n.Q.value = q;
      n.connect(dest);
      nodes.push(n);
      return n;
    };
    const osc = (type: OscillatorType, f: number, dest: AudioNode): void => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.connect(dest);
      o.start(t);
      nodes.push(o);
      srcs.push(o);
    };
    const lfo = (rate: number, depth: number, target: AudioParam): GainNode => {
      const amt = ctx.createGain();
      amt.gain.value = depth;
      amt.connect(target);
      nodes.push(amt);
      osc('sine', rate, amt);
      return amt;
    };

    const out = gain(0, g.music);
    const send = gain(0, g.reverb);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(1, t + FADE);
    send.gain.setValueAtTime(0, t);
    send.gain.linearRampToValueAtTime(def.rev, t + FADE);

    const mel = gain(1, out);
    mel.connect(send);
    const echo = ctx.createDelay(2);
    echo.delayTime.value = Math.min(1.9, def.step * 3);
    nodes.push(echo);
    mel.connect(gain(def.echo, echo));
    echo.connect(gain(0.4, echo));
    echo.connect(out);
    echo.connect(send);

    // The cutoff starts low and opens towards its target while the scene fades in.
    const pad = biquad('lowpass', 350, 1, gain(def.pad, out));
    const lfoDepth = lfo(0.05 + rng() * 0.04, 0, pad.frequency);

    const bed = biquad('bandpass', 480, 0.6, gain(0.12 * def.water, out));
    const water = ctx.createBufferSource();
    water.buffer = g.noise;
    water.loop = true;
    water.connect(bed);
    water.start(t);
    nodes.push(water);
    srcs.push(water);
    lfo(0.09 + rng() * 0.06, 200, bed.frequency);

    const drone = gain(0, out);
    const droneLp = biquad('lowpass', 420, 2, drone);
    const f = mtof(def.root - 12);
    osc('sawtooth', f * 0.997, droneLp);
    osc('sawtooth', f * 1.004, droneLp);

    const sc: Scene = {
      def, out, send, mel, pad, lfoDepth, drone, nodes, srcs, voices: [], next: t, i: 0, pos: 4, dieAt: 0,
    };
    tune(sc, t);
    return sc;
  };

  const kill = (sc: Scene): void => {
    const now = ctx.currentTime;
    for (const v of sc.voices) release(v, now);
    sc.voices.length = 0;
    for (const s of sc.srcs) {
      try {
        s.stop(now);
      } catch {
        /* never started */
      }
    }
    for (const n of sc.nodes) {
      try {
        n.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    sc.srcs.length = 0;
    sc.nodes.length = 0;
  };

  /** Creates a voice at `t` feeding `dest`, lets `build` fill it and registers it for cleanup. */
  const emit = (sc: Scene, dest: AudioNode, t: number, build: (v: Voice) => void): void => {
    const v = newVoice(ctx, dest, g.noise, rng, t);
    sc.voices.push(v);
    try {
      build(v);
    } finally {
      seal(v);
    }
  };

  /** Open voicing (root, fifth, tenth) of detuned saws and triangles; chords crossfade into each other. */
  const padChord = (sc: Scene, deg: number, t: number, len: number): void => {
    const d = sc.def;
    const a = Math.min(2.5, len * 0.4);
    const rel = Math.min(3, len * 0.5);
    emit(sc, sc.pad, t, (v) => {
      const voice = (n: number, w: OscillatorType, gn: number, cents: number): void =>
        tone(v, { w, f: mtof(note(d, n)) * 2 ** (cents / 1200), a, h: len - a, d: rel, g: gn, lin: true });
      voice(deg, 'sawtooth', 0.03, -7);
      voice(deg, 'triangle', 0.05, 6);
      voice(deg + 4, 'triangle', 0.04, -4);
      voice(deg + 9, 'sawtooth', 0.022, 8);
      voice(deg + 9, 'triangle', 0.035, -6);
      if (d.add) voice(deg + d.add, 'triangle', 0.02, 3);
    });
  };

  const melody = (sc: Scene, t: number, pos: number, vel: number): void => {
    const d = sc.def;
    const f = mtof(note(d, at(d.mel, pos) + 7 * Math.floor(pos / d.mel.length)) + 12 * d.oct);
    emit(sc, sc.mel, t, (v) => {
      if (d.fm) tone(v, { f, a: 0.003, d: d.ring, g: 0.075 * vel, fm: d.fm, fmI: d.fmI });
      else {
        tone(v, { w: 'triangle', f, d: d.ring, g: 0.085 * vel, lp: 2600, lpTo: 700 });
        tone(v, { f: f * 2, d: d.ring * 0.5, g: 0.02 * vel });
      }
    });
  };

  const step = (sc: Scene, t: number, dur: number): void => {
    const d = sc.def;
    const i = sc.i++;
    const s = i % 8;
    const bar = Math.floor(i / 8);
    const chord = at(d.prog, Math.floor(bar / d.bars));
    // Chords on the upper degrees drop an octave so the pad stays in one register.
    const deg = chord > 3 ? chord - 7 : chord;
    if (s === 0 && bar % d.bars === 0) padChord(sc, deg, t, dur * 8 * d.bars);

    // Danger adds a heartbeat on the beats, then on the off-beats too.
    const pulse = Math.max(
      at(d.pulse, s),
      s % 4 === 0 ? intensity * 0.7 : 0,
      s % 4 === 2 && intensity > 0.6 ? intensity * 0.45 : 0,
    );
    const tick = at(d.tick, s);
    if (pulse > 0 || tick > 0) {
      emit(sc, sc.out, t, (v) => {
        tone(v, {
          w: 'triangle',
          f: mtof(note(d, s === 6 ? deg + 4 : deg)),
          a: 0.008,
          d: Math.min(0.7, dur * 2.5),
          g: 0.11 * pulse,
          lp: 900,
          lpTo: 320,
        });
        noise(v, { ft: 'highpass', f: 7000, a: 0.002, d: 0.06, g: 0.07 * tick });
      });
    }

    // Melody: a random walk over the pentatonic ladder, busier on the beats.
    if (rng() < d.dens * (s % 2 ? 0.6 : 1.4) * (1 + 0.5 * intensity)) {
      const move = at(WALK, Math.floor(rng() * WALK.length));
      const pos = sc.pos + move;
      sc.pos = clamp(pos < 0 || pos > 9 ? sc.pos - move : pos, 0, 9);
      melody(sc, t + rng() * 0.015, sc.pos, 0.6 + rng() * 0.4);
      if (rng() < 0.2) melody(sc, t + dur * (rng() < 0.5 ? 0.5 : 1), sc.pos + 2, 0.45);
    }

    if (rng() < 0.035 * d.water) {
      emit(sc, sc.mel, t + rng() * dur, (v) => {
        const f = 500 + rng() * 900;
        const n = 1 + Math.floor(rng() * 3);
        for (let k = 0; k < n; k++) {
          tone(v, { f: f * (1 + k * 0.18), to: f * (1.9 + k * 0.2), gl: 0.07, at: k * (0.07 + rng() * 0.05), a: 0.006, d: 0.12, g: 0.035 });
        }
      });
    }

    if (s === 0 && rng() < d.creak) {
      emit(sc, sc.mel, t + rng() * dur * 4, (v) => {
        // A resonant bandpass sliding over the harmonics of a low saw sounds like straining timber.
        const f = 62 + rng() * 40;
        tone(v, {
          w: 'sawtooth', f, to: f * (0.85 + rng() * 0.3), gl: 1, a: 0.3, d: 0.9, g: 0.16,
          ft: 'bandpass', lp: 420 + rng() * 300, lpTo: 600 + rng() * 500, q: 14, vib: 3, vibHz: 5 + rng() * 3,
        });
      });
    }
  };

  const stopTimer = (): void => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };

  const pump = (): void => {
    const now = ctx.currentTime;
    for (let k = scenes.length - 1; k >= 0; k--) {
      const sc = scenes[k];
      if (!sc) continue;
      sweep(sc.voices, now);
      if (sc.dieAt && now >= sc.dieAt) {
        kill(sc);
        scenes.splice(k, 1);
      }
    }
    if (cur && ctx.state === 'running') {
      // After a stall (timer throttling, interruption) resume from now instead of replaying the backlog.
      if (cur.next < now) cur.next = now + 0.05;
      while (cur.next < now + LOOKAHEAD) {
        const dur = cur.def.step / (1 + 0.15 * intensity);
        step(cur, cur.next, dur);
        cur.next += dur;
      }
    }
    if (!scenes.length) stopTimer();
  };

  const tick = (): void => {
    try {
      pump();
    } catch {
      /* music must never break the game */
    }
  };

  const startTimer = (): void => {
    if (timer === null && active && scenes.length) timer = setInterval(tick, TICK_MS);
  };

  /** Fades the current scene out and, unless the mood is 'none', a new one in. */
  const swap = (): void => {
    const now = ctx.currentTime;
    shown = mood;
    if (cur) {
      for (const p of [cur.out.gain, cur.send.gain]) {
        const value = p.value;
        p.cancelScheduledValues(now);
        p.setValueAtTime(value, now);
        p.linearRampToValueAtTime(0, now + FADE);
      }
      cur.dieAt = now + FADE + 0.1;
      cur = null;
    }
    const def = mood === 'none' ? undefined : (MOODS[mood] as MoodDef | undefined);
    if (def) {
      cur = open(def, now + 0.05);
      scenes.push(cur);
    }
    startTimer();
  };

  return {
    set(next) {
      mood = next;
      if (active && mood !== shown) swap();
    },
    intensity(v) {
      intensity = clamp(v, 0, 1);
      if (cur) tune(cur, ctx.currentTime);
    },
    run(on) {
      active = on;
      if (!on) stopTimer();
      else if (mood !== shown) swap();
      else startTimer();
    },
    dispose() {
      active = false;
      stopTimer();
      for (const sc of scenes) kill(sc);
      scenes.length = 0;
      cur = null;
    },
  };
}
