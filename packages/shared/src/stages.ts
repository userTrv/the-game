import { CREATURES, type CreatureDef } from './data/creatures';
import { GUARDIANS } from './data/guardians';
import { BIOMES, type BiomeId, type Diet } from './types';

export const CHAPTER_STAGES = 12;
export const STAGES_PER_SEGMENT = 3;

export interface StageInfo {
  stage: number;
  kind: 'hunt' | 'guardian';
  biome: BiomeId;
  /** 0-based index of the 3-stage block. */
  segment: number;
  /** 0 for the chapter, 1+ for endless loops. */
  loop: number;
  /** Tier of rank-0 creatures in this segment. */
  baseTier: number;
  guardianId?: string;
  /** Endless scaling for the guardian's stats. */
  guardianHpMult: number;
  guardianAtkMult: number;
}

/** Guardian stat growth per endless loop (the chapter's four guardians repeat as "ancient"). */
export const ENDLESS_HP_MULT = 11;
export const ENDLESS_ATK_MULT = 5;

export function stageInfo(stage: number): StageInfo {
  if (!Number.isInteger(stage) || stage < 1) throw new Error(`bad stage: ${stage}`);
  const segment = Math.floor((stage - 1) / STAGES_PER_SEGMENT);
  const loop = Math.floor(segment / BIOMES.length);
  const biome = BIOMES[segment % BIOMES.length] as BiomeId;
  const kind = stage % STAGES_PER_SEGMENT === 0 ? 'guardian' : 'hunt';
  const info: StageInfo = {
    stage,
    kind,
    biome,
    segment,
    loop,
    baseTier: 1 + segment,
    guardianHpMult: Math.pow(ENDLESS_HP_MULT, loop),
    guardianAtkMult: Math.pow(ENDLESS_ATK_MULT, loop),
  };
  if (kind === 'guardian') info.guardianId = GUARDIANS[segment % GUARDIANS.length]?.id;
  return info;
}

export interface SpawnEntry {
  def: CreatureDef;
  tier: number;
  weight: number;
}

/** The trench reuses abyss fauna (drawn with an "ancient" tint by the client). */
export function biomeFauna(biome: BiomeId): CreatureDef[] {
  const src = biome === 'trench' ? 'abyss' : biome;
  return CREATURES.filter((c) => c.biome === src);
}

/**
 * Spawn table of a hunt stage. `dietWeights` comes from the weekly event
 * (e.g. { sting: 2 } during the jellyfish spawning).
 */
export function spawnTable(stage: number, dietWeights?: Partial<Record<Diet, number>>): SpawnEntry[] {
  const info = stageInfo(stage);
  // The second hunt of a segment leans toward bigger fauna.
  const second = (stage - 1) % STAGES_PER_SEGMENT === 1;
  return biomeFauna(info.biome).map((def) => {
    let weight = def.weight * (dietWeights?.[def.diet] ?? 1);
    if (second && def.rank >= 3) weight *= 1.4;
    if (!second && def.rank >= 4) weight *= 0.6;
    return { def, tier: info.baseTier + def.rank, weight };
  });
}

export function creatureTier(stage: number, def: CreatureDef): number {
  return stageInfo(stage).baseTier + def.rank;
}
