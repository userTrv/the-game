/**
 * Deterministic PRNG shared by client and server. Only integer math and IEEE doubles
 * (no Math.sin and friends), so results are identical in every JS engine.
 */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Weighted pick; returns index. Weights must be >= 0 with a positive sum. */
  weightedIndex(weights: readonly number[]): number;
  shuffle<T>(items: readonly T[]): T[];
}

/** FNV-1a 32-bit hash of a string. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed: string | number): Rng {
  const base = typeof seed === 'number' ? seed >>> 0 : hashString(seed);
  const f = mulberry32(base);
  // Warm up: the first outputs of mulberry32 correlate for nearby seeds.
  f();
  f();
  const rng: Rng = {
    next: f,
    int(min, max) {
      return min + Math.floor(f() * (max - min + 1));
    },
    chance(p) {
      return f() < p;
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('pick from empty list');
      return items[Math.floor(f() * items.length)] as T;
    },
    weightedIndex(weights) {
      let total = 0;
      for (const w of weights) total += w;
      if (!(total > 0)) throw new Error('weights must have a positive sum');
      let r = f() * total;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i] as number;
        if (r < 0) return i;
      }
      return weights.length - 1;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(f() * (i + 1));
        const tmp = out[i] as T;
        out[i] = out[j] as T;
        out[j] = tmp;
      }
      return out;
    },
  };
  return rng;
}

/** Derive an independent sub-seed, e.g. subSeed(runSeed, 'offers', stage, reroll). */
export function subSeed(seed: string, ...parts: (string | number)[]): string {
  return `${seed}/${parts.join('/')}`;
}
