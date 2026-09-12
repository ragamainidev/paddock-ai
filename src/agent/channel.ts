/**
 * The push channel both orchestrators drain (`docs/patterns.md §5.2`).
 * Progress fired from inside an awaited promise — a research worker
 * reporting each live search — has nowhere to go in an async generator:
 * the generator is parked on the await. The channel buffers those callbacks
 * and `drainUntil` yields them while the promise is still running, so the
 * console shows the work as it happens instead of after it lands.
 */

export function eventChannel<T>() {
  const buffer: T[] = [];
  let wake: (() => void) | null = null;
  const push = (item: T) => {
    buffer.push(item);
    wake?.();
    wake = null;
  };
  async function* drainUntil(promise: Promise<unknown>): AsyncGenerator<T> {
    let settled = false;
    void promise.finally(() => {
      settled = true;
      wake?.();
      wake = null;
    });
    while (true) {
      if (buffer.length > 0) {
        yield buffer.shift() as T;
        continue;
      }
      if (settled) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  }
  return { push, drainUntil };
}
