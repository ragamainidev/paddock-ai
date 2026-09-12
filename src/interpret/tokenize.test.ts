import { describe, expect, test } from 'vitest';
import type { Branch } from '@/lib/types';
import { tokenize } from './tokenize';

function only(query: string): Branch {
  const i = tokenize(query);
  expect(i.branches, `expected one branch for "${query}"`).toHaveLength(1);
  return i.branches[0];
}

describe('chassis codes', () => {
  test('e46 m3 pins make, model, and the chassis year window', () => {
    const b = only('e46 m3');
    expect(b.constraint).toMatchObject({
      make: 'BMW',
      models: ['M3'],
      yearMin: 1999,
      yearMax: 2006,
    });
    expect(b.assumptions.some((a) => a.source === 'chassis' && a.input === 'e46')).toBe(true);
  });

  test('F80 M3 is the 2015–2018 car, case-insensitively', () => {
    expect(only('F80 M3').constraint).toMatchObject({ yearMin: 2015, yearMax: 2018 });
  });

  test('996 turbo reads turbo as the 911 Turbo trim, not aspiration', () => {
    const b = only('996 turbo');
    expect(b.constraint).toMatchObject({
      make: 'Porsche',
      models: ['911'],
      yearMin: 1999,
      yearMax: 2005,
      trimContains: [['Turbo']],
    });
    expect(b.constraint.aspiration).toBeUndefined();
    expect(b.assumptions.some((a) => a.meaning.includes('trim'))).toBe(true);
  });

  test('turbo miata keeps turbo as aspiration', () => {
    const b = only('turbo miata');
    expect(b.constraint).toMatchObject({ make: 'Mazda', aspiration: 'Turbo' });
    expect(b.constraint.trimContains).toBeUndefined();
  });

  test('miata na resolves na as the chassis, given mazda context', () => {
    const b = only('miata na');
    expect(b.constraint).toMatchObject({ make: 'Mazda', yearMin: 1990, yearMax: 1997 });
    expect(b.constraint.aspiration).toBeUndefined();
  });
});

describe('ambiguity forks', () => {
  test('c7 alone returns both branches and picks neither', () => {
    const i = tokenize('c7');
    expect(i.branches).toHaveLength(2);
    const makes = new Set(i.branches.map((b) => b.constraint.make));
    expect(makes).toEqual(new Set(['Chevrolet', 'Audi']));
  });

  test('c7 rs7 collapses to the Audi', () => {
    const b = only('c7 rs7');
    expect(b.constraint).toMatchObject({
      make: 'Audi',
      models: ['RS7%'],
      yearMin: 2012,
      yearMax: 2018,
    });
  });

  test('c7 z06 collapses to the Corvette', () => {
    const b = only('c7 z06');
    expect(b.constraint).toMatchObject({
      make: 'Chevrolet',
      models: ['Corvette'],
      trimContains: [['Z06']],
    });
  });

  test('mk4 alone forks three ways', () => {
    expect(tokenize('mk4').branches).toHaveLength(3);
  });

  test('mk4 supra collapses to the 1993–1998 Supra', () => {
    const b = only('mk4 supra');
    expect(b.constraint).toMatchObject({
      make: 'Toyota',
      models: ['Supra'],
      yearMin: 1993,
      yearMax: 1998,
    });
  });

  test('mk4 supra tt adds the Turbo trim via twin-turbo context', () => {
    const b = only('mk4 supra tt');
    expect(b.constraint.trimContains).toEqual([['Turbo']]);
    expect(b.constraint.aspiration).toBeUndefined();
  });

  test('audi tt is the TT model, not a turbo', () => {
    const b = only('audi tt');
    expect(b.constraint).toMatchObject({ make: 'Audi', models: ['TT%'] });
    expect(b.constraint.aspiration).toBeUndefined();
  });
});

describe('malformed input', () => {
  test('gt3rs normalizes to the GT3 RS variant', () => {
    const b = only('gt3rs');
    expect(b.constraint).toMatchObject({
      make: 'Porsche',
      models: ['911'],
      trimContains: [['GT3 RS']],
    });
  });

  test('992gt3 splits into chassis and variant, and generation-refines', () => {
    const b = only('992gt3');
    expect(b.constraint).toMatchObject({
      make: 'Porsche',
      models: ['911'],
      // 2022, not the 992 chassis window's 2019: the 992 GT3's first US
      // model year comes from the variant generation table.
      yearMin: 2022,
      trimContains: [['GT3']],
    });
  });

  test('992 gt3 touring stacks trims with AND semantics', () => {
    expect(only('992 gt3 touring').constraint.trimContains).toEqual([['GT3'], ['Touring']]);
  });
});

