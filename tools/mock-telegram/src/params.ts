import { badRequest } from './errors';

/**
 * Bot API parameters merged from the query string and the body. Telegram accepts the same parameter as a
 * JSON value, a form field or a query parameter, so every accessor coerces from strings.
 */
export class Params {
  private readonly values: Record<string, unknown>;

  constructor(...sources: unknown[]) {
    const merged: Record<string, unknown> = {};
    for (const source of sources) {
      if (source !== null && typeof source === 'object' && !Array.isArray(source)) {
        Object.assign(merged, source);
      }
    }
    this.values = merged;
  }

  has(name: string): boolean {
    const value = this.values[name];
    return value !== undefined && value !== null;
  }

  str(name: string): string | undefined {
    const value = this.values[name];
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return undefined;
  }

  num(name: string): number | undefined {
    const value = this.values[name];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
  }

  bool(name: string): boolean | undefined {
    const value = this.values[name];
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    return undefined;
  }

  /** A structured parameter: either already an object/array, or a JSON-serialized string (form encoding). */
  json(name: string): unknown {
    const value = this.values[name];
    if (typeof value !== 'string') return value ?? undefined;
    const trimmed = value.trim();
    if (trimmed === '') return undefined;
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      throw badRequest(`can't parse ${name} JSON object`);
    }
  }

  requireStr(name: string): string {
    const value = this.str(name);
    if (value === undefined) throw badRequest(`parameter "${name}" is required`);
    return value;
  }

  requireNum(name: string): number {
    const value = this.num(name);
    if (value === undefined) throw badRequest(`parameter "${name}" is required`);
    return value;
  }
}
