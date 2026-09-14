import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export function createDb(url: string, opts: { max?: number } = {}) {
  const client = postgres(url, { max: opts.max ?? 10, onnotice: () => {} });
  return { db: drizzle(client, { schema }), client };
}

export type Database = ReturnType<typeof createDb>['db'];
export { schema };
export * from './schema.js';
