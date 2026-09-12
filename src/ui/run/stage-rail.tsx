'use client';

import { stageDuration, type RailStage } from './lines';
import { useNowTicker } from './use-now';

// DESIGN.md stage rail: the run's spine. Exactly one dot is amber while the
// run is live; settled stages show their true (envelope-timestamp) duration;
// degraded rows keep their reason. Compresses to a dot row on narrow screens.

function Dot({ state }: { state: RailStage['state'] }) {
  const cls = {
    pending: 'border border-border bg-transparent',
    active: 'bg-accent',
    ok: 'bg-border-strong',
    degraded: 'bg-warn',
  }[state];
  return <span className={`block h-2 w-2 shrink-0 rounded-full ${cls}`} />;
}

// Active rows render whole seconds: the clock ticks once a second, and
// tenths that step by 1.0s read as a broken timer. Settled rows keep
// stageDuration's tenths, where the precision is a real measurement.
function ActiveElapsed({ beginAt }: { beginAt?: string }) {
  const now = useNowTicker(true);
  if (!beginAt || now === null) return null;
  const ms = now - Date.parse(beginAt);
  if (ms < 900) return null;
  const label = ms < 60_000 ? `${Math.floor(ms / 1000)}s` : stageDuration(ms);
  return <span className="type-meta font-mono">{label}</span>;
}

export function StageRail({ stages, running }: { stages: RailStage[]; running: boolean }) {
  if (stages.length === 0) return null;
  return (
    <nav aria-label="inspection stages" className="lg:w-[180px] lg:shrink-0">
      {/* Narrow: one row of dots. */}
      <ol className="flex items-center gap-3 lg:hidden" aria-hidden>
        {stages.map((s) => (
          <li key={s.stage} className="flex items-center gap-1.5">
            <Dot state={s.state} />
            {s.state === 'active' && <span className="type-meta">{s.label}</span>}
          </li>
        ))}
      </ol>
      {/* Wide: the spine. */}
      <ol className="relative hidden flex-col lg:flex">
        <span aria-hidden className="absolute bottom-2 left-[3.5px] top-2 w-px bg-border" />
        {stages.map((s) => (
          <li key={s.stage} className="relative py-1.5 pl-5">
            <span className="absolute left-0 top-[9px]">
              <Dot state={s.state} />
            </span>
            <div className="flex items-baseline justify-between gap-2">
              <span
                className={`type-label normal-case ${
                  s.state === 'active' ? 'text-text' : s.state === 'pending' ? 'text-faint' : ''
                }`}
              >
                {s.label}
              </span>
              {s.state === 'active' && running ? (
                <ActiveElapsed beginAt={s.beginAt} />
              ) : s.ms !== undefined ? (
                <span className="type-meta font-mono">{stageDuration(s.ms)}</span>
              ) : null}
            </div>
            {s.state === 'degraded' && s.detail && (
              <p className="type-meta mt-0.5 text-warn">{s.detail}</p>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
