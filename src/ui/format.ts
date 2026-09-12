import type { Assumption, Constraint, ResolvedVehicle, StageStatus } from '@/lib/types';

// Pure formatting for the UI layer. Components stay declarative; everything
// with a decision in it lives here where it can be unit-tested.

// DESIGN.md: year ranges are `2019–2026`, en dash, no spaces.
export function yearRange(min: number, max: number): string {
  return min === max ? String(min) : `${min}–${max}`;
}

// DESIGN.md assumption chip: `992 → Porsche 911, 2019+`.
export function assumptionChip(a: Assumption): string {
  return `${a.input} → ${a.meaning}`;
}

// Clicking a chip re-runs the query without the assumed token. Whole-token
// match only: dropping '3' from 'm3 3 series' must not maul 'm3'.
export function queryWithout(query: string, token: string): string {
  const words = query.split(/\s+/).filter(Boolean);
  const target = token.split(/\s+/).filter(Boolean).map(lower);
  for (let i = 0; i + target.length <= words.length; i++) {
    const slice = words.slice(i, i + target.length).map(lower);
    if (slice.every((w, j) => w === target[j])) {
      return [...words.slice(0, i), ...words.slice(i + target.length)].join(' ');
    }
  }
  return words.join(' ');
}

function lower(s: string): string {
  return s.toLowerCase();
}

// The selected vehicle travels in the URL as `v=<branch>.<vehicle>` so a
// result link is shareable and the whole page stays server-rendered.
export function selectionParam(branch: number, vehicle: number): string {
  return `${branch}.${vehicle}`;
}

export function parseSelection(v: string | undefined): { branch: number; vehicle: number } | null {
  if (!v) return null;
  const m = /^(\d+)\.(\d+)$/.exec(v);
  if (!m) return null;
  return { branch: Number(m[1]), vehicle: Number(m[2]) };
}

// Unfilterable terms flagged for listings ('manual', 'slicktop') go into the
// eBay query; that forwarding is the whole reason they were kept.
export function forwardedTerms(constraint: Constraint): string[] {
  return (constraint.unfilterable ?? []).filter((u) => u.forwardedToListings).map((u) => u.term);
}

const SPEC_LIST_CAP = 4;

function capped(values: string[]): string {
  if (values.length <= SPEC_LIST_CAP) return values.join(', ');
  const rest = values.length - SPEC_LIST_CAP;
  return `${values.slice(0, SPEC_LIST_CAP).join(', ')} +${rest} more`;
}

// Rows for the vehicle card's two-column mono grid. Empty facets are omitted
// rather than rendered as blanks; years are always present.
export function vehicleSpecs(v: ResolvedVehicle): [string, string][] {
  const rows: [string, string][] = [['years', yearRange(v.yearMin, v.yearMax)]];
  const engines = v.engines.map((e) => e.engine).filter((e): e is string => e !== null);
  if (engines.length > 0) rows.push(['engines', capped(engines)]);
  if (v.drive.length > 0) rows.push(['drive', capped(v.drive)]);
  if (v.body.length > 0) rows.push(['body', capped(v.body)]);
  if (v.trims.length > 0) rows.push(['trims', capped(v.trims)]);
  return rows;
}

const STAGE_NOTES: Record<StageStatus['stage'], string> = {
  interpret: 'interpreter degraded',
  resolve: 'vehicle lookup failed',
  nhtsa: 'NHTSA data unavailable',
  ebay: 'listings unavailable',
  themes: 'complaint themes unavailable',
};

// DESIGN.md: when a stage fails, say which and why in meta under the results
// that did work. Degradation is visible, never silent.
export function stageNote(status: StageStatus): string {
  const base = STAGE_NOTES[status.stage];
  return status.detail ? `${base}: ${status.detail}` : base;
}
