import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * SPEC 15: the offline eval is the pre-push gate, which is only true if a
 * failing case makes it exit non-zero. The runner is started as its own
 * process over an injected case file (`--cases`), so what is observed is
 * the exit code a hook would see — and such a run writes no artifacts.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const ARTIFACTS = ['results.json', 'results.md', 'history.jsonl'];

// One committed case, and the same query with an expectation the resolver
// cannot satisfy: 'e46 m3' resolves to cards, so "nothing" must fail.
const PASSING =
  '{"query":"e46 m3","expect":{"top":{"make":"BMW","model":"M3","yearMin":2001,"yearMax":2006}}}';
const FAILING = '{"query":"e46 m3","expect":{"nothing":true}}';

function spawnEval(args: string[]): { status: number | null; output: string } {
  const result = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsx'), [
    join(HERE, 'run.ts'),
    ...args,
  ]);
  return {
    status: result.status,
    output: `${result.stdout?.toString() ?? ''}${result.stderr?.toString() ?? ''}`,
  };
}

function runEval(cases: string): { status: number | null; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'paddock-eval-'));
  const file = join(dir, 'queries.jsonl');
  writeFileSync(file, `${cases}\n`);
  return spawnEval(['--cases', file]);
}

const artifacts = () => ARTIFACTS.map((name) => readFileSync(join(HERE, name), 'utf8'));

describe('the offline eval as a gate', () => {
  it('exits non-zero on a failing case', { timeout: 120_000 }, () => {
    const before = artifacts();
    const { status, output } = runEval(FAILING);
    expect(status).toBe(1);
    expect(output).toContain('FAIL  e46 m3');
    // A run over injected cases is not the committed suite's result.
    expect(artifacts()).toEqual(before);
  });

  it('exits zero when every case passes', { timeout: 120_000 }, () => {
    const before = artifacts();
    const { status, output } = runEval(PASSING);
    expect(status).toBe(0);
    expect(output).toContain('PASS  e46 m3');
    expect(artifacts()).toEqual(before);
  });

  it('says what is wrong when --cases has no path', { timeout: 120_000 }, () => {
    for (const args of [['--cases'], ['--cases', '--live']]) {
      const { status, output } = spawnEval(args);
      expect(status, args.join(' ')).toBe(2);
      expect(output).toContain('--cases requires a path');
      // Not a stack trace from readFileSync.
      expect(output).not.toContain('ERR_INVALID_ARG_TYPE');
    }
  });
});

describe('the public evidence gate', () => {
  it(
    'accepts an unresolved engine candidate and rejects claiming the code is verified',
    { timeout: 120_000 },
    () => {
      const before = artifacts();
      const candidate = runEval(
        JSON.stringify({
          query: '2jz',
          expect: {
            top: { make: 'Toyota', model: 'Supra', unresolved: ['2jz.*exact engine'] },
            noReasons: ['^2jz$'],
          },
        }),
      );
      expect(candidate.status, candidate.output).toBe(0);
      const falseCredit = runEval(
        JSON.stringify({
          query: '2jz',
          expect: { top: { make: 'Toyota', model: 'Supra', reasons: ['^2jz$'] } },
        }),
      );
      expect(falseCredit.status, falseCredit.output).toBe(1);
      expect(artifacts()).toEqual(before);
    },
  );
});
