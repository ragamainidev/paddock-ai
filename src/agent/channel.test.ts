import { describe, expect, test } from 'vitest';
import { eventChannel } from './channel';

describe('eventChannel', () => {
  test('pushes during a pending promise are yielded before completion', async () => {
    const channel = eventChannel<number>();
    let resolve!: () => void;
    const pending = new Promise<void>((r) => (resolve = r));
    const seen: number[] = [];

    channel.push(1);
    const drain = (async () => {
      for await (const n of channel.drainUntil(pending)) {
        seen.push(n);
        if (n === 2) resolve();
      }
    })();
    channel.push(2);
    await drain;
    expect(seen).toEqual([1, 2]);
  });

  test('drains buffered items even when the promise is already settled', async () => {
    const channel = eventChannel<string>();
    channel.push('late');
    const seen: string[] = [];
    for await (const s of channel.drainUntil(Promise.resolve())) seen.push(s);
    expect(seen).toEqual(['late']);
  });
});
