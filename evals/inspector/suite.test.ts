import { describe, expect, test } from 'vitest';
import { runInspectorSuite } from './suite';

// The eval suite is itself gated by the unit tests: if any graded check
// regresses, `pnpm test` fails too — not just the pre-push eval.

describe('inspector eval suite', () => {
  test('every case and every check passes', async () => {
    const results = await runInspectorSuite();
    expect(results.length).toBeGreaterThanOrEqual(10);
    const failures = results
      .flatMap((c) => c.checks.map((check) => ({ caseName: c.name, check })))
      .filter((x) => !x.check.pass);
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
    // The three check classes are all represented — invariants, behavior,
    // and honesty are each under test.
    const classes = new Set(results.flatMap((c) => c.checks.map((check) => check.class)));
    expect([...classes].sort()).toEqual(['behavior', 'honesty', 'invariant']);
  });
});
