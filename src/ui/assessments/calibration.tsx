'use client';

/**
 * What the desk's forecasts did against what actually happened, as a collapsed
 * disclosure on the workspace list (DESIGN.md collapsed evidence). Every row
 * states its denominator, a sample too small to read states its count instead
 * of a number, and the section says what it never counts (SPEC 63). It renders
 * projections and computes nothing.
 */
import type { OutcomeReport } from '@/assessment-reporting/outcomes';
import { calibrationExclusions, calibrationRows, calibrationSummary } from './calibration-format';

export function Calibration({ report }: { report: OutcomeReport }) {
  return (
    <section>
      <h2 className="type-h2 border-b border-border pb-3">Estimates against observed outcomes</h2>
      <details className="pt-4">
        <summary className="type-body cursor-pointer text-accent">
          {calibrationSummary(report)}
        </summary>
        <p className="type-body py-3 text-dim">
          From up to 100 most recently updated saved assessments. Each outcome is read against the
          decision that was saved before it was observed. This measures neither profit nor avoided
          loss, and no constant changes from it.
        </p>
        <ul className="divide-y divide-border">
          {calibrationRows(report).map((row) => (
            <li key={row.id} className="py-2">
              <div className="grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline">
                <span className="type-body min-w-0">{row.label}</span>
                <span className="min-w-0 font-mono text-[13px] tabular-nums">{row.value}</span>
              </div>
              <p className="type-meta mt-1">{row.basis}</p>
            </li>
          ))}
        </ul>
        <p className="type-meta mt-3">{calibrationExclusions(report)}</p>
      </details>
    </section>
  );
}
