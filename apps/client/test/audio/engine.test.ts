import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicMood, SfxId } from '../../src/audio';
import { createAudioEngine, SFX_IDS } from '../../src/audio';
import { FakeBiquad, FakeGain, FakeOscillator, FakePanner } from './fakeAudioContext';
import { capture, rig, run, unlocked } from './helpers';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Calls every method of the public API; none of them may throw. */
async function exercise(engine: ReturnType<typeof createAudioEngine>): Promise<void> {
  await engine.unlock();
  engine.play('eat_small', { volume: 0.5, pitch: 1.2, pan: -0.3 });
  engine.setMusic('lagoon');
  engine.setMusicVolume(0.5);
  engine.setSfxVolume(0.5);
  engine.setIntensity(0.5);
  engine.suspend();
  engine.resume();
  await engine.unlock();
  engine.dispose();
  engine.play('bubble');
  await engine.unlock();
}

describe('no-op engine', () => {
  it('stays silent and never throws when the factory throws', async () => {
    const factory = vi.fn((): AudioContext => {
      throw new Error('no audio device');
    });
    const engine = createAudioEngine(factory);
    await expect(exercise(engine)).resolves.toBeUndefined();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stays silent when Web Audio does not exist at all', async () => {
    await expect(exercise(createAudioEngine())).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stays silent when the context refuses to start', async () => {
    const { ctx, engine } = rig({ failResume: true });
    await expect(engine.unlock()).resolves.toBeUndefined();
    engine.setMusic('town');
    expect(capture(ctx, () => engine.play('ui_tap'))).toHaveLength(0);
    run(ctx, 1);
    expect(ctx.violations).toEqual([]);
    engine.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not hang when the browser never answers resume()', async () => {
    const { ctx, engine } = rig({ hangResume: true });
    const pending = engine.unlock();
    // A tap that arrives while the context is starting is queued rather than lost...
    expect(capture(ctx, () => engine.play('ui_tap')).length).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(600);
    await expect(pending).resolves.toBeUndefined();
    // ...but nothing piles up once it is clear the context did not start.
    expect(capture(ctx, () => engine.play('ui_back'))).toHaveLength(0);
    engine.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('unlock', () => {
  it('creates nothing and plays nothing before unlock', () => {
    const { ctx, engine, factory } = rig();
    engine.setMusic('lagoon');
    engine.setIntensity(1);
    engine.setSfxVolume(0.5);
    for (const id of SFX_IDS) engine.play(id);
    engine.resume();
    vi.advanceTimersByTime(5000);
    expect(factory).not.toHaveBeenCalled();
    expect(ctx.nodes).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is idempotent', async () => {
    const { ctx, engine, factory } = await unlocked();
    const nodes = ctx.nodes.length;
    await engine.unlock();
    await engine.unlock();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(ctx.nodes).toHaveLength(nodes);
    expect(ctx.state).toBe('running');
  });

  it('keeps the context suspended when unlocked while the page is hidden', async () => {
    const { ctx, engine } = rig();
    engine.suspend();
    engine.setMusic('lagoon');
    await engine.unlock();
    expect(ctx.state).toBe('suspended');
    expect(vi.getTimerCount()).toBe(0);
    expect(capture(ctx, () => engine.play('ui_tap'))).toHaveLength(0);
    engine.resume();
    expect(ctx.state).toBe('running');
    expect(vi.getTimerCount()).toBe(1);
  });
});

describe('play', () => {
  it.each(SFX_IDS)('%s creates at least one source without errors', async (id) => {
    const { ctx, engine } = await unlocked();
    const sources = capture(ctx, () => engine.play(id));
    expect(sources.length).toBeGreaterThan(0);
    expect(ctx.violations).toEqual([]);
  });

  it('knows all 44 effects', () => {
    expect(new Set(SFX_IDS).size).toBe(44);
  });

  it('ignores unknown ids and garbage options', async () => {
    const { ctx, engine } = await unlocked();
    expect(() => engine.play('nope' as SfxId)).not.toThrow();
    expect(() => engine.play('bubble', { volume: NaN, pitch: Infinity, pan: -Infinity })).not.toThrow();
    run(ctx, 0.1);
    expect(() => engine.play('bubble', { volume: -3, pitch: 0, pan: 9 })).not.toThrow();
    run(ctx, 0.1);
    expect(() => engine.play('bubble', { volume: 99, pitch: 1e9, pan: -9 })).not.toThrow();
    expect(ctx.violations).toEqual([]);
    for (const n of ctx.nodes) {
      if (n instanceof FakePanner) expect(Math.abs(n.pan.value)).toBeLessThanOrEqual(1);
    }
  });

  it('applies volume, pitch and pan', async () => {
    const firstFreq = async (pitch: number): Promise<number> => {
      const { ctx, engine } = await unlocked({}, 7);
      const osc = capture(ctx, () => engine.play('ui_back', { pitch })).find((s) => s instanceof FakeOscillator);
      return (osc as FakeOscillator).frequency.events[0]?.value ?? 0;
    };
    expect((await firstFreq(2)) / (await firstFreq(1))).toBeCloseTo(2, 6);

    const { ctx, engine } = await unlocked();
    const before = ctx.nodes.length;
    engine.play('ui_back', { volume: 0.25, pan: 0.5 });
    const created = ctx.nodes.slice(before);
    const panner = created.find((n) => n instanceof FakePanner) as FakePanner;
    expect(panner.pan.value).toBe(0.5);
    expect((created[0] as FakeGain).gain.value).toBe(0.25);
  });

  it('varies the pitch slightly between plays', async () => {
    const { ctx, engine } = await unlocked();
    const freqs: number[] = [];
    for (let i = 0; i < 8; i++) {
      const osc = capture(ctx, () => engine.play('ui_back')).find((s) => s instanceof FakeOscillator);
      freqs.push((osc as FakeOscillator).frequency.events[0]?.value ?? 0);
      run(ctx, 0.1);
    }
    expect(new Set(freqs).size).toBe(8);
    for (const f of freqs) expect(Math.abs(12 * Math.log2(f / 640))).toBeLessThanOrEqual(0.35);
  });

  it('rate-limits the same id but not different ones', async () => {
    const { ctx, engine } = await unlocked();
    expect(capture(ctx, () => engine.play('eat_small')).length).toBeGreaterThan(0);
    expect(capture(ctx, () => engine.play('eat_small'))).toHaveLength(0);
    expect(capture(ctx, () => engine.play('eat_big')).length).toBeGreaterThan(0);
    run(ctx, 0.03, 10);
    expect(capture(ctx, () => engine.play('eat_small'))).toHaveLength(0);
    run(ctx, 0.02, 10);
    expect(capture(ctx, () => engine.play('eat_small')).length).toBeGreaterThan(0);

    // Thirty creatures eaten within a second: at most one "nom" per 40 ms gets through.
    let played = 0;
    for (let i = 0; i < 100; i++) {
      if (capture(ctx, () => engine.play('eat_small')).length) played++;
      run(ctx, 0.01, 10);
    }
    expect(played).toBeLessThanOrEqual(25);
    expect(played).toBeGreaterThanOrEqual(20);
  });

  it('caps simultaneous voices by fading out the oldest', async () => {
    const { ctx, engine } = await unlocked();
    const baseline = ctx.connected.size;
    const now = ctx.currentTime;
    const groups = SFX_IDS.map((id) => capture(ctx, () => engine.play(id)));
    expect(groups.every((g) => g.length > 0)).toBe(true);

    const stolen = groups.slice(0, groups.length - 16);
    const kept = groups.slice(-16);
    for (const g of stolen) for (const s of g) expect(s.stopTime).toBeLessThanOrEqual(now + 0.0401);
    for (const g of kept) expect(Math.max(...g.map((s) => s.stopTime ?? 0))).toBeGreaterThan(now + 0.05);
    // A stolen voice is silent before its sources stop: no click.
    for (const g of stolen) for (const s of g) expect(s.outputs.length).toBeGreaterThan(0);
    expect(ctx.violations).toEqual([]);

    // Everything is stopped and disconnected once the sounds are over.
    run(ctx, 3);
    expect(ctx.running.size).toBe(0);
    expect(ctx.connected.size).toBe(baseline);
  });

  it('does not leak nodes over many plays', async () => {
    const { ctx, engine } = await unlocked();
    const baseline = ctx.connected.size;
    let most = 0;
    for (let i = 0; i < 2000; i++) {
      engine.play(SFX_IDS[i % SFX_IDS.length] ?? 'bubble', { pan: (i % 3) - 1 });
      run(ctx, 0.05);
      most = Math.max(most, ctx.connected.size);
    }
    run(ctx, 3);
    expect(most).toBeLessThan(baseline + 400);
    expect(ctx.running.size).toBe(0);
    expect(ctx.connected.size).toBe(baseline);
    expect(ctx.violations).toEqual([]);
  });
});

describe('volume', () => {
  it.each(['setSfxVolume', 'setMusicVolume'] as const)('%s clamps to 0..1', async (setter) => {
    const { ctx, engine } = await unlocked();
    const last = (): number => ctx.log[ctx.log.length - 1]?.value ?? NaN;
    engine[setter](0.5);
    const bus = ctx.log[ctx.log.length - 1]?.param;
    expect(last()).toBeCloseTo(0.25, 9);
    engine[setter](7);
    expect(last()).toBe(1);
    engine[setter](-2);
    expect(last()).toBe(0);
    engine[setter](Infinity);
    expect(last()).toBe(1);
    engine[setter](0.5);
    engine[setter](NaN);
    expect(last()).toBeCloseTo(0.25, 9);
    expect(ctx.log[ctx.log.length - 1]?.param).toBe(bus);
    expect(ctx.violations).toEqual([]);
  });

  it('remembers volumes set before unlock', async () => {
    const { ctx, engine } = rig();
    engine.setSfxVolume(0);
    engine.setMusicVolume(-1);
    await engine.unlock();
    const buses = ctx.nodes.filter(
      (n): n is FakeGain => n instanceof FakeGain && n.outputs.some((o) => 'kind' in o && o.kind === 'compressor'),
    );
    expect(buses.filter((b) => b.gain.value === 0)).toHaveLength(2);
  });
});

describe('music', () => {
  const persistent = (ctx: Awaited<ReturnType<typeof unlocked>>['ctx']): number =>
    [...ctx.running].filter((s) => s.stopTime === null).length;

  it('starts on unlock when the mood was chosen earlier', async () => {
    const { ctx, engine } = rig();
    engine.setMusic('lagoon');
    expect(vi.getTimerCount()).toBe(0);
    await engine.unlock();
    expect(vi.getTimerCount()).toBe(1);
    expect(persistent(ctx)).toBeGreaterThan(0);
    const before = ctx.nodes.length;
    run(ctx, 4);
    expect(ctx.nodes.length).toBeGreaterThan(before);
    expect(ctx.violations).toEqual([]);
  });

  it('switches moods with a crossfade and frees the old scene', async () => {
    const { ctx, engine } = await unlocked();
    const baseline = ctx.connected.size;
    engine.setMusic('lagoon');
    expect(vi.getTimerCount()).toBe(1);
    run(ctx, 5);
    const one = persistent(ctx);
    expect(one).toBeGreaterThan(0);

    engine.setMusic('lagoon');
    expect(persistent(ctx)).toBe(one);

    engine.setMusic('abyss');
    run(ctx, 1);
    expect(persistent(ctx)).toBe(one * 2);
    run(ctx, 2);
    expect(persistent(ctx)).toBe(one);
    expect(vi.getTimerCount()).toBe(1);

    engine.setMusic('none');
    run(ctx, 1);
    expect(persistent(ctx)).toBe(one);
    run(ctx, 2);
    expect(ctx.running.size).toBe(0);
    expect(ctx.connected.size).toBe(baseline);
    expect(vi.getTimerCount()).toBe(0);
    expect(ctx.violations).toEqual([]);
  });

  it('survives rapid mood changes', async () => {
    const { ctx, engine } = await unlocked();
    const baseline = ctx.connected.size;
    const moods: MusicMood[] = ['lagoon', 'wreck', 'abyss', 'town', 'battle', 'boss', 'none'];
    for (let i = 0; i < 40; i++) {
      engine.setMusic(moods[i % moods.length] ?? 'none');
      run(ctx, 0.3);
    }
    engine.setMusic('none');
    run(ctx, 3);
    expect(ctx.running.size).toBe(0);
    expect(ctx.connected.size).toBe(baseline);
    expect(vi.getTimerCount()).toBe(0);
    expect(ctx.violations).toEqual([]);
  });

  it('darkens the pad and raises the drone with intensity', async () => {
    const { ctx, engine } = await unlocked();
    engine.setMusic('lagoon');
    run(ctx, 3);
    const mark = ctx.log.length;
    engine.setIntensity(1);
    const events = ctx.log.slice(mark);
    const cutoff = events.find((e) => e.param.owner instanceof FakeBiquad && e.param.name === 'frequency');
    expect(cutoff?.kind).toBe('target');
    expect(cutoff?.value).toBeCloseTo(1900 * 0.45, 6);
    const drone = events.filter((e) => e.param.owner instanceof FakeGain).pop();
    expect(drone?.value).toBeGreaterThan(0);

    // Out-of-range values clamp to the same result.
    const again = ctx.log.length;
    engine.setIntensity(5);
    expect(ctx.log.slice(again).map((e) => e.value)).toEqual(events.map((e) => e.value));
    engine.setIntensity(-5);
    expect(ctx.log[ctx.log.length - 1]?.value).toBe(0);
  });

  it('plays faster under high intensity', async () => {
    const count = async (intensity: number): Promise<number> => {
      const { ctx, engine } = await unlocked({}, 3);
      engine.setIntensity(intensity);
      engine.setMusic('battle');
      const before = ctx.nodes.length;
      run(ctx, 60);
      return ctx.nodes.length - before;
    };
    expect(await count(1)).toBeGreaterThan((await count(0)) * 1.1);
  });
});

describe('lifecycle', () => {
  it('suspends and resumes with the page', async () => {
    const { ctx, engine } = await unlocked();
    engine.setMusic('town');
    run(ctx, 2);
    engine.suspend();
    expect(ctx.state).toBe('suspended');
    expect(vi.getTimerCount()).toBe(0);
    expect(capture(ctx, () => engine.play('ui_tap'))).toHaveLength(0);

    // A mood chosen while hidden is picked up when the page comes back.
    engine.setMusic('wreck');
    const frozen = ctx.nodes.length;
    vi.advanceTimersByTime(10_000);
    expect(ctx.nodes).toHaveLength(frozen);

    engine.resume();
    expect(ctx.state).toBe('running');
    expect(vi.getTimerCount()).toBe(1);
    expect(capture(ctx, () => engine.play('ui_tap')).length).toBeGreaterThan(0);
    run(ctx, 4);
    expect(ctx.nodes.length).toBeGreaterThan(frozen);
    expect(ctx.violations).toEqual([]);
  });

  it('dispose clears timers, frees every node and closes the context', async () => {
    const { ctx, engine, factory } = await unlocked();
    engine.setMusic('boss');
    run(ctx, 3);
    engine.setMusic('lagoon');
    run(ctx, 0.5);
    engine.play('victory');
    engine.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(ctx.state).toBe('closed');
    expect(ctx.connected.size).toBe(0);
    for (const s of ctx.running) expect(s.stopTime).not.toBeNull();

    const nodes = ctx.nodes.length;
    engine.play('bubble');
    engine.setMusic('town');
    engine.resume();
    await engine.unlock();
    engine.dispose();
    vi.advanceTimersByTime(5000);
    expect(ctx.nodes).toHaveLength(nodes);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(ctx.violations).toEqual([]);
  });
});
