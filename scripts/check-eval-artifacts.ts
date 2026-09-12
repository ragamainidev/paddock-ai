import { execFileSync } from 'node:child_process';

/**
 * Run after `pnpm eval` / `pnpm eval:decisions` / `pnpm eval:agent` on a
 * clean tree: the artifacts they rewrote may differ from the committed ones
 * only in their date/sha/timestamp header. Anything else is either a real
 * behavior change that belongs in the commit, or a writer whose output is not
 * reproducible — which is what used to leave `evals/results.json` and
 * `evals/agent/decision-results.md` modified after every run, and what a
 * per-run session id in `evals/agent/results.md` would do to every case
 * (SPEC 15, 20).
 */

const FILES = [
  'evals/results.md',
  'evals/results.json',
  'evals/agent/decision-results.md',
  'evals/agent/results.md',
];

// The header is the run's identity: the date it ran, the commit it ran on,
// and the instant the runtime suite generated its artifact. Everything else
// in an artifact is a result.
const HEADER = [/^- date: /, /^\s*"date":/, /^\s*"gitSha":/, /^As of /, /^Generated: /];

// Against HEAD, not the index: an artifact that was staged without being
// looked at is exactly the drift this is here to catch.
function changedLines(): string[] {
  const diff = execFileSync('git', ['diff', '-U0', 'HEAD', '--', ...FILES], { encoding: 'utf8' });
  return diff
    .split('\n')
    .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line))
    .map((line) => line.slice(1))
    .filter((line) => !HEADER.some((pattern) => pattern.test(line)));
}

const unexpected = changedLines();
if (unexpected.length > 0) {
  console.error(
    `eval artifacts changed beyond their header (${unexpected.length} line(s)):\n` +
      `${unexpected.slice(0, 20).join('\n')}\n` +
      'Commit the regenerated artifacts if the change is real; otherwise the writer is not\n' +
      'reproducible. See docs/testing-and-evals.md §3.3.',
  );
  process.exit(1);
}
console.log('eval artifacts are stable: only the date/sha header differs');
