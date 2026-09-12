import Link from 'next/link';
import type { Assumption } from '@/lib/types';
import { assumptionChip, queryWithout } from './format';

// Every inference the interpreter made, arguable: clicking a chip re-runs
// the query without the assumed token. The reason rides in the tooltip.
export function AssumptionChips({
  query,
  assumptions,
}: {
  query: string;
  assumptions: Assumption[];
}) {
  if (assumptions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {assumptions.map((a) => (
        <Link
          key={`${a.input}→${a.meaning}`}
          href={`/search?q=${encodeURIComponent(queryWithout(query, a.input))}`}
          title={a.reason}
          className="rounded-[2px] border border-warn px-2 py-1 font-mono text-[11px] leading-[14px] text-text transition-colors duration-[120ms] ease-out hover:bg-raised"
        >
          {assumptionChip(a)}
        </Link>
      ))}
    </div>
  );
}
