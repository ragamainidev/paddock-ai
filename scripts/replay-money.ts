// Replay a recorded run's triage + typed evidence through the CURRENT money
// model. Zero API cost: the evidence was paid for once, and every money
// function is pure. Usage: pnpm tsx scripts/replay-money.ts <run.json>...
// Reports persisted before typed evidence existed carry no comps and are
// reported as such rather than re-parsed.
import { readFileSync } from 'node:fs';
import { priceLot, synthesizeSalvage } from '../src/salvage/assess';
import { applyPriceEvidence, deriveRepairPlan } from '../src/salvage/knowledge';
import { getSalvageLot } from '../src/salvage/seed-lots';
import { profileFor } from '../src/salvage/tiers';
import type { DamageTriage, SalvageEvidence } from '../src/salvage/types';

const usd = (n: number | null | undefined) =>
  n === undefined || n === null ? '–' : `$${n.toLocaleString('en-US')}`;

for (const path of process.argv.slice(2)) {
  const run = JSON.parse(readFileSync(path, 'utf8')).run;
  const report = run.report;
  if (!report) {
    console.log(`\n=== ${path}: no report (${run.status}: ${run.error ?? '?'})`);
    continue;
  }
  const lot = getSalvageLot(run.input.lotId);
  if (!lot) continue;
  const triage = report.triage as DamageTriage;
  const evidence = report.evidence as SalvageEvidence | undefined;
  if (!evidence) {
    console.log(
      `\n=== ${path.split('/').pop()} → ${lot.id}: legacy report without typed evidence, nothing to replay`,
    );
    continue;
  }
  const profile = profileFor(lot);
  const { plan } = applyPriceEvidence(deriveRepairPlan(triage, lot, profile), evidence.prices, lot);
  const { ledger, exit, wreck } = priceLot(lot, triage, plan, evidence.comps, profile);
  const a = synthesizeSalvage(
    lot,
    triage,
    plan,
    ledger,
    report.research ?? [],
    [],
    undefined,
    12,
    profile,
  );

  console.log(`\n=== ${path.split('/').pop()} → ${lot.id}`);
  console.log(
    `verdict: ${a.verdict.toUpperCase()} · ceiling ${usd(ledger.ceiling)} · break-even ${usd(ledger.breakEven)} · stress ${usd(ledger.stress)}`,
  );
  console.log(
    `exit: ${exit ? `${usd(exit.low)} / ${usd(exit.typical)} / ${usd(exit.high)} (${exit.basis})` : 'none'}`,
  );
  console.log(
    `wreck: ${wreck ? `${usd(wreck.low)}–${usd(wreck.high)} median ${usd(wreck.median)} (${wreck.n})` : 'none'}`,
  );
  console.log(
    `repairs: ${usd(plan.low)} / ${usd(plan.expected)} / ${usd(plan.high)} across ${plan.programs.length} programs`,
  );
  console.log(`summary: ${a.summary}`);
}
