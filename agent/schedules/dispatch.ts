/**
 * The deployment's own clock is the dispatcher: saved research intents that no
 * request could deliver, and bounded watch refreshes, are retried here instead
 * of by a supervised daemon (SPEC 57). The handler owns no domain logic — it
 * drains the queue worker in src/assessment-queue/worker.ts. It has no inbound
 * request, so the agent's address must come from `PADDOCK_AGENT_URL` or, on
 * Vercel, from `VERCEL_URL`. After the drain it runs the outcome phase, which
 * needs no runtime at all: it asks in the activity log what happened to a lot
 * whose sale is over (SPEC 62). The schedule fires daily at 06:00 UTC by
 * default, which is all a Vercel Hobby project allows.
 */
import { defineSchedule } from 'eve/schedules';
import { getAssessmentWorker } from '../../src/assessment-queue/worker';

// One fire takes at most this many units of work, so a cron task cannot outlive
// its platform budget; whatever is left is claimed on the next fire.
const MAX_TICKS = 20;

// Vercel Hobby allows one cron fire per day; Pro allows minute granularity. The
// expression is read at build time so a Pro project can set PADDOCK_DISPATCH_CRON.
const DISPATCH_CRON = process.env.PADDOCK_DISPATCH_CRON?.trim() || '0 6 * * *';

export default defineSchedule({
  cron: DISPATCH_CRON,
  // `eve dev` never fires schedules on their cron cadence: local development
  // relies on the run route's inline dispatch and on `pnpm agent:worker --once`.
  // Vercel evaluates the expression in UTC, so the default drains the queue once
  // a day at 06:00; a Pro project sets `PADDOCK_DISPATCH_CRON='* * * * *'`.
  async run({ waitUntil }) {
    // The cron task ends when its handler returns, so the drain is registered
    // rather than awaited.
    waitUntil(drainAssessmentQueue());
  },
});

/**
 * Claim and deliver until the queue reports nothing left or the bound is hit,
 * then ask for the outcomes the sale calendar has made due. A queue that cannot
 * be reached stops the drain rather than rejecting the task silently; saved
 * intents keep their state and the next fire retries them. The outcome phase
 * owns its own failure for the same reason, so a prompt nobody could write
 * never costs the fire the deliveries it already made.
 */
export async function drainAssessmentQueue(
  worker: Pick<
    ReturnType<typeof getAssessmentWorker>,
    'tick' | 'promptOutcomes'
  > = getAssessmentWorker(),
): Promise<void> {
  for (let taken = 0; taken < MAX_TICKS; taken++) {
    try {
      if ((await worker.tick()).kind === 'idle') break;
    } catch (error) {
      console.error('assessment queue: scheduled dispatch stopped:', error);
      break;
    }
  }
  try {
    await worker.promptOutcomes();
  } catch (error) {
    console.error('assessment queue: outcome prompts were not recorded:', error);
  }
}
