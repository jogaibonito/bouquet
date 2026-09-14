import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

export async function migrate(url: string, { reset = false } = {}) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    if (reset) {
      await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    }
    await sql.unsafe('CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const applied = new Set((await sql`SELECT name FROM _migrations`).map((r) => r.name as string));
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      await sql.begin(async (tx) => {
        await tx.unsafe(readFileSync(join(migrationsDir, file), 'utf8'));
        await tx`INSERT INTO _migrations (name) VALUES (${file})`;
      });
      console.log(`applied ${file}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  await migrate(url, { reset: process.argv.includes('--reset') });
  console.log('migrations up to date');
}
