import type { MarketComp } from './types';

// Hand-curated real listings, seeded because no live listing API is
// configured. Every entry is a real Bring a Trailer auction: real VIN, real
// sold price, and photo URLs verified (HTTP 200, image/*) on the collection
// date. Nothing here is invented; provenance is the listing URL. The app
// fetches nothing from BaT at runtime — photos are hotlinked by the browser
// and by the vision API only when a user inspects that car.
//
// Collected: 2026-08-13. If photos rot, replace the entry, don't patch URLs.
// Descriptions are independently phrased summaries of recorded listing
// claims, not seller quotations or independent condition/history checks.
// WRX sale price corrected against its source auction on 2026-09-13.

export type SeedListing = {
  id: string;
  title: string;
  make: string;
  model: string;
  year: number;
  vin: string;
  price: number; // final sale price in USD
  soldOn: string;
  url: string;
  source: 'Bring a Trailer';
  photos: string[];
  description: string; // original summary of recorded listing claims
};

export const SEED_LISTINGS: SeedListing[] = [
  {
    id: 'e46-m3-original-owner',
    title: 'Original-Owner 2004 BMW M3 Coupe',
    make: 'BMW',
    model: 'M3',
    year: 2004,
    vin: 'WBSBL93424PN58876',
    price: 49000,
    soldOn: '2026-08-12',
    url: 'https://bringatrailer.com/listing/2004-bmw-m3-coupe-247/',
    source: 'Bring a Trailer',
    photos: [
      'https://bringatrailer.com/wp-content/uploads/2026/07/IMG_3697-scaled-copy-2026-07-31-bxm-58334.jpeg',
      'https://bringatrailer.com/wp-content/uploads/2026/07/2004_bmw_m3-coupe_IMG_3690-87017-scaled-1-copy-2026-07-31-vul-58447.jpeg',
      'https://bringatrailer.com/wp-content/uploads/2026/07/2004_bmw_m3-coupe_IMG_4074-86697-scaled-1-copy-2026-07-31-knx-58471.jpeg',
      'https://bringatrailer.com/wp-content/uploads/2026/07/2004_bmw_m3-coupe_IMG_4040-87371-scaled-1-copy-2026-07-31-97n-58494.jpeg',
      'https://bringatrailer.com/wp-content/uploads/2026/07/IMG_4049-scaled-copy-2026-07-31-gpd-58384.jpeg',
      'https://bringatrailer.com/wp-content/uploads/2026/07/IMG_3770-scaled-copy-2026-07-31-skm-58419.jpeg',
      'https://bringatrailer.com/wp-content/uploads/2026/07/IMG_4037-scaled-copy-2026-07-31-5jv-58520.jpeg',
    ],
    description:
      'Recorded listing: 35,000 miles; SMG gearbox; gray paint with red upholstery; modified bodywork and wheels.',
  },
  {
    id: 'e46-m3-supercharged',
    title: 'Supercharged 2004 BMW M3 Coupe 6-Speed',
    make: 'BMW',
    model: 'M3',
    year: 2004,
    vin: 'WBSBL93424PN58585',
    price: 22300,
    soldOn: '2026-08-06',
    url: 'https://bringatrailer.com/listing/2004-bmw-m3-coupe-246/',
    source: 'Bring a Trailer',
    photos: [
      'https://bringatrailer.com/wp-content/uploads/2026/07/DSC_1493-1-scaled-copy-2026-07-29-p0j-58373.jpeg',
      'https://bringatrailer.com/wp-content/uploads/2026/07/DSC_1420-1-scaled-copy-2026-07-29-mrr-58460.jpeg',
      'https://bringatrailer.com/wp-content/uploads/2026/07/DSC_1468-1-scaled-copy-2026-07-29-x2e-58507.jpeg',
    ],
    description:
      'Recorded listing: manual gearbox and VF570 supercharger; black interior and exterior; upgraded brakes and suspension.',
  },
  {
    id: '996-carrera-1999',
    title: '1999 Porsche 911 Carrera Coupe 6-Speed',
    make: 'Porsche',
    model: '911',
    year: 1999,
    vin: 'WP0AA2997XS625539',
    price: 28350,
    soldOn: '2026-08-10',
    url: 'https://bringatrailer.com/listing/1999-porsche-911-carrera-coupe-218/',
    source: 'Bring a Trailer',
    photos: [
      'https://bringatrailer.com/wp-content/uploads/2026/07/DSC_0004-scaled-copy-2026-07-29-d1e-35083.jpg',
      'https://bringatrailer.com/wp-content/uploads/2026/07/DSC_0007-scaled-copy-2026-07-29-nb1-35135.jpg',
      'https://bringatrailer.com/wp-content/uploads/2026/07/DSC_0081-scaled-copy-2026-07-29-535-35156.jpg',
      'https://bringatrailer.com/wp-content/uploads/2026/07/DSC_0076-scaled-copy-2026-07-29-329-35178.jpg',
    ],
    description:
      'Recorded listing: 89,000 miles; manual gearbox and 3.4-liter engine; white exterior; aftermarket wheels and stereo.',
  },
  {
    id: 'wrx-2014-premium',
    title: '2014 Subaru Impreza WRX Premium 5-Speed',
    make: 'Subaru',
    model: 'WRX',
    year: 2014,
    vin: 'JF1GR7E6XEG250506',
    price: 13000,
    soldOn: '2026-07-20',
    url: 'https://bringatrailer.com/listing/2014-subaru-impreza-wrx-32/',
    source: 'Bring a Trailer',
    photos: [
      'https://bringatrailer.com/wp-content/uploads/2026/06/IMG_3819-scaled-copy-2026-07-07-2uw-59936.jpeg',
      'https://bringatrailer.com/wp-content/uploads/2026/06/IMG_3803-scaled-copy-2026-07-07-7or-59940.jpeg',
      'https://bringatrailer.com/wp-content/uploads/2026/06/IMG_3816-scaled-copy-2026-07-07-9bm-59955.jpeg',
      'https://bringatrailer.com/wp-content/uploads/2026/06/IMG_3781-scaled-copy-2026-07-07-kfk-59983.jpeg',
      'https://bringatrailer.com/wp-content/uploads/2026/06/IMG_3782-scaled-copy-2026-07-07-8y3-59984.jpeg',
      'https://bringatrailer.com/wp-content/uploads/2026/06/IMG_3789-scaled-copy-2026-07-07-yd1-62340.jpeg',
    ],
    description:
      'Recorded listing: 91,000 miles; five-speed manual and 2.5-liter turbo engine; silver exterior; heated seats and modified shifter.',
  },
  {
    id: 'frs-2014-supercharged',
    title: 'Original-Owner, Supercharged 2014 Scion FR-S 6-Speed',
    make: 'Scion',
    model: 'FR-S',
    year: 2014,
    vin: 'JF1ZNAA11E9707557',
    price: 12500,
    soldOn: '2026-05-26',
    url: 'https://bringatrailer.com/listing/2014-scion-fr-s-4/',
    source: 'Bring a Trailer',
    photos: [
      'https://bringatrailer.com/wp-content/uploads/2026/04/2014_scion_fr-s_2014_scion_fr-s_fa0c90d2-408c-4dbe-b3fe-0c8efc5ba60c-QBmLMs-58731-58732-scaled.jpg',
      'https://bringatrailer.com/wp-content/uploads/2026/04/2014_scion_fr-s_2014_scion_fr-s_bb438aed-5e88-4ec2-ac9e-39b87b6a580e-enFcK0-58719-58720-scaled.jpg',
      'https://bringatrailer.com/wp-content/uploads/2026/04/2014_scion_fr-s_2014_scion_fr-s_34d79940-f1d6-46ad-b5c0-36775b2e0a75-vVU5uT-58728-58729-scaled.jpg',
      'https://bringatrailer.com/wp-content/uploads/2026/04/2014_scion_fr-s_2014_scion_fr-s_663cc7aa-ca6f-4842-8788-cb23604113eb-idw7vn-58791-83517.jpg',
      'https://bringatrailer.com/wp-content/uploads/2026/04/2014_scion_fr-s_2014_scion_fr-s_fdec6899-4566-4670-b067-9792102a2cec-wCaYwI-58800-58801-scaled.jpg',
      'https://bringatrailer.com/wp-content/uploads/2026/04/2014_scion_fr-s_2014_scion_fr-s_3c3cd2a6-9f89-49d9-97f6-1bf3285c2025-j8frbu-58861-83540.jpg',
      'https://bringatrailer.com/wp-content/uploads/2026/04/2014_scion_fr-s_2014_scion_fr-s_4eff7f6a-5163-4b5b-ade3-0689d607049d-kea6wz-58881-58882-scaled.jpg',
    ],
    description:
      'Recorded listing: 79,000 miles; manual gearbox; Jackson Racing supercharger and cooling upgrades; aftermarket wheels and suspension.',
  },
  {
    id: 'nc-miata-2006-sport',
    title: '2006 Mazda MX-5 Miata Sport 6-Speed',
    make: 'Mazda',
    model: 'MX-5',
    year: 2006,
    vin: 'JM1NC25F860111135',
    price: 11750,
    soldOn: '2026-08-10',
    url: 'https://bringatrailer.com/listing/2006-mazda-mx-5-miata-119/',
    source: 'Bring a Trailer',
    photos: [
      'https://bringatrailer.com/wp-content/uploads/2026/07/IMG_2869-scaled-copy-2026-07-28-g0b-46392.jpeg',
      'https://bringatrailer.com/wp-content/uploads/2026/07/IMG_2834-scaled-copy-2026-07-28-cy5-46468.jpeg',
      'https://bringatrailer.com/wp-content/uploads/2026/07/IMG_2896-scaled-copy-2026-07-28-30i-46493.jpeg',
      'https://bringatrailer.com/wp-content/uploads/2026/07/IMG_2844-scaled-copy-2026-07-28-f6w-46497.jpeg',
      'https://bringatrailer.com/wp-content/uploads/2026/07/IMG_2850-scaled-copy-2026-07-28-7x0-46502.jpeg',
    ],
    description:
      'Recorded listing: 51,000 miles; six-speed manual; red exterior and black cloth; soft top and Bilstein suspension.',
  },
];

