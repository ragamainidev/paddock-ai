import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type Client } from '@libsql/client';
import { format, resolveConfig } from 'prettier';
import { ensureEvalDb } from '../scripts/ensure-eval-db';
import { interpretWithModel } from '@/interpret/model';
import { tokenize } from '@/interpret/tokenize';
import type { Interpretation } from '@/lib/types';
import { resolveVehicles } from '@/resolve/catalog';
import type { EvalArtifact, HistoryEntry, ResolverRow } from './artifact';
import { runInspectorSuite, type InspectorCaseResult } from './inspector/suite';
import { runSalvageSuite } from './salvage/suite';
import {
  scoreCase,
  type CaseResult,
  type EvalCase,
  type QueryOutcome,
  type VehicleExpectation,
} from './score';

// The offline eval (default) is two deterministic suites, no network, no
// live model calls — this is what pre-push runs:
//
//   resolver  — every query case runs tokenize → SQL → rank against the
//               committed public EPA sample
//   inspector — the agent orchestrated over recorded fixtures, graded per
//               check (invariant / behavior / honesty), adversarial cases
//               included
//
// Output: results.json (machine-readable, what /evals renders) and
// results.md (human-readable), both committed. --live re-runs the resolver
// suite with the model fallback on top; it needs a key and never gates.

const HERE = dirname(fileURLToPath(import.meta.url));

async function runQuery(db: Client, interpretation: Interpretation): Promise<QueryOutcome> {
  const vehiclesByBranch = [];
  for (const branch of interpretation.branches) {
    vehiclesByBranch.push(await resolveVehicles(db, branch.constraint));
  }
  return { branches: interpretation.branches, vehiclesByBranch };
}

// `--cases <path>` runs an alternative case file. Such a run writes no
// artifacts: the committed artifact is the committed suite's result, and a
// run over other cases has none. It exists so the exit code can be tested
// (SPEC 15) without touching evals/results.*.
function casesPath(): string {
  const i = process.argv.indexOf('--cases');
  if (i === -1) return join(HERE, 'queries.jsonl');
  const path = process.argv[i + 1];
  if (!path || path.startsWith('--')) {
    console.error('--cases requires a path');
    process.exit(2);
  }
  return path;
}

function loadCases(path: string): EvalCase[] {
  const raw = readFileSync(path, 'utf8');
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as EvalCase);
}

function describeExpectation(c: EvalCase): string {
  const e = c.expect;
  const parts: string[] = [];
  const vehicle = (v: VehicleExpectation) => {
    const years =
      v.yearMin !== undefined || v.yearMax !== undefined
        ? ` ${v.yearMin ?? '…'}–${v.yearMax ?? '…'}`
        : '';
    const missing = v.unresolved?.length ? ` unresolved: ${v.unresolved.join(', ')}` : '';
    const reasons = v.reasons?.length ? ` evidence: ${v.reasons.join(', ')}` : '';
    return `${v.make} ${v.model ?? `/${v.modelPattern}/`}${years}${missing}${reasons}`;
  };
  if (e.top) parts.push(`top-${e.k ?? 5}: ${vehicle(e.top)}`);
  if (e.contains) parts.push(`top-${e.k ?? 5} contains: ${e.contains.map(vehicle).join(', ')}`);
  if (e.candidates) parts.push(`candidates: ${e.candidates.map(vehicle).join(', ')}`);
  if (e.absent) parts.push(`absent: ${e.absent.map(vehicle).join(', ')}`);
  if (e.unresolvedAll) parts.push(`all unresolved: ${e.unresolvedAll.join(', ')}`);
  if (e.noReasons) parts.push(`no match credit: ${e.noReasons.join(', ')}`);
  if (e.yearWindow)
    parts.push(`within years: ${e.yearWindow.min ?? '…'}–${e.yearWindow.max ?? '…'}`);
  if (e.forkMakes) parts.push(`fork: [${e.forkMakes.join(', ')}]`);
  if (e.nothing) parts.push('nothing');
  if (e.assumption) parts.push(`assumption /${e.assumption}/`);
  if (e.unfilterable) parts.push(`unfilterable: ${e.unfilterable.join(', ')}`);
  return parts.join('; ');
}

async function interpret(query: string, live: boolean): Promise<Interpretation> {
  const deterministic = tokenize(query);
  if (!live) return deterministic;
  const { interpretation, status } = await interpretWithModel(query, deterministic);
  if (status.called && !status.ok) {
    console.warn(`  (model stage degraded for "${query}": ${status.detail})`);
  }
  return interpretation;
}

function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: HERE }).toString().trim();
  } catch {
    return 'unknown';
  }
}

// -- Combined artifact ------------------------------------------------------------

