import { describe, expect, test } from 'vitest';
import { getSalvageLot } from './seed-lots';
import { profileFor } from './tiers';
import { TITLE_PROCESS, titleProcessFor } from './title-process';

const fallback = profileFor(getSalvageLot('sf90-front-il')!).titleProcess;

describe('title process by state (docs/salvage-economics.md §13)', () => {
  test('a tabulated state returns its own range, named and sourced', () => {
    const ca = titleProcessFor('US-CA', fallback);
    expect(ca.tabulated).toBe(true);
    expect(ca.low).toBe(TITLE_PROCESS['US-CA'].low);
    expect(ca.high).toBe(TITLE_PROCESS['US-CA'].high);
    expect(ca.basis).toContain('California');
    expect(ca.basis).toContain('https://');
    expect(ca.basis).not.toContain('state not tabulated');
  });

  test('every tabulated state names itself, cites a URL, and holds a sane band', () => {
    const wanted = [
      'US-AZ',
      'US-CA',
      'US-FL',
      'US-GA',
      'US-IL',
      'US-MI',
      'US-NC',
      'US-NY',
      'US-OH',
      'US-PA',
      'US-TX',
      'US-WA',
    ];
    expect(Object.keys(TITLE_PROCESS).sort()).toEqual(wanted);
    for (const code of wanted) {
      const t = titleProcessFor(code, fallback);
      expect(t.tabulated, code).toBe(true);
      expect(t.low, code).toBeGreaterThan(0);
      expect(t.high, code).toBeGreaterThanOrEqual(t.low);
      // A jurisdiction the buyer profile can hold, a state the basis names,
      // and a source the reader can check (SPEC 44).
      expect(code).toMatch(/^US-[A-Z]{2}$/);
      expect(t.basis, code).toContain(code);
      expect(t.basis, code).toMatch(/https:\/\//);
    }
  });

  test('an untabulated state falls back to the tier default and says so', () => {
    const ks = titleProcessFor('US-KS', fallback);
    expect(ks.tabulated).toBe(false);
    expect(ks.low).toBe(fallback.low);
    expect(ks.high).toBe(fallback.high);
    expect(ks.basis).toBe(`${fallback.basis}; state not tabulated`);
  });

  test('an unspecified jurisdiction falls back rather than guessing a state', () => {
    for (const code of ['US-unspecified', '', 'CA', 'us-ca', 'nonsense']) {
      const t = titleProcessFor(code, fallback);
      expect(t.tabulated, code).toBe(false);
      expect(t.low, code).toBe(fallback.low);
      expect(t.basis, code).toBe(`${fallback.basis}; state not tabulated`);
    }
  });
});
