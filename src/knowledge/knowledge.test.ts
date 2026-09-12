import { parse } from 'csv-parse/sync';
import { readFileSync } from 'node:fs';
import { likeToRegex } from '../lib/like';
import { describe, expect, test } from 'vitest';
import { CHASSIS } from './chassis';
import { ENGINES } from './engines';
import { lookupChassis, lookupEngine, lookupModelWord, lookupVariant } from './index';
import { MAKE_WORDS, MODEL_WORDS } from './models';
import { VARIANTS } from './variants';

describe('chassis lookups', () => {
  test('decodes a bmw generation code case-insensitively', () => {
    const hits = lookupChassis('e46');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ code: 'E46', make: 'BMW', yearMin: 1999, yearMax: 2006 });
  });

  test('E92 aliases to the E90 generation entry', () => {
    expect(lookupChassis('e92')[0]?.code).toBe('E90');
  });

  test('porsche 911 generations carry year windows', () => {
    expect(lookupChassis('992')[0]).toMatchObject({ make: 'Porsche', yearMin: 2019 });
    expect(lookupChassis('964')[0]).toMatchObject({ yearMin: 1989, yearMax: 1994 });
  });

  test('C7 is ambiguous: Corvette and Audi', () => {
    const hits = lookupChassis('c7');
    expect(hits).toHaveLength(2);
    expect(new Set(hits.map((h) => h.make))).toEqual(new Set(['Chevrolet', 'Audi']));
  });

  test('Mk4 is ambiguous three ways: Supra, Golf, Jetta', () => {
    const hits = lookupChassis('mk4');
    expect(hits).toHaveLength(3);
    expect(new Set(hits.map((h) => `${h.make} ${h.family}`))).toEqual(
      new Set(['Toyota Supra', 'Volkswagen Golf', 'Volkswagen Jetta']),
    );
  });

  test('mkiv aliases to mk4', () => {
    expect(lookupChassis('mkiv')).toHaveLength(3);
  });

  test('R32 is ambiguous: JDM Skyline GT-R and VW Golf R32', () => {
    const hits = lookupChassis('r32');
    expect(hits).toHaveLength(2);
    const nissan = hits.find((h) => h.make === 'Nissan');
    expect(nissan?.jdmOnly).toBe(true);
    expect(hits.find((h) => h.make === 'Volkswagen')).toBeDefined();
  });

  test('miata generation codes exist and are marked context-dependent', () => {
    const na = lookupChassis('na');
    expect(na).toHaveLength(1);
    expect(na[0]).toMatchObject({ make: 'Mazda', contextRequired: true });
    expect(lookupChassis('nd')[0]).toMatchObject({ make: 'Mazda', yearMin: 2016 });
  });

  test('unknown codes return empty, never guess', () => {
    expect(lookupChassis('q99')).toEqual([]);
  });
});

describe('engine lookups', () => {
  test('2JZ maps to supra and lexus fitments', () => {
    const e = lookupEngine('2jz');
    expect(e).toBeDefined();
    expect(e!.cylinders).toBe(6);
    expect(e!.blockType).toBe('L');
    const models = e!.fitments.map((f) => `${f.make} ${f.modelLike[0]}`);
    expect(models).toContain('Toyota Supra');
  });

  test('1JZ and RB26 are honest about having no US-market rows', () => {
    expect(lookupEngine('1jz')?.jdmOnly).toBe(true);
    expect(lookupEngine('rb26')?.jdmOnly).toBe(true);
  });

  test('LT5 notes both its generations', () => {
    const e = lookupEngine('lt5');
    expect(e?.note).toMatch(/ZR-?1/i);
  });

  test('1LR-GUE maps to the LFA', () => {
    const e = lookupEngine('1lr-gue');
    expect(e?.fitments[0]).toMatchObject({ make: 'Lexus' });
    expect(lookupEngine('1lr')?.code).toBe('1LR-GUE');
  });

  test('unknown engine codes return undefined', () => {
    expect(lookupEngine('9zz')).toBeUndefined();
  });
});

describe('model word lookups', () => {
  test('supra covers both the Mk4 and the GR Supra', () => {
    const m = lookupModelWord('supra');
    expect(m).toMatchObject({ make: 'Toyota' });
    expect(m?.models).toEqual(['Supra', 'GR Supra']);
  });

  test('vette aliases to the Corvette', () => {
    expect(lookupModelWord('vette')).toMatchObject({ make: 'Chevrolet', models: ['Corvette'] });
  });

  test('skyline is documented as JDM-only', () => {
    expect(lookupModelWord('skyline')?.jdmOnly).toBe(true);
  });

  test('ae86 pins the corolla to its chassis years', () => {
    expect(lookupModelWord('ae86')).toMatchObject({ make: 'Toyota', yearMin: 1984, yearMax: 1987 });
  });

  test('make words normalize colloquial names', () => {
    expect(MAKE_WORDS['chevy']).toBe('Chevrolet');
    expect(MAKE_WORDS['vw']).toBe('Volkswagen');
    expect(MAKE_WORDS['mercedes']).toBe('Mercedes-Benz');
    expect(MAKE_WORDS['infiniti']).toBe('INFINITI');
  });

  test('unknown model words return undefined', () => {
    expect(lookupModelWord('gremlinx')).toBeUndefined();
  });
});

