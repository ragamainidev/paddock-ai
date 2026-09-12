import { expect, it } from 'vitest';
import { pollIntervalMs } from './polling';

it('polls a working assessment on the fast schedule', () => {
  expect(pollIntervalMs('active', 0)).toBe(1500);
  expect(pollIntervalMs('investigating', 59_999)).toBe(1500);
});

it('backs off once a minute passes without a revision change', () => {
  expect(pollIntervalMs('active', 60_000)).toBe(5000);
  expect(pollIntervalMs('investigating', 600_000)).toBe(5000);
});

it('stops entirely for a stopped assessment, however long it has been quiet', () => {
  expect(pollIntervalMs('stopped', 0)).toBeNull();
  expect(pollIntervalMs('stopped', 600_000)).toBeNull();
});
