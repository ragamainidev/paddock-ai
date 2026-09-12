// NHTSA enrichment: complaints and recalls for a resolved vehicle.
// NHTSA has its own naming — our "M3" is their "M3 COUPE" and "M3
// CONVERTIBLE" — so mapping our names onto theirs is a separate, failable
// step (mapToNhtsaNames returning null) rather than a silent guess baked
// into the queries.

import { failureReason } from '@/lib/failure';
import type { StageStatus } from '@/lib/types';

const BASE = 'https://api.nhtsa.gov';

// Returns parsed JSON. Injected in tests; the default uses global fetch.
export type Fetcher = (url: string) => Promise<unknown>;

export const defaultFetcher: Fetcher = async (url) => {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`NHTSA ${res.status} for ${url}`);
  return res.json();
};

export type NhtsaNameMapping = {
  make: string;
  models: string[]; // every NHTSA body-style variant of our one model
};

export type ComplaintRecord = {
  odiNumber: number;
  components: string;
  summary: string;
  crash: boolean;
  fire: boolean;
  dateComplaintFiled?: string;
};

export type RecallRecord = {
  campaign: string;
  component: string;
  summary: string;
  remedy: string;
};

export type ComponentCount = { component: string; count: number };

// Complaints and recalls are per model-year; querying every year of a long
// window would be years × body styles requests. Three spread years bound the
// fan-out while still catching era-specific problems.
export function representativeYears(yearMin: number, yearMax: number): number[] {
  const mid = Math.round((yearMin + yearMax) / 2);
  return [...new Set([yearMin, mid, yearMax])];
}

function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function mapToNhtsaNames(
  vehicle: { make: string; model: string; yearMin: number; yearMax: number },
  fetcher: Fetcher = defaultFetcher,
): Promise<NhtsaNameMapping | null> {
  const year = Math.round((vehicle.yearMin + vehicle.yearMax) / 2);
  const params = new URLSearchParams({
    modelYear: String(year),
    make: vehicle.make,
    issueType: 'c',
  });
  const raw = (await fetcher(`${BASE}/products/vehicle/models?${params}`)) as {
    results?: { make?: string; model?: string }[];
  };
  const ours = normalizeName(vehicle.model);
  const models: string[] = [];
  let exact: string | null = null;
  for (const row of raw.results ?? []) {
    if (!row.model) continue;
    const theirs = normalizeName(row.model);
    if (theirs === ours) exact = row.model;
    // Word-boundary prefix: 'M3 COUPE' matches our 'M3', 'M30' does not.
    if (theirs === ours || theirs.startsWith(`${ours} `)) models.push(row.model);
  }
  if (exact) return { make: vehicle.make, models: [exact] };
  if (models.length === 0) return null;
  return { make: vehicle.make, models: models.sort() };
}

// A (model, year) pair, fetched independently. One flaky request costs only
// its own slice — but a skipped slice is missing complaints, so the count
// rides back with the records and the stage says how many were lost.
export type SliceFetch<T> = { records: T[]; attempted: number; skipped: number };

export async function fetchComplaints(
  mapping: NhtsaNameMapping,
  years: number[],
  fetcher: Fetcher = defaultFetcher,
): Promise<SliceFetch<ComplaintRecord>> {
  const seen = new Set<number>();
  const out: ComplaintRecord[] = [];
  let skipped = 0;
  for (const model of mapping.models) {
    for (const year of years) {
      const params = new URLSearchParams({
        make: mapping.make,
        model,
        modelYear: String(year),
      });
      let raw: { results?: Record<string, unknown>[] };
      try {
        raw = (await fetcher(`${BASE}/complaints/complaintsByVehicle?${params}`)) as typeof raw;
      } catch {
        skipped += 1;
        continue;
      }
      for (const row of raw.results ?? []) {
        const odi = Number(row.odiNumber);
        if (!Number.isFinite(odi) || seen.has(odi)) continue;
        seen.add(odi);
        out.push({
          odiNumber: odi,
          components: String(row.components ?? ''),
          summary: String(row.summary ?? ''),
          crash: row.crash === true,
          fire: row.fire === true,
          dateComplaintFiled: row.dateComplaintFiled ? String(row.dateComplaintFiled) : undefined,
        });
      }
    }
  }
  return { records: out, attempted: mapping.models.length * years.length, skipped };
}

