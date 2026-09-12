/**
 * Where a lot's data came from, in the one `meta` line every lot surface
 * shows: the source host as a link when the lot has a page of its own and the
 * source that stated it otherwise, then the day it was collected, because a lot
 * the buyer brought has no page to link (SPEC 61). A lot from the recorded
 * catalog carries the `recorded example` tag beside it (DESIGN.md).
 */
import type { SalvageLot } from '@/salvage/types';
import { lotProvenance, RECORDED_EXAMPLE } from './format';

// DESIGN.md evidence chip: 1px border, 2px radius, `meta` mono, never a fill.
const tagClass = 'type-meta shrink-0 rounded-[2px] border border-border px-1.5 font-mono';

export function RecordedExampleTag() {
  return <span className={tagClass}>{RECORDED_EXAMPLE}</span>;
}

export function LotProvenanceLine({
  lot,
}: {
  lot: Pick<SalvageLot, 'id' | 'source' | 'url' | 'collectedOn'>;
}) {
  const provenance = lotProvenance(lot);
  return (
    <p className="type-meta flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="break-all">
        lot data from{' '}
        {provenance.href ? (
          <a
            href={provenance.href}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors duration-[120ms] ease-out hover:text-accent"
          >
            {provenance.text}
          </a>
        ) : (
          provenance.text
        )}{' '}
        · collected {provenance.day}
      </span>
      {provenance.example && <RecordedExampleTag />}
    </p>
  );
}
