/** Low-level Web Audio helpers shared by the SFX and music layers. */

export type Rng = () => number;

/** Small seeded PRNG (mulberry32) returning floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** MIDI note number to frequency in Hz. */
export const mtof = (m: number): number => 440 * 2 ** ((m - 69) / 12);

/** Envelopes decay to this level (-80 dB) before a source stops, so stopping never clicks. */
export const EPS = 1e-4;

/** Extra time a source keeps running after its envelope has reached silence. */
const TAIL = 0.01;

/** Keeps audible frequencies and filter cutoffs in a sane range whatever the pitch multiplier. */
const hz = (f: number): number => clamp(f, 20, 16000);

/* ------------------------------------------------------------------ graph */

export interface Graph {
  ctx: AudioContext;
  /** SFX bus; its gain is the SFX volume. */
  sfx: GainNode;
  /** Music bus; its gain is the music volume. */
  music: GainNode;
  /** Input of the shared reverb. */
  reverb: AudioNode;
  /** Shared white noise, looped by every noise source. */
  noise: AudioBuffer;
  nodes: AudioNode[];
}

function noiseBuffer(ctx: BaseAudioContext, seconds: number, rng: Rng): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = rng() * 2 - 1;
  return buf;
}

/** Generated impulse response: decaying noise whose tail gets darker, like sound travelling through water. */
function impulse(ctx: BaseAudioContext, seconds: number, rng: Rng): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  const skip = Math.floor(ctx.sampleRate * 0.012);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = skip; i < n; i++) {
      const x = i / n;
      lp += (rng() * 2 - 1 - lp) * (0.55 - 0.4 * x);
      d[i] = lp * (1 - x) * Math.exp(-5 * x);
    }
  }
  return buf;
}

/**
 * sfx ──┐
 * music ─┼─> compressor ─> trim ─> destination
 * reverb (highpass ─> convolver ─> return) ─┘
 *
 * The compressor works as a soft limiter. Web Audio applies makeup gain to it automatically: with these
 * settings quiet material is lifted by about 6 dB, a 0 dBFS sum comes out near -4 dBFS and even +20 dB of
 * overload stays below -2 dBFS; `trim` takes another 0.9 dB off, so the output never reaches full scale.
 */
export function buildGraph(ctx: AudioContext, rng: Rng): Graph {
  const nodes: AudioNode[] = [];
  const gain = (value: number, dest: AudioNode): GainNode => {
    const n = ctx.createGain();
    n.gain.value = value;
    n.connect(dest);
    nodes.push(n);
    return n;
  };
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 12;
  comp.ratio.value = 12;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;
  comp.connect(gain(0.9, ctx.destination));
  const conv = ctx.createConvolver();
  conv.buffer = impulse(ctx, 1.4, rng);
  conv.connect(gain(0.5, comp));
  const reverb = ctx.createBiquadFilter();
  reverb.type = 'highpass';
  reverb.frequency.value = 220;
  reverb.connect(conv);
  nodes.push(comp, conv, reverb);
  return { ctx, sfx: gain(1, comp), music: gain(1, comp), reverb, noise: noiseBuffer(ctx, 2, rng), nodes };
}

/* ----------------------------------------------------------------- voices */

/** One sound event: a group of short-lived sources feeding `out`, released together when the last one ends. */
export interface Voice<T extends AudioNode = AudioNode> {
  readonly ctx: BaseAudioContext;
  /** Where the sources of this voice connect to. */
  readonly out: T;
  readonly noise: AudioBuffer;
  readonly rng: Rng;
  /** Start time on the context clock. */
  readonly t: number;
  /** Pitch multiplier applied to every frequency. */
  readonly p: number;
  /** Time when the last source stops. */
  end: number;
  last: AudioScheduledSourceNode | null;
  dead: boolean;
  srcs: AudioScheduledSourceNode[];
  nodes: AudioNode[];
}

