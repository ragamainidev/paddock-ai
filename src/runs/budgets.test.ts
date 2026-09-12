import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { maxDuration as inspectMaxDuration } from '@/app/api/inspect/route';
import { maxDuration as salvageMaxDuration } from '@/app/api/salvage/route';
import { maxDuration as streamMaxDuration } from '@/app/api/runs/[id]/stream/route';
import {
  SWEEP_BUDGET_MS,
  WORKER_BUDGET_MS as INSPECTOR_WORKER_BUDGET_MS,
} from '@/inspector/research';
import { VISION_ATTEMPTS, VISION_TIMEOUT_MS } from '@/inspector/vision';
import { WORKER_BUDGET_MS as SALVAGE_WORKER_BUDGET_MS } from '@/salvage/research';
import { TRIAGE_ATTEMPTS, TRIAGE_TIMEOUT_MS } from '@/salvage/triage';
import { EVENT_TIMEOUT_MS, TAIL_DEADLINE_MS } from './manager';

/**
 * Stage budgets have to fit under the serverless function ceiling. A stage
 * bound above `maxDuration` never fires: the platform kills the instance
 * first, and the run reads as dead for no stated reason instead of naming
 * the stage that overran. This adds the budgets up the way a run spends
 * them — serially, per agent — and holds the sum under the ceiling with
 * room for the work that has no constant of its own (docs/operations.md §8).
 *
 * An SDK `timeout` bounds one attempt, not one call, so a stage whose only
 * bound is that timeout costs `timeout × attempts`. The sums below are
 * attempt-aware, and the retry setting they assume is asserted against the
 * source of every model caller in the two agents.
 */

const MAX_DURATION_MS = 300_000;
// Reserved for the unbudgeted remainder of a run: the photo pre-flight, the
// federal decode, finalize and the last store write.
const SLACK_MS = 20_000;
const SERIAL_CEILING_MS = MAX_DURATION_MS - SLACK_MS;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Both agents and the runtime they share, scanned rather than listed, so a
// caller added later is covered the day it lands. A worker loop aborts its
// own stream at a wall-clock deadline, so its budget bounds it whatever the
// SDK does; vision and triage are bounded by the request timeout alone,
// which is why their attempts are constants the sums multiply by.
const AGENT_DIRS = ['src/agent', 'src/inspector', 'src/salvage', 'src/assessments'];
// Vision, triage, the two research worker fan-outs, the VIN sweep and the
// intake completion. Intake runs on the create request rather than inside a
// run's serial chain, so it adds a client to the scan and nothing to the sums.
const AGENT_CLIENTS = 6;
const ATTEMPT_CONSTANTS: Record<string, number> = { VISION_ATTEMPTS, TRIAGE_ATTEMPTS };

// `maxRetries: 0` written literally, or as `<NAME>_ATTEMPTS - 1` where that
// exported constant is 1. Anything else is a retry the budgets do not fund;
// so is a client that names no `maxRetries` at all, since the SDK's default
// is two of them.
function retriesOf(expression: string | undefined): number | null {
  if (expression === undefined) return null;
  if (/^\d+$/.test(expression)) return Number(expression);
  const derived = /^([A-Z_]+)\s*-\s*1$/.exec(expression);
  const attempts = derived ? ATTEMPT_CONSTANTS[derived[1]] : undefined;
  return attempts === undefined ? null : attempts - 1;
}

// Every `new Anthropic({...})` under the agent directories, as
// `<file>: <retries>` so a failure names the caller that regained one.
function agentClientRetries(): string[] {
  return AGENT_DIRS.flatMap((dir) =>
    readdirSync(join(ROOT, dir))
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .flatMap((name) => {
        const source = readFileSync(join(ROOT, dir, name), 'utf8');
        return [...source.matchAll(/new Anthropic\(\{([^}]*)\}\)/g)].map((client) => {
          const setting = /maxRetries:\s*([^,}]+)/.exec(client[1]);
          return `${dir}/${name}: ${retriesOf(setting?.[1].trim())}`;
        });
      }),
  );
}

describe('stage budgets under the function ceiling', () => {
  it('every run route declares the ceiling these budgets assume', () => {
    expect(inspectMaxDuration * 1000).toBe(MAX_DURATION_MS);
    expect(salvageMaxDuration * 1000).toBe(MAX_DURATION_MS);
    expect(streamMaxDuration * 1000).toBe(MAX_DURATION_MS);
  });

  it('no model caller in either agent leaves the SDK free to retry', () => {
    const clients = agentClientRetries();
    // A scan that finds nothing is a check that stopped checking.
    expect(clients).toHaveLength(AGENT_CLIENTS);
    expect(clients).toEqual(clients.map((client) => `${client.split(':')[0]}: 0`));
  });

  it('an inspection fits: vision, then a research worker, then the VIN sweep', () => {
    const serial =
      VISION_TIMEOUT_MS * VISION_ATTEMPTS + INSPECTOR_WORKER_BUDGET_MS + SWEEP_BUDGET_MS;
    expect(serial).toBeLessThanOrEqual(SERIAL_CEILING_MS);
    expect(serial + SLACK_MS).toBeLessThanOrEqual(MAX_DURATION_MS);
  });

  it('a salvage assessment fits: triage, then a research worker', () => {
    const serial = TRIAGE_TIMEOUT_MS * TRIAGE_ATTEMPTS + SALVAGE_WORKER_BUDGET_MS;
    expect(serial).toBeLessThanOrEqual(SERIAL_CEILING_MS);
    expect(serial + SLACK_MS).toBeLessThanOrEqual(MAX_DURATION_MS);
  });

  it('the dead-run timeout can fire before the platform kills the instance', () => {
    expect(EVENT_TIMEOUT_MS + SLACK_MS).toBeLessThanOrEqual(MAX_DURATION_MS);
    expect(TAIL_DEADLINE_MS + SLACK_MS).toBeLessThanOrEqual(MAX_DURATION_MS);
    // It is a hang detector, not a stage bound: no single stage may outlast
    // it, or a slow stage reads as a dead run. A stage bounded by a request
    // timeout is measured across every attempt it is allowed.
    for (const budget of [
      VISION_TIMEOUT_MS * VISION_ATTEMPTS,
      INSPECTOR_WORKER_BUDGET_MS,
      SWEEP_BUDGET_MS,
      TRIAGE_TIMEOUT_MS * TRIAGE_ATTEMPTS,
      SALVAGE_WORKER_BUDGET_MS,
    ]) {
      expect(budget).toBeLessThan(EVENT_TIMEOUT_MS);
    }
  });
});
