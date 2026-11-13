import type { AudioEngine, EngineOptions, MusicMood } from './types';
import type { Music } from './music';
import { createMusic } from './music';
import type { Graph, Voice } from './nodes';
import { buildGraph, clamp, halt, mulberry32, newVoice, release, seal, sweep } from './nodes';
import type { Recipe } from './sfx';
import { SFX } from './sfx';

/** Simultaneous SFX; the oldest one is faded out when a new sound needs room. */
const MAX_VOICES = 16;
/** The same SFX id is not retriggered more often than this, s. */
const MIN_GAP = 0.04;
/** How long `unlock()` waits for the context to start, and how long `play` trusts a pending start, ms. */
const WAKE_MS = 500;

type AudioCtor = new (options?: AudioContextOptions) => AudioContext;

function defaultCtxFactory(): AudioContext {
  const w = globalThis as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio is unavailable');
  return new Ctor({ latencyHint: 'interactive' });
}

/** Runs a call that may throw or return a rejecting promise and ignores both outcomes. */
function quiet(fn: () => unknown): void {
  try {
    const r = fn() as { catch?: (cb: () => void) => unknown } | undefined;
    if (r && typeof r.catch === 'function') r.catch(() => undefined);
  } catch {
    /* audio must never break the game */
  }
}

/** Reads an optional numeric option: non-finite values fall back to the default. */
const num = (v: number | undefined, def: number, lo: number, hi: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : def;

/**
 * Creates the audio engine. Nothing is created and nothing sounds until `unlock()` is called from a user
 * gesture; the AudioContext itself is made there, so browsers never see one started without a gesture.
 * If Web Audio is missing or the context cannot be created, every method is a silent no-op.
 */
export function createAudioEngine(
  ctxFactory: () => AudioContext = defaultCtxFactory,
  options: EngineOptions = {},
): AudioEngine {
  const rng = mulberry32(options.seed ?? (Date.now() ^ 0x9e3779b9));
  let g: Graph | null = null;
  let music: Music | null = null;
  let dead = false;
  let unlocked = false;
  let hidden = false;
  let wakeAt = -Infinity;
  let stopWait: (() => void) | null = null;
  // Volumes are squared before they reach the gain nodes: a slider then feels even across its range.
  let sfxVol = 1;
  let musicVol = 1;
  let mood: MusicMood = 'none';
  let intensity = 0;
  const live: Voice<GainNode>[] = [];
  const fading: Voice[] = [];
  const lastPlay = new Map<string, number>();

  /** Resolves when `p` settles or after WAKE_MS: a context blocked by autoplay policy may never answer. */
  const wait = (p: unknown): Promise<void> =>
    new Promise<void>((resolve) => {
      const fin = (): void => {
        clearTimeout(id);
        if (stopWait === fin) stopWait = null;
        resolve();
      };
      const id = setTimeout(fin, WAKE_MS);
      stopWait?.();
      stopWait = fin;
      Promise.resolve(p).then(fin, fin);
    });

  const setBus = (bus: GainNode, v: number, ctx: AudioContext): void => {
    bus.gain.setTargetAtTime(v * v, ctx.currentTime, 0.03);
  };

  /** Clamps a volume to 0..1; NaN keeps the previous value. */
  const vol = (v: number, prev: number): number => (Number.isNaN(v) ? prev : clamp(v, 0, 1));

  return {
    async unlock() {
      if (dead) return;
      if (!g) {
        let ctx: AudioContext | undefined;
        try {
          ctx = ctxFactory();
          g = buildGraph(ctx, rng);
          g.sfx.gain.value = sfxVol * sfxVol;
          g.music.gain.value = musicVol * musicVol;
          music = createMusic(g, rng);
          music.intensity(intensity);
          music.set(mood);
        } catch {
          dead = true;
          g = null;
          music = null;
          const broken = ctx;
          if (broken) quiet(() => broken.close());
          return;
        }
      }
      unlocked = true;
      const { ctx } = g;
      try {
        if (hidden) {
          quiet(() => ctx.suspend());
          return;
        }
        music?.run(true);
        if (ctx.state !== 'running') {
          wakeAt = Date.now();
          await wait(ctx.resume());
        }
      } catch {
        /* still locked; a later gesture may succeed */
      }
    },

    play(id, opts) {
      try {
        if (!g || !unlocked || hidden) return;
        const { ctx } = g;
        // A context that is still starting keeps its clock frozen, so sounds queued now play on start.
        if (ctx.state !== 'running' && Date.now() - wakeAt > WAKE_MS) return;
        const recipe = SFX[id] as Recipe | undefined;
        const now = ctx.currentTime;
        if (!recipe || now - (lastPlay.get(id) ?? -1) < MIN_GAP) return;
        lastPlay.set(id, now);

        sweep(live, now);
        sweep(fading, now);
        while (live.length >= MAX_VOICES) {
          const old = live.shift();
          if (!old) break;
          const p = old.out.gain;
          p.setValueAtTime(p.value, now);
          p.linearRampToValueAtTime(0, now + 0.03);
          halt(old, now + 0.04);
          fading.push(old);
        }

        const amp = ctx.createGain();
        amp.gain.value = num(opts?.volume, 1, 0, 1);
        const semis = (rng() * 2 - 1) * (recipe.vary ?? 0.35);
        const v = newVoice(ctx, amp, g.noise, rng, now, num(opts?.pitch, 1, 0.25, 4) * 2 ** (semis / 12));
        v.nodes.push(amp);
        let tail: AudioNode = amp;
        const pan = num(opts?.pan, 0, -1, 1);
        if (pan && typeof ctx.createStereoPanner === 'function') {
          const panner = ctx.createStereoPanner();
          panner.pan.value = pan;
          amp.connect(panner);
          v.nodes.push(panner);
          tail = panner;
        }
        tail.connect(g.sfx);
        const send = ctx.createGain();
        send.gain.value = recipe.rev ?? 0.15;
        tail.connect(send);
        send.connect(g.reverb);
        v.nodes.push(send);
        live.push(v);
        try {
          recipe.b(v);
        } finally {
          seal(v);
        }
      } catch {
        /* audio must never break the game */
      }
    },

    setMusic(next) {
      mood = next;
      quiet(() => music?.set(next));
    },

    setMusicVolume(v) {
      musicVol = vol(v, musicVol);
      const graph = g;
      if (graph) quiet(() => setBus(graph.music, musicVol, graph.ctx));
    },

    setSfxVolume(v) {
      sfxVol = vol(v, sfxVol);
      const graph = g;
      if (graph) quiet(() => setBus(graph.sfx, sfxVol, graph.ctx));
    },

    setIntensity(v) {
      intensity = vol(v, intensity);
      quiet(() => music?.intensity(intensity));
    },

    suspend() {
      hidden = true;
      const graph = g;
      if (!graph || !unlocked) return;
      quiet(() => music?.run(false));
      quiet(() => graph.ctx.suspend());
    },

    resume() {
      hidden = false;
      const graph = g;
      if (!graph || !unlocked) return;
      wakeAt = Date.now();
      quiet(() => music?.run(true));
      quiet(() => graph.ctx.resume());
    },

    dispose() {
      dead = true;
      unlocked = false;
      stopWait?.();
      const graph = g;
      g = null;
      quiet(() => music?.dispose());
      music = null;
      if (!graph) return;
      const now = graph.ctx.currentTime;
      for (const v of [...live, ...fading]) release(v, now);
      live.length = 0;
      fading.length = 0;
      for (const n of graph.nodes) quiet(() => n.disconnect());
      quiet(() => graph.ctx.close());
    },
  };
}