export function newVoice<T extends AudioNode>(
  ctx: BaseAudioContext,
  out: T,
  noise: AudioBuffer,
  rng: Rng,
  t: number,
  p = 1,
): Voice<T> {
  return { ctx, out, noise, rng, t, p, end: t, last: null, dead: false, srcs: [], nodes: [] };
}

/** Disconnects everything the voice created. With `stopAt` the sources are stopped as well. Idempotent. */
export function release(v: Voice, stopAt?: number): void {
  if (v.dead) return;
  v.dead = true;
  for (const s of v.srcs) {
    s.onended = null;
    if (stopAt !== undefined) {
      try {
        s.stop(stopAt);
      } catch {
        /* never started */
      }
    }
  }
  for (const n of v.nodes) {
    try {
      n.disconnect();
    } catch {
      /* already disconnected */
    }
  }
  v.srcs.length = 0;
  v.nodes.length = 0;
  v.last = null;
}

/** Call once the voice is built: frees its nodes as soon as the last source has ended. */
export function seal(v: Voice): void {
  if (v.last) v.last.onended = () => release(v);
  else release(v);
}

/** Stops every source of the voice at `at` (after the caller has faded it out). */
export function halt(v: Voice, at: number): void {
  for (const s of v.srcs) {
    try {
      s.stop(at);
    } catch {
      /* never started */
    }
  }
  v.end = at;
}

/** Drops finished voices from the list in place; a fallback for browsers that skip `ended` events. */
export function sweep(list: Voice[], now: number): void {
  let n = 0;
  for (const v of list) {
    if (!v.dead && v.end + 0.05 < now) release(v);
    if (!v.dead) list[n++] = v;
  }
  list.length = n;
}

/* ------------------------------------------------------------ generators */

export interface EnvOpts {
  /** Start offset from the voice start, s. */
  at?: number;
  /** Attack, s (default 4 ms). */
  a?: number;
  /** Hold at peak level, s. */
  h?: number;
  /** Decay, s. Exponential down to -80 dB (so it is roughly a T60) unless `lin` is set. */
  d: number;
  /** Peak gain. */
  g: number;
  /** Linear release down to zero instead of an exponential one (pads, crossfades). */
  lin?: boolean;
}

export interface ToneOpts extends EnvOpts {
  /** Waveform (default sine). */
  w?: OscillatorType;
  /** Start frequency, Hz. */
  f: number;
  /** End frequency of an exponential glide, Hz. */
  to?: number;
  /** Glide time, s (default: the whole note). */
  gl?: number;
  /** Filter cutoff, Hz; the tone is unfiltered when omitted. */
  lp?: number;
  /** Cutoff at the end of a sweep over the first 60 % of the note. */
  lpTo?: number;
  /** Filter Q: dB of resonance for lowpass/highpass, quality factor for bandpass. */
  q?: number;
  /** Filter type (default lowpass). */
  ft?: BiquadFilterType;
  /** Vibrato depth, Hz. */
  vib?: number;
  /** Vibrato rate, Hz (default 6). */
  vibHz?: number;
  /** FM modulator ratio; with `fmI` gives bell and glass timbres. */
  fm?: number;
  /** FM modulation index at the onset (default 1); it fades as the note rings out. */
  fmI?: number;
}

export interface NoiseOpts extends EnvOpts {
  /** Filter type (default bandpass). */
  ft?: BiquadFilterType;
  /** Filter frequency, Hz. */
  f: number;
  /** Filter frequency at the end of a sweep over the first 60 % of the burst. */
  to?: number;
  q?: number;
}

interface Span {
  amp: GainNode;
  t0: number;
  len: number;
  stop: number;
}

