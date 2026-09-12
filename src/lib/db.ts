import { createClient, type Client } from '@libsql/client';

// One libSQL client per server process. DATABASE_URL is a local file in dev
// (built by `pnpm ingest`) and a libsql:// Turso URL in production, where
// TURSO_AUTH_TOKEN is required. Read lazily so env handling stays a runtime
// concern, not a build-time one.
let client: Client | null = null;

export function getDb(): Client {
  if (client) return client;
  const url = process.env.DATABASE_URL ?? 'file:data/ymm.db';
  client = createClient({
    url,
    authToken: url.startsWith('libsql://') ? process.env.TURSO_AUTH_TOKEN : undefined,
  });
  return client;
}
