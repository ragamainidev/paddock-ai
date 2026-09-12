/**
 * The assessment detail view's poll schedule and the effect that runs it.
 * A saved assessment changes only when the agent commits a revision, so the
 * page re-reads the record instead of tailing a stream. This module owns how
 * often that happens and when it stops: a stopped assessment is polled by
 * nothing, and a quiet one is polled slowly. The schedule is pure so the
 * bound is testable without a browser.
 */
import { useEffect, useRef, type RefObject } from 'react';

export type PollStatus = 'active' | 'investigating' | 'stopped';

// A working assessment writes revisions faster than a reader can refresh.
const ACTIVE_MS = 1500;
// Nothing has changed for this long, so the same answer is worth less often.
const IDLE_AFTER_MS = 60_000;
const IDLE_MS = 5000;

/** `null` means stop: a stopped assessment cannot change without a manual action. */
export function pollIntervalMs(status: PollStatus, msSinceRevisionChange: number): number | null {
  if (status === 'stopped') return null;
  return msSinceRevisionChange >= IDLE_AFTER_MS ? IDLE_MS : ACTIVE_MS;
}

/**
 * Runs `poll` on the schedule above. The status and the last revision change
 * are read from refs at each tick, so the loop reacts to what the previous
 * poll returned rather than to a render that may not have happened yet.
 * Changing `restartKey` restarts a loop that stopped; a hidden tab keeps its
 * place in the schedule without spending a request. A zero in
 * `revisionChangedAt` means no revision has been read yet, which is as fresh
 * as a record gets.
 */
export function useBoundedPoll(
  poll: () => Promise<void>,
  status: RefObject<PollStatus>,
  revisionChangedAt: RefObject<number>,
  restartKey: unknown,
): void {
  const latest = useRef(poll);
  useEffect(() => {
    latest.current = poll;
  });
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let skipped = false;
    const tick = async (forced: boolean) => {
      if (!alive) return;
      clearTimeout(timer);
      // The first read of a mount fills a page that has nothing on it yet;
      // every later read spends a request only on a tab someone is looking at.
      skipped = !forced && document.visibilityState !== 'visible';
      if (!skipped) await latest.current();
      if (!alive) return;
      const changed = revisionChangedAt.current;
      const ms = pollIntervalMs(status.current, changed === 0 ? 0 : Date.now() - changed);
      if (ms === null) return;
      timer = setTimeout(() => void tick(false), ms);
    };
    // A tab coming back to the front is read at once, not at its next turn.
    const wake = () => {
      if (skipped && document.visibilityState === 'visible') void tick(false);
    };
    document.addEventListener('visibilitychange', wake);
    void tick(true);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [restartKey, status, revisionChangedAt]);
}
