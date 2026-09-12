import type { Branch, ResolvedVehicle } from '@/lib/types';

export type VehicleExpectation = {
  make: string;
  model?: string;
  modelPattern?: string; // regex against the unchanged source model label
  yearMin?: number;
  yearMax?: number;
  unresolved?: string[]; // regexes, all required on this same candidate
  reasons?: string[]; // regexes, all required as verified match credit
};

// One eval case: a query and what a correct resolver must do with it.
// Expectations AND together; a case with none is a broken case and fails.
export type EvalCase = {
  query: string;
  note?: string;
  expect: {
    // This vehicle must rank within the top k cards of some branch.
    top?: VehicleExpectation;
    k?: number; // default 5
    // Ambiguity fork: branch makes must equal exactly this set.
    forkMakes?: string[];
    // The query must resolve to zero vehicles (JDM, impossible, nonsense).
    nothing?: boolean;
    // Every listed vehicle must appear within the top k of some branch.
    contains?: VehicleExpectation[];
    candidates?: VehicleExpectation[]; // membership anywhere, no ranking claim
    absent?: VehicleExpectation[]; // cannot appear anywhere, even below k
    unresolvedAll?: string[]; // every returned candidate must retain these unknowns
    noReasons?: string[]; // no candidate may earn this unsupported credit
    yearWindow?: { min?: number; max?: number }; // every observed year stays in query bounds
    // Some assumption's meaning or reason must match this pattern.
    assumption?: string;
    // Each term must be flagged unfilterable on some branch.
    unfilterable?: string[];
  };
};

export type QueryOutcome = {
  branches: Branch[];
  vehiclesByBranch: ResolvedVehicle[][]; // parallel to branches
};

export type CaseResult = { pass: boolean; detail: string };

const DEFAULT_K = 5;

function cardMatches(card: ResolvedVehicle, want: VehicleExpectation): boolean {
  if (card.make !== want.make) return false;
  if (want.model !== undefined && card.model !== want.model) return false;
  if (want.modelPattern && !new RegExp(want.modelPattern, 'i').test(card.model)) return false;
  if (
    want.unresolved?.some(
      (pattern) => !(card.unresolved ?? []).some((note) => new RegExp(pattern, 'i').test(note)),
    )
  )
    return false;
  if (
    want.reasons?.some(
      (pattern) => !card.reasons.some((reason) => new RegExp(pattern, 'i').test(reason)),
    )
  )
    return false;
  if (want.yearMin !== undefined && card.yearMin !== want.yearMin) return false;
  if (want.yearMax !== undefined && card.yearMax !== want.yearMax) return false;
  return true;
}

function inTopK(outcome: QueryOutcome, want: VehicleExpectation, k: number): boolean {
  return outcome.vehiclesByBranch.some((cards) =>
    cards.slice(0, k).some((c) => cardMatches(c, want)),
  );
}

export function scoreCase(c: EvalCase, outcome: QueryOutcome): CaseResult {
  const e = c.expect;
  const k = e.k ?? DEFAULT_K;
  const failures: string[] = [];
  let checked = 0;

  if (e.top) {
    checked++;
    if (!inTopK(outcome, e.top, k)) {
      const years =
        e.top.yearMin !== undefined || e.top.yearMax !== undefined
          ? ` ${e.top.yearMin ?? '…'}–${e.top.yearMax ?? '…'}`
          : '';
      failures.push(`${e.top.make} ${e.top.model ?? e.top.modelPattern}${years} not in top ${k}`);
    }
  }

  if (e.forkMakes) {
    checked++;
    const got = outcome.branches.map((b) => b.constraint.make ?? '(none)').sort();
    const want = [...e.forkMakes].sort();
    if (got.length !== want.length || got.some((m, i) => m !== want[i])) {
      failures.push(`expected fork [${want.join(', ')}], got [${got.join(', ')}]`);
    }
  }

  if (e.nothing) {
    checked++;
    const total = outcome.vehiclesByBranch.reduce((n, cards) => n + cards.length, 0);
    if (total > 0) failures.push(`expected zero vehicles, got ${total}`);
  }

  if (e.contains?.length) {
    checked++;
    for (const want of e.contains) {
      if (!inTopK(outcome, want, k))
        failures.push(`${want.make} ${want.model ?? want.modelPattern} not in top ${k}`);
    }
  }

  const all = outcome.vehiclesByBranch.flat();
  if (e.candidates?.length) {
    checked++;
    for (const want of e.candidates)
      if (!all.some((card) => cardMatches(card, want)))
        failures.push(
          `missing candidate/evidence: ${want.make} ${want.model ?? want.modelPattern}`,
        );
  }
  if (e.absent?.length) {
    checked++;
    for (const want of e.absent)
      if (all.some((card) => cardMatches(card, want)))
        failures.push(`forbidden candidate: ${want.make} ${want.model ?? want.modelPattern}`);
  }
  if (e.unresolvedAll?.length) {
    checked++;
    if (!all.length) failures.push('unresolved evidence requires candidates');
    for (const pattern of e.unresolvedAll)
      if (
        all.some(
          (card) => !(card.unresolved ?? []).some((note) => new RegExp(pattern, 'i').test(note)),
        )
      )
        failures.push(`missing unresolved evidence: ${pattern}`);
  }
  if (e.noReasons?.length) {
    checked++;
    for (const pattern of e.noReasons)
      if (all.some((card) => card.reasons.some((reason) => new RegExp(pattern, 'i').test(reason))))
        failures.push(`unsupported match credit: ${pattern}`);
  }
  if (e.yearWindow) {
    checked++;
    if (
      !all.length ||
      all.some(
        (card) =>
          (e.yearWindow?.min !== undefined && card.yearMin < e.yearWindow.min) ||
          (e.yearWindow?.max !== undefined && card.yearMax > e.yearWindow.max),
      )
    )
      failures.push('candidate years outside requested window or no candidates');
  }

  if (e.assumption) {
    checked++;
    const re = new RegExp(e.assumption, 'i');
    const hit = outcome.branches.some((b) =>
      b.assumptions.some((a) => re.test(a.meaning) || re.test(a.reason)),
    );
    if (!hit) failures.push(`no assumption matching /${e.assumption}/i`);
  }

  if (e.unfilterable?.length) {
    checked++;
    for (const term of e.unfilterable) {
      const hit = outcome.branches.some((b) =>
        (b.constraint.unfilterable ?? []).some((u) => u.term.includes(term)),
      );
      if (!hit) failures.push(`"${term}" not flagged unfilterable`);
    }
  }

  if (checked === 0) return { pass: false, detail: 'case has no expectation' };
  if (failures.length > 0) return { pass: false, detail: failures.join('; ') };
  return { pass: true, detail: 'ok' };
}
