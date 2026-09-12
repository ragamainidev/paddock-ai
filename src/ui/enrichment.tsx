import Image from 'next/image';
import type { Listing } from '@/enrich/ebay';
import type { ComplaintRecord, RecallRecord } from '@/enrich/nhtsa';
import type { ComplaintTheme } from '@/enrich/themes';
import type { ResolvedVehicle } from '@/lib/types';
import { enrichVehicle } from '@/pipeline/enrich';
import { stageNote, yearRange } from './format';

const QUOTES_PER_THEME = 2;
const QUOTE_CHARS = 280;

// Per-vehicle enrichment: NHTSA complaints themed by Haiku, recalls, and
// live eBay listings. Each section renders from its own status; one dead
// source never blanks another's data.
export async function Enrichment({
  vehicle,
  trims,
  forwarded,
}: {
  vehicle: ResolvedVehicle;
  trims?: string[][];
  forwarded: string[];
}) {
  const e = await enrichVehicle(
    {
      make: vehicle.make,
      model: vehicle.model,
      yearMin: vehicle.yearMin,
      yearMax: vehicle.yearMax,
      trims,
    },
    forwarded,
  );
  const [nhtsaStatus, themesStatus, ebayStatus] = e.statuses;

  return (
    <div>
      <h2 className="type-h1">
        {vehicle.make} {vehicle.model}{' '}
        <span className="font-mono text-[16px] font-normal text-dim">
          {yearRange(vehicle.yearMin, vehicle.yearMax)}
        </span>
      </h2>

      <div className="mt-4 grid grid-cols-1 gap-y-6 md:grid-cols-2 md:gap-y-8">
        <div className="flex flex-col gap-6 md:border-r md:border-border md:pr-6">
          <section className="flex flex-col gap-3">
            <h3 className="type-h2">Known issues</h3>
            {nhtsaStatus.ok && <NhtsaProvenance detail={nhtsaStatus.detail} />}
            {!nhtsaStatus.ok && <p className="type-meta">{stageNote(nhtsaStatus)}</p>}
            {!themesStatus.ok && <p className="type-meta">{stageNote(themesStatus)}</p>}
            {e.themes.length === 0 && nhtsaStatus.ok && (
              <p className="type-body text-dim">No owner complaints on file.</p>
            )}
            {e.themes.map((t) => (
              <Theme key={t.component} theme={t} complaints={e.nhtsa.complaints} />
            ))}
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="type-h2">Recalls</h3>
            {nhtsaStatus.ok && e.nhtsa.recalls.length === 0 && (
              <p className="type-body text-dim">No recalls on file.</p>
            )}
            {!nhtsaStatus.ok && <p className="type-meta">{stageNote(nhtsaStatus)}</p>}
            {e.nhtsa.recalls.map((r) => (
              <Recall key={r.campaign} recall={r} />
            ))}
          </section>
        </div>

        <section className="flex flex-col gap-3 md:pl-6">
          <h3 className="type-h2">Live listings</h3>
          {e.listings.query && <p className="type-meta">ebay: {e.listings.query}</p>}
          {!ebayStatus.ok && <p className="type-meta">{stageNote(ebayStatus)}</p>}
          {ebayStatus.ok && e.listings.listings.length === 0 && (
            <p className="type-body text-dim">No live listings right now.</p>
          )}
          <ul className="flex flex-col gap-2">
            {e.listings.listings.map((l) => (
              <ListingRow key={l.id} listing={l} />
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

// The NHTSA status detail lists every federal model name that was queried —
// useful provenance, unreadable as a wall. The counts stay on one line; the
// name list collapses behind a disclosure.
function NhtsaProvenance({ detail }: { detail?: string }) {
  if (!detail) return null;
  const at = detail.toLowerCase().indexOf(' via ');
  if (at === -1) return <p className="type-meta">{detail}</p>;
  const head = detail.slice(0, at);
  const names = detail
    .slice(at + 5)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <details className="group">
      <summary className="type-meta cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        {head} · via {names.length} NHTSA model name{names.length === 1 ? '' : 's'}{' '}
        <span className="text-accent group-open:hidden">expand</span>
      </summary>
      <p className="type-meta mt-1 max-w-[68ch] normal-case">{names.join(' · ')}</p>
    </details>
  );
}

// A theme is a count plus the model's title, expandable to representative
// owner quotes in mono, since the source text is verbatim owner writing.
function Theme({ theme, complaints }: { theme: ComplaintTheme; complaints: ComplaintRecord[] }) {
  const quotes = complaints
    .filter((c) => c.components.includes(theme.component))
    .slice(0, QUOTES_PER_THEME)
    .map((c) => truncate(c.summary, QUOTE_CHARS));
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-baseline gap-3 [&::-webkit-details-marker]:hidden">
        <span className="type-spec shrink-0 text-dim">{theme.count}×</span>
        <span className="type-body max-w-[68ch]">
          {theme.title}
          {/* The description is essential reading, not metadata — it stays
              at the 4.5:1 tier, never faint. */}
          <span className="text-dim"> {theme.detail}</span>
        </span>
      </summary>
      {quotes.length > 0 && (
        <div className="mt-2 flex flex-col gap-2 border-l border-border pl-3">
          {quotes.map((q) => (
            <blockquote
              key={q.slice(0, 40)}
              className="font-mono text-[12px] leading-[18px] text-dim"
            >
              {q}
            </blockquote>
          ))}
        </div>
      )}
    </details>
  );
}

function Recall({ recall }: { recall: RecallRecord }) {
  return (
    <div className="border-l-2 border-danger pl-3">
      <div className="type-label">{recall.component}</div>
      <p className="type-body mt-1">{recall.summary}</p>
      <div className="type-meta mt-1 font-mono">{recall.campaign}</div>
    </div>
  );
}

// DESIGN.md listing row: 72px tall, 64px thumbnail at 2px radius, one-line
// title, price right-aligned mono. The whole row is the link.
function ListingRow({ listing }: { listing: Listing }) {
  const meta = [listing.condition, listing.location].filter(Boolean).join(' · ');
  return (
    <li>
      <a
        href={listing.url}
        target="_blank"
        rel="noopener noreferrer"
        data-nav
        className="flex h-[72px] items-center gap-3 rounded-[2px] border border-border bg-surface px-2 transition-colors duration-[120ms] ease-out hover:border-border-strong hover:bg-raised"
      >
        {listing.image ? (
          <Image
            src={listing.image}
            alt=""
            width={64}
            height={64}
            className="h-16 w-16 shrink-0 rounded-[2px] border border-border object-cover"
          />
        ) : (
          <div className="h-16 w-16 shrink-0 rounded-[2px] border border-border bg-raised" />
        )}
        <div className="min-w-0 flex-1">
          <div className="type-body truncate">{listing.title}</div>
          {meta && <div className="type-meta mt-1 truncate">{meta}</div>}
        </div>
        <div className="shrink-0 font-mono text-[16px] font-semibold">{listing.price}</div>
      </a>
    </li>
  );
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max).trimEnd()}…`;
}
