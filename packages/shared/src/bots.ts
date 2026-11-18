import { ratePower } from './battle';
import { buildFighter, slotCount } from './build';
import { SHELLS } from './data/shells';
import { TENANTS } from './data/tenants';
import { createRng } from './rng';
import { DIETS, zeroDiets, type BuildSnapshot, type TenantInst } from './types';

export const BOT_NAMES = ['Клешня', 'Пузырёк', 'Рифовик', 'Шустрик', 'Барнакл', 'Коралыч', 'Pinchy', 'Bubbles', 'Reefer', 'Shelldon', 'Scuttle', 'Нептуша', 'Жемчуг', 'Тихоход', 'Crabby', 'Tide', 'Мидий', 'Finn'];

/** Stages that get bot rivals, and how many per stage. */
export const BOT_STAGES = { from: 2, to: 24, perStage: 12 } as const;

/** A plausible bot build for a guardian stage: one main family, some off-family picks, merged copies. */
export function botBuild(stage: number, seed: string): BuildSnapshot {
  const rng = createRng(seed);
  const size = Math.max(2, Math.round(1 + stage * 0.8 + rng.int(-1, 1)));
  const tier = Math.min(4, Math.floor((size - 1) / 2));
  const shells = SHELLS.filter((s) => !s.starter);
  const shell = { id: tier === 0 ? 'periwinkle' : rng.pick(shells).id, tier };
  const n = slotCount('hermit', shell);
  const main = rng.pick(DIETS);
  const genes = zeroDiets();
  for (const d of DIETS) genes[d] = rng.int(0, 4 + stage);
  genes[main] += 8 + stage * 3;
  const slots: (TenantInst | null)[] = [];
  const filled = Math.max(2, Math.min(n, 2 + Math.floor(stage / 2) + rng.int(-1, 0)));
  for (let i = 0; i < n; i++) {
    if (i >= filled) {
      slots.push(null);
      continue;
    }
    const pool = TENANTS.filter((t) => (rng.chance(0.65) ? t.families.includes(main) : true) && t.rarity <= (stage >= 9 ? 3 : 2));
    const star = rng.chance(Math.min(0.6, stage * 0.05)) ? (stage >= 9 && rng.chance(0.25) ? 3 : 2) : 1;
    slots.push({ id: rng.pick(pool.length > 0 ? pool : TENANTS).id, star });
  }
  return { heroId: 'hermit', size, genes, mutations: {}, shell, slots };
}

export interface BotGhost {
  id: string;
  name: string;
  stage: number;
  power: number;
  build: BuildSnapshot & { name: string };
}

/** The fixed bot rivals of one stage; deterministic, so every device sees the same reef. */
export function botGhosts(stage: number): BotGhost[] {
  const out: BotGhost[] = [];
  for (let i = 0; i < BOT_STAGES.perStage; i++) {
    const build = botBuild(stage, `bot/${stage}/${i}`);
    const name = BOT_NAMES[(i + stage) % BOT_NAMES.length] as string;
    out.push({ id: `bot_${stage}_${i}`, name, stage, power: ratePower(buildFighter(build)), build: { ...build, name } });
  }
  return out;
}
