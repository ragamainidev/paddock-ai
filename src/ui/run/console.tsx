'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { clockFormat, type ConsoleLine, type LineKind } from './lines';
import { useNowTicker } from './use-now';

// DESIGN.md console v2. Incoming lines queue and reveal one at a time —
// 90ms cadence tightening toward 40ms as the queue deepens, instant once the
// run is over — so bursts read as the agent talking, not the page lurching.
// The cursor line means the console never looks stuck; stage dividers give
// the log a spine.

const KIND_CLASS: Record<LineKind, string> = {
  thought: 'text-dim',
  evidence: 'text-text',
  'finding-warn': 'text-warn',
  'finding-danger': 'text-danger',
  search: 'text-text',
  plan: 'text-dim',
  degraded: 'text-warn',
  'verdict-pass': 'text-ok',
  'verdict-warn': 'text-warn',
  'verdict-danger': 'text-danger',
};

function paceDelay(queued: number): number {
  if (queued > 12) return 40;
  if (queued > 6) return 60;
  return 90;
}

export function Console({
  lines,
  running,
  activeStage,
  activeSince,
  totalMs,
  finished,
}: {
  lines: ConsoleLine[];
  running: boolean;
  activeStage?: string;
  activeSince?: number; // client clock ms when the active stage last changed
  totalMs?: number; // finished-run duration, from envelope timestamps
  finished: boolean;
}) {
  const [revealedState, setRevealed] = useState(0);
  const [collapsed, setCollapsed] = useState(finished);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);

  // Pacing applies only while live; finished runs reveal everything.
  const revealed = running ? Math.min(revealedState, lines.length) : lines.length;

  // Collapse exactly once, when the run transitions to finished in view.
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && finished) setCollapsed(true);
    wasRunning.current = running;
  }, [running, finished]);

  // The pacing drain: reveal one queued line per tick, faster when behind.
  useEffect(() => {
    if (!running || revealed >= lines.length) return;
    const queued = lines.length - revealed;
    const timer = setTimeout(() => setRevealed(revealed + 1), paceDelay(queued));
    return () => clearTimeout(timer);
  }, [lines.length, revealed, running]);

  // Auto-follow unless the reader scrolled up to study something.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && followRef.current) el.scrollTop = el.scrollHeight;
  }, [revealed, running]);

  const visible = lines.slice(0, revealed);

  const log = (
    <div
      ref={scrollRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
      className="max-h-[62vh] overflow-y-auto rounded-[4px] border border-border bg-surface p-3"
    >
      {visible.length === 0 && running && <p className="type-meta">starting…</p>}
      <div className="flex flex-col gap-[3px]">
        {visible.map((line, i) => (
          <Fragment key={line.key}>
            {(i === 0 || visible[i - 1].stage !== line.stage) && (
              <div className="mb-1 mt-2 flex items-center gap-2 first:mt-0" aria-hidden>
                <span className="type-meta shrink-0">{line.stage}</span>
                <span className="h-px flex-1 bg-border" />
              </div>
            )}
            <p className="rise-in pl-2 font-mono text-[12px] leading-[18px]">
              {line.lane && <span className="text-faint">[{line.lane}] </span>}
              {line.kind === 'search' && <span className="text-dim">searching: </span>}
              {line.photo !== undefined && (
                <span className="mr-2 rounded-[2px] border border-border px-1 font-mono text-[11px] text-faint">
                  photo {line.photo}
                </span>
              )}
              <span className={KIND_CLASS[line.kind]}>{line.text}</span>
              {line.detail && (
                <span className="text-faint">
                  {line.kind === 'plan' ? ' → ' : ' · '}
                  {line.kind === 'plan' ? (
                    <span className="text-text">{line.detail}</span>
                  ) : (
                    line.detail
                  )}
                </span>
              )}
            </p>
          </Fragment>
        ))}
      </div>
      {running && (
        <CursorLine stage={activeStage} since={activeSince} catchingUp={revealed < lines.length} />
      )}
    </div>
  );

  if (!finished) {
    return (
      <section className="flex min-w-0 flex-col gap-2">
        <h2 className="type-label">Console</h2>
        {log}
      </section>
    );
  }

  // Finished: the summary bar owns the space; the log expands back in place.
  return (
    <section className="flex min-w-0 flex-col">
      <button
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="flex h-10 w-full items-center justify-between rounded-[4px] border border-border bg-surface px-3 transition-colors duration-[120ms] ease-out hover:border-border-strong"
      >
        <span className="type-label">Console</span>
        <span className="type-meta font-mono">
          {lines.length} lines{totalMs !== undefined ? ` · ${clockFormat(totalMs)}` : ''} ·{' '}
          <span className="text-accent">{collapsed ? 'expand' : 'collapse'}</span>
        </span>
      </button>
      <div className="structural-collapse" data-collapsed={collapsed}>
        <div>
          <div className="pt-2">{log}</div>
        </div>
      </div>
    </section>
  );
}

// The one blinking element in the system. Elapsed ticks client-side so the
// reader always sees motion — the answer to "is it thinking or stuck".
function CursorLine({
  stage,
  since,
  catchingUp,
}: {
  stage?: string;
  since?: number;
  catchingUp: boolean;
}) {
  const now = useNowTicker(true);
  const seconds =
    since !== undefined && now !== null ? Math.max(0, Math.floor((now - since) / 1000)) : null;
  return (
    <p className="mt-2 font-mono text-[12px] leading-[18px]">
      <span className="cursor-blink text-accent motion-reduce:animate-none">▍</span>
      <span className="type-meta ml-2">
        {catchingUp && !stage ? 'catching up' : (stage ?? 'working')}
        {seconds !== null && !catchingUp ? ` · ${seconds}s` : ''}
      </span>
    </p>
  );
}
