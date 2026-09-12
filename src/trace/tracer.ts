// Lightweight run tracing. Every stage and every model/fetch call becomes a
// span with wall-clock timings (and token usage when the SDK reports it).
// Spans ride the run's event stream as {type:'span'} events, so they persist
// with the run and render live — the trace view is a pure projection of the
// event log, no separate storage.

export type SpanKind = 'stage' | 'model' | 'fetch';

export type Span = {
  id: string;
  parent?: string;
  name: string;
  kind: SpanKind;
  startedAt: string;
  ms: number;
  ok: boolean;
  // e.g. { model: 'claude-sonnet-5', inputTokens: 1200, outputTokens: 800 }
  attrs?: Record<string, string | number | boolean>;
};

export type SpanHandle = {
  id: string;
  end(ok: boolean, attrs?: Span['attrs']): Span;
};

export type Tracer = {
  // Manual begin/end for stages that wrap generator yields.
  begin(name: string, kind: SpanKind, parent?: string): SpanHandle;
  // Time an awaited call; records ok/failure and rethrows.
  time<T>(
    name: string,
    kind: SpanKind,
    fn: () => Promise<T>,
    opts?: { parent?: string; attrs?: Span['attrs'] },
  ): Promise<T>;
  // Spans recorded since the last drain — the orchestrator yields these as
  // events at its next natural yield point.
  drain(): Span[];
  all(): Span[];
};

export function createTracer(now: () => number = () => Date.now()): Tracer {
  const finished: Span[] = [];
  const pending: Span[] = [];
  let counter = 0;

  const begin = (name: string, kind: SpanKind, parent?: string): SpanHandle => {
    const id = `s${++counter}`;
    const startedMs = now();
    return {
      id,
      end(ok: boolean, attrs?: Span['attrs']): Span {
        const span: Span = {
          id,
          parent,
          name,
          kind,
          startedAt: new Date(startedMs).toISOString(),
          ms: Math.max(0, now() - startedMs),
          ok,
          ...(attrs && Object.keys(attrs).length > 0 ? { attrs } : {}),
        };
        finished.push(span);
        pending.push(span);
        return span;
      },
    };
  };

  return {
    begin,
    async time(name, kind, fn, opts) {
      const handle = begin(name, kind, opts?.parent);
      try {
        const result = await fn();
        handle.end(true, opts?.attrs);
        return result;
      } catch (err) {
        handle.end(false, opts?.attrs);
        throw err;
      }
    },
    drain() {
      return pending.splice(0, pending.length);
    },
    all() {
      return [...finished];
    },
  };
}
