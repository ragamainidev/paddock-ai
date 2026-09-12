'use client';

/**
 * One bidder's cost lines as a disclosure: every dollar a ceiling was solved
 * against, each with the basis it came from and the chip that says whether that
 * basis is curated, cited or derived (SPEC 59). A line that costs nothing is
 * counted in the summary rather than given a row, so the table is what the
 * money actually went to (DESIGN.md collapsed evidence).
 */
import type { CostLine } from '@/salvage/types';
import { dollars } from '@/ui/inspect-format';
import { EvidenceChip } from '@/ui/run/program-table';
import { ledgerRows, ledgerSummary } from './format';

export function LedgerLines({ label, lines }: { label: string; lines: CostLine[] }) {
  return (
    <details className="border-t border-border pt-4">
      <summary className="type-body cursor-pointer text-accent">
        {ledgerSummary(label, lines)}
      </summary>
      <ul className="mt-3 divide-y divide-border">
        {ledgerRows(lines).map((line) => (
          <li key={line.id} className="py-2">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
              <span className="type-body min-w-0">{line.label}</span>
              <span className="flex items-baseline gap-2 font-mono text-[13px] tabular-nums">
                <span className="type-meta">
                  {dollars(line.low)}–{dollars(line.high)}
                </span>
                <span>{dollars(line.expected)}</span>
                <EvidenceChip evidence={line.evidence} />
              </span>
            </div>
            <p className="type-meta mt-1">{line.basis}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}