function suiteSummary(cases: InspectorCaseResult[]) {
  const checks = cases.flatMap((c) => c.checks);
  const byClass: Record<string, { passed: number; total: number }> = {};
  for (const check of checks) {
    byClass[check.class] ??= { passed: 0, total: 0 };
    byClass[check.class].total += 1;
    if (check.pass) byClass[check.class].passed += 1;
  }
  return {
    casesPassed: cases.filter((c) => c.pass).length,
    casesTotal: cases.length,
    checksPassed: checks.filter((c) => c.pass).length,
    checksTotal: checks.length,
    byClass,
    cases,
  };
}

function buildArtifact(
  mode: string,
  resolverRows: { c: EvalCase; r: CaseResult }[],
  inspectorCases: InspectorCaseResult[],
  salvageCases: InspectorCaseResult[],
  live: boolean,
): EvalArtifact {
  const rows: ResolverRow[] = resolverRows.map(({ c, r }, i) => ({
    n: i + 1,
    query: c.query,
    expectation: describeExpectation(c),
    pass: r.pass,
    detail: r.pass ? undefined : r.detail,
  }));
  return {
    date: new Date().toISOString().slice(0, 10),
    gitSha: gitSha(),
    mode,
    suites: {
      resolver: {
        pipeline: live
          ? 'tokenize → model fallback (claude-sonnet-5) → SQL → rank'
          : 'tokenize → source-aware catalog resolution (deterministic, no model call)',
        passed: rows.filter((r) => r.pass).length,
        total: rows.length,
        rows,
      },
      inspector: {
        pipeline:
          'full agent orchestration over recorded fixtures (vision, research, NHTSA, vPIC, sweep) — offline, frozen clock',
        ...suiteSummary(inspectorCases),
      },
      salvage: {
        pipeline:
          'recorded live traces (triage + cited research) replayed through the current money model, graded per check',
        ...suiteSummary(salvageCases),
      },
    },
  };
}

function appendHistory(artifact: EvalArtifact): void {
  const entry: HistoryEntry = {
    date: artifact.date,
    gitSha: artifact.gitSha,
    mode: artifact.mode,
    resolver: { passed: artifact.suites.resolver.passed, total: artifact.suites.resolver.total },
    inspector: {
      checksPassed: artifact.suites.inspector.checksPassed,
      checksTotal: artifact.suites.inspector.checksTotal,
    },
    salvage: artifact.suites.salvage
      ? {
          checksPassed: artifact.suites.salvage.checksPassed,
          checksTotal: artifact.suites.salvage.checksTotal,
        }
      : undefined,
  };
  const path = join(HERE, 'history.jsonl');
  let existing = '';
  try {
    existing = readFileSync(path, 'utf8');
  } catch {
    existing = '';
  }
  // One line per sha: re-running on the same commit updates in place, so
  // the trend tracks commits, not invocations.
  const lines = existing
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .filter((l) => (JSON.parse(l) as HistoryEntry).gitSha !== entry.gitSha);
  lines.push(JSON.stringify(entry));
  writeFileSync(path, lines.join('\n') + '\n');
}

// lint-staged formats every committed *.json, so an artifact written any
// other way is dirty the moment it is staged and every eval run leaves the
// tree modified. Write exactly what prettier would. (results.md is listed
// in .prettierignore and history.jsonl has no prettier parser, so both are
// already stable as written.)
async function writeJson(path: string, value: unknown): Promise<void> {
  const options = await resolveConfig(path);
  writeFileSync(
    path,
    await format(`${JSON.stringify(value, null, 2)}\n`, {
      ...options,
      filepath: path,
    }),
  );
}

