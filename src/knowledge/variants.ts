import type { VariantEntry } from './types';

// Variant shorthand → where that trim actually exists in the data. A variant
// term may match the trim, submodel, OR model column (AMG lives in model
// names, Z06 in trims). Fitments are validated against the eval DB.

export const VARIANTS: VariantEntry[] = [
  // Porsche GT-car generations: the DB's own trim-years, so a chassis code
  // plus a trim term resolves to the generation's real model years instead
  // of the chassis calendar window (whose boundary years belong to the
  // neighboring generation).
  {
    term: 'GT3 RS',
    aliases: ['gt3rs'],
    trimContains: ['GT3 RS'],
    note: '911 GT3 RS',
    fitments: [
      {
        make: 'Porsche',
        modelLike: ['911'],
        generations: [
          { chassis: '997', yearMin: 2007, yearMax: 2012 },
          { chassis: '991', yearMin: 2016, yearMax: 2019 },
          { chassis: '992', yearMin: 2023, yearMax: 2026 },
        ],
      },
    ],
  },
  {
    term: 'GT3',
    trimContains: ['GT3'],
    note: '911 GT3 (includes RS and Touring Package)',
    fitments: [
      {
        make: 'Porsche',
        modelLike: ['911'],
        generations: [
          { chassis: '996', yearMin: 2001, yearMax: 2005 },
          { chassis: '997', yearMin: 2007, yearMax: 2012 },
          { chassis: '991', yearMin: 2014, yearMax: 2019 },
          { chassis: '992', yearMin: 2022, yearMax: 2026 },
        ],
      },
    ],
  },
  {
    term: 'GT2 RS',
    aliases: ['gt2rs'],
    trimContains: ['GT2 RS'],
    note: '911 GT2 RS',
    fitments: [
      {
        make: 'Porsche',
        modelLike: ['911'],
        generations: [
          { chassis: '997', yearMin: 2011, yearMax: 2011 },
          { chassis: '991', yearMin: 2018, yearMax: 2019 },
        ],
      },
    ],
  },
  {
    term: 'GT2',
    trimContains: ['GT2'],
    note: '911 GT2 (Kia Stinger also uses a GT2 trim)',
    fitments: [
      {
        make: 'Porsche',
        modelLike: ['911'],
        generations: [
          { chassis: '996', yearMin: 2002, yearMax: 2005 },
          { chassis: '997', yearMin: 2008, yearMax: 2011 },
        ],
      },
    ],
  },
  {
    term: 'GT4',
    trimContains: ['GT4'],
    note: 'Cayman GT4',
    fitments: [{ make: 'Porsche', modelLike: ['Cayman', '718 Cayman'] }],
  },
  {
    term: 'Touring',
    trimContains: ['Touring'],
    note: '911 GT3 Touring Package',
    fitments: [{ make: 'Porsche', modelLike: ['911'] }],
  },
  {
    term: 'Z06',
    aliases: ['z06'],
    trimContains: ['Z06'],
    note: 'Corvette Z06',
    fitments: [{ make: 'Chevrolet', modelLike: ['Corvette'] }],
  },
  {
    term: 'ZR1',
    aliases: ['zr-1', 'zr1'],
    trimContains: ['ZR1', 'ZR-1'],
    note: 'Corvette ZR1 (C4 wrote it ZR-1)',
    fitments: [{ make: 'Chevrolet', modelLike: ['Corvette'] }],
  },
  {
    term: 'Grand Sport',
    trimContains: ['Grand Sport'],
    note: 'Corvette Grand Sport',
    fitments: [{ make: 'Chevrolet', modelLike: ['Corvette'] }],
  },
  {
    term: 'Type R',
    aliases: ['type-r', 'typer'],
    trimContains: ['Type R'],
    note: 'Honda Civic Type R / Acura Integra Type R',
    fitments: [
      { make: 'Honda', modelLike: ['Civic%'] },
      { make: 'Acura', modelLike: ['Integra'] },
    ],
  },
  {
    term: 'STI',
    trimContains: ['STI'],
    note: 'Subaru WRX STI',
    fitments: [{ make: 'Subaru', modelLike: ['WRX%', 'Impreza%'] }],
  },
  {
    term: 'Evo',
    aliases: ['evolution', 'evo8', 'evo9', 'evo viii', 'evo ix'],
    trimContains: ['Evolution'],
    note: 'Mitsubishi Lancer Evolution',
    fitments: [{ make: 'Mitsubishi', modelLike: ['Lancer%'] }],
  },
  {
    term: 'AMG',
    trimContains: ['AMG'],
    note: 'Mercedes-AMG models',
    fitments: [{ make: 'Mercedes-Benz', modelLike: ['%AMG%'] }],
  },
  {
    term: 'Quadrifoglio',
    aliases: ['qv'],
    trimContains: ['Quadrifoglio'],
    note: 'Alfa Romeo Quadrifoglio',
    fitments: [{ make: 'Alfa Romeo', modelLike: ['Giulia', 'Stelvio'] }],
  },
  {
    term: 'Hellcat',
    trimContains: ['Hellcat'],
    note: 'Dodge SRT Hellcat',
    fitments: [
      { make: 'Dodge', modelLike: ['Challenger'] },
      { make: 'Dodge', modelLike: ['Charger'] },
    ],
  },
  {
    term: 'Raptor',
    trimContains: ['Raptor'],
    note: 'Ford F-150 Raptor',
    fitments: [{ make: 'Ford', modelLike: ['F-150'] }],
  },
  {
    term: 'CSL',
    trimContains: ['CSL'],
    note: 'BMW M4 CSL (the E46 M3 CSL never came to the US)',
    fitments: [{ make: 'BMW', modelLike: ['M4'] }],
  },
  {
    term: 'Competition',
    aliases: ['comp'],
    trimContains: ['Competition'],
    note: 'BMW M Competition',
    fitments: [{ make: 'BMW', modelLike: ['M3', 'M4', 'M5'] }],
  },
];
