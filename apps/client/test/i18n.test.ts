import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { ru } from '../src/i18n/ru';

const params = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();

describe('i18n dictionaries', () => {
  it('have the same keys in ru and en', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ru).sort());
  });
  it('use the same placeholders in both languages', () => {
    for (const key of Object.keys(ru)) {
      expect(params(en[key] ?? ''), key).toEqual(params(ru[key] ?? ''));
    }
  });
  it('have no empty strings', () => {
    for (const [k, v] of [...Object.entries(ru), ...Object.entries(en)]) expect(v.trim().length, k).toBeGreaterThan(0);
  });
});
