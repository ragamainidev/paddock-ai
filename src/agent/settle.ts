/**
 * A stage's promise, turned into a value the orchestrator can read without
 * a try/catch around its own yields. Failure is a state, not an exception
 * (SPEC 10, 24): the reason is the fixed user-facing one and the error
 * object goes to the server log, named by the stage that owned it
 * (`docs/logging.md §2.2`).
 *
 * The handlers attach where the work starts, so a settled promise awaited
 * later can never reject — that is what lets a stage run in parallel with
 * the stages streaming before it.
 */

import { failureReason } from '@/lib/failure';

export type Settled<T> = { ok: true; value: T } | { ok: false; detail: string };

export function settle<T>(work: Promise<T>, log: string): Promise<Settled<T>> {
  return work.then(
    (value) => ({ ok: true as const, value }),
    (err: unknown) => {
      console.error(log, err);
      return { ok: false as const, detail: failureReason(err) };
    },
  );
}
