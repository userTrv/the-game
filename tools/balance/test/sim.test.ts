import { describe, expect, it } from 'vitest';
import { POLICIES, PROFILES, simulateRun, summarize } from '../src/sim';

describe('balance simulator', () => {
  it('is deterministic for a seed', () => {
    const policy = POLICIES[0]!;
    const profile = PROFILES['late']!(0);
    expect(simulateRun('t:1', policy, profile)).toEqual(simulateRun('t:1', policy, profile));
  });

  it('every bot finishes its runs on every town preset', () => {
    for (const profile of Object.keys(PROFILES)) {
      for (const policy of POLICIES) {
        const s = summarize(policy, profile, 5, 'hermit', 'test');
        expect(s.avgStage, `${policy.id}/${profile}`).toBeGreaterThanOrEqual(1);
        expect(s.avgStage).toBeLessThanOrEqual(s.maxStage);
      }
    }
    // Bots try out rearrangements at every camp, which takes a few seconds on a slow machine.
  }, 30_000);

  it('a new player usually beats the first guardian', () => {
    const omni = POLICIES.find((p) => p.id === 'omnivore')!;
    expect(summarize(omni, 'fresh', 60, 'hermit', 'test').beat[3]).toBeGreaterThan(0.8);
  });
});
