import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { VehicleCard } from './vehicle-card';
test('catalog candidates display unverified filters and observed years without trim-year claims', () => {
  const html = renderToStaticMarkup(
    createElement(VehicleCard, {
      href: '/search?q=toyota',
      selected: false,
      vehicle: {
        make: 'Toyota',
        model: 'Supra',
        yearMin: 1995,
        yearMax: 1995,
        trims: [],
        engines: [],
        body: [],
        drive: [],
        score: 1,
        reasons: ['make Toyota'],
        rowCount: 2,
        catalogYears: [1995],
        unresolved: ['engine layout', 'excluding aspiration Turbo'],
      },
    }),
  );
  expect(html).toContain('Unresolved:');
  expect(html).toContain('engine layout');
  expect(html).toContain('catalog years');
  expect(html).toContain('catalog records');
  expect(html).not.toContain('trim-years');
});
