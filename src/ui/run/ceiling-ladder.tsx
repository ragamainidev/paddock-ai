'use client';

import type { SalvageLedger } from '@/salvage/types';
import { dollars } from '../inspect-format';

// DESIGN.md ceiling ladder: a horizontal waterfall from the rebuilt exit down
// to the bid ceiling. Pure over the ledger's ladder steps; the running total
// is recomputed here so a step's bar sits exactly where its dollars leave.

export function CeilingLadder({ ledger }: { ledger: SalvageLedger }) {
  const steps = ledger.ladder;
  if (steps.length === 0 || !ledger.exit) return null;
  const scale = Math.max(ledger.exit.low, 1);
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / scale) * 100))}%`;
  const breakEven = ledger.breakEven ?? 0;
  const basisOf = (id: string) => {
    if (id.startsWith('program:')) {
      const program = id.slice('program:'.length);
      return ledger.costs
        .filter((c) => c.program === program)
        .map((c) => `${c.label}: ${dollars(c.expected)}`)
        .join(' · ');
    }
    return ledger.costs.find((c) => c.id === id)?.basis ?? '';
  };

  // Bar geometry per step: the running total after each cost step is the
  // bar's left edge; exit and ceiling bars grow from zero.
  const rows = steps.reduce<{ step: (typeof steps)[number]; left: number; width: number }[]>(
    (acc, step) => {
      const running = acc.length ? acc[acc.length - 1].left : ledger.exit!.low;
      if (step.kind === 'exit' || step.kind === 'ceiling') {
        acc.push({ step, left: step.kind === 'exit' ? ledger.exit!.low : 0, width: step.amount });
        return acc;
      }
      const after = running - step.amount;
      acc.push({ step, left: Math.max(0, after), width: Math.min(step.amount, running) });
      return acc;
    },
    [],
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col">
        {rows.map(({ step, left, width }) => {
          const zero = step.kind === 'ceiling' && step.amount <= 0;
          return (
            <div
              key={step.id}
              className="grid h-5 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[14rem_minmax(0,1fr)_7rem]"
              title={step.kind === 'cost' || step.kind === 'bid_fee' ? basisOf(step.id) : undefined}
            >
              <span
                className={`type-spec truncate ${step.kind === 'exit' || step.kind === 'ceiling' ? 'text-text' : 'text-dim'}`}
              >
                {step.label}
              </span>
              <div className="relative hidden h-2 sm:block">
                {breakEven > 0 && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute -top-1.5 -bottom-1.5 w-px bg-border-strong"
                    style={{ left: pct(breakEven) }}
                  />
                )}
                {!zero && (
                  <div
                    className={`absolute top-0 h-2 rounded-[2px] ${
                      step.kind === 'exit'
                        ? 'bg-border-strong'
                        : step.kind === 'ceiling'
                          ? 'bg-accent'
                          : step.killer
                            ? 'bg-danger'
                            : 'border border-border-strong bg-raised'
                    }`}
                    style={{
                      left: pct(step.kind === 'exit' ? 0 : left),
                      width: `max(2px, ${pct(width)})`,
                    }}
                  />
                )}
                {zero && <div className="absolute top-0 left-0 h-2 w-px bg-danger" />}
              </div>
              <span
                className={`type-spec text-right tabular-nums ${
                  zero
                    ? 'text-danger'
                    : step.kind === 'ceiling'
                      ? 'text-accent'
                      : step.kind === 'exit'
                        ? 'text-text'
                        : step.killer
                          ? 'text-text'
                          : 'text-dim'
                }`}
              >
                {step.kind === 'exit' || step.kind === 'ceiling'
                  ? dollars(step.amount)
                  : `−${dollars(step.amount)}`}
              </span>
            </div>
          );
        })}
      </div>
      <p className="type-meta">
        {breakEven > 0
          ? `break-even ${dollars(breakEven)} is the rule through the ladder · `
          : 'break-even $0 · '}
        margin {Math.round((1 - ledger.discipline.share) * 100)}% of the low exit · repairs at
        expected, rolled up per program
        {ledger.killers.length > 0 ? ' · red bars are what ate the ceiling' : ''}
      </p>
    </div>
  );
}
