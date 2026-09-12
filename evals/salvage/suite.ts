import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EbayItemSummary } from '@/enrich/ebay';
import { priceLot, synthesizeSalvage } from '@/salvage/assess';
import { createCompsFetcher } from '@/salvage/comps';
import { bidDependentFees } from '@/salvage/fees';
import { applyPriceEvidence, deriveRepairPlan } from '@/salvage/knowledge';
import { getSalvageLot } from '@/salvage/seed-lots';
import { profileFor } from '@/salvage/tiers';
import type {
  Comp,
  DamageTriage,
  MarqueTier,
  RepairPlan,
  SalvageAssessment,
  SalvageEvidence,
  SalvageLedger,
} from '@/salvage/types';
import type { CheckResult, InspectorCaseResult } from '../inspector/suite';

/**
 * The salvage money-model suite: recorded triage plus typed evidence (real
 * comps and prices, hand-converted from live-run traces and re-verified
 * research) replayed through the CURRENT ceiling pipeline and graded.
 * Deterministic and offline; every change to the money model is scored
 * against the same evidence, and the committed history makes regressions
 * visible run over run.
 *
 * Check classes:
 *   invariant  SPEC rules that must never break
 *   realism    numbers a practitioner could falsify against the market
 *   honesty    the report never argues against its own verdict
 *   behavior   the verdict follows from the evidence (per-case expectations)
 */

const CASES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'cases');
const NOW = new Date('2026-08-17T00:00:00Z');
const COLLECTED_ON = '2026-08-17';
// The whole-vehicle floor the comps fetcher applies to the ask lanes of an
// exotic or premium lot (src/salvage/comps.ts), restated band by band so the
// eval fails independently if the fetcher stops applying it. Ages are read
// off COLLECTED_ON, never the wall clock.
const FLOOR_BANDS: Record<MarqueTier, { maxAge: number; usd: number }[]> = {
  exotic: [{ maxAge: Infinity, usd: 10_000 }],
  premium: [
    { maxAge: 12, usd: 10_000 },
    { maxAge: 20, usd: 4_000 },
    { maxAge: Infinity, usd: 0 },
  ],
  mainstream: [{ maxAge: Infinity, usd: 0 }],
};
const floorFor = (tier: MarqueTier, year: number): number => {
  const age = Number(COLLECTED_ON.slice(0, 4)) - year;
  return FLOOR_BANDS[tier].find((band) => age <= band.maxAge)?.usd ?? 0;
};

type SalvageCase = {
  name: string;
  note: string;
  lotId: string;
  triage: DamageTriage;
  // `ebayRaw` is recorded Browse item summaries: a case that carries them
  // runs the live comps fetcher over a stub client, so the screening the
  // assessor depends on is graded, not assumed.
  evidence: SalvageEvidence & { ebayRaw?: EbayItemSummary[] };
  expect?: {
    verdict?: 'build' | 'walk';
    dealbreaker?: boolean;
    noExit?: boolean;
    exitLane?: string;
    wreckMax?: number;
    wreckMin?: number;
    panelsMax?: number;
    oneFrontProgram?: boolean;
    // Substrings every one of which must appear in some comps progress note.
    progressIncludes?: string[];
  };
};

// A case whose comps are settled: typed evidence plus whatever the fetcher
// derived from the recorded item summaries, beside the progress notes the
// fetcher emitted while screening them.
type ResolvedCase = SalvageCase & { comps: Comp[]; notes: string[] };

type Money = { plan: RepairPlan; ledger: SalvageLedger; assessment: SalvageAssessment };

async function resolveCase(c: SalvageCase): Promise<ResolvedCase> {
  const raw = c.evidence.ebayRaw;
  if (!raw) return { ...c, comps: c.evidence.comps, notes: [] };
  const lot = getSalvageLot(c.lotId);
  // An unknown lot is reported by the graded `runs` check, not thrown here.
  if (!lot) return { ...c, comps: c.evidence.comps, notes: [] };
  const fetcher = createCompsFetcher({ searchRaw: async () => raw }, () => COLLECTED_ON);
  const notes: string[] = [];
  const derived = await fetcher(lot, (note) => notes.push(note));
  return { ...c, comps: [...c.evidence.comps, ...derived], notes };
}

function runCase(c: ResolvedCase): Money {
  const lot = getSalvageLot(c.lotId);
  if (!lot) throw new Error(`unknown lot ${c.lotId}`);
  const profile = profileFor(lot);
  const { plan } = applyPriceEvidence(
    deriveRepairPlan(c.triage, lot, profile),
    c.evidence.prices,
    lot,
  );
  const { ledger } = priceLot(lot, c.triage, plan, c.comps, profile, NOW);
  const assessment = synthesizeSalvage(lot, c.triage, plan, ledger, [], [], undefined, 12, profile);
  return { plan, ledger, assessment };
}

