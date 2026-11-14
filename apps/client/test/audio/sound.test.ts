/**
 * Nobody can listen to the output in CI, so the recipes are checked analytically instead: scheduling is
 * valid, envelopes are silent when sources start and stop (no clicks), frequencies stay in an audible
 * range, and the summed level into the master limiter stays well below clipping.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicMood } from '../../src/audio';
import { SFX_IDS } from '../../src/audio';
import type { FakeSource } from './fakeAudioContext';
import {
  auditNodes,
  checkSources,
  compressorCurve,
  FakeCompressor,
  FakeGain,
  FakeOscillator,
  inspect,
  levelAt,
} from './fakeAudioContext';
import { capture, run, unlocked } from './helpers';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Upper bound for one effect with every partial peaking at once; real peaks are roughly half of it. */
const SFX_PEAK_MAX = 0.8;
const SFX_PEAK_MIN = 0.1;
/** Upper bound for the whole music bed, same pessimistic measure. */
const MUSIC_PEAK_MAX = 0.6;

describe('sfx recipes', () => {
  it.each(SFX_IDS)('%s is well formed', async (id) => {
    const { ctx, engine } = await unlocked();
    const t0 = ctx.currentTime;
    const report = inspect(capture(ctx, () => engine.play(id)), t0);
    expect(report.problems).toEqual([]);
    expect(auditNodes(ctx)).toEqual([]);
    expect(ctx.violations).toEqual([]);
    expect(report.peak).toBeGreaterThan(SFX_PEAK_MIN);
    expect(report.peak).toBeLessThan(SFX_PEAK_MAX);
    expect(report.duration).toBeGreaterThan(0.05);
    expect(report.duration).toBeLessThan(2.6);
    expect(report.count).toBeLessThanOrEqual(24);
  });

  it.each([0.25, 0.5, 2, 4])('every effect stays in range at pitch x%s', async (pitch) => {
    const { ctx, engine } = await unlocked();
    for (const id of SFX_IDS) {
      const report = inspect(capture(ctx, () => engine.play(id, { pitch })), ctx.currentTime, 0.01);
      expect(report.problems, id).toEqual([]);
      run(ctx, 3, 500);
    }
    expect(auditNodes(ctx)).toEqual([]);
    expect(ctx.violations).toEqual([]);
  });

  it('every effect is distinct', async () => {
    const signatures = new Map<string, string>();
    for (const id of SFX_IDS) {
      const { ctx, engine } = await unlocked();
      const t0 = ctx.currentTime;
      const parts = capture(ctx, () => engine.play(id))
        .filter((s) => s.outputs.some((o) => !('events' in o)))
        .map((s) => {
          const f = s instanceof FakeOscillator ? Math.round(s.frequency.events[0]?.value ?? 0) : 0;
          return `${s.kind}@${Math.round(((s.startTime ?? 0) - t0) * 1000)}:${f}`;
        });
      const signature = parts.join(' ');
      expect(signatures.get(signature), `${id} sounds like ${signatures.get(signature)}`).toBeUndefined();
      signatures.set(signature, id);
    }
  });

  it('merge_3 is bigger than merge_2', async () => {
    const measure = async (id: 'merge_2' | 'merge_3'): Promise<ReturnType<typeof inspect>> => {
      const { ctx, engine } = await unlocked();
      return inspect(capture(ctx, () => engine.play(id)), ctx.currentTime);
    };
    const two = await measure('merge_2');
    const three = await measure('merge_3');
    expect(three.count).toBeGreaterThan(two.count);
    expect(three.duration).toBeGreaterThan(two.duration);
    expect(three.peak).toBeGreaterThan(two.peak);
  });
});