describe('engine codes', () => {
  test('2jz unions its three US fitments', () => {
    const b = only('2jz');
    expect(b.constraint.anyOf).toHaveLength(3);
    expect(b.constraint.anyOf![0]).toMatchObject({ make: 'Toyota', models: ['Supra'] });
    expect(b.assumptions.some((a) => a.source === 'engine')).toBe(true);
  });

  test('ls1 unions corvette and camaro', () => {
    const makes = only('ls1').constraint.anyOf!.map((f) => f.models![0]);
    expect(makes.sort()).toEqual(['Camaro', 'Corvette']);
  });

  test('1jz is honest about never being sold here', () => {
    const b = only('1jz');
    expect(b.constraint.anyOf).toBeUndefined();
    expect(b.constraint.make).toBeUndefined();
    expect(b.assumptions.some((a) => /JDM/i.test(a.reason))).toBe(true);
  });

  test('skyline maps to a model that matches zero US rows, with the reason attached', () => {
    const b = only('skyline');
    expect(b.constraint).toMatchObject({ make: 'Nissan', models: ['Skyline%'] });
    expect(b.assumptions.some((a) => /never sold/i.test(a.reason))).toBe(true);
  });
});

describe('variants without context', () => {
  test('type r unions honda and acura fitments', () => {
    const b = only('type r');
    expect(b.constraint.anyOf).toHaveLength(2);
    for (const f of b.constraint.anyOf!) expect(f.trimContains).toEqual(['Type R']);
  });

  test('civic type r applies the trim inside honda context', () => {
    const b = only('civic type r');
    expect(b.constraint).toMatchObject({
      make: 'Honda',
      models: ['Civic%'],
      trimContains: [['Type R']],
    });
    expect(b.constraint.anyOf).toBeUndefined();
  });

  test('hellcat unions challenger and charger', () => {
    const models = only('hellcat').constraint.anyOf!.map((f) => f.models![0]);
    expect(models.sort()).toEqual(['Challenger', 'Charger']);
  });
});

describe('negations', () => {
  test('911 no pdk becomes an unfilterable, not a filter', () => {
    const b = only('911 no pdk');
    const u = b.constraint.unfilterable!;
    expect(u.some((x) => /pdk/i.test(x.term))).toBe(true);
    expect(b.constraint.exclude).toBeUndefined();
  });

  test('996 no turbo excludes the Turbo trim in 911 context', () => {
    const b = only('996 no turbo');
    expect(b.constraint.exclude?.trimContains).toEqual(['Turbo']);
    expect(b.constraint.trimContains).toBeUndefined();
  });

  test('na not turbo pins NA and excludes turbo aspiration', () => {
    const b = only('na not turbo');
    expect(b.constraint.aspiration).toBe('NA');
    expect(b.constraint.exclude?.aspiration).toEqual(['Turbo']);
  });
});

describe('spec keywords and unfilterables', () => {
  test('brown wagon manual diesel filters what it can, forwards what it cannot', () => {
    const b = only('brown wagon manual diesel');
    expect(b.constraint).toMatchObject({ body: 'Wagon', fuel: 'DIESEL' });
    const terms = b.constraint.unfilterable!.map((u) => u.term).sort();
    expect(terms).toEqual(['brown', 'manual']);
    for (const u of b.constraint.unfilterable!) expect(u.forwardedToListings).toBe(true);
    expect(tokenize('brown wagon manual diesel').unparsed).toEqual([]);
  });

  test('naturally aspirated flat six manual coupe', () => {
    const b = only('naturally aspirated flat six manual coupe');
    expect(b.constraint).toMatchObject({
      aspiration: 'NA',
      blockType: 'H',
      cylinders: 6,
      body: 'Coupe',
    });
    expect(b.constraint.unfilterable![0].term).toBe('manual');
  });

  test('v10 is a pure spec query', () => {
    expect(only('v10').constraint).toMatchObject({ blockType: 'V', cylinders: 10 });
  });

  test('awd wagon', () => {
    expect(only('awd wagon').constraint).toMatchObject({ drive: 'AWD', body: 'Wagon' });
  });
});

describe('years', () => {
  test('911 90s reads a decade', () => {
    expect(only('911 90s').constraint).toMatchObject({ yearMin: 1990, yearMax: 1999 });
  });

  test('e30 1990 narrows the chassis window to one year', () => {
    expect(only('e30 1990').constraint).toMatchObject({ yearMin: 1990, yearMax: 1990 });
  });

  test('supra 1993-1998 reads a range', () => {
    expect(only('supra 1993-1998').constraint).toMatchObject({ yearMin: 1993, yearMax: 1998 });
  });

  test('wrx 2019+ is a floor', () => {
    const c = only('wrx 2019+').constraint;
    expect(c.yearMin).toBe(2019);
    expect(c.yearMax).toBeUndefined();
  });

  test('pre-2005 wrx is a ceiling', () => {
    const c = only('pre-2005 wrx').constraint;
    expect(c.yearMax).toBe(2004);
    expect(c.yearMin).toBeUndefined();
  });

  test('an impossible year intersection is preserved, not papered over', () => {
    const c = only('996 2010').constraint;
    expect(c.yearMin).toBe(2010);
    expect(c.yearMax).toBe(2005);
  });
});

