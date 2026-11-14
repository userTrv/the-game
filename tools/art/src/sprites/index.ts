import type { Sprite } from '../kit';
import { crabSprites } from './crab';
import { creatureSprites } from './creatures';
import { miscSprites } from './misc';
import { shellSprites } from './shells';
import { tenantSprites } from './tenants';

const fauna = creatureSprites();
const misc = miscSprites();

/** Atlas groups: `core` loads first; biome, guardian and town atlases load lazily. */
export const ALL_GROUPS: Record<string, Sprite[]> = {
  core: [...crabSprites(), ...shellSprites(), ...tenantSprites(), ...misc.core],
  lagoon: [...fauna.lagoon, ...misc.decor.lagoon],
  wreck: [...fauna.wreck, ...misc.decor.wreck],
  abyss: [...fauna.abyss, ...misc.decor.abyss],
  big: misc.big,
  town: misc.town,
};
