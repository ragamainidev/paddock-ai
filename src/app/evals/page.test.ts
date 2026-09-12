import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { EvalArtifact, HistoryEntry } from '@/../evals/artifact';

/**
 * SPEC 20: /evals is a viewer, not a runner. Two halves to that — the page
 * writes nothing and starts nothing (asserted against its source, since
 * rendering it needs a browser), and the artifact it renders is the shape
 * it expects, so a malformed committed artifact is caught here rather than
 * as a blank page.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const page = readFileSync(join(HERE, 'page.tsx'), 'utf8');

const check = z.object({
  id: z.string(),
  class: z.string(),
  spec: z.string().optional(),
  desc: z.string(),
  pass: z.boolean(),
  detail: z.string().optional(),
});

const suite = z.object({
  pipeline: z.string(),
  casesPassed: z.number().int(),
  casesTotal: z.number().int(),
  checksPassed: z.number().int(),
  checksTotal: z.number().int(),
  byClass: z.record(z.string(), z.object({ passed: z.number().int(), total: z.number().int() })),
  cases: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      checks: z.array(check),
      pass: z.boolean(),
    }),
  ),
});

const artifactSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gitSha: z.string().min(1),
  mode: z.string().min(1),
  suites: z.object({
    resolver: z.object({
      pipeline: z.string(),
      passed: z.number().int(),
      total: z.number().int(),
      rows: z.array(
        z.object({
          n: z.number().int(),
          query: z.string(),
          expectation: z.string(),
          pass: z.boolean(),
          detail: z.string().optional(),
        }),
      ),
    }),
    inspector: suite,
    salvage: suite.optional(),
  }),
});

const historySchema = z.object({
  date: z.string(),
  gitSha: z.string(),
  mode: z.string(),
  resolver: z.object({ passed: z.number().int(), total: z.number().int() }),
  inspector: z.object({ checksPassed: z.number().int(), checksTotal: z.number().int() }),
  salvage: z.object({ checksPassed: z.number().int(), checksTotal: z.number().int() }).optional(),
});

describe('the /evals page is a viewer', () => {
  it('imports no runner and no writer', () => {
    // Importing the runner would execute it: evals/run.ts calls main() at
    // module scope.
    expect(page).not.toMatch(/from\s+'[^']*evals\/(run|score)'/);
    expect(page).not.toMatch(/from\s+'[^']*(inspector|salvage)\/suite'/);
    // The only thing it may take from evals/ is the artifact's types.
    const evalImports = [...page.matchAll(/from\s+'([^']*evals\/[^']+)'/g)].map((m) => m[1]);
    expect(evalImports).toEqual(['@/../evals/artifact']);
  });

  it('reads the filesystem and never writes to it', () => {
    expect(page).toMatch(/import \{ readFile \} from 'node:fs\/promises'/);
    for (const writer of ['writeFile', 'appendFile', 'writeFileSync', 'mkdir', 'rm(']) {
      expect(page, writer).not.toContain(writer);
    }
  });

  it('renders the committed artifact, which is the shape it expects', () => {
    const raw = readFileSync(join(ROOT, 'evals', 'results.json'), 'utf8');
    const artifact = artifactSchema.parse(JSON.parse(raw)) as EvalArtifact;

    const { resolver, inspector, salvage } = artifact.suites;
    expect(resolver.rows).toHaveLength(resolver.total);
    expect(resolver.rows.filter((r) => r.pass)).toHaveLength(resolver.passed);
    for (const s of [inspector, salvage]) {
      if (!s) continue;
      expect(s.cases).toHaveLength(s.casesTotal);
      expect(s.cases.flatMap((c) => c.checks)).toHaveLength(s.checksTotal);
    }
  });

  it('the history the page charts is one parseable entry per line', () => {
    const lines = readFileSync(join(ROOT, 'evals', 'history.jsonl'), 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0);
    expect(lines.length).toBeGreaterThan(0);
    const entries = lines.map((line) => historySchema.parse(JSON.parse(line)) as HistoryEntry);
    // One line per commit: the trend tracks commits, not invocations.
    expect(new Set(entries.map((e) => e.gitSha)).size).toBe(entries.length);
  });
});
