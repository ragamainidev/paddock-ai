/** When a sale counts as over, and when an ask is still waiting (SPEC 62). */
import { expect, it } from 'vitest';
import { outcomePromptPending, saleIsOver } from './outcome-prompt';

const at = (value: string) => new Date(value);

it('treats a calendar sale date as over only after its day has fully closed', () => {
  // The listing states a day, which parses as its own midnight UTC. The 06:00
  // fire on the day of the sale, and the one the morning after, say nothing.
  expect(saleIsOver('2026-09-06', at('2026-09-06T06:00:00Z'))).toBe(false);
  expect(saleIsOver('2026-09-06', at('2026-09-07T06:00:00Z'))).toBe(false);
  expect(saleIsOver('2026-09-06', at('2026-09-08T06:00:00Z'))).toBe(true);
  // The boundary itself: two whole days after the stated midnight.
  expect(saleIsOver('2026-09-06', at('2026-09-07T23:59:59Z'))).toBe(false);
  expect(saleIsOver('2026-09-06', at('2026-09-08T00:00:00Z'))).toBe(true);
});

it('settles a stated instant a day after the instant itself', () => {
  expect(saleIsOver('2026-09-06T18:00:00Z', at('2026-09-07T06:00:00Z'))).toBe(false);
  expect(saleIsOver('2026-09-06T18:00:00Z', at('2026-09-07T18:00:00Z'))).toBe(true);
});

it('asks nothing about a lot that states no sale, or states one nobody can read', () => {
  expect(saleIsOver(undefined, at('2030-01-01T00:00:00Z'))).toBe(false);
  expect(saleIsOver('next Thursday', at('2030-01-01T00:00:00Z'))).toBe(false);
});

it('holds an ask open until an outcome recorded after it answers', () => {
  expect(outcomePromptPending(undefined, [])).toBe(false);
  expect(outcomePromptPending('2026-09-08T06:00:00.000Z', [])).toBe(true);
  expect(
    outcomePromptPending('2026-09-08T06:00:00.000Z', [{ at: '2026-09-09T00:00:00.000Z' }]),
  ).toBe(false);
  // An outcome recorded before the ask does not answer it: the ask was written
  // over a record that already held it.
  expect(
    outcomePromptPending('2026-09-08T06:00:00.000Z', [{ at: '2026-09-07T00:00:00.000Z' }]),
  ).toBe(true);
});
