import { describe, expect, it } from 'vitest';
import { INTERSTITIAL_GAP_MS, interstitialDue, type InterstitialGate } from '../src/platform/interstitial';

const base: InterstitialGate = { tutorialDone: true, runs: 5, now: 10 * 60_000, sessionStart: 0, lastShown: null };

describe('interstitialDue', () => {
  it('shows after the free runs once the session is old enough', () => {
    expect(interstitialDue(base)).toBe(true);
  });
  it('skips the tutorial and the first two runs', () => {
    expect(interstitialDue({ ...base, tutorialDone: false })).toBe(false);
    expect(interstitialDue({ ...base, runs: 1 })).toBe(false);
    expect(interstitialDue({ ...base, runs: 2 })).toBe(false);
    expect(interstitialDue({ ...base, runs: 3 })).toBe(true);
  });
  it('waits a gap from the session start', () => {
    expect(interstitialDue({ ...base, now: INTERSTITIAL_GAP_MS - 1 })).toBe(false);
    expect(interstitialDue({ ...base, now: INTERSTITIAL_GAP_MS })).toBe(true);
  });
  it('waits a gap after the last one shown', () => {
    expect(interstitialDue({ ...base, lastShown: base.now - INTERSTITIAL_GAP_MS + 1 })).toBe(false);
    expect(interstitialDue({ ...base, lastShown: base.now - INTERSTITIAL_GAP_MS })).toBe(true);
  });
});
