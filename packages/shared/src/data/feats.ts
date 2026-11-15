/**
 * Feats: things done inside a run that unlock content for good. A tenant, hero or shell that names a
 * feat stays out of the pool until the feat is in the profile.
 */
export interface FeatStats {
  linksMax?: number;
  flawless?: boolean;
  parries?: number;
  trophies?: number;
  duelWins?: number;
  maxSet: Record<string, number>;
}

export interface FeatDef {
  id: string;
  /** Number shown next to the feat's icon (3 links, 5 parries...). */
  need: number;
  done(stats: FeatStats): boolean;
}

export const FEATS: readonly FeatDef[] = [
  { id: 'links3', need: 3, done: (s) => (s.linksMax ?? 0) >= 3 },
  { id: 'flawless', need: 80, done: (s) => s.flawless === true },
  { id: 'parry5', need: 5, done: (s) => (s.parries ?? 0) >= 5 },
  { id: 'trophy3', need: 3, done: (s) => (s.trophies ?? 0) >= 3 },
  { id: 'duel3', need: 3, done: (s) => (s.duelWins ?? 0) >= 3 },
  { id: 'set6', need: 6, done: (s) => Object.values(s.maxSet).some((n) => n >= 6) },
];

export const FEAT_BY_ID: ReadonlyMap<string, FeatDef> = new Map(FEATS.map((f) => [f.id, f]));
