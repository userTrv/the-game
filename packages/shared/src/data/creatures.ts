import type { BiomeId, Diet } from '../types';

/**
 * How a creature moves in a pool:
 *  drift  - floats slowly, bobbing (jellyfish, plankton)
 *  crawl  - walks along the floor, changes direction rarely
 *  dart   - idles, then bursts away when the crab comes close
 *  school - small fish moving as a group
 *  hunter - when bigger than the crab: chases it; otherwise wanders like `crawl`
 *  ambush - sits still; when bigger than the crab lunges once it gets close
 */
export type Behavior = 'drift' | 'crawl' | 'dart' | 'school' | 'hunter' | 'ambush';

export interface CreatureDef {
  id: string;
  diet: Diet;
  biome: Exclude<BiomeId, 'trench'>;
  /** 0 (tiny) .. 5 (apex) within its biome; tier = segment base tier + rank. */
  rank: number;
  behavior: Behavior;
  /** World units per second. */
  speed: number;
  /** Floats above the floor (visual + shadow offset). */
  hover?: boolean;
  /** Relative spawn weight. */
  weight: number;
}

export const CREATURES: readonly CreatureDef[] = [
  // Sunny lagoon
  { id: 'plankton_spark', diet: 'glow', biome: 'lagoon', rank: 0, behavior: 'drift', speed: 18, hover: true, weight: 10 },
  { id: 'moon_jelly', diet: 'sting', biome: 'lagoon', rank: 0, behavior: 'drift', speed: 16, hover: true, weight: 10 },
  { id: 'sand_worm', diet: 'soft', biome: 'lagoon', rank: 0, behavior: 'crawl', speed: 22, weight: 10 },
  { id: 'baby_shrimp', diet: 'armor', biome: 'lagoon', rank: 1, behavior: 'dart', speed: 60, weight: 9 },
  { id: 'sea_slug', diet: 'venom', biome: 'lagoon', rank: 1, behavior: 'crawl', speed: 14, weight: 9 },
  { id: 'mini_urchin', diet: 'spike', biome: 'lagoon', rank: 1, behavior: 'crawl', speed: 10, weight: 9 },
  { id: 'hopper_clam', diet: 'soft', biome: 'lagoon', rank: 2, behavior: 'dart', speed: 45, weight: 7 },
  { id: 'compass_jelly', diet: 'sting', biome: 'lagoon', rank: 2, behavior: 'drift', speed: 20, hover: true, weight: 7 },
  { id: 'lantern_fry', diet: 'glow', biome: 'lagoon', rank: 2, behavior: 'school', speed: 55, hover: true, weight: 7 },
  { id: 'sea_star', diet: 'spike', biome: 'lagoon', rank: 3, behavior: 'crawl', speed: 9, weight: 5 },
  { id: 'fiddler_crab', diet: 'armor', biome: 'lagoon', rank: 3, behavior: 'hunter', speed: 62, weight: 5 },
  { id: 'puffer', diet: 'venom', biome: 'lagoon', rank: 4, behavior: 'hunter', speed: 50, hover: true, weight: 4 },
  { id: 'lionfish', diet: 'venom', biome: 'lagoon', rank: 5, behavior: 'hunter', speed: 78, hover: true, weight: 2 },

  // Sunken ship
  { id: 'rust_shrimp', diet: 'armor', biome: 'wreck', rank: 0, behavior: 'dart', speed: 64, weight: 10 },
  { id: 'bottle_jelly', diet: 'sting', biome: 'wreck', rank: 0, behavior: 'drift', speed: 17, hover: true, weight: 10 },
  { id: 'ship_worm', diet: 'soft', biome: 'wreck', rank: 0, behavior: 'crawl', speed: 20, weight: 10 },
  { id: 'glow_squidling', diet: 'glow', biome: 'wreck', rank: 1, behavior: 'school', speed: 58, hover: true, weight: 9 },
  { id: 'spiny_snail', diet: 'spike', biome: 'wreck', rank: 1, behavior: 'crawl', speed: 9, weight: 9 },
  { id: 'ink_slug', diet: 'venom', biome: 'wreck', rank: 2, behavior: 'crawl', speed: 13, weight: 8 },
  { id: 'sea_hare', diet: 'soft', biome: 'wreck', rank: 2, behavior: 'crawl', speed: 16, weight: 7 },
  { id: 'man_o_war', diet: 'sting', biome: 'wreck', rank: 3, behavior: 'hunter', speed: 34, hover: true, weight: 5 },
  { id: 'long_urchin', diet: 'spike', biome: 'wreck', rank: 3, behavior: 'crawl', speed: 8, weight: 5 },
  { id: 'lantern_fish', diet: 'glow', biome: 'wreck', rank: 3, behavior: 'school', speed: 60, hover: true, weight: 6 },
  { id: 'box_crab', diet: 'armor', biome: 'wreck', rank: 4, behavior: 'hunter', speed: 66, weight: 4 },
  { id: 'scorpionfish', diet: 'venom', biome: 'wreck', rank: 5, behavior: 'ambush', speed: 120, weight: 2 },

  // Glowing abyss
  { id: 'abyss_copepod', diet: 'glow', biome: 'abyss', rank: 0, behavior: 'drift', speed: 20, hover: true, weight: 10 },
  { id: 'comb_jelly', diet: 'sting', biome: 'abyss', rank: 0, behavior: 'drift', speed: 18, hover: true, weight: 10 },
  { id: 'bone_worm', diet: 'soft', biome: 'abyss', rank: 1, behavior: 'crawl', speed: 18, weight: 9 },
  { id: 'glass_shrimp', diet: 'armor', biome: 'abyss', rank: 1, behavior: 'dart', speed: 68, weight: 9 },
  { id: 'sea_pig', diet: 'soft', biome: 'abyss', rank: 2, behavior: 'crawl', speed: 12, weight: 7 },
  { id: 'toxic_nudi', diet: 'venom', biome: 'abyss', rank: 2, behavior: 'crawl', speed: 14, weight: 8 },
  { id: 'siphon_chain', diet: 'sting', biome: 'abyss', rank: 3, behavior: 'hunter', speed: 36, hover: true, weight: 5 },
  { id: 'spider_urchin', diet: 'spike', biome: 'abyss', rank: 2, behavior: 'crawl', speed: 15, weight: 8 },
  { id: 'hatchetfish', diet: 'glow', biome: 'abyss', rank: 3, behavior: 'school', speed: 62, hover: true, weight: 6 },
  { id: 'giant_isopod', diet: 'armor', biome: 'abyss', rank: 4, behavior: 'hunter', speed: 60, weight: 4 },
  { id: 'vampire_squid', diet: 'venom', biome: 'abyss', rank: 4, behavior: 'hunter', speed: 70, hover: true, weight: 3 },
  { id: 'spike_crab', diet: 'spike', biome: 'abyss', rank: 4, behavior: 'hunter', speed: 58, weight: 3 },
  { id: 'viperfish', diet: 'glow', biome: 'abyss', rank: 5, behavior: 'hunter', speed: 86, hover: true, weight: 2 },
];

export const CREATURE_BY_ID: ReadonlyMap<string, CreatureDef> = new Map(CREATURES.map((c) => [c.id, c]));

export function creatureDef(id: string): CreatureDef {
  const c = CREATURE_BY_ID.get(id);
  if (!c) throw new Error(`unknown creature: ${id}`);
  return c;
}

export type NodeId = 'oyster' | 'coral' | 'glitter';
