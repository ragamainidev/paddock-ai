/* eslint-disable @next/next/no-img-element -- listing and lot photos come
   from BaT and the Copart CDN; next/image can optimize neither. */

import Link from 'next/link';
import { connection } from 'next/server';
import { SEED_LISTINGS } from '@/inspector/seed-listings';
import { SALVAGE_LOTS } from '@/salvage/seed-lots';
import { getRun } from '@/runs/manager';
import { resolveRunStore } from '@/runs/resolve-store';
import type { RunSummary } from '@/runs/types';
import { dollars, hostOf } from '@/ui/inspect-format';
import { RecordedExampleTag } from '@/ui/assessments/lot-provenance';

// The showroom (DESIGN.md): the one photography-led surface. Real cars
// carry the page — sold listings ready to inspect, live salvage lots ready
// to assess — and the interface recedes to labels, prices, and one search
// affordance. No hero copy; the cars are the copy.

export default async function ShowroomPage() {
  // Recent verdicts are per-request run data; without this the page is
  // prerendered at build time and the list freezes at whatever the build saw.
  await connection();

  const featured = SALVAGE_LOTS.find((l) => l.id === 'sf90-front-il') ?? SALVAGE_LOTS[0];
  const lots = SALVAGE_LOTS.filter((l) => l.id !== featured.id);

  let recent: RunSummary[] = [];
  try {
    const store = await resolveRunStore();
    recent = (await store.listRuns({ limit: 5 })).filter((r) => r.status !== 'running');
  } catch {
    // No database, no recents — the showroom stands on its own.
  }
  void getRun; // manager import keeps hot-reload singletons wired in dev

  return (
    <div className="flex flex-col gap-12 pb-8">
      {/* Search affordance: the field at rest, linking to /search. */}
      <Link
        href="/search"
        className="flex h-14 w-full items-center rounded-[4px] border border-border bg-surface px-4 font-mono text-[14px] text-faint transition-colors duration-[120ms] ease-out hover:border-accent-dim"
      >
        search: e46 m3 · 996 turbo · gen 3 mustang · 991 gt3rs…
      </Link>

      {/* Featured car: full-width, caption under the image, never over it. */}
      <section>
        <Link href={`/salvage?lot=${featured.id}`} className="group block">
          <div className="overflow-hidden rounded-[4px] border border-border transition-colors duration-[120ms] ease-out group-hover:border-border-strong">
            <img
              src={featured.photos[0]}
              alt={featured.title}
              className="aspect-[21/9] w-full object-cover"
            />
          </div>
          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h1 className="type-h1">
              {featured.year} {featured.make} {featured.model}
            </h1>
            <span className="font-mono text-[16px] font-semibold text-accent">
              assess this build →
            </span>
          </div>
          <p className="type-meta mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono">
            <span>
              {featured.damage.primary.toLowerCase()} ·{' '}
              {featured.odometer
                ? `${featured.odometer.toLocaleString('en-US')} mi`
                : 'odometer unknown'}{' '}
              · {featured.location.toLowerCase()} ·{' '}
              {featured.currentBid ? `bid ${dollars(featured.currentBid)}` : 'future sale'} ·{' '}
              {/* A lot the user brought states its own source instead of a host (SPEC 61). */}
              {featured.url ? `copart via ${hostOf(featured.url)}` : featured.source.toLowerCase()}
            </span>
            {/* A catalog lot is a lot we recorded, not a lot on offer here. */}
            <RecordedExampleTag />
          </p>
        </Link>
        {/* The way out of the examples: the same flow on a lot of your own,
            with this one's VIN carried over and nothing else prefilled. */}
        <Link
          href={`/assessments?vin=${encodeURIComponent(featured.vin)}`}
          className="type-meta mt-2 inline-block font-mono text-accent transition-colors duration-[120ms] ease-out hover:text-text"
        >
          assess a lot like this →
        </Link>
      </section>

      {/* Sold listings → inspections. */}
      <section>
        <div className="flex items-baseline justify-between border-b border-border pb-3">
          <h2 className="type-h2">The showroom</h2>
          <span className="type-meta">
            real bring a trailer sold results · pick one, the inspector takes it from there
          </span>
        </div>
        <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SEED_LISTINGS.map((listing) => (
            <li key={listing.id}>
              <Link href={`/inspect?seed=${listing.id}`} className="group block">
                <div className="overflow-hidden rounded-[4px] border border-border transition-colors duration-[120ms] ease-out group-hover:border-border-strong">
                  <img
                    src={listing.photos[0]}
                    alt={listing.title}
                    loading="lazy"
                    className="aspect-[4/3] w-full object-cover"
                  />
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-3">
                  <span className="type-body min-w-0 truncate">{listing.title}</span>
                  <span className="shrink-0 font-mono text-[16px] font-semibold">
                    {dollars(listing.price)}
                  </span>
                </div>
                <div className="type-meta mt-0.5">sold {listing.soldOn} · inspect →</div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Salvage lots → build assessments. */}
      <section>
        <div className="flex items-baseline justify-between border-b border-border pb-3">
          <h2 className="type-h2">The salvage yard</h2>
          <span className="type-meta">
            live copart lots · damage triage, build plan, break-even math
          </span>
        </div>
        <ul className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {lots.map((lot) => (
            <li key={lot.id}>
              <Link href={`/salvage?lot=${lot.id}`} className="group block">
                <div className="overflow-hidden rounded-[4px] border border-border transition-colors duration-[120ms] ease-out group-hover:border-border-strong">
                  <img
                    src={lot.photos[0]}
                    alt={lot.title}
                    loading="lazy"
                    className="aspect-[4/3] w-full object-cover"
                  />
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-3">
                  <span className="type-body min-w-0 truncate">
                    {lot.year} {lot.make} {lot.model}
                  </span>
                  <span className="shrink-0 font-mono text-[14px] font-semibold">
                    {lot.currentBid ? dollars(lot.currentBid) : '–'}
                  </span>
                </div>
                <div className="type-meta mt-0.5 truncate">
                  {lot.damage.primary.toLowerCase()}
                  {/non-repairable/i.test(lot.titleBrand) ? (
                    <span className="text-danger"> · non-repairable</span>
                  ) : null}{' '}
                  · assess →
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {recent.length > 0 && (
        <section>
          <div className="border-b border-border pb-3">
            <h2 className="type-h2">Recent verdicts</h2>
          </div>
          <ul className="mt-2 flex flex-col">
            {recent.map((run) => (
              <li key={run.id} className="border-b border-border">
                <Link
                  href={`/${run.kind === 'salvage' ? 'salvage' : 'inspect'}/${run.id}`}
                  className="flex items-baseline justify-between gap-4 py-2.5 transition-colors duration-[120ms] ease-out hover:bg-surface"
                >
                  <span className="type-body min-w-0 truncate">{run.title}</span>
                  <span className="type-meta shrink-0 font-mono">
                    {run.status === 'error' ? (
                      <span className="text-danger">failed</span>
                    ) : (
                      <VerdictTag verdict={run.verdict} />
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="type-meta">
        every car above is real: bat sold results and copart lots, vins federally decoded, photos
        from the source listings · collected 2026-08-13
      </p>
    </div>
  );
}

function VerdictTag({ verdict }: { verdict?: string }) {
  if (!verdict) return <span>done</span>;
  const cls =
    verdict === 'pass' || verdict === 'build'
      ? 'text-ok'
      : verdict === 'avoid' || verdict === 'walk'
        ? 'text-danger'
        : 'text-warn';
  return <span className={cls}>{verdict.toUpperCase()}</span>;
}
