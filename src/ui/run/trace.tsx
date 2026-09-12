'use client';

import type { Span } from '@/trace/tracer';
import { stageDuration } from './lines';

// DESIGN.md trace waterfall: the run's spans on a shared time axis, mono
// throughout. The shape of the waterfall is the information — parallel work
// reads as overlap, the long pole is obvious, and attrs (token counts,
// photo counts) ride along in meta.

export function TraceWaterfall({ spans }: { spans: Span[] }) {
  if (spans.length === 0) {
    return <p className="type-body text-dim">No spans recorded for this run.</p>;
  }
  const sorted = [...spans].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const t0 = Date.parse(sorted[0].startedAt);
  const end = Math.max(...sorted.map((s) => Date.parse(s.startedAt) + s.ms));
  const total = Math.max(1, end - t0);

  // Round tick spacing: aim for 4-6 ticks at a round number of seconds.
  const rawStep = total / 5;
  const steps = [250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000];
  const step = steps.find((s) => s >= rawStep) ?? 120000;
  const ticks: number[] = [];
  for (let t = 0; t <= total; t += step) ticks.push(t);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[560px]">
        {/* Axis */}
        <div className="relative mb-1 ml-[220px] mr-[64px] h-4">
          {ticks.map((t) => (
            <span
              key={t}
              className="type-meta absolute top-0 -translate-x-1/2 font-mono"
              style={{ left: `${(t / total) * 100}%` }}
            >
              {t === 0 ? '0' : stageDuration(t)}
            </span>
          ))}
        </div>
        <div className="flex flex-col gap-[6px]">
          {sorted.map((span) => {
            const left = ((Date.parse(span.startedAt) - t0) / total) * 100;
            const width = Math.max(0.5, (span.ms / total) * 100);
            return (
              <div key={span.id} className="flex items-center gap-3">
                <span
                  className="w-[208px] shrink-0 truncate text-right font-mono text-[12px] text-dim"
                  title={span.name}
                >
                  {span.name}
                </span>
                <div className="relative h-2 flex-1">
                  <span
                    aria-hidden
                    className="absolute inset-y-1/2 left-0 right-0 h-px bg-border"
                  />
                  <span
                    className={`absolute top-0 h-2 rounded-[2px] ${
                      span.kind === 'stage'
                        ? 'border border-border-strong bg-raised'
                        : span.ok
                          ? 'border border-accent-dim'
                          : 'border border-danger'
                    }`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={`${span.name} · ${stageDuration(span.ms)}`}
                  />
                </div>
                <span className="w-[52px] shrink-0 text-right font-mono text-[11px] text-faint">
                  {stageDuration(span.ms)}
                </span>
              </div>
            );
          })}
        </div>
        {/* Attrs footnotes, only for spans that carry them */}
        <div className="mt-2 flex flex-col gap-0.5">
          {sorted
            .filter((s) => s.attrs && Object.keys(s.attrs).length > 0)
            .map((s) => (
              <p key={s.id} className="type-meta font-mono">
                {s.name}:{' '}
                {Object.entries(s.attrs!)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(' · ')}
              </p>
            ))}
        </div>
      </div>
    </div>
  );
}
