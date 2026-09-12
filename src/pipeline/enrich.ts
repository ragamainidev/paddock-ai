import { searchEbayListings, type EbayEnrichment } from '@/enrich/ebay';
import { defaultFetcher, enrichNhtsa, type Fetcher, type NhtsaEnrichment } from '@/enrich/nhtsa';
import { themeComplaints, type ComplaintTheme, type ThemeCaller } from '@/enrich/themes';
import type { StageStatus } from '@/lib/types';

// The enrichment half of the pipeline, run per selected vehicle: NHTSA
// (complaints + recalls), Haiku themes over those complaints, and eBay
// listings. Failure isolation is the contract — every section carries its
// own StageStatus and an empty-but-rendered shape, so one dead source never
// blanks another's data.

export type VehicleEnrichment = {
  nhtsa: NhtsaEnrichment;
  themes: ComplaintTheme[];
  listings: EbayEnrichment;
  statuses: StageStatus[];
};

export type EnrichDeps = {
  nhtsaFetcher?: Fetcher;
  themeCaller?: ThemeCaller;
  ebay?: { searchListings: typeof searchEbayListings };
};

type VehicleToEnrich = {
  make: string;
  model: string;
  yearMin: number;
  yearMax: number;
  trims?: string[][]; // constraint trim groups, shaping the listing query
};

export async function enrichVehicle(
  vehicle: VehicleToEnrich,
  forwarded: string[],
  deps: EnrichDeps = {},
): Promise<VehicleEnrichment> {
  const nhtsaFetcher = deps.nhtsaFetcher ?? defaultFetcher;
  const ebay = deps.ebay ?? { searchListings: searchEbayListings };

  // NHTSA and eBay are independent sources; they run in parallel and neither
  // waits on — or can fail — the other. Both return statuses, never throw.
  const [nhtsa, listings] = await Promise.all([
    enrichNhtsa(vehicle, nhtsaFetcher),
    ebay.searchListings(vehicle, forwarded),
  ]);

  // Themes read NHTSA's complaints, so they run after it — and degrade to
  // raw component counts on their own, without taking the complaints down.
  const label = `${vehicle.make} ${vehicle.model} ${vehicle.yearMin}–${vehicle.yearMax}`;
  const { themes, status: themesStatus } = await themeComplaints(
    label,
    nhtsa.complaints,
    deps.themeCaller,
  );

  return {
    nhtsa,
    themes,
    listings,
    statuses: [nhtsa.status, themesStatus, listings.status],
  };
}