export async function fetchRecalls(
  mapping: NhtsaNameMapping,
  years: number[],
  fetcher: Fetcher = defaultFetcher,
): Promise<SliceFetch<RecallRecord>> {
  const seen = new Set<string>();
  const out: RecallRecord[] = [];
  let skipped = 0;
  for (const model of mapping.models) {
    for (const year of years) {
      const params = new URLSearchParams({
        make: mapping.make,
        model,
        modelYear: String(year),
      });
      let raw: { results?: Record<string, unknown>[] };
      try {
        raw = (await fetcher(`${BASE}/recalls/recallsByVehicle?${params}`)) as typeof raw;
      } catch {
        skipped += 1;
        continue;
      }
      for (const row of raw.results ?? []) {
        const campaign = String(row.NHTSACampaignNumber ?? '');
        if (!campaign || seen.has(campaign)) continue;
        seen.add(campaign);
        out.push({
          campaign,
          component: String(row.Component ?? ''),
          summary: String(row.Summary ?? ''),
          remedy: String(row.Remedy ?? ''),
        });
      }
    }
  }
  return { records: out, attempted: mapping.models.length * years.length, skipped };
}

export type NhtsaEnrichment = {
  mapping: NhtsaNameMapping | null;
  complaints: ComplaintRecord[];
  recalls: RecallRecord[];
  components: ComponentCount[];
  status: StageStatus;
};

const EMPTY: Omit<NhtsaEnrichment, 'status'> = {
  mapping: null,
  complaints: [],
  recalls: [],
  components: [],
};

// The whole NHTSA stage for one resolved vehicle. Any failure — unknown
// naming, network — lands in status.detail and the rest of the report keeps
// rendering; this section degrades alone.
export async function enrichNhtsa(
  vehicle: { make: string; model: string; yearMin: number; yearMax: number },
  fetcher: Fetcher = defaultFetcher,
): Promise<NhtsaEnrichment> {
  let mapping: NhtsaNameMapping | null;
  try {
    mapping = await mapToNhtsaNames(vehicle, fetcher);
  } catch (err) {
    console.error('nhtsa: name mapping failed:', err);
    return { ...EMPTY, status: { stage: 'nhtsa', ok: false, detail: failureReason(err) } };
  }
  if (!mapping) {
    return {
      ...EMPTY,
      status: {
        stage: 'nhtsa',
        ok: false,
        detail: `no NHTSA model matches "${vehicle.make} ${vehicle.model}"; their naming differs from ours and this one could not be mapped`,
      },
    };
  }

  const years = representativeYears(vehicle.yearMin, vehicle.yearMax);
  const complaints = await fetchComplaints(mapping, years, fetcher);
  // NHTSA's recalls endpoint answers to plain names ('M3') that its own
  // products index expands ('M3 COUPE'), so recalls get the raw name too.
  const recallNames = [...new Set([vehicle.model.toUpperCase(), ...mapping.models])];
  const recalls = await fetchRecalls({ ...mapping, models: recallNames }, years, fetcher);

  // A skipped slice is a hole in the counts. Saying how many were lost is
  // the difference between partial data and data that looks complete
  // (SPEC 10, 11); the phrase sits before ` via ` so the provenance line
  // still parses the model names after it.
  const skipped = complaints.skipped + recalls.skipped;
  const attempted = complaints.attempted + recalls.attempted;
  const holes = skipped > 0 ? ` (${skipped} of ${attempted} year/model slices unreachable)` : '';
  return {
    mapping,
    complaints: complaints.records,
    recalls: recalls.records,
    components: summarizeComponents(complaints.records),
    status: {
      stage: 'nhtsa',
      // A stage that fetched none of its slices did not succeed (SPEC 10);
      // partial data still counts as data, and the detail says how partial.
      ok: skipped < attempted,
      detail: `${complaints.records.length} complaints, ${recalls.records.length} recalls${holes} via ${mapping.models.join(', ')}`,
    },
  };
}

// The honest counts the theme stage builds on: computed here, never by a
// model. Compound strings like 'AIR BAGS,ELECTRICAL SYSTEM' count once per
// named component.
export function summarizeComponents(
  complaints: Pick<ComplaintRecord, 'components'>[],
): ComponentCount[] {
  const counts = new Map<string, number>();
  for (const c of complaints) {
    for (const part of c.components.split(',')) {
      const component = part.trim();
      if (!component) continue;
      counts.set(component, (counts.get(component) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([component, count]) => ({ component, count }))
    .sort((a, b) => b.count - a.count || a.component.localeCompare(b.component));
}
