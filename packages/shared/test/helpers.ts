import { SHELLS, TENANTS, MUT_SLOTS, type RunConfig, type BuildSnapshot, zeroDiets } from '../src';

export function fullConfig(over: Partial<RunConfig> = {}): RunConfig {
  return {
    heroId: 'hermit',
    maxStage: 12,
    tenantPool: TENANTS.map((t) => t.id),
    shellPool: SHELLS.filter((s) => !s.starter).map((s) => s.id),
    mutSlots: [...MUT_SLOTS],
    mutMaxTier: 3,
    extraSlots: 0,
    startPearls: 0,
    startGenes: 0,
    lives: 3,
    extra: {},
    tutorial: false,
    ...over,
  };
}

export function build(over: Partial<BuildSnapshot> = {}): BuildSnapshot {
  return {
    heroId: 'hermit',
    size: 1,
    genes: zeroDiets(),
    mutations: {},
    shell: { id: 'periwinkle', tier: 0 },
    slots: [null, null, null],
    ...over,
  };
}
