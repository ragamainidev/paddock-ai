import { expect, it } from 'vitest';
import { runDecisionCase, runDecisionCohort } from './decision-cohort';
it('meets independent positive, rejection and abstention expectations without spending provider tokens', async () => {
  const report = await runDecisionCohort();
  expect(
    report.results.map((r) => ({
      id: r.caseId,
      expected: r.expected,
      actual: r.reviewedCapabilityLoop,
    })),
  ).toEqual(
    report.results.map((r) => ({ id: r.caseId, expected: r.expected, actual: r.expected })),
  );
  expect(report.results.some((r) => r.reviewedCapabilityLoop === 'build')).toBe(true);
  expect(report.results.every((r) => r.costCents === 0 && r.investigations <= 12)).toBe(true);
  expect(report.results.filter((r) => r.falsePositive)).toEqual([]);
  // A percentage above 100 in a reason would be an impossible retained margin:
  // the surplus arm can drive a target below zero (SPEC 58).
  expect(
    report.results.flatMap((r) => r.decision.reasons).filter((reason) => /\d{3,}%/.test(reason)),
  ).toEqual([]);
});

it('prices one lot for three bidders: fee mode, exit channel, and a car that is never sold', async () => {
  const direct = (await runDecisionCase('broker-vs-direct')).decision.buyerEconomics!;
  const retail = (await runDecisionCase('private-party-vs-retail')).decision.buyerEconomics!;
  const keep = (await runDecisionCase('keep-not-sell')).decision.buyerEconomics!;
  // The kernel's own vehicle-relative ceiling for this lot: a public buyer
  // through a broker, selling privately, with the national title band.
  const kernel = direct.kernelMaxBid!;
  expect([kernel, direct.maxBid, retail.maxBid, keep.maxBid]).toEqual([
    151_000, 157_000, 140_000, 162_000,
  ]);
  // A licensed account pays neither the broker's percentage nor Copart's own
  // per-vehicle broker charge, so it clears a higher bid than the persona that
  // pays both; the flat auction total drops by exactly that charge.
  expect(direct.lines.some((l) => l.id === 'fees.broker')).toBe(false);
  expect(direct.lines.find((l) => l.id === 'fees.fixed')!.expected).toBe(130);
  expect(direct.maxBid - kernel).toBeGreaterThan(5_000);
  // Retail asks a little more and costs 8% of the exit to sell against the
  // tier's own 4%: the same car, a lower bid.
  expect(retail.lines.find((l) => l.id === 'selling')!.expected).toBe(24_400);
  expect(retail.exit.high).toBeGreaterThan(keep.exit.high);
  expect(retail.maxBid).toBeLessThan(kernel);
  // Nothing is sold, so nothing is paid to sell it: the selling line stays in
  // the ledger at zero, and the all-in at the ceiling is the cash at it.
  expect(keep.lines.find((l) => l.group === 'selling')!.expected).toBe(0);
  expect(keep.totalEconomicCostAtCeiling).toBe(keep.cashAtCeiling);
  expect(keep.exit.basis).toContain('no sale planned; value retained at private-party typical');
  // Every buyer-side line states its basis (SPEC 59).
  for (const economics of [direct, retail, keep])
    for (const line of economics.lines) expect(line.basis.trim(), line.id).not.toBe('');
});

it('two ceilings on one lot: the wedge has no edge on it, and a shop that keeps the car does', async () => {
  const walk = (await runDecisionCase('no-edge-walk')).decision;
  const build = (await runDecisionCase('edge-positive-build')).decision;
  const hobbyist = walk.buyerEconomics!;
  const shop = build.buyerEconomics!;
  // One lot, one market ceiling: the marginal professional rebuilder's own
  // solve over the same plan and the same exit evidence (SPEC 60).
  expect([hobbyist.market.maxBid, shop.market.maxBid]).toEqual([144_500, 144_500]);
  expect([hobbyist.maxBid, shop.maxBid]).toEqual([0, 167_000]);
  expect([hobbyist.edge, shop.edge]).toEqual([-144_500, 22_500]);
  // The wedge's $40,000 cannot reach an exotic rebuild that a capitalized shop
  // bids into, and the first reason names both numbers.
  expect(walk.verdict).toBe('walk');
  expect(walk.reasons[0]).toBe(
    "No edge on this lot: a professional rebuilder can pay $144,500 and you can pay $0; bidding above your ceiling to win is the winner's curse.",
  );
  // A car that is never sold pays nothing to sell, which the persona's retail
  // exit cannot match: the same lot, a higher bid, and a build.
  expect(build.verdict).toBe('build');
  expect(build.reasons[0]).toBe(
    'Reviewed evidence and buyer constraints support a conditional bid within the ceiling',
  );
  // A defensible positive ceiling is still a walk when the room's is higher: a
  // broker seat selling retail is the persona minus the broker cut.
  const retail = (await runDecisionCase('private-party-vs-retail')).decision;
  expect(retail.ceiling).toBe(140_000);
  expect(retail.buyerEconomics!.edge).toBe(-4_500);
  expect(retail.verdict).toBe('walk');
  expect(retail.reasons[0]).toContain('No edge on this lot');
});

it('a stated jurisdiction prices the title on the buyer’s side only', async () => {
  const decision = (await runDecisionCase('state-title-process')).decision;
  const title = decision.buyerEconomics!.lines.find((l) => l.id === 'title')!;
  // California's published band, on the buyer's ledger, with the source that
  // states it (SPEC 59).
  expect([title.low, title.expected, title.high]).toEqual([375, 538, 700]);
  expect(title.evidence).toBe('derived');
  expect(title.basis).toContain('US-CA California revived salvage');
  expect(title.basis).toContain('https://www.dmv.ca.gov/');
  // The kernel stays vehicle-relative: its own line is the national band, and
  // the buyer's state never edits it.
  const kernel = decision.report!.ledger!.costs.find((c) => c.id === 'title')!;
  expect([kernel.low, kernel.expected, kernel.high]).toEqual([150, 375, 600]);
  expect(kernel.basis).toContain('the band is national');
  // The persona registers the car where the buyer does, so the state moves
  // both ceilings and never makes the edge (SPEC 60).
  expect(decision.buyerEconomics!.market.lines.find((l) => l.id === 'title')!.expected).toBe(
    title.expected,
  );
  expect([decision.ceiling, decision.buyerEconomics!.market.maxBid]).toEqual([150_500, 144_500]);
  expect(decision.verdict).toBe('build');
});
