/**
 * The outcome loop's shared rule (SPEC 62): the event the desk records once a
 * lot's sale is over, the words it records, how long it waits before asking
 * again, and when an answer has arrived. The queue selects on the interval, the
 * worker writes the message, and both the collection endpoint and the workspace
 * read the same pending test, so one rule decides what every surface shows.
 */

/** The activity event type the desk writes; no external notification is sent. */
export const OUTCOME_PROMPT_EVENT = 'outcome_prompt';

/** What the prompt says, in the kinds the outcome form offers. */
export const OUTCOME_PROMPT_MESSAGE =
  'The sale date has passed. Record what happened: passed, purchased (hammer), or sold (proceeds).';

/** The desk asks once a week at most; it asks, it does not nag. */
export const OUTCOME_PROMPT_INTERVAL_MS = 7 * 86_400_000;

// A lot states its sale as a calendar day (`2026-09-06`) far more often than as
// an instant: that is what the auction listings carry and what intake reads.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether a lot's sale is over far enough to ask about it. A calendar day
 * parses as its own midnight UTC, so a bare date is only past once a full day
 * has elapsed after that day closed — no fire on the morning of the sale, and
 * none the morning after, whatever timezone the yard ran on. A stated instant
 * needs the same day of settling from the instant itself.
 */
export function saleIsOver(saleDate: string | undefined, now: Date): boolean {
  if (!saleDate) return false;
  const stated = Date.parse(saleDate);
  if (!Number.isFinite(stated)) return false;
  return stated + (DATE_ONLY.test(saleDate) ? 2 : 1) * 86_400_000 <= now.getTime();
}

/**
 * Whether a recorded prompt is still waiting for its answer. An outcome saved
 * after the prompt answers it; one saved before it does not, because the prompt
 * was recorded on a record that already held it. Both sides are ISO instants,
 * which compare as strings.
 */
export function outcomePromptPending(
  promptedAt: string | undefined,
  outcomes: readonly { at: string }[],
): boolean {
  if (!promptedAt) return false;
  return outcomes.every((outcome) => outcome.at <= promptedAt);
}
