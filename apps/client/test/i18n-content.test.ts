import { AD_UNLOCKS, BIOMES, BUILDING_DEFS, BUILDINGS, CREATURES, DIETS, FEATS, GUARDIANS, HEROES, MILESTONES, MUT_SLOTS, MUTATIONS, QUESTS, SHELLS, TALENTS, TENANTS } from '@shellter/shared';
import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { NAMES } from '../src/i18n/names';
import { ru } from '../src/i18n/ru';

/** Keys the UI builds from game data, e.g. t(`hero.${id}`): each must exist in both languages. */
function contentKeys(): string[] {
  const keys: string[] = [];
  for (const h of HEROES) keys.push(`hero.${h.id}`, `hero.${h.id}.desc`);
  for (const g of GUARDIANS) keys.push(`guardian.${g.id}`);
  for (const b of BUILDINGS) {
    keys.push(`building.${b}`, `building.${b}.desc`);
  }
  // Buildings without a numeric effect describe each level in words (Home.tsx levelText).
  for (const b of ['lab', 'hatchery'] as const) for (let l = 0; l <= BUILDING_DEFS[b].costs.length; l++) keys.push(`building.${b}.l${l}`);
  for (const x of TALENTS) keys.push(`talent.${x.id}`);
  for (const x of FEATS) keys.push(`feat.${x.id}`);
  for (const d of DIETS) keys.push(`diet.${d}`);
  for (const b of BIOMES) keys.push(`biome.${b}`);
  for (const q of QUESTS) keys.push(q.metric.startsWith('eat_') && q.metric !== 'eat_total' ? 'quest.eat_diet' : `quest.${q.metric}`);
  for (const m of MILESTONES) keys.push(`milestone.${m.kind}`);
  for (const u of AD_UNLOCKS) keys.push(`product.${u.id}`);
  for (const r of new Set(TENANTS.map((x) => x.role))) keys.push(`camp.role.${r}`);
  for (const r of ['defeat', 'cleared', 'carried']) keys.push(`result.${r}`);
  return [...new Set(keys)];
}

describe('i18n of game content', () => {
  it('has a label for every key built from game data', () => {
    const missing = contentKeys().filter((k) => !ru[k] || !en[k]);
    expect(missing).toEqual([]);
  });
  it('names every creature, tenant, shell, mutation and slot in both languages', () => {
    const ids = [
      ...CREATURES.map((x) => `creature.${x.id}`),
      ...TENANTS.map((x) => `tenant.${x.id}`),
      ...SHELLS.map((x) => `shell.${x.id}`),
      ...MUTATIONS.map((x) => `mut.${x.id}`),
      ...MUT_SLOTS.map((x) => `slot.${x}`),
    ];
    const missing = ids.filter((k) => !NAMES[k]?.[0]?.trim() || !NAMES[k]?.[1]?.trim());
    expect(missing).toEqual([]);
  });
});