function writeMarkdown(artifact: EvalArtifact): void {
  const { resolver, inspector } = artifact.suites;
  const esc = (s: string) => s.replace(/\|/g, '\\|');
  const lines = [
    '# Eval results',
    '',
    `- date: ${artifact.date} · git: ${artifact.gitSha} · mode: ${artifact.mode}`,
    '',
    '## Resolver suite',
    '',
    `- pipeline: ${resolver.pipeline}`,
    `- score: **${resolver.passed}/${resolver.total}**`,
    '',
    '| # | query | expectation | result |',
    '|---|-------|-------------|--------|',
    ...resolver.rows.map(
      (r) =>
        `| ${r.n} | \`${esc(r.query)}\` | ${esc(r.expectation)} | ${r.pass ? '✅' : `❌ ${esc(r.detail ?? '')}`} |`,
    ),
    '',
    '## Inspector suite',
    '',
    `- pipeline: ${inspector.pipeline}`,
    `- cases: **${inspector.casesPassed}/${inspector.casesTotal}** · checks: **${inspector.checksPassed}/${inspector.checksTotal}** (${Object.entries(
      inspector.byClass,
    )
      .map(([cls, s]) => `${cls} ${s.passed}/${s.total}`)
      .join(' · ')})`,
    '',
    '| case | check | class | spec | result |',
    '|------|-------|-------|------|--------|',
    ...inspector.cases.flatMap((c) =>
      c.checks.map(
        (check) =>
          `| ${esc(c.name)} | ${esc(check.desc)} | ${check.class} | ${check.spec ?? ''} | ${check.pass ? '✅' : `❌ ${esc(check.detail ?? '')}`} |`,
      ),
    ),
    '',
    ...(artifact.suites.salvage
      ? [
          '## Salvage money-model suite',
          '',
          `- pipeline: ${artifact.suites.salvage.pipeline}`,
          `- cases: **${artifact.suites.salvage.casesPassed}/${artifact.suites.salvage.casesTotal}** · checks: **${artifact.suites.salvage.checksPassed}/${artifact.suites.salvage.checksTotal}** (${Object.entries(
            artifact.suites.salvage.byClass,
          )
            .map(([cls, s]) => `${cls} ${s.passed}/${s.total}`)
            .join(' · ')})`,
          '',
          '| case | check | class | spec | result |',
          '|------|-------|-------|------|--------|',
          ...artifact.suites.salvage.cases.flatMap((c) =>
            c.checks.map(
              (check) =>
                `| ${esc(c.name)} | ${esc(check.desc)} | ${check.class} | ${check.spec ?? ''} | ${check.pass ? '✅' : `❌ ${esc(check.detail ?? '')}`} |`,
            ),
          ),
          '',
        ]
      : []),
  ];
  writeFileSync(join(HERE, 'results.md'), lines.join('\n'));
}

async function main(): Promise<void> {
  // Arguments are read before anything else runs: a malformed invocation
  // should say so, not fail somewhere inside the suite.
  const casesFile = casesPath();
  const live = process.argv.includes('--live');
  if (live && !process.env.ANTHROPIC_API_KEY) {
    console.error('eval --live needs ANTHROPIC_API_KEY; the offline eval is `pnpm eval`.');
    process.exit(1);
  }
  const mode = live ? 'live (resolver suite adds the model fallback)' : 'offline';

  // Resolver suite.
  const dbPath = await ensureEvalDb();
  const db = createClient({ url: `file:${dbPath}` });
  const cases = loadCases(casesFile);
  const resolverRows: { c: EvalCase; r: CaseResult }[] = [];
  for (const c of cases) {
    const outcome = await runQuery(db, await interpret(c.query, live));
    resolverRows.push({ c, r: scoreCase(c, outcome) });
  }
  db.close();

  // Inspector suite (always offline: fixtures + frozen clock).
  const inspectorCases = await runInspectorSuite();

  // Salvage money-model suite (always offline: recorded traces).
  const salvageCases = await runSalvageSuite();

  const artifact = buildArtifact(mode, resolverRows, inspectorCases, salvageCases, live);
  if (casesFile === join(HERE, 'queries.jsonl')) {
    writeMarkdown(artifact);
    await writeJson(join(HERE, 'results.json'), artifact);
    appendHistory(artifact);
  }

  for (const { c, r } of resolverRows) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${c.query}${r.pass ? '' : `  — ${r.detail}`}`);
  }
  for (const c of inspectorCases) {
    const failed = c.checks.filter((x) => !x.pass);
    console.log(
      `${c.pass ? 'PASS' : 'FAIL'}  [inspector] ${c.name} (${c.checks.length - failed.length}/${c.checks.length} checks)${
        failed.length > 0 ? ` — ${failed.map((f) => f.id).join(', ')}` : ''
      }`,
    );
  }
  for (const c of salvageCases) {
    const failed = c.checks.filter((x) => !x.pass);
    console.log(
      `${c.pass ? 'PASS' : 'FAIL'}  [salvage] ${c.name} (${c.checks.length - failed.length}/${c.checks.length} checks)${
        failed.length > 0 ? ` — ${failed.map((f) => f.id).join(', ')}` : ''
      }`,
    );
  }

  const { resolver, inspector, salvage } = artifact.suites;
  console.log(
    `\neval: resolver ${resolver.passed}/${resolver.total} · inspector ${inspector.checksPassed}/${inspector.checksTotal} · salvage ${salvage?.checksPassed}/${salvage?.checksTotal} checks → evals/results.{md,json}`,
  );
  if (
    resolver.passed < resolver.total ||
    inspector.casesPassed < inspector.casesTotal ||
    (salvage && salvage.casesPassed < salvage.casesTotal)
  ) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
