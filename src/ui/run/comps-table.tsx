'use client';

import type { CompUse } from '@/salvage/types';
import { dollars, hostOf } from '../inspect-format';

// DESIGN.md comps table: the cars behind the exit, one row per comp, used
// or struck with the reason. Mono throughout; beyond eight rows a lane
// collapses behind a count.

const LEAD = 8;

export function CompsTable({ label, comps }: { label: string; comps: CompUse[] }) {
  if (comps.length === 0) return null;
  const sorted = [...comps].sort(
    (a, b) => Number(b.used) - Number(a.used) || b.adjusted - a.adjusted,
  );
  const lead = sorted.slice(0, LEAD);
  const rest = sorted.slice(LEAD);
  return (
    <div className="flex flex-col gap-2">
      <div className="type-label">{label}</div>
      <div className="flex flex-col font-mono text-[12px]">
        {lead.map((c, i) => (
          <CompRow key={`${c.comp.url}-${i}`} use={c} />
        ))}
        {rest.length > 0 && (
          <details className="group">
            <summary className="type-meta cursor-pointer list-none py-1 [&::-webkit-details-marker]:hidden">
              {rest.length} more <span className="text-accent group-open:hidden">expand</span>
              <span className="hidden text-accent group-open:inline">collapse</span>
            </summary>
            {rest.map((c, i) => (
              <CompRow key={`${c.comp.url}-${LEAD + i}`} use={c} />
            ))}
          </details>
        )}
      </div>
    </div>
  );
}

function CompRow({ use }: { use: CompUse }) {
  const c = use.comp;
  const struck = !use.used;
  const haircut = use.used && use.adjusted !== c.price;
  return (
    <div
      className={`flex flex-col gap-0.5 border-b border-border py-1.5 ${struck ? 'text-faint' : ''}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className={`w-2 shrink-0 ${use.used ? 'text-accent' : ''}`}>
          {use.used ? '·' : ''}
        </span>
        <span className="type-label w-24 shrink-0 normal-case">
          {c.lane} {c.outcome.replace(/_/g, ' ')}
        </span>
        <span className={`w-24 shrink-0 text-right tabular-nums ${struck ? 'line-through' : ''}`}>
          {dollars(use.adjusted)}
        </span>
        {haircut && <span className="text-faint tabular-nums">({dollars(c.price)} ask)</span>}
        <span className="w-10 shrink-0 tabular-nums">{c.year ?? '–'}</span>
        <span className="w-16 shrink-0 tabular-nums">
          {c.mileage !== undefined ? `${c.mileage.toLocaleString('en-US')} mi` : '–'}
        </span>
        <span className="w-24 shrink-0 tabular-nums">{c.date ?? '–'}</span>
        <span className="w-14 shrink-0">{c.title ?? '–'}</span>
        <span className={`min-w-0 flex-1 truncate ${struck ? '' : 'text-dim'}`}>
          {[c.variant, c.damage, c.note].filter(Boolean).join(' · ')}
        </span>
        <a
          href={c.url}
          target="_blank"
          rel="noopener noreferrer"
          className="type-meta shrink-0 text-faint transition-colors duration-[120ms] ease-out hover:text-accent"
        >
          {hostOf(c.url)}
        </a>
      </div>
      {use.reason && (
        <p className="type-meta pl-5">
          {struck ? 'struck: ' : ''}
          {use.reason}
        </p>
      )}
    </div>
  );
}
