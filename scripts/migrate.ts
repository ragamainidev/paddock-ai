import { runner } from 'node-pg-migrate';
import { Client } from 'pg';
import { postgresUrl } from '../src/db/pg';

// Thin wrapper over node-pg-migrate so the Postgres URL resolves through the
// one place that knows the default (src/db/pg.ts) — this project's
// DATABASE_URL already belongs to the libsql vehicle database, so the
// library's default env var cannot be used.
//
// Usage:  pnpm db:migrate            apply pending migrations
//         pnpm db:migrate --reset    drop the public schema and re-apply
//                                    (refused off localhost)

async function reset(url: string) {
  const host = new URL(url).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error(`refusing to reset non-local database at ${host}`);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('drop schema public cascade');
    await client.query('create schema public');
    console.log('schema dropped and recreated');
  } finally {
    await client.end();
  }
}

async function main() {
  const url = postgresUrl();
  if (process.argv.includes('--reset')) await reset(url);
  const applied = await runner({
    databaseUrl: url,
    dir: 'db/migrations',
    direction: 'up',
    migrationsTable: 'pgmigrations',
    checkOrder: true,
    verbose: false,
  });
  console.log(
    applied.length > 0
      ? `applied ${applied.length} migration(s): ${applied.map((m) => m.name).join(', ')}`
      : 'database is up to date',
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
