'use client';

import type { LineEvidence, RepairPlan } from '@/salvage/types';
import { dollars, hostOf } from '../inspect-format';

// DESIGN.md program table: the build plan as programs, one block each, with
// the lines beneath — task, who, low / expected / high, evidence chip, and
// the reason for the split. Photo anchors on the program header.

export function EvidenceChip({ evidence }: { evidence: LineEvidence }) {
  return (
    <span
      className={`type-meta rounded-[2px] border px-1 font-mono ${
        evidence === 'cited' ? 'border-accent-dim text-text' : 'border-border'
      }`}
    >
      {evidence}
    </span>
  );
}

export function ProgramTable({
  plan,
  onAnchor,
}: {
  plan: RepairPlan;
  onAnchor: (indices: number[]) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {plan.programs.map((program) => {
        const expected = program.lines.reduce((s, l) => s + l.expected, 0);
        return (
          <div key={program.id} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border pb-1">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="type-label">{program.label}</span>
                {program.zones.length > 0 && (
                  <span className="type-meta">
                    {program.severity} · {program.zones.join(', ')}
                  </span>
                )}
                {program.photos.length > 0 && (
                  <button
                    onClick={() => onAnchor(program.photos)}
                    className="type-meta rounded-[2px] border border-border px-1.5 font-mono transition-colors duration-[120ms] ease-out hover:border-accent-dim hover:text-accent"
                  >
                    photo{program.photos.length === 1 ? '' : 's'} {program.photos.join(', ')}
                  </button>
                )}
              </div>
              <span className="font-mono text-[13px] tabular-nums">{dollars(expected)}</span>
            </div>
            <div className="flex flex-col gap-2">
              {program.lines.map((line) => (
                <div key={line.id} className="flex flex-col gap-0.5">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 sm:grid-cols-[minmax(0,1fr)_2.5rem_16rem_5rem]">
                    <span className="type-body min-w-0">{line.task}</span>
                    <span className="type-meta hidden sm:inline">
                      {line.who === 'diy' ? 'you' : 'pro'}
                    </span>
                    <span className="hidden font-mono text-[13px] tabular-nums sm:grid sm:grid-cols-3 sm:gap-x-2 sm:text-right">
                      <span className="text-dim">{dollars(line.low)}</span>
                      <span>{dollars(line.expected)}</span>
                      <span className="text-dim">{dollars(line.high)}</span>
                    </span>
                    <span className="flex justify-end sm:hidden">
                      <span className="font-mono text-[13px] tabular-nums">
                        {dollars(line.expected)}
                      </span>
                    </span>
                    <span className="hidden justify-end sm:flex">
                      <EvidenceChip evidence={line.evidence} />
                    </span>
                  </div>
                  <p className="type-meta">
                    {line.who === 'diy'
                      ? `you${line.diyHours ? ` · ≈${line.diyHours}h` : ''} · `
                      : ''}
                    {line.reason}
                    {line.evidence === 'cited' && line.citations?.length ? (
                      <>
                        {' · '}
                        {line.citations.slice(0, 3).map((c, i) => (
                          <a
                            key={c.url}
                            href={c.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-faint transition-colors duration-[120ms] ease-out hover:text-accent"
                          >
                            {i > 0 ? ' · ' : ''}
                            {hostOf(c.url)}
                          </a>
                        ))}
                      </>
                    ) : null}
                  </p>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <p className="type-meta">
        low / expected / high per line · {plan.tierLabel} · curated ranges are estimates, not
        quotes; cited lines carry their sources
      </p>
    </div>
  );
}