describe('variant lookups', () => {
  test('gt3 rs scopes to the porsche 911', () => {
    const v = lookupVariant('gt3 rs');
    expect(v?.fitments[0]).toMatchObject({ make: 'Porsche' });
    expect(v?.trimContains).toEqual(['GT3 RS']);
  });

  test('type r spans honda and acura', () => {
    const v = lookupVariant('type r');
    expect(v?.fitments.map((f) => f.make).sort()).toEqual(['Acura', 'Honda']);
  });

  test('hellcat spans challenger and charger', () => {
    const v = lookupVariant('hellcat');
    expect(v?.fitments.map((f) => f.modelLike[0]).sort()).toEqual(['Challenger', 'Charger']);
  });

  test('unknown variants return undefined', () => {
    expect(lookupVariant('zestfulness')).toBeUndefined();
  });
});

// EPA configuration names differ from curated family names. Missing mappings
// below are measured coverage gaps, never claims that the vehicle did not exist.
const publicRows: Record<string, string>[] = parse(
  readFileSync(new URL('../../data/epa-sample.csv', import.meta.url)),
  { columns: true },
);
function hasIdentity(make: string, patterns: string[], min = 0, max = 9999): boolean {
  return publicRows.some(
    (r) =>
      r.make.toLowerCase() === make.toLowerCase() &&
      patterns.some((p) => likeToRegex(p).test(r.model)) &&
      Number(r.year) >= min &&
      Number(r.year) <= max,
  );
}

describe('knowledge structure and public source coverage', () => {
  test('every chassis mapping either has source identity evidence or a named coverage gap', () => {
    const missing = CHASSIS.filter(
      (c) => !c.jdmOnly && !hasIdentity(c.make, c.modelLike, c.yearMin, c.yearMax),
    );
    expect(missing.map((c) => `${c.make} ${c.code}`)).toEqual([
      'Porsche 964',
      'Porsche 993',
      'Porsche 996',
      'Porsche 997',
      'Porsche 991',
      'Porsche 992',
      'Chevrolet C1',
      'Chevrolet C2',
      'Chevrolet C3',
    ]);
    // EPA spells 911 configurations with suffixes; pre-1984 Corvette is outside coverage.
    expect(hasIdentity('Porsche', ['911%'], 1999, 2005)).toBe(true);
    expect(Math.min(...publicRows.map((r) => Number(r.year)))).toBe(1984);
  });

  test('engine fitment identity gaps are explicit; identity evidence does not verify the engine code', () => {
    const missing = ENGINES.filter((e) => !e.jdmOnly).flatMap((e) =>
      e.fitments
        .filter((f) => !hasIdentity(f.make, f.modelLike, f.yearMin, f.yearMax))
        .map((f) => `${e.code} → ${f.make} ${f.modelLike.join('/')}`),
    );
    expect(missing).toEqual(['2JZ → Lexus SC300', '2JZ → Lexus IS300', 'VQ35 → INFINITI FX35']);
    expect(publicRows[0]).not.toHaveProperty('engine_code');
  });

  test('model-word gaps are recorded independently of tokenizer expected answers', () => {
    const missing = MODEL_WORDS.filter(
      (m) => !m.jdmOnly && !hasIdentity(m.make, m.models, m.yearMin, m.yearMax),
    );
    expect(missing.map((m) => m.token)).toEqual([
      'gr86',
      '928',
      'm4',
      'm8',
      '1m',
      'z3',
      'z4',
      'passat',
      'beetle',
      'crx',
      '240z',
      '280z',
      '280zx',
      '510',
      '3000gt',
      'rs5',
      'rs7',
      'tts',
      'f150',
      'is300',
      'sc300',
      'sc400',
      'fx35',
      'stinger',
      'gallardo',
    ]);
  });

  test('all curated variant windows are valid and inside their referenced chassis windows', () => {
    for (const variant of VARIANTS) {
      expect(variant.trimContains.length).toBeGreaterThan(0);
      expect(variant.fitments.length).toBeGreaterThan(0);
      for (const fitment of variant.fitments) {
        expect(fitment.modelLike.length).toBeGreaterThan(0);
        for (const generation of fitment.generations ?? []) {
          const chassis = CHASSIS.find(
            (c) => c.code === generation.chassis && c.make === fitment.make,
          );
          expect(chassis).toBeDefined();
          expect(generation.yearMin).toBeGreaterThanOrEqual(chassis!.yearMin);
          expect(generation.yearMax).toBeLessThanOrEqual(chassis!.yearMax);
          expect(generation.yearMax).toBeGreaterThanOrEqual(generation.yearMin);
        }
      }
    }
    // A configuration model label can mention a variant, but EPA does not
    // supply an exhaustive trim column. No test manufactures one to prove lore.
    expect(publicRows[0]).not.toHaveProperty('trim');
  });
});
