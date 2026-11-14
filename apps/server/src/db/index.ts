import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export { schema };

export interface DbHandle {
  db: Db;
  close(): Promise<void>;
}

function migrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/db (tsx) -> ../../drizzle ; dist (bundle) -> ./drizzle
  for (const candidate of [join(here, 'drizzle'), join(here, '../../drizzle'), join(here, '../drizzle')]) {
    if (existsSync(join(candidate, 'meta', '_journal.json'))) return candidate;
  }
  throw new Error('migrations folder not found');
}

/** Connects by URL and applies pending migrations. */
export async function connect(url: string): Promise<DbHandle> {
  if (url.startsWith('pglite://')) {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    const target = url.slice('pglite://'.length);
    const client = target === 'memory' || target === '' ? new PGlite() : new PGlite(target);
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: migrationsFolder() });
    return { db: db as unknown as Db, close: () => client.close() };
  }
  const pg = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const pool = new pg.default.Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: migrationsFolder() });
  return { db: db as unknown as Db, close: () => pool.end() };
}
