import type { TenantDef } from './abilities';

/**
 * Shell tenants. Star values are [★, ★★, ★★★]; a merged tenant is worth a bit less than the three it
 * was made from in raw numbers, but takes one slot instead of three.
 */
export const TENANTS: readonly TenantDef[] = [
  // --- Sting: direct damage, chains, stuns ---------------------------------------------------
  { id: 'anemone', families: ['sting'], rarity: 1, role: 'front', unlock: 0, link: { kind: 'aura', stat: 'power', family: 'sting', v: [15, 25, 40] },
    ability: { type: 'active', kind: 'zap', cd: 2.0, v: [5, 11, 25], range: 95 } },
  { id: 'fire_coral', families: ['sting'], rarity: 1, role: 'front', unlock: 0, link: { kind: 'bond', stat: 'power', family: 'sting', v: [20, 30, 45] },
    ability: { type: 'active', kind: 'burst', cd: 2.6, v: [8, 18, 40], range: 80 } },
  { id: 'hydroid', families: ['sting'], rarity: 1, role: 'back', unlock: 1,
    ability: { type: 'active', kind: 'nova', cd: 4.0, v: [8, 18, 40], range: 120 } },
  { id: 'sea_nettle', families: ['sting'], rarity: 2, role: 'any', unlock: 2,
    ability: { type: 'active', kind: 'zap', cd: 3.0, v: [6, 13, 30], range: 120, n: 2 } },
  { id: 'siphonophore', families: ['sting'], rarity: 2, role: 'back', unlock: 3,
    ability: { type: 'active', kind: 'stun', cd: 7.5, v: [0.8, 1.2, 1.8], range: 110,
      also: { kind: 'zap', v: [5, 11, 25] } } },
  { id: 'storm_polyp', families: ['sting'], rarity: 3, role: 'back', unlock: 0, link: { kind: 'solo', stat: 'power', v: [40, 60, 90] }, feat: 'duel3',
    ability: { type: 'active', kind: 'zap', cd: 6.0, v: [24, 52, 120], range: 150 } },

  // --- Spike: thorns, reflection, raw attack -------------------------------------------------
  { id: 'urchin', families: ['spike'], rarity: 1, role: 'front', unlock: 0, link: { kind: 'bond', stat: 'power', family: 'spike', v: [25, 35, 50] },
    ability: { type: 'passive', kind: 'thorns', mods: [{ thorns: 3 }, { thorns: 7 }, { thorns: 16 }] } },
  { id: 'needle_coral', families: ['spike'], rarity: 1, role: 'any', unlock: 0,
    ability: { type: 'active', kind: 'zap', cd: 2.4, v: [6, 13, 30], range: 110 } },
  { id: 'starfish', families: ['spike'], rarity: 1, role: 'back', unlock: 1, link: { kind: 'aura', stat: 'power', v: [10, 18, 30] },
    ability: { type: 'passive', kind: 'might', mods: [{ atkPct: 12 }, { atkPct: 26 }, { atkPct: 60 }] } },
  { id: 'pencil_urchin', families: ['spike'], rarity: 2, role: 'front', unlock: 2,
    ability: { type: 'active', kind: 'burst', cd: 3.0, v: [11, 24, 55], range: 90 } },
  { id: 'crown_thorns', families: ['spike'], rarity: 2, role: 'front', unlock: 3, link: { kind: 'aura', stat: 'power', family: 'spike', v: [15, 25, 40] },
    ability: { type: 'passive', kind: 'thorns',
      mods: [{ thorns: 2, reflectPct: 8 }, { thorns: 4, reflectPct: 17 }, { thorns: 9, reflectPct: 38 }] } },
  { id: 'murex', families: ['spike'], rarity: 3, role: 'any', unlock: 4,
    ability: { type: 'active', kind: 'nova', cd: 5.0, v: [16, 35, 80], range: 130,
      also: { kind: 'weaken', v: [10, 15, 25], dur: 3 } } },

  // --- Glow: crits, blind, marks ---------------------------------------------------------------
  { id: 'glow_shroom', families: ['glow'], rarity: 1, role: 'back', unlock: 0, link: { kind: 'aura', stat: 'haste', v: [8, 14, 22] },
    ability: { type: 'passive', kind: 'focus', mods: [{ crit: 8 }, { crit: 17 }, { crit: 38 }] } },
  { id: 'sea_sparkle', families: ['glow'], rarity: 1, role: 'any', unlock: 0,
    ability: { type: 'active', kind: 'blind', cd: 6.5, v: [1.5, 2.4, 3.8], range: 120 } },
  { id: 'lantern_weed', families: ['glow'], rarity: 1, role: 'back', unlock: 1, link: { kind: 'bond', stat: 'power', family: 'glow', v: [20, 30, 45] },
    ability: { type: 'active', kind: 'mark', cd: 6.0, v: [15, 30, 60], dur: 3, range: 220 } },
  { id: 'firefly_squid', families: ['glow'], rarity: 2, role: 'any', unlock: 2,
    ability: { type: 'active', kind: 'zap', cd: 2.6, v: [7, 15, 34], range: 130 } },
  { id: 'prism_coral', families: ['glow'], rarity: 2, role: 'back', unlock: 3, link: { kind: 'aura', stat: 'power', family: 'glow', v: [15, 25, 40] },
    ability: { type: 'passive', kind: 'focus',
      mods: [{ crit: 3, critMult: 30 }, { crit: 6, critMult: 65 }, { crit: 12, critMult: 140 }] } },
  { id: 'angler_lamp', families: ['glow'], rarity: 3, role: 'any', unlock: 4,
    ability: { type: 'active', kind: 'stun', cd: 8.0, v: [1.0, 1.5, 2.2], range: 130,
      also: { kind: 'blind', v: [1.5, 2.2, 3.2] } } },

  // --- Armor: armor, shields, economy ----------------------------------------------------------
  { id: 'barnacle', families: ['armor'], rarity: 1, role: 'front', unlock: 0, link: { kind: 'bond', stat: 'power', family: 'armor', v: [25, 35, 50] },
    ability: { type: 'passive', kind: 'plate', mods: [{ armor: 12 }, { armor: 26 }, { armor: 60 }] } },
  { id: 'limpet', families: ['armor'], rarity: 1, role: 'front', unlock: 0, link: { kind: 'aura', stat: 'power', family: 'armor', v: [15, 25, 40] },
    ability: { type: 'active', kind: 'shield', cd: 6.0, v: [10, 22, 50] } },
  { id: 'oyster', families: ['armor'], rarity: 1, role: 'back', unlock: 1,
    ability: { type: 'passive', kind: 'luck',
      mods: [{ pearlPct: 20, armor: 5 }, { pearlPct: 40, armor: 11 }, { pearlPct: 80, armor: 25 }] } },
  { id: 'brain_coral', families: ['armor'], rarity: 2, role: 'back', unlock: 2, link: { kind: 'aura', stat: 'power', v: [12, 20, 32] },
    ability: { type: 'active', kind: 'shield', cd: 8.0, v: [18, 40, 90] } },
  { id: 'chiton', families: ['armor'], rarity: 2, role: 'front', unlock: 3,
    ability: { type: 'passive', kind: 'plate',
      mods: [{ armor: 8, hpPct: 8 }, { armor: 17, hpPct: 18 }, { armor: 40, hpPct: 40 }] } },
  { id: 'giant_clam', families: ['armor'], rarity: 3, role: 'front', unlock: 4, link: { kind: 'solo', stat: 'power', v: [40, 60, 90] },
    ability: { type: 'active', kind: 'shield', cd: 5.0, v: [16, 35, 80],
      also: { kind: 'heal', v: [3, 7, 16] } } },

  // --- Venom: poison, weakening ----------------------------------------------------------------
  { id: 'nudibranch', families: ['venom'], rarity: 1, role: 'any', unlock: 0, link: { kind: 'aura', stat: 'power', family: 'venom', v: [15, 25, 40] },
    ability: { type: 'active', kind: 'poison', cd: 2.5, v: [1.6, 3.5, 8], range: 100 } },
  { id: 'cone_snail', families: ['venom'], rarity: 1, role: 'front', unlock: 0,
    ability: { type: 'active', kind: 'zap', cd: 4.0, v: [9, 20, 45], range: 100,
      also: { kind: 'poison', v: [0.8, 1.8, 4] } } },
  { id: 'toxic_sponge', families: ['venom'], rarity: 1, role: 'back', unlock: 1, link: { kind: 'bond', stat: 'power', family: 'venom', v: [20, 30, 45] },
    ability: { type: 'active', kind: 'weaken', cd: 7.0, v: [15, 25, 40], dur: 4, range: 130 } },
  { id: 'fire_worm', families: ['venom'], rarity: 2, role: 'front', unlock: 2,
    ability: { type: 'passive', kind: 'thorns',
      mods: [{ poisonThorns: 1.2 }, { poisonThorns: 2.6 }, { poisonThorns: 6 }] } },
  { id: 'blue_ring', families: ['venom'], rarity: 2, role: 'any', unlock: 3,
    ability: { type: 'active', kind: 'poison', cd: 4.0, v: [3.6, 8, 18], range: 110 } },
  { id: 'stonefish', families: ['venom'], rarity: 3, role: 'front', unlock: 4, link: { kind: 'solo', stat: 'power', v: [40, 60, 90] },
    ability: { type: 'active', kind: 'poison', cd: 5.0, v: [7, 15, 35], range: 110,
      also: { kind: 'weaken', v: [12, 18, 28], dur: 3 } } },

  // --- Soft: healing, regeneration, growth -----------------------------------------------------
  { id: 'sea_sponge', families: ['soft'], rarity: 1, role: 'back', unlock: 0, link: { kind: 'bond', stat: 'power', family: 'soft', v: [20, 30, 45] },
    ability: { type: 'active', kind: 'heal', cd: 5.0, v: [8, 18, 40] } },
  { id: 'kelp', families: ['soft'], rarity: 1, role: 'back', unlock: 0, link: { kind: 'aura', stat: 'haste', v: [8, 14, 22] },
    ability: { type: 'active', kind: 'pull', cd: 3.2, v: [15, 25, 40], dur: 2, range: 170 } },
  { id: 'feather_worm', families: ['soft'], rarity: 1, role: 'back', unlock: 1,
    ability: { type: 'passive', kind: 'regen', mods: [{ regenPct: 0.6 }, { regenPct: 1.3 }, { regenPct: 3 }] } },
  { id: 'sea_cucumber', families: ['soft'], rarity: 2, role: 'any', unlock: 2, link: { kind: 'aura', stat: 'power', family: 'soft', v: [15, 25, 40] },
    ability: { type: 'passive', kind: 'grow',
      mods: [{ hpPct: 12, xpPct: 8 }, { hpPct: 26, xpPct: 16 }, { hpPct: 60, xpPct: 30 }] } },
  { id: 'soft_coral', families: ['soft'], rarity: 2, role: 'back', unlock: 3,
    ability: { type: 'active', kind: 'heal', cd: 7.0, v: [15, 33, 75] } },
  { id: 'sea_squirt', families: ['soft'], rarity: 3, role: 'back', unlock: 4,
    ability: { type: 'passive', kind: 'leech',
      mods: [{ leechPct: 10, regenPct: 0.3 }, { leechPct: 21, regenPct: 0.7 }, { leechPct: 46, regenPct: 1.5 }] } },

  // --- Bridges: two families at once -----------------------------------------------------------
  { id: 'electric_urchin', families: ['sting', 'spike'], rarity: 2, role: 'front', unlock: 3,
    ability: { type: 'active', kind: 'burst', cd: 2.2, v: [8, 18, 40], range: 90 } },
  { id: 'spark_polyp', families: ['sting', 'glow'], rarity: 2, role: 'any', unlock: 3, link: { kind: 'aura', stat: 'haste', family: 'sting', v: [10, 16, 25] },
    ability: { type: 'active', kind: 'zap', cd: 3.4, v: [7, 15, 34], range: 120,
      also: { kind: 'blind', v: [0.8, 1.2, 1.9] } } },
  { id: 'shell_anemone', families: ['sting', 'armor'], rarity: 2, role: 'front', unlock: 4,
    ability: { type: 'active', kind: 'zap', cd: 3.0, v: [6, 13, 30], range: 100,
      also: { kind: 'shield', v: [5, 11, 25] } } },
  { id: 'venom_spine', families: ['spike', 'venom'], rarity: 2, role: 'front', unlock: 4,
    ability: { type: 'passive', kind: 'thorns',
      mods: [{ thorns: 2, poisonThorns: 0.8 }, { thorns: 4.5, poisonThorns: 1.8 }, { thorns: 10, poisonThorns: 4 }] } },
  { id: 'pearl_moss', families: ['armor', 'soft'], rarity: 2, role: 'back', unlock: 4,
    ability: { type: 'active', kind: 'shield', cd: 6.5, v: [9, 20, 45],
      also: { kind: 'heal', v: [5, 11, 25] } } },
  { id: 'ghost_shroom', families: ['glow', 'venom'], rarity: 3, role: 'back', unlock: 0, feat: 'flawless',
    ability: { type: 'active', kind: 'poison', cd: 4.5, v: [4, 9, 20], range: 120,
      also: { kind: 'blind', v: [1.0, 1.5, 2.4] } } },
  { id: 'coral_heart', families: ['soft', 'spike'], rarity: 3, role: 'any', unlock: 0, link: { kind: 'aura', stat: 'power', v: [12, 20, 32] }, feat: 'parry5',
    ability: { type: 'passive', kind: 'regen',
      mods: [{ regenPct: 0.5, thorns: 2.5 }, { regenPct: 1.1, thorns: 5.5 }, { regenPct: 2.5, thorns: 12 }] } },
  { id: 'lure_kelp', families: ['glow', 'soft'], rarity: 2, role: 'back', unlock: 0, feat: 'trophy3',
    ability: { type: 'active', kind: 'mark', cd: 5.5, v: [12, 24, 50], dur: 3, range: 240,
      also: { kind: 'heal', v: [4, 9, 20] } } },
];

export const TENANT_BY_ID: ReadonlyMap<string, TenantDef> = new Map(TENANTS.map((t) => [t.id, t]));

export function tenantDef(id: string): TenantDef {
  const t = TENANT_BY_ID.get(id);
  if (!t) throw new Error(`unknown tenant: ${id}`);
  return t;
}
