import { describe, expect, test } from 'vitest';
import type { Branch, ResolvedVehicle } from '@/lib/types';
import { scoreCase, type EvalCase, type QueryOutcome } from './score';

function vehicle(make: string, model: string, yearMin: number, yearMax: number): ResolvedVehicle {
  return {
    make,
    model,
    yearMin,
    yearMax,
    trims: [],
    engines: [],
    drive: [],
    body: [],
    score: 1,
    reasons: [],
    rowCount: 1,
  };
}

function branch(make?: string): Branch {
  return { label: make ?? 'branch', constraint: make ? { make } : {}, assumptions: [] };
}

function outcome(branches: Branch[], vehiclesByBranch: ResolvedVehicle[][]): QueryOutcome {
  return { branches, vehiclesByBranch };
}

function evalCase(expect: EvalCase['expect']): EvalCase {
  return { query: 'q', expect };
}

describe('scoreCase', () => {
  test('top passes when the vehicle is within k with matching years', () => {
    const r = scoreCase(
      evalCase({ top: { make: 'BMW', model: 'M3', yearMin: 2001, yearMax: 2006 } }),
      outcome([branch('BMW')], [[vehicle('BMW', 'M3', 2001, 2006)]]),
    );
    expect(r.pass).toBe(true);
  });

  test('top fails when the vehicle ranks below k', () => {
    const filler = Array.from({ length: 5 }, (_, i) => vehicle('BMW', `32${i}i`, 1999, 2006));
    const r = scoreCase(
      evalCase({ top: { make: 'BMW', model: 'M3' }, k: 5 }),
      outcome([branch('BMW')], [[...filler, vehicle('BMW', 'M3', 2001, 2006)]]),
    );
    expect(r.pass).toBe(false);
    expect(r.detail).toContain('M3');
  });

  test('top fails when the year window is wrong', () => {
    const r = scoreCase(
      evalCase({ top: { make: 'BMW', model: 'M3', yearMin: 2001, yearMax: 2006 } }),
      outcome([branch('BMW')], [[vehicle('BMW', 'M3', 1999, 2006)]]),
    );
    expect(r.pass).toBe(false);
  });

  test('forkMakes passes on exact branch set', () => {
    const r = scoreCase(
      evalCase({ forkMakes: ['Chevrolet', 'Audi'] }),
      outcome([branch('Chevrolet'), branch('Audi')], [[], []]),
    );
    expect(r.pass).toBe(true);
  });

  test('forkMakes fails when a branch is missing or extra', () => {
    expect(
      scoreCase(
        evalCase({ forkMakes: ['Chevrolet', 'Audi'] }),
        outcome([branch('Chevrolet')], [[]]),
      ).pass,
    ).toBe(false);
    expect(
      scoreCase(
        evalCase({ forkMakes: ['Chevrolet'] }),
        outcome([branch('Chevrolet'), branch('Audi')], [[], []]),
      ).pass,
    ).toBe(false);
  });

  test('nothing passes only when zero vehicles come back', () => {
    expect(scoreCase(evalCase({ nothing: true }), outcome([branch()], [[]])).pass).toBe(true);
    expect(
      scoreCase(
        evalCase({ nothing: true }),
        outcome([branch()], [[vehicle('BMW', 'M3', 2001, 2006)]]),
      ).pass,
    ).toBe(false);
  });

  test('contains requires every listed vehicle within k', () => {
    const cards = [
      vehicle('Toyota', 'Supra', 1993, 1998),
      vehicle('Lexus', 'SC300', 1992, 1997),
      vehicle('Lexus', 'IS300', 2001, 2005),
    ];
    expect(
      scoreCase(
        evalCase({
          contains: [
            { make: 'Toyota', model: 'Supra' },
            { make: 'Lexus', model: 'IS300' },
          ],
        }),
        outcome([branch()], [cards]),
      ).pass,
    ).toBe(true);
    expect(
      scoreCase(
        evalCase({ contains: [{ make: 'Nissan', model: 'GT-R' }] }),
        outcome([branch()], [cards]),
      ).pass,
    ).toBe(false);
  });

  test('assumption matches against meaning and reason, case-insensitively', () => {
    const b: Branch = {
      label: '1jz',
      constraint: {},
      assumptions: [{ source: 'engine', input: '1jz', meaning: '1JZ', reason: 'JDM only' }],
    };
    expect(scoreCase(evalCase({ nothing: true, assumption: 'jdm' }), outcome([b], [[]])).pass).toBe(
      true,
    );
    expect(
      scoreCase(evalCase({ nothing: true, assumption: 'never sold' }), outcome([b], [[]])).pass,
    ).toBe(false);
  });

  test('unfilterable requires each term to be flagged on some branch', () => {
    const b: Branch = {
      label: 'wagon',
      constraint: {
        body: 'Wagon',
        unfilterable: [
          { term: 'brown', reason: 'color is not in the vehicle data', forwardedToListings: true },
          {
            term: 'manual',
            reason: 'transmission is not in the vehicle data',
            forwardedToListings: true,
          },
        ],
      },
      assumptions: [],
    };
    const cards = [vehicle('Volvo', 'V70', 1998, 2007)];
    expect(
      scoreCase(evalCase({ unfilterable: ['brown', 'manual'] }), outcome([b], [cards])).pass,
    ).toBe(true);
    expect(scoreCase(evalCase({ unfilterable: ['pdk'] }), outcome([b], [cards])).pass).toBe(false);
  });

  test('a case with no expectations fails loudly', () => {
    const r = scoreCase(evalCase({}), outcome([branch()], [[]]));
    expect(r.pass).toBe(false);
    expect(r.detail).toContain('expectation');
  });

  test('all expectations must hold together', () => {
    const b: Branch = {
      label: '996 turbo',
      constraint: { make: 'Porsche' },
      assumptions: [
        { source: 'keyword', input: 'turbo', meaning: 'the Turbo trim', reason: 'model line' },
      ],
    };
    const cards = [vehicle('Porsche', '911', 1999, 2005)];
    expect(
      scoreCase(
        evalCase({ top: { make: 'Porsche', model: '911' }, assumption: 'trim' }),
        outcome([b], [cards]),
      ).pass,
    ).toBe(true);
    expect(
      scoreCase(
        evalCase({ top: { make: 'Porsche', model: '911' }, assumption: 'aspiration' }),
        outcome([b], [cards]),
      ).pass,
    ).toBe(false);
  });
});

