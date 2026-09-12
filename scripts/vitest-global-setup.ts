/**
 * Test bootstrap, run once in the main process before any worker starts.
 *
 * It builds data/eval.db: five test files need the eval database, and each
 * building it for itself means five processes ingesting the same CSV into
 * the same file, which on a cold checkout fails with SQLITE_BUSY. By the
 * time a worker calls ensureEvalDb() the database is fresh and the call is
 * a stat.
 *
 * It also announces the arms of the suite that will not run. The reporter
 * shows nothing a worker writes to the console, so a contract running two
 * of its three implementations would otherwise look like a full pass.
 */

import { ensureEvalDb } from './ensure-eval-db';

export default async function setup(): Promise<void> {
  await ensureEvalDb();
  if (!process.env.POSTGRES_TEST_URL) {
    console.warn(
      'postgres store contract skipped: POSTGRES_TEST_URL unset (src/runs/store.test.ts)',
    );
  }
}