describe('music', () => {
  const MOODS: Exclude<MusicMood, 'none'>[] = ['lagoon', 'wreck', 'abyss', 'town', 'battle', 'boss'];

  it.each(MOODS)('%s runs for ten minutes without glitches, leaks or hot levels', async (mood) => {
    const { ctx, engine } = await unlocked({}, 11);
    engine.setMusic(mood);
    let seen = ctx.nodes.length;
    const problems: string[] = [];
    const stats = { peak: 0, connected: 0, running: 0 };
    const sample = (): void => {
      const fresh = ctx.nodes.slice(seen).filter((n): n is FakeSource => 'stopTime' in n && n.stopTime !== null);
      seen = ctx.nodes.length;
      problems.push(...checkSources(fresh));
      stats.peak = Math.max(stats.peak, levelAt(ctx.running, ctx.currentTime));
      stats.connected = Math.max(stats.connected, ctx.connected.size);
      stats.running = Math.max(stats.running, ctx.running.size);
    };

    run(ctx, 300, 50, sample);
    const calm = { ...stats };
    expect(calm.peak).toBeGreaterThan(0.05);

    engine.setIntensity(1);
    stats.connected = 0;
    stats.running = 0;
    run(ctx, 300, 50, sample);

    expect(problems).toEqual([]);
    expect(auditNodes(ctx)).toEqual([]);
    expect(ctx.violations).toEqual([]);
    expect(stats.peak).toBeLessThan(MUSIC_PEAK_MAX);
    // CPU-light: a small, bounded set of live nodes that does not grow over time.
    expect(calm.running).toBeLessThan(48);
    expect(stats.running).toBeLessThan(48);
    expect(stats.connected).toBeLessThan(160);
    expect(stats.connected).toBeLessThan(calm.connected * 1.5);
  });

  it('is deterministic for a seed and different across seeds', async () => {
    const trace = async (seed: number): Promise<string> => {
      const { ctx, engine } = await unlocked({}, seed);
      engine.setMusic('lagoon');
      const from = ctx.nodes.length;
      run(ctx, 60);
      return ctx.nodes
        .slice(from)
        .filter((n): n is FakeOscillator => n instanceof FakeOscillator)
        .map((o) => `${(o.startTime ?? 0).toFixed(3)}:${o.frequency.events[0]?.value.toFixed(1) ?? ''}`)
        .join(' ');
    };
    const a = await trace(5);
    expect(await trace(5)).toBe(a);
    expect(await trace(6)).not.toBe(a);
  });

  it('does not repeat itself', async () => {
    const { ctx, engine } = await unlocked({}, 5);
    engine.setMusic('lagoon');
    run(ctx, 4);
    // Melody notes of consecutive 30 s windows, as offsets within the window.
    const windows: string[] = [];
    for (let w = 0; w < 6; w++) {
      const from = ctx.nodes.length;
      const t0 = ctx.currentTime;
      run(ctx, 30);
      windows.push(
        ctx.nodes
          .slice(from)
          .filter((n): n is FakeOscillator => n instanceof FakeOscillator && n.type === 'triangle')
          .filter((o) => (o.stopTime ?? 0) - (o.startTime ?? 0) < 2)
          .map((o) => `${((o.startTime ?? 0) - t0).toFixed(1)}:${Math.round(o.frequency.events[0]?.value ?? 0)}`)
          .join(' '),
      );
    }
    expect(new Set(windows).size).toBe(windows.length);
  });
});

describe('master bus', () => {
  it('keeps the output well below clipping', async () => {
    const { ctx } = await unlocked();
    const comp = ctx.nodes.find((n): n is FakeCompressor => n instanceof FakeCompressor);
    if (!comp) throw new Error('no compressor');
    const trim = comp.outputs[0];
    if (!(trim instanceof FakeGain)) throw new Error('no trim gain after the compressor');
    expect(trim.outputs[0]).toBe(ctx.destination);
    expect(comp.attack.value).toBeLessThanOrEqual(0.005);

    const curve = compressorCurve(comp.threshold.value, comp.knee.value, comp.ratio.value);
    const out = (x: number): number => curve(x) * trim.gain.value;
    const db = (x: number): number => 20 * Math.log10(x);

    // Quiet material passes almost unchanged (the automatic makeup gain is accounted for).
    expect(db(out(0.01) / 0.01)).toBeGreaterThan(3);
    expect(db(out(0.01) / 0.01)).toBeLessThan(7);
    // One loud effect on top of the music.
    expect(db(out(SFX_PEAK_MAX + MUSIC_PEAK_MAX))).toBeLessThan(-3);
    // Worst case: sixteen voices at their pessimistic peak plus music still do not reach full scale.
    expect(db(out(16 * SFX_PEAK_MAX + MUSIC_PEAK_MAX))).toBeLessThan(-1.5);
    // The curve never folds back: louder in is never quieter out.
    for (let x = 0.01; x < 20; x *= 1.1) expect(out(x * 1.1)).toBeGreaterThanOrEqual(out(x));
  });
});
