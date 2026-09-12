'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RunRecord, StoredEvent } from '@/runs/types';
import { Console } from './console';
import { Filmstrip, Lightbox, type FilmstripPhoto } from './filmstrip';
import { clockFormat, emptyProjection, reduceRun, type RunProjection } from './lines';
import { ReportView } from './report';
import { SalvageReportView } from './salvage-report';
import { StageRail } from './stage-rail';
import { TraceWaterfall } from './trace';
import { useNowTicker } from './use-now';

// The run page: attach to a run by id and render it — live, finished, or
// revisited weeks later. The stream replays persisted events then tails;
// losing the connection (or refreshing mid-run) costs nothing because the
// run executes server-side and this component just re-attaches from the
// last sequence number it saw.

type Phase = 'connecting' | 'running' | 'done' | 'error' | 'missing';

type StoredPhoto = { kind: 'url'; url: string } | { kind: 'upload' };

export function RunView({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunRecord | null>(null);
  const [phase, setPhase] = useState<Phase>('connecting');
  const [projection, setProjection] = useState<RunProjection>(emptyProjection);
  const [choreograph, setChoreograph] = useState(false);
  const [activePhotos, setActivePhotos] = useState<number[]>([]);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);
  const filmstripRef = useRef<HTMLDivElement>(null);

  // -- Attach: load the record, then stream from the last seen seq. -----------
  useEffect(() => {
    let alive = true;
    let lastSeq = 0;
    const wasLiveRef = { current: false };

    async function loadRecord(): Promise<RunRecord | null> {
      const res = await fetch(`/api/runs/${runId}`);
      if (res.status === 404) return null;
      const data = (await res.json()) as { run: RunRecord };
      return data.run;
    }

    async function streamOnce(): Promise<'ended' | 'aborted'> {
      const res = await fetch(`/api/runs/${runId}/stream?from=${lastSeq + 1}`);
      if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (!alive) return 'aborted';
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          if (!part.trim()) continue;
          const stored = JSON.parse(part) as StoredEvent;
          lastSeq = Math.max(lastSeq, stored.seq);
          setProjection((prev) => reduceRun(prev, stored));
          // Terminal events flip the page the moment they arrive; the
          // choreography runs only when the finish happened in view.
          const type = (stored.event as { type?: string }).type;
          if (type === 'report') {
            setPhase('done');
            if (wasLiveRef.current) setChoreograph(true);
          } else if (type === 'fatal') {
            setPhase('error');
          }
        }
      }
      return 'ended';
    }

    (async () => {
      const record = await loadRecord().catch(() => null);
      if (!alive) return;
      if (!record) {
        setPhase('missing');
        return;
      }
      setRun(record);
      if (record.status === 'running') {
        setPhase('running');
        wasLiveRef.current = true;
      }

      // Stream with reconnect: a dropped connection mid-run re-attaches
      // from the cursor; repeated failures degrade to the record's state.
      for (let attempt = 0; ; attempt++) {
        try {
          const outcome = await streamOnce();
          if (outcome === 'aborted' || !alive) return;
          // Stream ended: the run is over (or the server restarted).
          const finalRecord = await loadRecord().catch(() => null);
          if (!alive) return;
          if (finalRecord) setRun(finalRecord);
          if (finalRecord?.status === 'running' && attempt < 30) {
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }
          setPhase(finalRecord?.status === 'error' ? 'error' : 'done');
          if (wasLiveRef.current && finalRecord?.status === 'done') setChoreograph(true);
          return;
        } catch {
          if (!alive) return;
          if (attempt >= 5) {
            setPhase('error');
            return;
          }
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [runId]);

  // The cursor line's clock starts when the stage ACTUALLY began (the rail's
  // envelope timestamp), not when this page happened to load — a refresh
  // mid-stage must not reset the timer.
  const activeRail = projection.rail.find((r) => r.state === 'active');
  const beginMs = activeRail?.beginAt ? Date.parse(activeRail.beginAt) : NaN;
  const activeSince = Number.isFinite(beginMs) ? beginMs : undefined;

  const onAnchor = useCallback((indices: number[]) => {
    setActivePhotos(indices);
    filmstripRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);

  if (phase === 'missing') {
    return (
      <div>
        <p className="type-body text-dim">
          No run with that id. It may predate the database, or the server restarted with persistence
          unavailable.
        </p>
        <Link href="/inspect" className="type-label mt-3 inline-block text-accent">
          ← new inspection
        </Link>
      </div>
    );
  }

  const photos: FilmstripPhoto[] = (
    (run?.input as { photos?: StoredPhoto[] } | undefined)?.photos ?? []
  ).map((p) => (p.kind === 'url' ? { src: p.url } : { placeholder: true as const }));

  const report = projection.report ?? projection.salvageReport;
  const running = phase === 'running' || phase === 'connecting';
  const fatal = projection.fatal ?? (phase === 'error' ? (run?.error ?? 'run failed') : undefined);
  // A user-supplied lot carries no listing page, so the address is optional
  // and only the source is certain (SPEC 61).
  const listing = (run?.input as { listing?: { url?: string; source: string } } | undefined)
    ?.listing;

  return (
    <div className="flex flex-col gap-4">
      <RunHeader
        run={run}
        projection={projection}
        running={running}
        listing={listing}
        onTrace={() => {
          setTraceOpen(true);
          document.getElementById('trace')?.scrollIntoView({ behavior: 'smooth' });
        }}
      />

      {fatal && <p className="type-body border-l-2 border-danger pl-3 text-danger">{fatal}</p>}

      {running || !report ? (
        // Live layout: rail | console | evidence.
        <div className="flex flex-col gap-6 lg:flex-row">
          <StageRail stages={projection.rail} running={running} />
          <div className="min-w-0 flex-1">
            <Console
              lines={projection.lines}
              running={running}
              activeStage={projection.activeStage}
              activeSince={activeSince}
              finished={false}
            />
          </div>
          {photos.length > 0 && (
            <div ref={filmstripRef} className="lg:w-[280px] lg:shrink-0">
              <h2 className="type-label mb-2">Photos</h2>
              <Filmstrip
                photos={photos}
                active={activePhotos}
                onOpen={setLightbox}
                columns="grid-cols-4 lg:grid-cols-2"
              />
            </div>
          )}
        </div>
      ) : (
        // Finished layout: report + evidence column; console collapses to
        // its summary bar; the choreography runs once, on live completion.
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex flex-col gap-6">
            {projection.salvageReport ? (
              <SalvageReportView
                report={projection.salvageReport}
                choreograph={choreograph}
                onAnchor={onAnchor}
              />
            ) : (
              <ReportView
                report={projection.report!}
                choreograph={choreograph}
                onAnchor={onAnchor}
              />
            )}
            <Console
              lines={projection.lines}
              running={false}
              totalMs={
                projection.firstAt && projection.lastAt
                  ? Date.parse(projection.lastAt) - Date.parse(projection.firstAt)
                  : undefined
              }
              finished
            />
            <details
              id="trace"
              open={traceOpen}
              onToggle={(e) => setTraceOpen((e.target as HTMLDetailsElement).open)}
              className="group"
            >
              <summary className="type-label cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                Trace <span className="text-faint">({projection.spans.length} spans) · expand</span>
              </summary>
              <div className="mt-3">
                <TraceWaterfall spans={projection.spans} />
              </div>
            </details>
          </div>
          <aside ref={filmstripRef} className="lg:sticky lg:top-4 lg:self-start">
            {photos.length > 0 && (
              <>
                <h2 className="type-label mb-2">Evidence</h2>
                <Filmstrip
                  photos={photos}
                  active={activePhotos}
                  onOpen={setLightbox}
                  columns="grid-cols-4 lg:grid-cols-2"
                />
              </>
            )}
            {listing &&
              (listing.url ? (
                <a
                  href={listing.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="type-meta mt-3 inline-block font-mono text-faint transition-colors duration-[120ms] ease-out hover:text-accent"
                >
                  source listing: {listing.source}
                </a>
              ) : (
                <span className="type-meta mt-3 inline-block font-mono text-faint">
                  source listing: {listing.source}
                </span>
              ))}
          </aside>
        </div>
      )}

      {lightbox !== null && photos[lightbox] && 'src' in photos[lightbox] && (
        <Lightbox
          src={(photos[lightbox] as { src: string }).src}
          index={lightbox}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

function RunHeader({
  run,
  projection,
  running,
  listing,
  onTrace,
}: {
  run: RunRecord | null;
  projection: RunProjection;
  running: boolean;
  listing?: { url?: string; source: string };
  onTrace: () => void;
}) {
  const now = useNowTicker(running);

  const elapsed = (() => {
    if (!projection.firstAt) return undefined;
    const start = Date.parse(projection.firstAt);
    const end = running
      ? (now ?? start)
      : projection.lastAt
        ? Date.parse(projection.lastAt)
        : start;
    return clockFormat(Math.max(0, end - start));
  })();

  return (
    <div className="flex flex-col gap-1 border-b border-border pb-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="type-h1 min-w-0">{run?.title ?? 'Inspection'}</h1>
        <Link
          href="/inspect"
          className="type-label shrink-0 text-accent transition-colors duration-[120ms] ease-out hover:text-text"
        >
          ← new inspection
        </Link>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="type-meta font-mono">
          {running ? 'running' : (run?.status ?? '')}
          {elapsed ? ` · ${elapsed}` : ''}
        </span>
        {listing &&
          (listing.url ? (
            <a
              href={listing.url}
              target="_blank"
              rel="noopener noreferrer"
              className="type-meta font-mono text-faint transition-colors duration-[120ms] ease-out hover:text-accent"
            >
              {listing.source}
            </a>
          ) : (
            <span className="type-meta font-mono text-faint">{listing.source}</span>
          ))}
        {projection.meta && !projection.meta.persisted && (
          <span className="type-meta text-warn">runs are not persisted: database unreachable</span>
        )}
        {projection.spans.length > 0 && !running && (
          <button onClick={onTrace} className="type-meta ml-auto text-accent">
            view trace
          </button>
        )}
      </div>
    </div>
  );
}