describe('honesty', () => {
  test('unknown tokens land in unparsed', () => {
    const i = tokenize('e46 m3 zorp');
    expect(i.unparsed).toEqual(['zorp']);
    expect(i.branches).toHaveLength(1);
  });

  test('an empty query produces nothing', () => {
    const i = tokenize('   ');
    expect(i.branches).toEqual([]);
    expect(i.unparsed).toEqual([]);
  });

  test('a make alone is a valid constraint', () => {
    expect(only('porsche').constraint).toEqual({ make: 'Porsche' });
  });

  test('contradictions kill the branch and say why', () => {
    const i = tokenize('porsche civic');
    expect(i.branches).toEqual([]);
    expect(i.conflicts.length).toBeGreaterThan(0);
  });

  test('every branch label is non-empty', () => {
    for (const q of ['c7', 'mk4', '2jz', 'e46 m3', 'brown wagon manual diesel']) {
      for (const b of tokenize(q).branches) {
        expect(b.label.trim().length, `label for "${q}"`).toBeGreaterThan(0);
      }
    }
  });
});

describe('variant generation refinement', () => {
  test('991 gt3rs narrows to the 991-generation RS years, not the chassis calendar window', () => {
    const [branch] = tokenize('991 gt3rs').branches;
    expect(branch.constraint.make).toBe('Porsche');
    // MY2012 GT3 RS rows are 997s; the refined window must exclude them.
    expect(branch.constraint.yearMin).toBe(2016);
    expect(branch.constraint.yearMax).toBe(2019);
    const chip = branch.assumptions.find((a) => a.input === 'gt3rs');
    expect(chip?.meaning).toContain('991');
    expect(chip?.meaning).toContain('2016–2019');
  });

  test('token order does not matter: gt3rs 991 refines identically', () => {
    const [branch] = tokenize('gt3rs 991').branches;
    expect(branch.constraint.yearMin).toBe(2016);
    expect(branch.constraint.yearMax).toBe(2019);
  });

  test('997 gt3 keeps the 997-generation GT3 years', () => {
    const [branch] = tokenize('997 gt3').branches;
    expect(branch.constraint.yearMin).toBe(2007);
    expect(branch.constraint.yearMax).toBe(2012);
  });

  test('a chassis with no generation entry for the trim leaves the window alone', () => {
    // The GT3 table has no 964 entry; the chassis window must survive as-is.
    const [branch] = tokenize('992 touring').branches;
    expect(branch.constraint.yearMin).toBe(2019);
  });

  test('the variant alone still carries no year window', () => {
    const [branch] = tokenize('gt3rs').branches;
    expect(branch.constraint.yearMin).toBeUndefined();
  });
});

describe('generation catalog: ordinals and facelift phases', () => {
  test.each(['gen 1 facelift audi r8', 'audi r8 gen 1', 'gen 9 audi r8', 'facelift audi r8'])(
    '%s preserves source-backed identity and states missing generation research',
    (query) => {
      const result = tokenize(query);
      const branch = result.branches[0];
      expect(branch.constraint.make).toBe('Audi');
      expect(branch.constraint.models).toEqual(['R8']);
      expect(branch.constraint.yearMin).toBeUndefined();
      expect(branch.constraint.yearMax).toBeUndefined();
      expect(branch.assumptions.find((a) => a.source === 'generation')).toMatchObject({
        meaning: 'no generation data for this vehicle yet',
        reason: expect.stringContaining(
          'independently sourced generation boundaries are unavailable',
        ),
      });
      expect(result.unparsed).toEqual([]);
    },
  );

  test('generation words without a cataloged family say so instead of narrowing', () => {
    const [branch] = tokenize('gen 2 e46 m3').branches;
    expect(branch.constraint.yearMin).toBe(1999); // chassis window untouched
    const chip = branch.assumptions.find((a) => a.source === 'generation');
    expect(chip?.meaning).toMatch(/no generation data/);
  });

  test('mk ordinals only reach the catalog when no chassis code claims them', () => {
    // mk4 is a Supra chassis alias — the chassis table must keep winning.
    const [branch] = tokenize('mk4 supra').branches;
    expect(branch.constraint.make).toBe('Toyota');
    expect(branch.assumptions.some((a) => a.source === 'chassis')).toBe(true);
  });
});

test.each(['ls3', 'chevrolet ls3', 'bmw s54'])(
  'engine identity %s keeps known attributes and an unresolved exact code',
  (query) => {
    const c = only(query).constraint;
    const isLs3 = query.includes('ls3');
    expect(c).toMatchObject({
      cylinders: isLs3 ? 8 : 6,
      blockType: isLs3 ? 'V' : 'L',
      displacement: isLs3 ? 6.2 : 3.2,
    });
    expect(c.unfilterable).toContainEqual({
      term: isLs3 ? 'LS3' : 'S54',
      reason: 'catalog does not verify exact engine codes',
      forwardedToListings: true,
    });
  },
);

test('a later keyword cannot replace known engine attributes with a contradiction', () => {
  const result = tokenize('ls3 v6');
  expect(result.branches).toEqual([]);
  expect(result.conflicts).toContain('v6 contradicts the requested engine configuration');
});
