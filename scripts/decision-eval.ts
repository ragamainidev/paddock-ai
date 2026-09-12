/** Free deterministic decision-cohort run; actual authored Eve is covered by scripts/agent-eval.ts. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { runDecisionCohort } from '../evals/agent/decision-cohort';
import { usd } from '../src/lib/money';

// A ceiling column is money or the reason there is none: a case with no plan
// and no exit anchor solved neither ceiling.
function money(value: number | null | undefined): string {
  return typeof value === 'number' ? usd(value) : '–';
}

// lint-staged formats every committed *.md, so a hand-built markdown table
// is dirty the moment it is staged and every run leaves the tree modified.
// Write exactly what prettier would.
async function writeFormatted(path: string, content: string): Promise<void> {
  const options = await resolveConfig(path);
  await writeFile(path, await format(content, { ...options, filepath: path }));
}

async function main() {
  const report = await runDecisionCohort();
  const dir = resolve('evals/agent');
  await mkdir(dir, { recursive: true });
  const rows = report.results.map((r) => {
    const economics = r.decision.buyerEconomics;
    const cells = [
      r.caseId,
      r.split,
      // A record that predates the profile fields names no bidder; the cohort
      // states one in every case.
      r.assessment.buyer?.access ?? '–',
      r.assessment.buyer?.exit ?? '–',
      money(economics?.maxBid),
      money(economics?.market.maxBid),
      r.expected,
      r.staticListing,
      r.legacyKernel,
      r.capturedUnreviewed,
      r.reviewedCapabilityLoop,
      r.passed ? 'pass' : 'FAIL',
    ];
    return `| ${cells.join(' | ')} |`;
  });
  const text = [
    '# Synthetic decision cohort',
    '',
    report.provenance,
    '',
    report.limitations,
    '',
    `As of ${report.asOf}. Provider spend: $0.`,
    '',
    '| Case | Split | Access | Exit | Your ceiling | Market ceiling | Independent expectation | Listing-only diagnostic | Legacy conditional kernel | Captured, unreviewed | Reviewed capability loop | Result |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    `Passed ${report.results.filter((r) => r.passed).length}/${report.results.length}; unsafe positive results ${report.results.filter((r) => r.falsePositive).length}.`,
    '',
    "Access, exit and the two ceilings are the case's bidder-relative inputs and the numbers they solve (SPEC 58–60): this buyer's own ceiling beside the marginal professional rebuilder's on the same plan and the same exit evidence. Both are solved arithmetic, not an authorization to bid — the verdict columns say what the decision does with them, and an en dash means no plan or exit anchor was solved at all.",
    '',
    'The final policy is evaluated against literal case expectations. It includes simulated owner review of physical and documentary evidence; a model never attests to those records. The legacy kernel column is its conditional arithmetic verdict before document gates, not a claim that the old product certified roadworthiness. Listing-only is a deliberately weak diagnostic, not a calibrated production baseline.',
    '',
  ].join('\n');
  await writeFormatted(resolve(dir, 'decision-results.md'), text);
  await writeFile(resolve(dir, 'decision-results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(text);
  if (report.results.some((r) => !r.passed)) process.exitCode = 1;
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
