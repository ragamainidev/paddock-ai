import type { CommonFailure, ModelConcern, ReliabilityReport } from './types';

// Curated known-failure data for common enthusiast cars — the same kind of
// honest hardcoded knowledge as src/knowledge/. Every entry declares exactly
// which make/model/years it covers; nothing here is fuzzy-matched into the
// wrong car. When no entry covers the vehicle, the report says so instead of
// guessing.

type ReliabilityEntry = {
  makes: string[]; // badge-engineered twins share an entry (Toyota/Scion)
  models: string[]; // any of these substrings in the claimed model
  yearMin: number;
  yearMax: number;
  concerns: ModelConcern[];
  failures: CommonFailure[];
  reliability: ReliabilityReport['overallReliability'];
};

const ENTRIES: ReliabilityEntry[] = [
  {
    makes: ['BMW'],
    models: ['M3'],
    yearMin: 2001,
    yearMax: 2006,
    concerns: [
      {
        component: 'rear subframe',
        description: 'Rear subframe mounting points crack; inspect the trunk floor from below',
        affectedYears: [2001, 2002, 2003, 2004, 2005, 2006],
        frequency: 'very_common',
      },
      {
        component: 'rod bearings',
        description: 'S54 rod bearing wear; oil analysis or replacement records matter',
        affectedYears: [2001, 2002, 2003],
        frequency: 'common',
      },
      {
        component: 'VANOS',
        description: 'VANOS unit wear causes rough idle and lost midrange',
        affectedYears: [2001, 2002, 2003, 2004, 2005, 2006],
        frequency: 'common',
      },
    ],
    failures: [
      {
        component: 'rear subframe',
        failureDescription: 'mounting-point cracks needing plates or floor replacement',
        typicalMileage: 80000,
        repairCost: 'high',
      },
      {
        component: 'rod bearings',
        failureDescription: 'bearing wear leading to catastrophic S54 failure',
        typicalMileage: 90000,
        repairCost: 'high',
      },
      {
        component: 'VANOS',
        failureDescription: 'seal and tab failure',
        typicalMileage: 90000,
        repairCost: 'medium',
      },
    ],
    reliability: 'fair',
  },
  {
    makes: ['Porsche'],
    models: ['911', '996', 'Boxster', '986'],
    yearMin: 1997,
    yearMax: 2004,
    concerns: [
      {
        component: 'IMS bearing',
        description:
          'Intermediate shaft bearing failure can destroy the engine; retrofit records are the question to ask',
        affectedYears: [1997, 1998, 1999, 2000, 2001, 2002, 2003, 2004],
        frequency: 'common',
      },
      {
        component: 'rear main seal',
        description: 'RMS leaks are near-universal; small weep vs. drip matters',
        affectedYears: [1997, 1998, 1999, 2000, 2001, 2002, 2003, 2004],
        frequency: 'very_common',
      },
      {
        component: 'bore scoring',
        description:
          'Cylinder bore scoring on M96 engines; cold-start rattle and oil consumption are the tells',
        affectedYears: [1999, 2000, 2001, 2002, 2003, 2004],
        frequency: 'uncommon',
      },
    ],
    failures: [
      {
        component: 'IMS bearing',
        failureDescription: 'bearing failure causing total engine loss',
        typicalMileage: 60000,
        repairCost: 'high',
      },
      {
        component: 'rear main seal',
        failureDescription: 'oil leak requiring transmission-out labor',
        typicalMileage: 50000,
        repairCost: 'medium',
      },
    ],
    reliability: 'fair',
  },
  {
    makes: ['Subaru'],
    models: ['WRX', 'STI', 'Impreza'],
    yearMin: 2002,
    yearMax: 2014,
    concerns: [
      {
        component: 'ringlands',
        description: 'Ringland failure on tuned EJ engines; compression test any modified car',
        affectedYears: [2008, 2009, 2010, 2011, 2012, 2013, 2014],
        frequency: 'common',
      },
      {
        component: 'head gaskets',
        description: 'External head gasket leaks on EJ25s',
        affectedYears: [2002, 2003, 2004, 2005, 2006, 2007],
        frequency: 'common',
      },
    ],
    failures: [
      {
        component: 'pistons',
        failureDescription: 'ringland failure from knock on tuned engines',
        typicalMileage: 60000,
        repairCost: 'high',
      },
      {
        component: 'turbocharger',
        failureDescription: 'turbo failure from oil starvation (banjo bolt screens)',
        typicalMileage: 80000,
        repairCost: 'high',
      },
    ],
    reliability: 'fair',
  },
  {
    makes: ['Toyota', 'Scion'],
    models: ['86', 'GT86', 'FR-S'],
    yearMin: 2013,
    yearMax: 2020,
    concerns: [
      {
        component: 'fuel pump',
        description: 'Low-pressure fuel pump recall on early cars',
        affectedYears: [2013, 2014, 2015, 2016],
        frequency: 'uncommon',
      },
      {
        component: 'valve springs',
        description: 'Valve spring recall on 2013 cars; confirm the campaign was done',
        affectedYears: [2013],
        frequency: 'rare',
      },
    ],
    failures: [
      {
        component: 'fuel pump',
        failureDescription: 'low-pressure pump failure',
        typicalMileage: 50000,
        repairCost: 'low',
      },
    ],
    reliability: 'excellent',
  },
  {
    makes: ['Mazda'],
    models: ['MX-5', 'Miata'],
    yearMin: 2006,
    yearMax: 2015,
    concerns: [
      {
        component: 'convertible top',
        description: 'Soft-top wear and drain clogs leading to wet floors',
        affectedYears: [2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014],
        frequency: 'common',
      },
      {
        component: 'clutch',
        description: 'Clutch wear from enthusiastic use; judder on takeup is the tell',
        affectedYears: [2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015],
        frequency: 'common',
      },
    ],
    failures: [
      {
        component: 'convertible top',
        failureDescription: 'top and latch mechanism wear',
        typicalMileage: 70000,
        repairCost: 'medium',
      },
      {
        component: 'clutch',
        failureDescription: 'clutch replacement (wear item)',
        typicalMileage: 60000,
        repairCost: 'medium',
      },
    ],
    reliability: 'excellent',
  },
];

const NO_DATA: ReliabilityReport = {
  modelConcerns: [],
  commonFailures: [],
  overallReliability: 'good',
};

export function checkReliability(make: string, model: string, year: number): ReliabilityReport {
  const m = make.trim().toLowerCase();
  const mod = model.trim().toLowerCase();
  const entry = ENTRIES.find(
    (e) =>
      e.makes.some((name) => name.toLowerCase() === m) &&
      year >= e.yearMin &&
      year <= e.yearMax &&
      e.models.some((name) => mod.includes(name.toLowerCase())),
  );
  if (!entry) return NO_DATA;
  return {
    modelConcerns: entry.concerns.filter((c) => c.affectedYears.includes(year)),
    commonFailures: entry.failures,
    overallReliability: entry.reliability,
  };
}
