/**
 * FormData to request payload for the watch and outcome forms. The validation
 * a reader is owed happens here, before a request is spent on input the server
 * will refuse; the server schemas remain authoritative. Pure, so the rejection
 * rules are testable without a browser.
 */
import { OUTCOME_KINDS, type OfferedAction, type OutcomeKind } from '@/assessments/types';

export type PayloadResult<T> = { ok: true; payload: T } | { ok: false; error: string };

export type WatchRequest = {
  policy: {
    actionKinds: OfferedAction['kind'][];
    intervalMs: number;
    until: string;
    maxRefreshes: number;
  };
};

export type OutcomeRequest = {
  kind: OutcomeKind;
  note: string;
  decisionRevision: number;
  observedAt?: string;
  amount?: number;
  hammer?: number;
  repairCost?: number;
  holdingCost?: number;
  saleProceeds?: number;
};

const WATCH_KINDS: OfferedAction['kind'][] = [
  'market_comps',
  'photo_triage',
  'vin_identity',
  'repair_evidence',
];
// A lot that changed hands states the price it made, whoever won it (SPEC 62).
const HAMMER_KINDS: OutcomeKind[] = ['purchased', 'lost_to_hammer'];
const MONEY_FIELDS = [
  ['amount', 'observed amount'],
  ['hammer', 'winning bid'],
  ['repairCost', 'repair cash cost'],
  ['holdingCost', 'holding cost'],
  ['saleProceeds', 'net sale proceeds'],
] as const;

/** A watch spends this assessment's remaining budget, so every bound is required. */
export function watchPayload(values: FormData): PayloadResult<WatchRequest> {
  const actionKinds = values
    .getAll('actionKinds')
    .map(String)
    .filter((kind): kind is OfferedAction['kind'] =>
      WATCH_KINDS.includes(kind as OfferedAction['kind']),
    );
  if (actionKinds.length === 0) return { ok: false, error: 'Select at least one source to watch.' };
  const intervalHours = numberField(values, 'intervalHours');
  if (intervalHours === undefined || !Number.isFinite(intervalHours) || intervalHours <= 0)
    return { ok: false, error: 'Enter how many hours to wait between checks.' };
  const until = Date.parse(String(values.get('until') ?? ''));
  if (Number.isNaN(until)) return { ok: false, error: 'Enter the date to stop watching.' };
  const maxRefreshes = numberField(values, 'maxRefreshes');
  if (maxRefreshes === undefined || !Number.isFinite(maxRefreshes) || maxRefreshes < 1)
    return { ok: false, error: 'Enter how many refreshes this watch may spend.' };
  return {
    ok: true,
    payload: {
      policy: {
        actionKinds,
        intervalMs: Math.round(intervalHours * 3_600_000),
        until: new Date(until).toISOString(),
        maxRefreshes: Math.round(maxRefreshes),
      },
    },
  };
}

/** An outcome without the decision revision it is compared with measures nothing. */
export function outcomePayload(values: FormData): PayloadResult<OutcomeRequest> {
  const kind = String(values.get('kind') ?? '') as OutcomeKind;
  if (!(OUTCOME_KINDS as readonly string[]).includes(kind))
    return { ok: false, error: 'Choose what happened to this car.' };
  const note = String(values.get('note') ?? '').trim();
  if (!note) return { ok: false, error: 'Describe what happened and what the numbers include.' };
  const decisionRevision = numberField(values, 'decisionRevision');
  if (decisionRevision === undefined || !Number.isInteger(decisionRevision) || decisionRevision < 1)
    return { ok: false, error: 'Select the earlier decision this outcome is compared with.' };
  const observedRaw = String(values.get('observedAt') ?? '').trim();
  const observed = observedRaw ? Date.parse(observedRaw) : undefined;
  if (observed !== undefined && Number.isNaN(observed))
    return { ok: false, error: 'Enter a real observation date, or leave it blank for now.' };
  const money: Partial<Record<(typeof MONEY_FIELDS)[number][0], number>> = {};
  for (const [field, label] of MONEY_FIELDS) {
    const value = numberField(values, field);
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value < 0)
      return { ok: false, error: `Enter a number for the ${label}, or leave it blank.` };
    money[field] = value;
  }
  if (HAMMER_KINDS.includes(kind) && money.hammer === undefined)
    return { ok: false, error: 'Enter the winning bid this lot sold for.' };
  return {
    ok: true,
    payload: {
      kind,
      note,
      decisionRevision,
      ...(observed === undefined ? {} : { observedAt: new Date(observed).toISOString() }),
      ...money,
    },
  };
}

// A blank field is absent, not zero. Text that is not a number stays NaN so
// the caller reports it rather than sending a figure nobody typed.
function numberField(values: FormData, name: string): number | undefined {
  const raw = String(values.get(name) ?? '').trim();
  return raw ? Number(raw) : undefined;
}
