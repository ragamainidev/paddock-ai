'use client';

/* eslint-disable @next/next/no-img-element -- lot photos come from the
   Copart CDN; next/image cannot optimize them. */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useEffect, useState } from 'react';
import { getSalvageLot, SALVAGE_LOTS } from '@/salvage/seed-lots';
import type { SalvageLot } from '@/salvage/types';
import type { RunSummary } from '@/runs/types';
import { dollars } from '@/ui/inspect-format';
import { LotProvenanceLine, RecordedExampleTag } from '@/ui/assessments/lot-provenance';
import { clockFormat } from '@/ui/run/lines';

// Salvage rebuild assessment: pick a real Copart lot, get damage triage,
// a DIY-vs-professional build plan, cited parts and resale research, and a
// ledger from winning bid to break-even. Every lot below is a real auction,
// VIN federally decoded on the collection date.

export default function SalvagePage(props: PageProps<'/salvage'>) {
  const sp = use(props.searchParams);
  const router = useRouter();
  // The showroom deep-links a lot (?lot=): arrive with it selected.
  const [selected, setSelected] = useState<SalvageLot | null>(() =>
    typeof sp.lot === 'string' ? (getSalvageLot(sp.lot) ?? null) : null,
  );
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RunSummary[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/runs?kind=salvage&limit=8')
      .then((res) => res.json())
      .then((data: { runs: RunSummary[] }) => {
        if (alive) setRecent(data.runs);
      })
      .catch(() => {
        if (alive) setRecent([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function run() {
    if (!selected || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch('/api/salvage', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lotId: selected.id }),
      });
      const data = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!res.ok || !data?.id) {
        setStartError(data?.error ?? `request failed (${res.status})`);
        setStarting(false);
        return;
      }
      router.push(`/salvage/${data.id}`);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err));
      setStarting(false);
    }
  }

  return (
    <div>
      <div className="border-b border-border pb-4">
        <h1 className="type-display">Salvage</h1>
        <p className="type-body mt-1 text-dim">
          Wrecked exotics, honestly assessed: what&apos;s actually broken, what you can rebuild
          yourself versus what the factory jig owns, and the ledger from winning bid to break-even:
          parts prices and resale values cited, fees from the published schedule.
        </p>
      </div>

      <div className="mt-6 flex flex-col gap-8">
        <section>
          {/* The catalog is what the product recorded, not a feed it sells
              from: every lot here is an example you can run (SPEC 61). */}
          <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="type-label">Real lots</h2>
            <RecordedExampleTag />
          </div>
          <p className="type-meta mb-3">
            live copart auctions via a licensed broker · collected 2026-08-13 · every vin decoded
            against the federal database · bids move daily
          </p>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SALVAGE_LOTS.map((lot) => (
              <LotCard
                key={lot.id}
                lot={lot}
                selected={selected?.id === lot.id}
                onSelect={() => setSelected(lot)}
              />
            ))}
          </ul>
        </section>

        {selected && (
          <section>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-4">
              <h2 className="type-label">{selected.title}</h2>
              {/* A lot with no listing page states its source and the day it
                  was collected instead of a link (SPEC 61). */}
              <LotProvenanceLine lot={selected} />
            </div>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
              {selected.photos.map((src, i) => (
                <div key={src} className="relative">
                  <img
                    src={src}
                    alt={`photo ${i}`}
                    loading="lazy"
                    className="aspect-square w-full rounded-[2px] border border-border object-cover"
                  />
                  <span className="type-meta absolute left-1 top-1 rounded-[2px] bg-bg px-1 font-mono">
                    {i}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-1 sm:grid-cols-4">
              <Spec label="damage" value={selected.damage.primary.toLowerCase()} />
              <Spec label="title" value={selected.titleBrand} />
              <Spec
                label="odometer"
                value={
                  selected.odometer !== undefined
                    ? `${selected.odometer.toLocaleString('en-US')} mi`
                    : (selected.odometerNote ?? 'unknown')
                }
              />
              <Spec label="location" value={selected.location} />
              <Spec label="engine" value={selected.engine} />
              <Spec label="vin" value={selected.vin} mono />
              <Spec
                label="current bid"
                value={
                  selected.currentBid
                    ? `${dollars(selected.currentBid)} (at collection)`
                    : 'none yet'
                }
              />
              <Spec label="sale" value={selected.saleDate ?? 'future sale'} />
            </div>
            {selected.notes && <p className="type-body mt-3 text-dim">{selected.notes}</p>}
          </section>
        )}

        {startError && (
          <p className="type-body border-l-2 border-danger pl-3 text-danger">{startError}</p>
        )}

        <button
          onClick={() => void run()}
          disabled={!selected || starting}
          className="h-12 w-full rounded-[2px] border border-accent-dim font-mono text-[14px] text-accent transition-colors duration-[120ms] ease-out hover:border-accent hover:bg-accent-wash disabled:border-border disabled:text-faint disabled:hover:bg-transparent"
        >
          {starting
            ? 'starting…'
            : selected
              ? recent?.some((r) => r.status === 'running' && r.title === selected.title)
                ? `view the live assessment · ${selected.title}`
                : `assess this build · ${selected.title}`
              : 'pick a lot'}
        </button>

        {recent !== null && recent.length > 0 && (
          <section>
            <h2 className="type-label mb-3">Recent assessments</h2>
            <ul className="flex flex-col">
              {recent.map((run) => (
                <li key={run.id} className="border-t border-border last:border-b">
                  <Link
                    href={`/salvage/${run.id}`}
                    className="flex items-baseline justify-between gap-4 py-2.5 transition-colors duration-[120ms] ease-out hover:bg-surface"
                  >
                    <span className="type-body min-w-0 truncate">{run.title}</span>
                    <span className="type-meta shrink-0 font-mono">
                      {run.status === 'running' ? (
                        <span className="text-accent">running</span>
                      ) : run.status === 'error' ? (
                        <span className="text-danger">failed</span>
                      ) : (
                        <VerdictTag verdict={run.verdict} />
                      )}
                      {run.finishedAt
                        ? ` · ${clockFormat(Date.parse(run.finishedAt) - Date.parse(run.createdAt))}`
                        : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function Spec({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="type-meta">{label}</div>
      <div className={`truncate text-[13px] ${mono ? 'font-mono' : ''}`} title={value}>
        {value}
      </div>
    </div>
  );
}

function VerdictTag({ verdict }: { verdict?: string }) {
  if (!verdict) return <span>done</span>;
  const cls =
    verdict === 'build' || verdict === 'part_out'
      ? 'text-ok'
      : verdict === 'walk'
        ? 'text-danger'
        : 'text-warn';
  const label =
    verdict === 'build'
      ? 'BID'
      : verdict === 'walk'
        ? 'NO BID'
        : verdict.replace('_', ' ').toUpperCase();
  return <span className={cls}>{label}</span>;
}

// DESIGN.md listing card grammar, salvage flavor: the photo carries the
// card; damage and title brand are the footer facts that matter.
function LotCard({
  lot,
  selected,
  onSelect,
}: {
  lot: SalvageLot;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        onClick={onSelect}
        className={`block w-full overflow-hidden rounded-[4px] border bg-surface text-left transition-colors duration-[120ms] ease-out ${
          selected ? 'border-accent-dim' : 'border-border hover:border-border-strong'
        }`}
      >
        <img
          src={lot.photos[0]}
          alt={lot.title}
          loading="lazy"
          className="aspect-[4/3] w-full object-cover"
        />
        <div className="p-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="type-body min-w-0 truncate">
              {lot.year} {lot.make} {lot.model}
            </span>
            <span className="shrink-0 font-mono text-[16px] font-semibold">
              {lot.currentBid ? dollars(lot.currentBid) : '–'}
            </span>
          </div>
          <div className="type-meta mt-1 truncate">
            {lot.damage.primary.toLowerCase()} ·{' '}
            {/non-repairable/i.test(lot.titleBrand) ? (
              <span className="text-danger">non-repairable title</span>
            ) : (
              lot.titleBrand.replace(' on public listing', '')
            )}{' '}
            · {lot.location.toLowerCase()}
          </div>
        </div>
      </button>
    </li>
  );
}
