import type { Assessment, OfferedAction } from '../assessments/types';

export type WatchPolicy = {
  actionKinds: OfferedAction['kind'][];
  intervalMs: number;
  until: string;
  maxRefreshes: number;
};
export function runnable(a: Assessment): boolean {
  return (
    a.status === 'active' &&
    a.offeredActions.length > 0 &&
    a.budget.usedInvestigations < a.budget.maxInvestigations &&
    a.offeredActions.some(
      (action) =>
        action.maxCostCents <=
        a.budget.maxCostCents - a.budget.spentCostCents - a.budget.reservedCostCents,
    )
  );
}
export function externalChange(a: Assessment, old?: Assessment): boolean {
  if (!old || a.epoch !== old.epoch) return true;
  // A coordinator already continues after its own tool. Such saves update the
  // outbox's revision/heartbeat but must not enqueue another model turn.
  if (JSON.stringify(a.investigations) !== JSON.stringify(old.investigations)) return false;
  const significant = (value: Assessment) => {
    const ignored = new Set([
      'revision',
      'updatedAt',
      'history',
      'decision',
      'operations',
      'outcomes',
    ]);
    return Object.fromEntries(Object.entries(value).filter(([key]) => !ignored.has(key)));
  };
  return JSON.stringify(significant(a)) !== JSON.stringify(significant(old));
}
export function pendingDeadline(a: Assessment): string | undefined {
  return a.investigations
    .filter((i) => i.status === 'pending')
    .map((i) => i.deadlineAt)
    .sort()[0];
}
export function watchKindsDue(
  a: Assessment,
  policy: WatchPolicy,
  at: string,
): OfferedAction['kind'][] {
  const kinds = {
    photo_triage: 'triage',
    vin_identity: 'identity',
    market_comps: 'comp',
    repair_evidence: 'repair_price',
  } as const;
  return policy.actionKinds.filter((kind) => {
    const captures = a.evidence.filter((e) => e.kind === kinds[kind] && e.status === 'accepted');
    const uncertain = a.investigations.filter(
      (i) =>
        i.action.kind === kind &&
        i.status === 'failed' &&
        i.action.maxCostCents > 0 &&
        i.costBasis === 'allowance_estimate',
    );
    if (
      uncertain.some(
        (i) =>
          !captures.some(
            (e) => Date.parse(e.source.retrievedAt) > Date.parse(i.finishedAt ?? i.startedAt),
          ),
      )
    )
      return false;
    // Identity is stable unless absent. All other watched captures use the
    // explicitly opted interval, never a polling tick as a new observation.
    return (
      !captures.length ||
      (kind !== 'vin_identity' &&
        captures.every(
          (e) => Date.parse(at) - Date.parse(e.source.retrievedAt) >= policy.intervalMs,
        ))
    );
  });
}
