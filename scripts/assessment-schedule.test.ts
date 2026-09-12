/** Run the deployment drain itself; src must never import agent modules. */
import { afterEach, expect, it, vi } from 'vitest';
import { drainAssessmentQueue } from '../agent/schedules/dispatch';

afterEach(() => vi.restoreAllMocks());

it('asks for outcomes once after an idle delivery drain', async () => {
  const phases: string[] = [];
  await drainAssessmentQueue({
    async tick() {
      phases.push('idle');
      return { kind: 'idle' };
    },
    async promptOutcomes() {
      phases.push('outcomes');
      return 1;
    },
  });
  expect(phases).toEqual(['idle', 'outcomes']);
});

it('asks for outcomes once after a delivery drain failure', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const phases: string[] = [];
  await expect(
    drainAssessmentQueue({
      async tick() {
        phases.push('delivery failed');
        throw new Error('queue unavailable');
      },
      async promptOutcomes() {
        phases.push('outcomes');
        return 1;
      },
    }),
  ).resolves.toBeUndefined();
  expect(phases).toEqual(['delivery failed', 'outcomes']);
});

it('keeps completed deliveries when the outcome phase fails', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const phases: string[] = [];
  await expect(
    drainAssessmentQueue({
      async tick() {
        if (phases.length === 0) {
          phases.push('delivered');
          return { kind: 'dispatched', assessmentId: 'lot-1', sessionId: 'session-1' };
        }
        phases.push('idle');
        return { kind: 'idle' };
      },
      async promptOutcomes() {
        phases.push('outcomes failed');
        throw new Error('activity log unavailable');
      },
    }),
  ).resolves.toBeUndefined();
  expect(phases).toEqual(['delivered', 'idle', 'outcomes failed']);
});

it('bounds a busy delivery drain to twenty ticks before asking for outcomes', async () => {
  const phases: string[] = [];
  await drainAssessmentQueue({
    async tick() {
      phases.push('delivered');
      return { kind: 'dispatched', assessmentId: 'lot-1', sessionId: 'session-1' };
    },
    async promptOutcomes() {
      phases.push('outcomes');
      return 1;
    },
  });
  expect(phases).toEqual([...Array<string>(20).fill('delivered'), 'outcomes']);
});
