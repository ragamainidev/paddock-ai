/**
 * One money grammar for every surface: whole dollars, comma-grouped, no
 * cents. Ledgers, console notes, report cards and summaries all read the
 * same because they all format here; a local copy in a domain file is how
 * two figures on one screen end up rounded differently.
 */

export function usd(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

// The UI surface's name for the same format (`src/ui/inspect-format.ts`
// re-exports it, so components keep their vocabulary).
export const dollars = usd;