// Sold-price comps per platform, from the same BaT results pages, same
// collection date. Real sales, not asks — tighter signal than listings.
export type CompSet = {
  makes: string[]; // badge-engineered twins share a market (Scion/Toyota)
  models: string[]; // any of these substrings in the claimed model
  yearMin: number;
  yearMax: number;
  comps: MarketComp[];
};

export const COMPS_COLLECTED_ON = '2026-08-13';
export const COMPS_SOURCE = 'Bring a Trailer sold results';

export const COMP_SETS: CompSet[] = [
  {
    makes: ['BMW'],
    models: ['M3'],
    yearMin: 2001,
    yearMax: 2006,
    comps: [
      {
        title: 'Original-Owner 2004 BMW M3 Coupe',
        price: 49000,
        url: 'https://bringatrailer.com/listing/2004-bmw-m3-coupe-247/',
      },
      {
        title: '2003 BMW M3 Convertible',
        price: 32750,
        url: 'https://bringatrailer.com/listing/2003-bmw-m3-convertible-181/',
      },
      {
        title: '2002 BMW M3 Convertible 6-Speed',
        price: 26500,
        url: 'https://bringatrailer.com/listing/2002-bmw-m3-convertible-181/',
      },
      {
        title: '2003 BMW M3 Coupe 6-Speed',
        price: 26046,
        url: 'https://bringatrailer.com/listing/2003-bmw-m3-coupe-316/',
      },
      {
        title: '2003 BMW M3 Dinan S2 Convertible',
        price: 23750,
        url: 'https://bringatrailer.com/listing/2003-bmw-m3-convertible-177/',
      },
      {
        title: 'Supercharged 2004 BMW M3 Coupe 6-Speed',
        price: 22300,
        url: 'https://bringatrailer.com/listing/2004-bmw-m3-coupe-246/',
      },
      {
        title: 'CSL-Style 2004 BMW M3 Coupe 6-Speed Conversion',
        price: 96000,
        url: 'https://bringatrailer.com/listing/2004-bmw-m3-coupe-223/',
      },
      {
        title: '2001 BMW M3 Coupe 6-Speed',
        price: 76000,
        url: 'https://bringatrailer.com/listing/2001-bmw-m3-coupe-48/',
      },
      {
        title: '2004 BMW M3 Convertible',
        price: 13750,
        url: 'https://bringatrailer.com/listing/2004-bmw-m3-convertible-193/',
      },
      {
        title: 'Turbocharged 2004 BMW M3 Coupe 6-Speed',
        price: 54000,
        url: 'https://bringatrailer.com/listing/2004-bmw-m3-coupe-244/',
      },
    ],
  },
  {
    makes: ['Porsche'],
    models: ['911', '996'],
    yearMin: 1998,
    yearMax: 2005,
    comps: [
      {
        title: '34k-Mile 1999 Porsche 911 Carrera Coupe 6-Speed',
        price: 40500,
        url: 'https://bringatrailer.com/listing/1999-porsche-911-carrera-coupe-208-2/',
      },
      {
        title: '2002 Porsche 911 Carrera Coupe 6-Speed X51 PCA Race Car',
        price: 22000,
        url: 'https://bringatrailer.com/listing/2002-porsche-911-carrera-coupe-82/',
      },
      {
        title: '1999 Porsche 911 Carrera Coupe 6-Speed',
        price: 28350,
        url: 'https://bringatrailer.com/listing/1999-porsche-911-carrera-coupe-218/',
      },
      {
        title: '2002 Porsche 911 Carrera Cabriolet 6-Speed',
        price: 31250,
        url: 'https://bringatrailer.com/listing/2002-porsche-911-carrera-cabriolet-104/',
      },
      {
        title: '2002 Porsche 911 Carrera Coupe 6-Speed',
        price: 38000,
        url: 'https://bringatrailer.com/listing/2001-porsche-911-carrera-coupe-69/',
      },
      {
        title: '1999 Porsche 911 Carrera Coupe 6-Speed',
        price: 35250,
        url: 'https://bringatrailer.com/listing/1999-porsche-911-carrera-coupe-215/',
      },
      {
        title: '2000 Porsche 911 Carrera Coupe 6-Speed',
        price: 21500,
        url: 'https://bringatrailer.com/listing/2000-porsche-911-carrera-coupe-71/',
      },
      {
        title: '46k-Mile 2004 Porsche 911 Carrera Coupe 6-Speed',
        price: 40500,
        url: 'https://bringatrailer.com/listing/2004-porsche-911-carrera-coupe-35/',
      },
      {
        title: '16k-Mile 1999 Porsche 911 Carrera Cabriolet 6-Speed',
        price: 28250,
        url: 'https://bringatrailer.com/listing/1999-porsche-911-carrera-cabriolet-168/',
      },
      {
        title: '1999 Porsche 911 Carrera Cabriolet',
        price: 13500,
        url: 'https://bringatrailer.com/listing/1999-porsche-911-carrera-cabriolet-165/',
      },
    ],
  },
  {
    makes: ['Subaru'],
    models: ['WRX', 'Impreza'],
    yearMin: 2000,
    yearMax: 2017,
    comps: [
      {
        title: '2014 Subaru Impreza WRX Premium 5-Speed',
        price: 13000,
        url: 'https://bringatrailer.com/listing/2014-subaru-impreza-wrx-32/',
      },
      {
        title: 'Modified 2007 Subaru Impreza WRX Wagon 6-Speed',
        price: 10000,
        url: 'https://bringatrailer.com/listing/2007-subaru-wrx-wagon-2/',
      },
      {
        title: 'Single-Family-Owned 2002 Subaru Impreza WRX Sedan 5-Speed',
        price: 11250,
        url: 'https://bringatrailer.com/listing/2002-subaru-impreza-wrx-sedan-20/',
      },
      {
        title: '17k-Mile, Original-Owner 2014 Subaru Impreza WRX Premium',
        price: 23000,
        url: 'https://bringatrailer.com/listing/2014-subaru-impreza-wrx-31/',
      },
      {
        title: 'JDM 2000 Subaru Impreza WRX Sedan 5-Speed',
        price: 14000,
        url: 'https://bringatrailer.com/listing/2000-subaru-impreza-wrx-6/',
      },
      {
        title: 'Modified 2014 Subaru Impreza WRX Limited 5-Speed',
        price: 10925,
        url: 'https://bringatrailer.com/listing/2014-subaru-impreza-wrx-30/',
      },
      {
        title: '2002 Subaru Impreza WRX Sedan 5-Speed',
        price: 15000,
        url: 'https://bringatrailer.com/listing/2002-subaru-impreza-wrx-sedan-19/',
      },
      {
        title: 'Modified 2017 Subaru WRX 6-Speed',
        price: 18500,
        url: 'https://bringatrailer.com/listing/2017-subaru-wrx-7/',
      },
      {
        title: 'Single-Family-Owned 2004 Subaru Impreza WRX Sport Wagon',
        price: 13550,
        url: 'https://bringatrailer.com/listing/2004-subaru-impreza-wrx-sport-wagon-4/',
      },
      {
        title: 'Original-Owner Modified 2010 Subaru Impreza WRX Hatchback',
        price: 11500,
        url: 'https://bringatrailer.com/listing/2010-subaru-impreza-wrx-2-2/',
      },
    ],
  },
  {
    makes: ['Scion', 'Toyota'],
    models: ['FR-S', '86'],
    yearMin: 2013,
    yearMax: 2016,
    comps: [
      {
        title: 'Original-Owner, Supercharged 2014 Scion FR-S 6-Speed',
        price: 12500,
        url: 'https://bringatrailer.com/listing/2014-scion-fr-s-4/',
      },
      {
        title: 'Original-Owner 2016 Scion FR-S',
        price: 11750,
        url: 'https://bringatrailer.com/listing/2016-scion-fr-s-9/',
      },
      {
        title: 'Original-Owner, Turbocharged 2015 Scion FR-S 6-Speed',
        price: 25500,
        url: 'https://bringatrailer.com/listing/2015-scion-fr-s-14/',
      },
      {
        title: 'Turbocharged 2015 Scion FR-S 6-Speed',
        price: 15250,
        url: 'https://bringatrailer.com/listing/2015-scion-fr-s-12/',
      },
      {
        title: 'Supercharged 2013 Scion FR-S',
        price: 9600,
        url: 'https://bringatrailer.com/listing/2013-scion-fr-s-37/',
      },
      {
        title: 'Turbocharged 2013 Scion FR-S 6-Speed',
        price: 16250,
        url: 'https://bringatrailer.com/listing/2013-scion-fr-s-36/',
      },
      {
        title: '2016 Scion FR-S Release Series 2.0 6-Speed',
        price: 14500,
        url: 'https://bringatrailer.com/listing/2016-scion-fr-s-8/',
      },
      {
        title: 'Supercharged 2016 Scion FR-S 6-Speed',
        price: 21500,
        url: 'https://bringatrailer.com/listing/2016-scion-fr-s-7/',
      },
      {
        title: 'Turbocharged 2016 Scion FR-S Release Series 2.0',
        price: 20113,
        url: 'https://bringatrailer.com/listing/2016-scion-fr-s-6/',
      },
      {
        title: 'LS3-Powered 2013 Scion FR-S 6-Speed',
        price: 28750,
        url: 'https://bringatrailer.com/listing/2013-scion-fr-s-28/',
      },
    ],
  },
  {
    makes: ['Mazda'],
    models: ['MX-5', 'Miata'],
    yearMin: 2006,
    yearMax: 2015,
    comps: [
      {
        title: '2006 Mazda MX-5 Miata Sport 6-Speed',
        price: 11750,
        url: 'https://bringatrailer.com/listing/2006-mazda-mx-5-miata-119/',
      },
      {
        title: '2008 Mazda MX-5 Miata Grand Touring PRHT 6-Speed',
        price: 15500,
        url: 'https://bringatrailer.com/listing/2008-mazda-mx-5-miata-70/',
      },
      {
        title: '2010 Mazda MX-5 Miata PRHT 6-Speed',
        price: 20500,
        url: 'https://bringatrailer.com/listing/2010-mazda-mx-5-miata-25/',
      },
      {
        title: '2006 Mazda MX-5 Miata Grand Touring 6-Speed',
        price: 11250,
        url: 'https://bringatrailer.com/listing/2006-mazda-mx-5-miata-116/',
      },
      {
        title: '5k-Mile 2011 Mazda MX-5 Miata Sport 5-Speed',
        price: 12500,
        url: 'https://bringatrailer.com/listing/2011-mazda-mx-5-miata-16/',
      },
      {
        title: '2006 Mazda MX-5 Miata 5-Speed',
        price: 10000,
        url: 'https://bringatrailer.com/listing/2006-mazda-mx-5-miata-115/',
      },
      {
        title: '5.3L-Powered 2006 Mazda MX-5 Miata',
        price: 24000,
        url: 'https://bringatrailer.com/listing/2006-mazda-mx-5-miata-114/',
      },
      {
        title: '11k-Mile 2007 Mazda MX-5 Miata Sport 5-Speed',
        price: 16200,
        url: 'https://bringatrailer.com/listing/2007-mazda-mx-5-miata-42/',
      },
      {
        title: '5k-Mile 2008 Mazda MX-5 Miata Grand Touring PRHT',
        price: 18000,
        url: 'https://bringatrailer.com/listing/2008-mazda-mx-5-miata-68/',
      },
      {
        title: '2013 Mazda MX-5 Miata Grand Touring PRHT',
        price: 19750,
        url: 'https://bringatrailer.com/listing/2013-mazda-mx-5-miata-30/',
      },
    ],
  },
];

// Comps for a claimed vehicle. `excludeUrl` keeps the subject listing out of
// its own comp set. Null when no set covers the vehicle — the market stage
// degrades visibly instead of pretending.
export function findComps(
  make: string,
  model: string,
  year: number,
  excludeUrl?: string,
): { comps: MarketComp[]; query: string } | null {
  const m = make.trim().toLowerCase();
  const mod = model.trim().toLowerCase();
  const set = COMP_SETS.find(
    (s) =>
      s.makes.some((name) => name.toLowerCase() === m) &&
      year >= s.yearMin &&
      year <= s.yearMax &&
      s.models.some((name) => mod.includes(name.toLowerCase())),
  );
  if (!set) return null;
  const comps = set.comps.filter((c) => c.url !== excludeUrl);
  return {
    comps,
    query: `${COMPS_SOURCE}: ${set.makes[0]} ${set.models[0]} ${set.yearMin}–${set.yearMax} (collected ${COMPS_COLLECTED_ON})`,
  };
}

export function getSeedListing(id: string): SeedListing | undefined {
  return SEED_LISTINGS.find((listing) => listing.id === id);
}