describe('public catalog evidence expectations', () => {
  const candidate = {
    ...vehicle('Porsche', '911 Carrera', 2002, 2002),
    unresolved: ['trim Turbo'],
    reasons: ['make Porsche'],
  };
  test('a raw model family candidate only satisfies evidence on that same card', () => {
    const c = evalCase({
      top: { make: 'Porsche', modelPattern: '^911(?: |$)', unresolved: ['trim Turbo'] },
    });
    expect(scoreCase(c, outcome([branch('Porsche')], [[candidate]])).pass).toBe(true);
    expect(
      scoreCase(c, outcome([branch('Porsche')], [[{ ...candidate, unresolved: [] }]])).pass,
    ).toBe(false);
  });
  test('unknown candidates cannot satisfy a confirmed reason requirement', () => {
    const c = evalCase({ top: { make: 'Porsche', modelPattern: '^911', reasons: ['trim Turbo'] } });
    expect(scoreCase(c, outcome([branch('Porsche')], [[candidate]])).pass).toBe(false);
  });
  test('absence checks every result, including below the top-k cutoff', () => {
    const c = evalCase({ absent: [{ make: 'Porsche', modelPattern: 'Turbo' }] });
    expect(
      scoreCase(
        c,
        outcome(
          [branch('Porsche')],
          [[...Array(6).fill(candidate), vehicle('Porsche', '911 Turbo', 2002, 2002)]],
        ),
      ).pass,
    ).toBe(false);
  });
  test('all unresolved and forbidden-credit assertions fail on empty or falsely credited results', () => {
    const c = evalCase({ unresolvedAll: ['trim Turbo'], noReasons: ['trim Turbo'] });
    expect(scoreCase(c, outcome([branch('Porsche')], [[candidate]])).pass).toBe(true);
    expect(scoreCase(c, outcome([branch('Porsche')], [[]])).pass).toBe(false);
    expect(
      scoreCase(c, outcome([branch('Porsche')], [[{ ...candidate, reasons: ['trim Turbo'] }]]))
        .pass,
    ).toBe(false);
  });
  test('candidate membership has no ranking promise but still requires the requested evidence', () => {
    const c = evalCase({
      candidates: [{ make: 'Porsche', modelPattern: '^911', unresolved: ['trim Turbo'] }],
    });
    expect(
      scoreCase(
        c,
        outcome([branch()], [[...Array(6).fill(vehicle('BMW', 'M3', 2001, 2001)), candidate]]),
      ).pass,
    ).toBe(true);
    expect(scoreCase(c, outcome([branch()], [[{ ...candidate, unresolved: [] }]])).pass).toBe(
      false,
    );
  });
  test('a year window is an all-candidate constraint, not a production-boundary assertion', () => {
    expect(
      scoreCase(
        evalCase({ yearWindow: { min: 1999, max: 2005 } }),
        outcome([branch()], [[candidate]]),
      ).pass,
    ).toBe(true);
    expect(
      scoreCase(
        evalCase({ yearWindow: { min: 2003, max: 2005 } }),
        outcome([branch()], [[candidate]]),
      ).pass,
    ).toBe(false);
  });
});

test('a confirmed reason passes only on the same identity, and absence can pass', () => {
  const confirmed = { ...vehicle('Porsche', '911 Turbo', 2002, 2002), reasons: ['trim Turbo'] };
  const wanted = evalCase({
    top: { make: 'Porsche', model: '911 Turbo', reasons: ['trim Turbo'] },
    absent: [{ make: 'Porsche', model: 'Cayman' }],
  });
  expect(scoreCase(wanted, outcome([branch('Porsche')], [[confirmed]])).pass).toBe(true);
  expect(
    scoreCase(
      wanted,
      outcome(
        [branch('Porsche')],
        [
          [
            { ...confirmed, reasons: [] },
            { ...confirmed, model: 'Cayman' },
          ],
        ],
      ),
    ).pass,
  ).toBe(false);
});

test('empty positive lists do not count as meaningful expectations', () => {
  expect(
    scoreCase(evalCase({ contains: [], candidates: [] }), outcome([branch()], [[]])).pass,
  ).toBe(false);
});
