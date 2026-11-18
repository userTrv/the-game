/** Interstitial after a run: never in the tutorial or the first runs, at most once per gap. */
export const INTERSTITIAL_GAP_MS = 3 * 60_000;
/** Completed runs that never end in an interstitial. */
export const INTERSTITIAL_FREE_RUNS = 2;

export interface InterstitialGate {
  tutorialDone: boolean;
  /** Completed runs, including the one that just ended. */
  runs: number;
  now: number;
  sessionStart: number;
  /** When the last interstitial was shown in this session, if any. */
  lastShown: number | null;
}

export function interstitialDue(g: InterstitialGate): boolean {
  if (!g.tutorialDone || g.runs <= INTERSTITIAL_FREE_RUNS) return false;
  return g.now - (g.lastShown ?? g.sessionStart) >= INTERSTITIAL_GAP_MS;
}
