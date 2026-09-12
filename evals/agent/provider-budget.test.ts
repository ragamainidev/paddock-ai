/** Provider attempts reserve persisted allowance before the network boundary, including concurrent retries. */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { reserveLiveModelCall } from '../../agent/lib/events';

it('atomically admits at most twelve provider attempts per durable session', async () => {
  const oldUrl = process.env.ASSESSMENTS_DATABASE_URL;
  const directory = await mkdtemp(join(tmpdir(), 'paddock-provider-budget-'));
  const url = `file:${join(directory, 'budget.db')}`;
  process.env.ASSESSMENTS_DATABASE_URL = url;
  try {
    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, () => reserveLiveModelCall('owner', 'assessment', 'session')),
    );
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(12);
    expect(attempts.filter((a) => a.status === 'rejected')).toHaveLength(8);
    const reopened = createClient({ url });
    try {
      const rows = await reopened.execute(
        'select count(*) as count from assessment_agent_model_calls',
      );
      expect(Number(rows.rows[0].count)).toBe(12);
    } finally {
      reopened.close();
    }
  } finally {
    if (oldUrl === undefined) delete process.env.ASSESSMENTS_DATABASE_URL;
    else process.env.ASSESSMENTS_DATABASE_URL = oldUrl;
  }
});
