'use client';

/* eslint-disable @next/next/no-img-element -- listing photos come from
   arbitrary hosts and data: URLs; next/image can optimize neither. */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useEffect, useState } from 'react';
import { getSeedListing, SEED_LISTINGS, type SeedListing } from '@/inspector/seed-listings';
import type { PhotoSource } from '@/inspector/types';
import type { RunSummary } from '@/runs/types';
import { dollars, hostOf } from '@/ui/inspect-format';
import { Filmstrip, Lightbox } from '@/ui/run/filmstrip';
import { clockFormat } from '@/ui/run/lines';

// Inspection setup: pick a real listing or bring your own car, then the run
// gets its own URL (/inspect/<id>) the moment it starts — refreshes and
// shared links land on the same run. Recent runs live here too.

type OwnPhoto = { source: PhotoSource; preview: string };

const MAX_PHOTOS = 8;
const MAX_EDGE = 1568; // vision-optimal long edge for uploads

export default function InspectorSetupPage(props: PageProps<'/inspect'>) {
  const sp = use(props.searchParams);
  const router = useRouter();
  // The showroom deep-links a listing (?seed=): arrive with it selected.
  const [seed, setSeed] = useState<SeedListing | null>(() =>
    typeof sp.seed === 'string' ? (getSeedListing(sp.seed) ?? null) : null,
  );
  const [ownPhotos, setOwnPhotos] = useState<OwnPhoto[]>([]);
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [vin, setVin] = useState('');
  const [price, setPrice] = useState('');
  const [urlDraft, setUrlDraft] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RunSummary[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/runs?kind=inspect&limit=8')
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

  // -- Own-photo intake -------------------------------------------------------

  async function addFiles(files: FileList | File[]) {
    const incoming = [...files].filter((f) => f.type.startsWith('image/'));
    for (const file of incoming) {
      if (ownPhotos.length + 1 > MAX_PHOTOS) break;
      const downscaled = await downscale(file);
      if (downscaled) setOwnPhotos((prev) => [...prev.slice(0, MAX_PHOTOS - 1), downscaled]);
      setSeed(null);
    }
  }

  function addUrlPhoto() {
    const url = urlDraft.trim();
    if (!/^https?:\/\//.test(url) || ownPhotos.length >= MAX_PHOTOS) return;
    setOwnPhotos((prev) => [...prev, { source: { kind: 'url', url }, preview: url }]);
    setUrlDraft('');
    setSeed(null);
  }

  // -- Start ------------------------------------------------------------------

  const canRun =
    !starting &&
    (seed !== null ||
      (ownPhotos.length > 0 && make.trim() && model.trim() && /^\d{4}$/.test(year)));

  async function run() {
    if (!canRun) return;
    setStarting(true);
    setStartError(null);
    const payload = seed
      ? { seedId: seed.id }
      : {
          photos: ownPhotos.map((p) => p.source),
          make: make.trim(),
          model: model.trim(),
          year: Number(year),
          vin: vin.trim() || undefined,
          askingPrice: price.trim() ? Number(price.replace(/[^0-9.]/g, '')) : undefined,
        };
    try {
      const res = await fetch('/api/inspect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!res.ok || !data?.id) {
        setStartError(data?.error ?? `inspection request failed (${res.status})`);
        setStarting(false);
        return;
      }
      router.push(`/inspect/${data.id}`);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err));
      setStarting(false);
    }
  }

  const photos = seed ? seed.photos : ownPhotos.map((p) => p.preview);

  return (
    <div>
      <div className="border-b border-border pb-4">
        <h1 className="type-display">Inspect</h1>
        <p className="type-body mt-1 text-dim">
          Pre-purchase inspection from the listing&apos;s own photos: vision findings, live web
          research, federal data, VIN provenance, and market position, every claim sourced.
        </p>
      </div>

      <div className="mt-6 flex flex-col gap-8">
        <section>
          <h2 className="type-label mb-1">Real listings</h2>
          <p className="type-meta mb-3">
            seeded from bring a trailer sold results · collected 2026-08-13 · photos are the actual
            auction photos
          </p>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SEED_LISTINGS.map((listing) => (
              <SeedCard
                key={listing.id}
                listing={listing}
                selected={seed?.id === listing.id}
                onSelect={() => {
                  setSeed(listing);
                  setOwnPhotos([]);
                }}
              />
            ))}
          </ul>
        </section>

        <section>
          <h2 className="type-label mb-3">Or bring your own car</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                void addFiles(e.dataTransfer.files);
              }}
              className={`flex min-h-[112px] flex-col items-center justify-center gap-2 rounded-[4px] border border-dashed p-4 transition-colors duration-[120ms] ease-out ${
                dragOver ? 'border-accent-dim bg-accent-wash' : 'border-border'
              }`}
            >
              <label className="type-body cursor-pointer text-dim">
                Drop photos or <span className="text-accent">click to choose</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) void addFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
              <div className="flex w-full max-w-[420px] gap-2">
                <input
                  type="url"
                  value={urlDraft}
                  onChange={(e) => setUrlDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addUrlPhoto();
                    }
                  }}
                  placeholder="or paste a photo URL"
                  className="h-10 min-w-0 flex-1 rounded-[2px] border border-border bg-surface px-3 font-mono text-[13px] outline-none transition-colors duration-[120ms] ease-out focus:border-accent-dim"
                />
                <button
                  type="button"
                  onClick={addUrlPhoto}
                  className="type-label shrink-0 text-accent transition-colors duration-[120ms] ease-out hover:text-text"
                >
                  add
                </button>
              </div>
              <p className="type-meta">up to {MAX_PHOTOS} photos · uploads stay in memory</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Make" value={make} onChange={setMake} placeholder="BMW" />
              <Field label="Model" value={model} onChange={setModel} placeholder="M3" />
              <Field label="Year" value={year} onChange={setYear} placeholder="2004" mono />
              <Field
                label="Asking price (optional)"
                value={price}
                onChange={setPrice}
                placeholder="30000"
                mono
              />
              <div className="col-span-2">
                <Field
                  label="VIN (optional: unlocks federal decode + provenance sweep)"
                  value={vin}
                  onChange={(v) => setVin(v.toUpperCase())}
                  placeholder="WBSBL93424PN58876"
                  mono
                />
              </div>
            </div>
          </div>

          {ownPhotos.length > 0 && (
            <div className="mt-4">
              <Filmstrip
                photos={ownPhotos.map((p) => ({ src: p.preview }))}
                active={[]}
                onOpen={setLightbox}
                onRemove={(i) => setOwnPhotos((prev) => prev.filter((_, j) => j !== i))}
                columns="grid-cols-4 sm:grid-cols-6"
              />
            </div>
          )}
        </section>

        {seed && (
          <section>
            <div className="flex items-baseline justify-between">
              <h2 className="type-label mb-3">
                {seed.title} · <span className="font-mono">{dollars(seed.price)}</span>
              </h2>
              <a
                href={seed.url}
                target="_blank"
                rel="noopener noreferrer"
                className="type-meta text-faint transition-colors duration-[120ms] ease-out hover:text-accent"
              >
                source: {hostOf(seed.url)}
              </a>
            </div>
            <Filmstrip
              photos={seed.photos.map((src) => ({ src }))}
              active={[]}
              onOpen={setLightbox}
              columns="grid-cols-4 sm:grid-cols-7"
            />
            <p className="type-body mt-3 text-dim">{seed.description}</p>
          </section>
        )}

        {startError && (
          <p className="type-body border-l-2 border-danger pl-3 text-danger">{startError}</p>
        )}

        <button
          onClick={() => void run()}
          disabled={!canRun}
          className="h-12 w-full rounded-[2px] border border-accent-dim font-mono text-[14px] text-accent transition-colors duration-[120ms] ease-out hover:border-accent hover:bg-accent-wash disabled:border-border disabled:text-faint disabled:hover:bg-transparent"
        >
          {starting
            ? 'starting…'
            : canRun
              ? `run inspection · ${photos.length} photo${photos.length === 1 ? '' : 's'}`
              : 'pick a listing or add photos + vehicle details'}
        </button>

        <RecentRuns runs={recent} />
      </div>

      {lightbox !== null && photos[lightbox] && (
        <Lightbox src={photos[lightbox]} index={lightbox} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}

// -- Pieces -------------------------------------------------------------------

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  mono?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="type-label">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className={`h-10 w-full min-w-0 rounded-[2px] border border-border bg-surface px-3 text-[13px] outline-none transition-colors duration-[120ms] ease-out focus:border-accent-dim ${
          mono ? 'font-mono' : ''
        }`}
      />
    </label>
  );
}

