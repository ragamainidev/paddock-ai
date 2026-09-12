import { describe, expect, test } from 'vitest';
import { runSalvageSuite } from './suite';

/**
 * Pre-push gate for the salvage money-model suite: the committed recorded
 * traces must grade clean against the current pipeline. A failing check
 * here is a regression against evidence the project already paid for.
 */
const results = await runSalvageSuite();

describe('salvage eval suite', () => {
  test('every recorded case grades clean', () => {
    for (const c of results) {
      const failed = c.checks.filter((x) => !x.pass);
      expect(failed, `${c.name}: ${failed.map((f) => `${f.id} (${f.detail})`).join('; ')}`).toEqual(
        [],
      );
    }
  });

  test('the suite covers all four check classes', () => {
    const classes = new Set(results.flatMap((c) => c.checks.map((x) => x.class)));
    for (const cls of ['invariant', 'realism', 'honesty', 'behavior']) {
      expect(classes, `missing class ${cls}`).toContain(cls);
    }
  });
});
