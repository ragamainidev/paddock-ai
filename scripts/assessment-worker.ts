/**
 * Local diagnostic for the dispatch queue, not a production component:
 * deployments retry saved intents from the eve schedule in
 * `agent/schedules/dispatch.ts` and start a run inline from its route (SPEC 57).
 * `--once` takes a single unit of work and prints the result; the looping mode
 * is a convenience while developing against a local runtime. The schedule's
 * outcome phase runs on the way out, so a local desk asks what happened to a
 * lot whose sale is over exactly as a deployment does (SPEC 62). Runtime and
 * evidence opt-ins remain in Eve, and no provider call happens here.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { getAssessmentWorker } from '../src/assessment-queue/worker';

async function main() {
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  const worker = getAssessmentWorker();
  const once = process.argv.includes('--once');
  while (!controller.signal.aborted) {
    let idle = true;
    try {
      const result = await worker.tick();
      idle = result.kind === 'idle';
      if (!idle || once) process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch {
      process.stderr.write(
        'Assessment queue unavailable; retrying without losing saved intents.\n',
      );
    }
    if (once) break;
    try {
      await sleep(idle ? 2000 : 100, undefined, { signal: controller.signal });
    } catch {
      break;
    }
  }
  try {
    const prompted = await worker.promptOutcomes();
    if (prompted || once) process.stdout.write(`${JSON.stringify({ outcomePrompts: prompted })}\n`);
  } catch {
    process.stderr.write('Outcome prompts could not be recorded; saved assessments are intact.\n');
  }
}
main().catch(() => {
  process.stderr.write('Assessment worker could not start.\n');
  process.exitCode = 1;
});