// DESIGN.md listing card: the photo carries the card.
function SeedCard({
  listing,
  selected,
  onSelect,
}: {
  listing: SeedListing;
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
          src={listing.photos[0]}
          alt={listing.title}
          loading="lazy"
          className="aspect-[4/3] w-full object-cover"
        />
        <div className="p-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="type-body min-w-0 truncate">{listing.title}</span>
            <span className="shrink-0 font-mono text-[16px] font-semibold">
              {dollars(listing.price)}
            </span>
          </div>
          <div className="type-meta mt-1 truncate">
            {listing.photos.length} photos · vin on file · sold {listing.soldOn}
          </div>
        </div>
      </button>
    </li>
  );
}

function RecentRuns({ runs }: { runs: RunSummary[] | null }) {
  if (runs === null || runs.length === 0) return null;
  return (
    <section>
      <h2 className="type-label mb-3">Recent inspections</h2>
      <ul className="flex flex-col">
        {runs.map((run) => (
          <li key={run.id} className="border-t border-border last:border-b">
            <Link
              href={`/inspect/${run.id}`}
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
                {' · '}
                {runClock(run)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function VerdictTag({ verdict }: { verdict?: string }) {
  if (!verdict) return <span>done</span>;
  const cls = verdict === 'pass' ? 'text-ok' : verdict === 'avoid' ? 'text-danger' : 'text-warn';
  return <span className={cls}>{verdict.toUpperCase()}</span>;
}

function runClock(run: RunSummary): string {
  const when = new Date(run.createdAt);
  const date = `${when.getMonth() + 1}/${when.getDate()}`;
  if (run.finishedAt) {
    const ms = Date.parse(run.finishedAt) - Date.parse(run.createdAt);
    return `${date} · ${clockFormat(ms)}`;
  }
  return date;
}

// Downscale an upload to the vision-optimal long edge and normalize to JPEG;
// keeps request sizes sane and strips EXIF along the way.
async function downscale(file: File): Promise<OwnPhoto | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const base64 = dataUrl.split(',')[1];
    if (!base64) return null;
    return {
      source: { kind: 'upload', mediaType: 'image/jpeg', data: base64 },
      preview: dataUrl,
    };
  } catch {
    return null;
  }
}
