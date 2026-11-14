import { signal } from '@preact/signals';
import { en } from './en';
import { NAMES, STAT } from './names';
import { ru } from './ru';

export type Lang = 'ru' | 'en';

export const lang = signal<Lang>('ru');

const DICTS: Record<Lang, Record<string, string>> = { ru, en };

function fill(s: string, params?: Record<string, string | number>): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (params[k] !== undefined ? String(params[k]) : `{${k}}`));
}

/** Translates a UI key. Reading `lang.value` makes components re-render on a language switch. */
export function t(key: string, params?: Record<string, string | number>): string {
  const s = DICTS[lang.value][key] ?? ru[key] ?? key;
  return fill(s, params);
}

/** Name of a content item, e.g. name('tenant', 'anemone'). */
export function name(kind: 'creature' | 'tenant' | 'shell' | 'mut' | 'slot', id: string): string {
  const n = NAMES[`${kind}.${id}`];
  return n ? n[lang.value === 'ru' ? 0 : 1] : id;
}

export function stat(key: string, params: Record<string, string | number>): string {
  const s = STAT[key];
  return s ? fill(s[lang.value === 'ru' ? 0 : 1], params) : key;
}

export function local(text: { ru: string; en: string }): string {
  return lang.value === 'en' ? text.en || text.ru : text.ru || text.en;
}

/** 1234567 -> "1.2M". Keeps currency labels short on a phone. */
export function num(v: number): string {
  const n = Math.floor(v);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}K`;
  return String(n);
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ru_ = lang.value === 'ru';
  if (d > 0) return `${d}${ru_ ? ' д ' : 'd '}${h}${ru_ ? ' ч' : 'h'}`;
  if (h > 0) return `${h}${ru_ ? ' ч ' : 'h '}${m}${ru_ ? ' мин' : 'm'}`;
  return `${m}${ru_ ? ' мин' : 'm'}`;
}