function envelope(v: Voice, o: EnvOpts): Span {
  const t0 = v.t + (o.at ?? 0);
  const a = o.a ?? 0.004;
  const hold = t0 + a + (o.h ?? 0);
  const t1 = hold + o.d;
  const amp = v.ctx.createGain();
  const p = amp.gain;
  p.setValueAtTime(0, t0);
  p.linearRampToValueAtTime(o.g, t0 + a);
  if (o.h) p.setValueAtTime(o.g, hold);
  if (o.lin) p.linearRampToValueAtTime(0, t1);
  else p.exponentialRampToValueAtTime(EPS, t1);
  amp.connect(v.out);
  v.nodes.push(amp);
  return { amp, t0, len: t1 - t0, stop: t1 + TAIL };
}

function glide(p: AudioParam, f0: number, f1: number | undefined, t0: number, dur: number): void {
  p.setValueAtTime(hz(f0), t0);
  if (f1) p.exponentialRampToValueAtTime(hz(f1), t0 + dur);
}

function filter(
  v: Voice,
  type: BiquadFilterType,
  f0: number,
  f1: number | undefined,
  q: number,
  t0: number,
  dur: number,
): BiquadFilterNode {
  const flt = v.ctx.createBiquadFilter();
  flt.type = type;
  flt.Q.value = q;
  glide(flt.frequency, f0 * v.p, f1 && f1 * v.p, t0, dur);
  v.nodes.push(flt);
  return flt;
}

function track(v: Voice, src: AudioScheduledSourceNode, stop: number): void {
  src.stop(stop);
  v.srcs.push(src);
  v.nodes.push(src);
  if (stop >= v.end) {
    v.end = stop;
    v.last = src;
  }
}

/** Oscillator -> gain -> AudioParam: vibrato when slow, FM when fast. `fade` > 0 lets the depth die away. */
function modulate(
  v: Voice,
  target: AudioParam,
  rate: number,
  depth: number,
  fade: number,
  t0: number,
  stop: number,
): void {
  const lfo = v.ctx.createOscillator();
  lfo.frequency.setValueAtTime(rate, t0);
  const amt = v.ctx.createGain();
  amt.gain.setValueAtTime(depth, t0);
  if (fade) amt.gain.exponentialRampToValueAtTime(depth * 0.03, t0 + fade);
  lfo.connect(amt);
  amt.connect(target);
  v.nodes.push(amt);
  lfo.start(t0);
  track(v, lfo, stop);
}

/** Adds an enveloped oscillator to the voice. */
export function tone(v: Voice, o: ToneOpts): void {
  if (!(o.g > EPS)) return;
  const { amp, t0, len, stop } = envelope(v, o);
  const f0 = hz(o.f * v.p);
  const osc = v.ctx.createOscillator();
  osc.type = o.w ?? 'sine';
  glide(osc.frequency, f0, o.to && o.to * v.p, t0, o.gl ?? len);
  if (o.lp) {
    const flt = filter(v, o.ft ?? 'lowpass', o.lp, o.lpTo, o.q ?? 0.7, t0, len * 0.6);
    osc.connect(flt);
    flt.connect(amp);
  } else osc.connect(amp);
  osc.start(t0);
  track(v, osc, stop);
  if (o.vib) modulate(v, osc.frequency, o.vibHz ?? 6, o.vib * v.p, 0, t0, stop);
  if (o.fm) {
    const fmod = hz(f0 * o.fm);
    modulate(v, osc.frequency, fmod, fmod * (o.fmI ?? 1), len * 0.7, t0, stop);
  }
}

/** Adds an enveloped burst of filtered noise to the voice. */
export function noise(v: Voice, o: NoiseOpts): void {
  if (!(o.g > EPS)) return;
  const { amp, t0, len, stop } = envelope(v, o);
  const src = v.ctx.createBufferSource();
  src.buffer = v.noise;
  src.loop = true;
  const flt = filter(v, o.ft ?? 'bandpass', o.f, o.to, o.q ?? 1, t0, len * 0.6);
  src.connect(flt);
  flt.connect(amp);
  // A random offset decorrelates bursts that overlap.
  src.start(t0, v.rng() * (v.noise.duration - 0.1));
  track(v, src, stop);
}
