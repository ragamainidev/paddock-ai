import { describe, expect, it } from 'vitest';
import { createTracer } from './tracer';

describe('tracer', () => {
  const fakeClock = (start = 1_000_000) => {
    let t = start;
    return { now: () => t, tick: (ms: number) => (t += ms) };
  };

  it('times an awaited call and records a successful span', async () => {
    const clock = fakeClock();
    const tracer = createTracer(clock.now);
    const result = await tracer.time('vision', 'model', async () => {
      clock.tick(1234);
      return 42;
    });
    expect(result).toBe(42);
    const [span] = tracer.all();
    expect(span).toMatchObject({ name: 'vision', kind: 'model', ms: 1234, ok: true });
  });

  it('records a failed span and rethrows', async () => {
    const tracer = createTracer(fakeClock().now);
    await expect(
      tracer.time('nhtsa', 'fetch', async () => {
        throw new Error('502');
      }),
    ).rejects.toThrow('502');
    expect(tracer.all()[0]).toMatchObject({ name: 'nhtsa', ok: false });
  });

  it('supports manual begin/end with parenting and attrs', () => {
    const clock = fakeClock();
    const tracer = createTracer(clock.now);
    const stage = tracer.begin('web', 'stage');
    const call = tracer.begin('search 1', 'model', stage.id);
    clock.tick(500);
    call.end(true, { inputTokens: 100 });
    clock.tick(200);
    stage.end(true);

    const spans = tracer.all();
    expect(spans[0]).toMatchObject({
      name: 'search 1',
      parent: stage.id,
      ms: 500,
      attrs: { inputTokens: 100 },
    });
    expect(spans[1]).toMatchObject({ name: 'web', ms: 700 });
  });

  it('drain returns only spans finished since the last drain', async () => {
    const tracer = createTracer(fakeClock().now);
    await tracer.time('a', 'fetch', async () => {});
    expect(tracer.drain().map((s) => s.name)).toEqual(['a']);
    expect(tracer.drain()).toEqual([]);
    await tracer.time('b', 'fetch', async () => {});
    expect(tracer.drain().map((s) => s.name)).toEqual(['b']);
    expect(tracer.all().map((s) => s.name)).toEqual(['a', 'b']);
  });
});
