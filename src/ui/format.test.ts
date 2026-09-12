import { describe, expect, test } from 'vitest';
import type { Assumption, Constraint, ResolvedVehicle, StageStatus } from '@/lib/types';
import {
  assumptionChip,
  parseSelection,
  queryWithout,
  selectionParam,
  forwardedTerms,
  stageNote,
  vehicleSpecs,
  yearRange,
} from './format';

describe('yearRange', () => {
  test('renders an en-dash range with no spaces', () => {
    expect(yearRange(2019, 2026)).toBe('2019–2026');
  });

  test('collapses a single-year span to one year', () => {
    expect(yearRange(2003, 2003)).toBe('2003');
  });
});

describe('assumptionChip', () => {
  test('formats as input → meaning', () => {
    const a: Assumption = {
      source: 'chassis',
      input: '992',
      meaning: 'Porsche 911, 2019+',
      reason: 'chassis code',
    };
    expect(assumptionChip(a)).toBe('992 → Porsche 911, 2019+');
  });
});

describe('queryWithout', () => {
  test('removes the token and collapses whitespace', () => {
    expect(queryWithout('e46 m3 slicktop', 'slicktop')).toBe('e46 m3');
  });

  test('matches case-insensitively', () => {
    expect(queryWithout('E46 M3', 'e46')).toBe('M3');
  });

  test('only removes whole tokens, never substrings', () => {
    expect(queryWithout('m3 3 series', '3')).toBe('m3 series');
  });

  test('removes multi-word inputs as a sequence', () => {
    expect(queryWithout('shelby gt 500', 'gt 500')).toBe('shelby');
  });

  test('leaves the query alone when the token is absent', () => {
    expect(queryWithout('996 turbo', 'na')).toBe('996 turbo');
  });
});

describe('selection round-trip', () => {
  test('parses what selectionParam produces', () => {
    expect(parseSelection(selectionParam(1, 4))).toEqual({ branch: 1, vehicle: 4 });
  });

  test('rejects malformed values', () => {
    expect(parseSelection(undefined)).toBeNull();
    expect(parseSelection('')).toBeNull();
    expect(parseSelection('1')).toBeNull();
    expect(parseSelection('a.b')).toBeNull();
    expect(parseSelection('-1.0')).toBeNull();
    expect(parseSelection('1.2.3')).toBeNull();
  });
});

describe('forwardedTerms', () => {
  test('keeps only terms marked for listings', () => {
    const c: Constraint = {
      make: 'BMW',
      unfilterable: [
        { term: 'manual', reason: 'no transmission data', forwardedToListings: true },
        { term: 'clean title', reason: 'not vehicle data', forwardedToListings: false },
      ],
    };
    expect(forwardedTerms(c)).toEqual(['manual']);
  });

  test('handles constraints without unfilterables', () => {
    expect(forwardedTerms({})).toEqual([]);
  });
});

describe('vehicleSpecs', () => {
  const m3: ResolvedVehicle = {
    make: 'BMW',
    model: 'M3',
    yearMin: 2001,
    yearMax: 2006,
    trims: ['Base', 'Competition'],
    engines: [
      { engine: '3.2L L6 GAS', count: 40 },
      { engine: null, count: 2 },
    ],
    drive: ['RWD'],
    body: ['Coupe', 'Convertible'],
    score: 90,
    reasons: ['chassis E46 → 2001–2006'],
    rowCount: 42,
  };

  test('emits label/value pairs for the spec grid', () => {
    const rows = vehicleSpecs(m3);
    expect(rows).toContainEqual(['years', '2001–2006']);
    expect(rows).toContainEqual(['drive', 'RWD']);
    expect(rows).toContainEqual(['body', 'Coupe, Convertible']);
    expect(rows).toContainEqual(['trims', 'Base, Competition']);
  });

  test('lists engines and skips null engine strings', () => {
    const rows = vehicleSpecs(m3);
    const engines = rows.find(([label]) => label === 'engines');
    expect(engines?.[1]).toBe('3.2L L6 GAS');
  });

  test('caps long lists and counts the rest', () => {
    const busy = { ...m3, trims: ['A', 'B', 'C', 'D', 'E', 'F'] };
    const trims = vehicleSpecs(busy).find(([label]) => label === 'trims');
    expect(trims?.[1]).toBe('A, B, C, D +2 more');
  });

  test('omits rows with nothing to show', () => {
    const bare = { ...m3, trims: [], engines: [], drive: [], body: [] };
    const labels = vehicleSpecs(bare).map(([label]) => label);
    expect(labels).toEqual(['years']);
  });
});

describe('stageNote', () => {
  test('names the stage in plain language with the detail', () => {
    const s: StageStatus = { stage: 'ebay', ok: false, detail: 'credentials not set' };
    expect(stageNote(s)).toBe('listings unavailable: credentials not set');
  });

  test.each([
    ['interpret', 'interpreter degraded'],
    ['resolve', 'vehicle lookup failed'],
    ['nhtsa', 'NHTSA data unavailable'],
    ['themes', 'complaint themes unavailable'],
  ] as const)('%s → %s', (stage, prefix) => {
    expect(stageNote({ stage, ok: false, detail: 'x' })).toBe(`${prefix}: x`);
  });

  test('a stage without detail still reads as a sentence', () => {
    expect(stageNote({ stage: 'nhtsa', ok: false })).toBe('NHTSA data unavailable');
  });
});
