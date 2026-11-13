import { vi } from 'vitest';
import type { AudioEngine } from '../../src/audio';
import { createAudioEngine } from '../../src/audio';
import type { FakeOptions } from './fakeAudioContext';
import { FakeAudioContext, FakeSource } from './fakeAudioContext';

export interface Rig {
  ctx: FakeAudioContext;
  engine: AudioEngine;
  factory: ReturnType<typeof vi.fn<() => AudioContext>>;
}

/** An engine wired to a fake context. The context is only handed over when the engine asks for it. */
export function rig(options: FakeOptions = {}, seed = 1): Rig {
  const ctx = new FakeAudioContext(options);
  const factory = vi.fn(() => ctx as unknown as AudioContext);
  return { ctx, engine: createAudioEngine(factory, { seed }), factory };
}

/** A rig that has already been unlocked and is running. */
export async function unlocked(options: FakeOptions = {}, seed = 1): Promise<Rig> {
  const r = rig(options, seed);
  await r.engine.unlock();
  return r;
}

/** Advances fake timers and the audio clock together, in steps of `stepMs`. */
export function run(ctx: FakeAudioContext, seconds: number, stepMs = 50, each?: () => void): void {
  for (let i = 0; i < Math.round((seconds * 1000) / stepMs); i++) {
    vi.advanceTimersByTime(stepMs);
    ctx.advance(stepMs / 1000);
    each?.();
  }
}

/** Sources created while `fn` runs. */
export function capture(ctx: FakeAudioContext, fn: () => void): FakeSource[] {
  const from = ctx.nodes.length;
  fn();
  return ctx.nodes.slice(from).filter((n): n is FakeSource => n instanceof FakeSource);
}