function gradeCase(c: ResolvedCase): InspectorCaseResult {
  const checks: CheckResult[] = [];
  const check = (
    id: string,
    cls: CheckResult['class'],
    desc: string,
    pass: boolean,
    detail?: string,
    spec?: string,
  ) => checks.push({ id, class: cls, desc, pass, detail: pass ? undefined : detail, spec });

  let money: Money;
  try {
    money = runCase(c);
  } catch (err) {
    check(
      'runs',
      'invariant',
      'the money pipeline runs on the recorded evidence',
      false,
      String(err),
    );
    return { name: c.name, description: c.note, checks, pass: false };
  }
  const { plan, ledger, assessment } = money;
  const summary = assessment.summary;
  const usd = (n: number) => `$${n.toLocaleString('en-US')}`;

  // -- invariants ---------------------------------------------------------------
  check(
    'verdict-taxonomy',
    'invariant',
    'the verdict is bid or no bid',
    ['build', 'walk'].includes(assessment.verdict),
    `got ${assessment.verdict}`,
    'SPEC 45',
  );
  const structuralPerProgram = plan.programs.every(
    (p) => p.lines.filter((l) => /\.structure$/.test(l.id)).length <= 1,
  );
  check(
    'one-structure-per-program',
    'invariant',
    'a damage program carries at most one structural line',
    structuralPerProgram,
    plan.programs
      .map((p) => `${p.id}:${p.lines.filter((l) => /\.structure$/.test(l.id)).length}`)
      .join(','),
    'SPEC 43',
  );
  check(
    'every-line-has-basis',
    'invariant',
    'every cost line carries a basis and an evidence chip',
    ledger.costs.every((l) => l.basis.length > 0 && l.evidence.length > 0),
    ledger.costs
      .filter((l) => !l.basis)
      .map((l) => l.id)
      .join(','),
    'SPEC 36',
  );
  check(
    'comps-are-typed',
    'invariant',
    'every comp behind the exit has a positive price and an http(s) source',
    (ledger.exit?.comps ?? []).every((u) => u.comp.price > 0 && /^https?:\/\//.test(u.comp.url)),
    undefined,
    'SPEC 44',
  );
  if (c.evidence.ebayRaw) {
    const fixedPriceUrls = new Set(
      c.evidence.ebayRaw
        .filter((item) => item.buyingOptions?.includes('FIXED_PRICE'))
        .map((item) => item.itemWebUrl),
    );
    const fromBrowse = c.comps.filter((comp) => comp.source === 'ebay.com');
    check(
      'comps-fixed-price-only',
      'invariant',
      'no eBay comp comes from a listing that does not declare a fixed price',
      fromBrowse.every((comp) => fixedPriceUrls.has(comp.url)),
      fromBrowse
        .filter((comp) => !fixedPriceUrls.has(comp.url))
        .map((comp) => comp.url)
        .join(','),
      'SPEC 53',
    );
    const lot = getSalvageLot(c.lotId)!;
    const floor = floorFor(profileFor(lot).tier, lot.year);
    // The floor guards the ask lanes only: a damaged listing under it is
    // wreck evidence, which is context and never enters the solve (SPEC 39).
    const asks = fromBrowse.filter((comp) => comp.lane !== 'wreck');
    // A band of $0 leaves nothing to grade: every ask clears zero already,
    // because the fetcher refuses a non-positive price. The floor is checked
    // where the lot's band sets one, and a case whose band sets none pins its
    // screening through `comps-fixed-price-only` and the counts a
    // `progressIncludes` expectation reads out of the note.
    if (floor > 0)
      check(
        'comps-whole-car',
        'invariant',
        `no eBay ask comp on an exotic or premium lot is priced below ${usd(floor)}`,
        asks.every((comp) => comp.price >= floor),
        asks
          .filter((comp) => comp.price < floor)
          .map((comp) => `${comp.price}: ${comp.note ?? comp.url}`)
          .join(','),
        'SPEC 53',
      );
  }
  // Graded outside the `ebayRaw` block: an expectation on notes the fetcher
  // never emitted is a broken case, not an absent check.
  const wanted = c.expect?.progressIncludes ?? [];
  if (wanted.length) {
    const missing = wanted.filter((phrase) => !c.notes.some((note) => note.includes(phrase)));
    check(
      'comps-progress',
      'invariant',
      'the comps progress note states what the screens dropped',
      Boolean(c.evidence.ebayRaw) && missing.length === 0,
      c.evidence.ebayRaw
        ? `missing ${missing.join(' | ')} in: ${c.notes.join(' | ')}`
        : 'progressIncludes needs recorded ebayRaw: the comps fetcher never ran',
      'SPEC 53',
    );
  }
  if (ledger.exit && ledger.ceiling !== null) {
    const fixed = ledger.costs.filter((l) => !l.bidDependent).reduce((s, l) => s + l.expected, 0);
    const target = ledger.discipline.share * ledger.exit.low;
    const allIn = (bid: number) => bid + bidDependentFees(bid) + fixed;
    check(
      'ceiling-solves',
      'invariant',
      'the ceiling is the highest $500 step whose all-in stays at or under discipline',
      ledger.ceiling === 0
        ? allIn(500) > target
        : allIn(ledger.ceiling) <= target && allIn(ledger.ceiling + 500) > target,
      `ceiling ${ledger.ceiling}, all-in ${allIn(ledger.ceiling)}, target ${target}`,
      'SPEC 39',
    );
    check(
      'zero-names-killers',
      'invariant',
      'a zero ceiling names its killers and its unlocks',
      ledger.ceiling > 0 || (ledger.killers.length > 0 && ledger.unlocks.length > 0),
      `killers ${ledger.killers.length}, unlocks ${ledger.unlocks.length}`,
      'SPEC 39',
    );
  }
  if (assessment.dealbreakers.length > 0) {
    check(
      'dealbreaker-walks',
      'invariant',
      'a dealbreaker forces no bid regardless of the money',
      assessment.verdict === 'walk',
      assessment.verdict,
      'SPEC 36',
    );
  }

  // -- realism ------------------------------------------------------------------
  if (ledger.exit) {
    const e = ledger.exit;
    check(
      'exit-band-sane',
      'realism',
      'the exit is a band: low ≤ typical ≤ high, high under 2.6× low (a 1.4/0.7 comp spread times the 0.65/0.5 discount band)',
      e.low <= e.typical && e.typical <= e.high && e.high / e.low <= 2.6,
      `${e.low}/${e.typical}/${e.high}`,
    );
    check(
      'exit-under-clean',
      'realism',
      'a derived exit sits below the clean money it derives from',
      e.lane === 'rebuilt_sold' ||
        !e.discount ||
        e.typical < e.typical / ((e.discount.low + e.discount.high) / 2),
      e.basis.slice(0, 120),
    );
  }
  if (ledger.wreck) {
    const w = ledger.wreck;
    check(
      'wreck-band-sane',
      'realism',
      'the wreck market is a plausible band: no pocket change, high under 4× low',
      w.low >= 1000 && w.high / w.low <= 4,
      `${w.low}-${w.high}`,
    );
    if (ledger.exit && ledger.exit.lane !== 'rebuilt_sold') {
      const cleanTypical = ledger.exit.typical / 0.575;
      check(
        'wreck-under-clean',
        'realism',
        'no wreck comp used sits at clean money',
        w.comps.filter((u) => u.used).every((u) => u.adjusted < cleanTypical * 0.9),
        w.comps
          .filter((u) => u.used)
          .map((u) => u.adjusted)
          .join(','),
      );
    }
  }
  if (ledger.ceiling !== null && ledger.breakEven !== null && ledger.stress !== null) {
    check(
      'ceiling-ordering',
      'realism',
      'stress ≤ ceiling ≤ break-even',
      ledger.stress <= ledger.ceiling && ledger.ceiling <= ledger.breakEven,
      `${ledger.stress} ≤ ${ledger.ceiling} ≤ ${ledger.breakEven}`,
    );
  }
  const contingency = ledger.costs.find((l) => l.group === 'contingency');
  check(
    'contingency-floor',
    'realism',
    'the hidden-damage contingency never sits below the tier floor',
    Boolean(contingency && contingency.expected >= 1000),
    String(contingency?.expected),
  );

  // -- honesty ------------------------------------------------------------------
  if (assessment.verdict === 'walk') {
    check(
      'no-bid-copy-on-refusal',
      'honesty',
      'a no-bid verdict never carries "Bid to" copy',
      !/Bid to \$/.test(summary),
      summary.slice(0, 120),
    );
  } else {
    check(
      'bid-copy-states-ceiling',
      'honesty',
      'a bid verdict states its ceiling in the summary',
      ledger.ceiling !== null && summary.includes(`Bid to ${usd(ledger.ceiling)}`),
      summary.slice(0, 120),
    );
  }
  if (ledger.ceiling === 0 && assessment.dealbreakers.length === 0) {
    check(
      'zero-explains',
      'honesty',
      'a zero ceiling says what ate it and what would have to be true',
      /What ate it:/.test(summary) &&
        /(turns positive only if|No single input|Nothing realistic)/.test(summary),
      summary.slice(0, 200),
    );
  }
  if (ledger.exit) {
    check(
      'exit-basis-cites',
      'honesty',
      'the exit basis names its hosts or confesses a derivation',
      /\.[a-z]{2,}|ACV|derived/i.test(ledger.exit.basis),
      ledger.exit.basis.slice(0, 140),
    );
  }
  if (assessment.dealbreakers.length > 0) {
    check(
      'veto-stated',
      'honesty',
      'a dead rebuild lane states its veto in the summary',
      /^Don't bid\. No bid: /.test(summary),
      summary.slice(0, 120),
    );
  }

  // -- behavior (per-case expectations) -----------------------------------------
  const ex = c.expect ?? {};
  if (ex.verdict) {
    check(
      'expected-verdict',
      'behavior',
      `verdict is ${ex.verdict}`,
      assessment.verdict === ex.verdict,
      assessment.verdict,
    );
  }
  if (ex.dealbreaker) {
    check(
      'expected-dealbreaker',
      'behavior',
      'a dealbreaker is stated',
      assessment.dealbreakers.length > 0,
      'none',
    );
  }
  if (ex.noExit) {
    check(
      'expected-no-exit',
      'behavior',
      'no exit and no ceiling; the cost side still itemized',
      ledger.exit === null && ledger.ceiling === null && ledger.costs.length > 0,
      `exit ${ledger.exit?.lane}`,
    );
  }
  if (ex.exitLane) {
    check(
      'expected-exit-lane',
      'behavior',
      `exit lane is ${ex.exitLane}`,
      ledger.exit?.lane === ex.exitLane,
      ledger.exit?.lane ?? 'none',
    );
  }
  if (ex.wreckMax !== undefined) {
    check(
      'wreck-max',
      'behavior',
      `no wreck comp used above ${usd(ex.wreckMax)} (a retail figure cannot bleed into the hammer band)`,
      Boolean(ledger.wreck) && ledger.wreck!.high <= ex.wreckMax,
      `wreck high ${ledger.wreck?.high}`,
      'SPEC 44',
    );
  }
  if (ex.wreckMin !== undefined) {
    check(
      'wreck-min',
      'behavior',
      `at least ${ex.wreckMin} wreck comps survive relaning (salvage-auction listings are wreck evidence whatever lane the worker used)`,
      (ledger.wreck?.n ?? 0) >= ex.wreckMin,
      `wreck n ${ledger.wreck?.n ?? 0}`,
      'SPEC 44',
    );
  }
  if (ex.panelsMax !== undefined) {
    const panels = plan.lines.find((l) => l.id === 'front.panels');
    check(
      'panels-max',
      'behavior',
      `off-spec, aftermarket, and structure items never inflate the front panels line past ${usd(ex.panelsMax)}`,
      Boolean(panels) && panels!.expected <= ex.panelsMax,
      `front.panels expected ${panels?.expected}`,
      'SPEC 44',
    );
  }
  if (ex.oneFrontProgram) {
    check(
      'one-front-program',
      'behavior',
      'three heavy structural front zones price as one front program with one structural line',
      plan.programs.filter((p) => p.id === 'front').length === 1 &&
        plan.lines.filter((l) => l.id === 'front.structure').length === 1,
      plan.programs.map((p) => p.id).join(','),
      'SPEC 43',
    );
  }
  // Every case: the wreck market is context, never a verdict input.
  check(
    'wreck-is-context',
    'behavior',
    'the verdict does not flip on the wreck market',
    (() => {
      const lot = getSalvageLot(c.lotId)!;
      const profile = profileFor(lot);
      const { plan: p2 } = applyPriceEvidence(
        deriveRepairPlan(c.triage, lot, profile),
        c.evidence.prices,
        lot,
      );
      const noWreck = priceLot(
        lot,
        c.triage,
        p2,
        c.comps.filter((x) => x.lane !== 'wreck'),
        profile,
        NOW,
      );
      const a2 = synthesizeSalvage(
        lot,
        c.triage,
        p2,
        noWreck.ledger,
        [],
        [],
        undefined,
        12,
        profile,
      );
      return a2.verdict === assessment.verdict && noWreck.ledger.ceiling === ledger.ceiling;
    })(),
    undefined,
    'SPEC 45',
  );

  return { name: c.name, description: c.note, checks, pass: checks.every((x) => x.pass) };
}

export async function runSalvageSuite(): Promise<InspectorCaseResult[]> {
  const files = readdirSync(CASES_DIR).filter((f) => f.endsWith('.json'));
  const cases = files
    .sort()
    .map((f) => JSON.parse(readFileSync(join(CASES_DIR, f), 'utf8')) as SalvageCase);
  const resolved = await Promise.all(cases.map(resolveCase));
  return resolved.map(gradeCase);
}
