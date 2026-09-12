import type { InspectorDeps } from '@/inspector/inspector';
import type { InspectorInput } from '@/inspector/types';

// Recorded fixtures for the inspector eval suite. Everything the agent
// would fetch or generate live is pinned here, so the full orchestration
// runs offline and deterministically — the suite grades the agent's
// decisions, not the network's mood.

export const FROZEN_NOW = new Date('2026-08-13T12:00:00.000Z');

export const M3_INPUT: InspectorInput = {
  photos: [
    { kind: 'url', url: 'https://example.com/front.jpg' },
    { kind: 'url', url: 'https://example.com/rear.jpg' },
    { kind: 'url', url: 'https://example.com/engine.jpg' },
  ],
  make: 'BMW',
  model: 'M3',
  year: 2004,
  vin: 'WBSBL93424PN58876',
  askingPrice: 30000,
  listing: {
    title: 'Original-Owner 2004 BMW M3 Coupe',
    url: 'https://bringatrailer.com/listing/2004-bmw-m3-coupe-247/',
    source: 'Bring a Trailer',
    condition: 'Used',
  },
};

// -- Vision fixtures (raw model output, pre-validation) -------------------------

export const VISION_CLEAN = {
  observations: [
    { photo: 0, note: 'front three-quarter, straight panels, even gaps' },
    { photo: 1, note: 'rear clean, original spoiler' },
    { photo: 2, note: 'engine bay stock and dry' },
  ],
  overallCondition: 'excellent',
  issues: [],
  modifications: [],
  wear: [],
  confidence: 0.9,
};

export const VISION_RUSTY = {
  observations: [
    { photo: 0, note: 'bubbling at both rear arches' },
    { photo: 1, note: 'undercoating overspray near sills' },
  ],
  overallCondition: 'fair',
  issues: [
    {
      type: 'rust',
      severity: 'high',
      description: 'rust bubbling at rear wheel arches with fresh undercoat nearby',
      location: 'rear arches',
      photos: [0, 1],
    },
  ],
  modifications: [],
  wear: [],
  confidence: 0.8,
};

// Anchors out of range: 7 and -1 must be dropped; the finding survives with
// none rather than being assigned one.
export const VISION_BAD_ANCHORS = {
  ...VISION_CLEAN,
  overallCondition: 'good',
  issues: [
    {
      type: 'paint_issue',
      severity: 'medium',
      description: 'respray blend visible on driver door',
      location: 'driver door',
      photos: [7, -1],
    },
  ],
};

export const VISION_GARBAGE = { totally: 'not a vision payload' };

// -- Web research fixtures --------------------------------------------------------

export const WEB_MIXED_CITATIONS = {
  findings: [
    {
      topic: 'rust repair',
      summary: 'E46 arch rust spreads under the seam sealer; proper repair means cutting',
      severity: 'concern',
      costEstimate: '$1,500-3,000',
      sources: [
        { url: 'https://www.m3forum.net/threads/arch-rust.123/', title: 'Arch rust thread' },
      ],
    },
    {
      topic: 'subframe',
      summary: 'rear subframe cracking is the E46 tax',
      severity: 'critical',
      sources: [
        { url: 'https://www.e46fanatics.com/threads/subframe.99/', title: 'Subframe megathread' },
      ],
    },
    {
      topic: 'uncited claim',
      summary: 'this claim has no source and must be discarded',
      severity: 'critical',
      sources: [],
    },
    {
      topic: 'bad url claim',
      summary: 'this claim cites a non-http source and must be discarded',
      severity: 'concern',
      sources: [{ url: 'not-a-url', title: 'nope' }],
    },
  ],
};

// -- NHTSA fixture (speaks the real endpoint shapes) --------------------------------

export function nhtsaFetcherFixture(structureComplaints = 3) {
  let odi = 0;
  return async (url: string): Promise<unknown> => {
    if (url.includes('/products/vehicle/models')) {
      return { results: [{ make: 'BMW', model: 'M3' }] };
    }
    if (url.includes('complaintsByVehicle')) {
      return {
        results: Array.from({ length: structureComplaints }, () => ({
          odiNumber: ++odi,
          components: 'STRUCTURE',
          summary: 'subframe cracked',
          crash: false,
          fire: false,
        })),
      };
    }
    return { results: [] };
  };
}

export const nhtsaDown = async (): Promise<unknown> => {
  throw new Error('NHTSA 502');
};

// -- vPIC fixtures -------------------------------------------------------------------

export const VPIC_MATCHING = {
  Results: [
    {
      Make: 'BMW',
      Model: 'M3',
      ModelYear: '2004',
      BodyClass: 'Coupe',
      DisplacementL: '3.2',
      EngineCylinders: '6',
      PlantCity: 'REGENSBURG',
      PlantCountry: 'GERMANY',
    },
  ],
};

export const VPIC_MISMATCH = {
  Results: [{ Make: 'HONDA', Model: 'CIVIC', ModelYear: '2004', BodyClass: 'Sedan' }],
};

// -- Sweep fixture ---------------------------------------------------------------------

export const SWEEP_MIXED = {
  sightings: [
    {
      url: 'https://bringatrailer.com/listing/2004-bmw-m3-coupe-247/',
      title: 'the subject listing itself — must be excluded',
    },
    {
      url: 'https://www.m3post.com/forums/showthread.php?t=99',
      title: 'FS: 2004 M3 coupe',
      date: 'March 2024',
      note: 'asked $38,500',
    },
    { url: 'garbage', title: 'uncited — must be dropped' },
  ],
};

// -- Deps factory ------------------------------------------------------------------------

// Plain async stubs — the suite runs under tsx, not vitest.
export const returns = (value: unknown) => async (): Promise<unknown> => value;

export function fixtureDeps(overrides: Partial<InspectorDeps> = {}): InspectorDeps {
  return {
    visionCaller: returns(VISION_CLEAN),
    webCaller: null,
    sweepCaller: null,
    vpicFetcher: null,
    photoProbe: null,
    vinHistory: null,
    nhtsaFetcher: nhtsaFetcherFixture(0),
    now: () => FROZEN_NOW,
    ...overrides,
  };
}
