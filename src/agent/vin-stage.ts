/**
 * The VIN stage both agents run: structural decode, the federal vPIC decode
 * merged over it, the free-history link probe, then the provenance sweep —
 * one implementation, so an inspection and a salvage assessment can never
 * decode the same car differently (SPEC 26, 33).
 *
 * It is an async generator of typed steps rather than a returned record:
 * the inspector streams every step as it happens (the sweep's live searches
 * included) while the salvage assessor runs the same steps in parallel with
 * triage and reports only the outcome. Each consumer maps the steps into
 * its own event grammar; the stage itself emits no run events and decides
 * no stage status. Nothing here throws: a failed sweep is a step, and an
 * unreachable vPIC leaves the structural decode standing with a note that
 * says so.
 */

import { defaultVinSweepCaller, runVinSweep, type VinSweepCaller } from '@/inspector/research';
import type { VinCheck, VinSighting } from '@/inspector/types';
import { checkVin, decodeVinVpic, defaultVpicFetcher, type VpicFetcher } from '@/inspector/vin';
import { createVinHistoryProbe, type VinHistoryProbe } from '@/inspector/vin-history';
import type { Tracer } from '@/trace/tracer';
import { eventChannel } from './channel';
import { settle } from './settle';

export type VinStageDeps = {
  tracer: Tracer;
  vpicFetcher?: VpicFetcher | null; // null: skip the live decode (offline)
  vinHistory?: VinHistoryProbe | null; // null: skip the free-history link probe (offline)
  sweepCaller?: VinSweepCaller | null; // null: skip the provenance sweep
  excludeUrl?: string; // the subject listing, never a sighting of itself
  log: string; // server-log prefix for a failed sweep, named by the agent
};

export type VinStageStep =
  | { kind: 'note'; text: string } // reader-facing progress, one line
  | { kind: 'check'; check: VinCheck } // the decode, before any sweep
  | { kind: 'sightings'; sightings: VinSighting[] }
  | { kind: 'sweep-failed'; detail: string };

const hasKey = () => Boolean(process.env.ANTHROPIC_API_KEY);

export async function* runVinStage(
  vin: string,
  vehicle: { make: string; model: string; year: number },
  deps: VinStageDeps,
): AsyncGenerator<VinStageStep> {
  const { tracer } = deps;
  const structural = checkVin(vin, { make: vehicle.make, year: vehicle.year });
  let check: VinCheck = structural;

  const vpicFetcher = deps.vpicFetcher === null ? null : (deps.vpicFetcher ?? defaultVpicFetcher);
  if (structural.valid && vpicFetcher) {
    try {
      const vpic = await tracer.time('vin: NHTSA vPIC decode', 'fetch', () =>
        decodeVinVpic(vin, vpicFetcher),
      );
      check = mergeVpic(structural, vpic, vehicle);
    } catch {
      // vPIC unreachable: keep the structural decode, say so.
      check = {
        ...structural,
        note: `${structural.note} NHTSA vPIC decode was unreachable; this is the structural decode only.`,
      };
    }
  }

  // Free-history probe: only links verified on a live listing are shown.
  const historyProbe =
    deps.vinHistory === null
      ? null
      : (deps.vinHistory ?? (process.env.EBAY_CLIENT_ID ? createVinHistoryProbe() : null));
  if (check.valid && historyProbe) {
    const found = await tracer
      .time('vin: free history-link probe', 'fetch', () => historyProbe(vin))
      .catch(() => []);
    if (found.length > 0) {
      check = { ...check, links: [...found, ...check.links] };
      yield {
        kind: 'note',
        text: `found a free history report on a live listing (${found.length} link${found.length === 1 ? '' : 's'})`,
      };
    }
  }
  yield { kind: 'check', check };

  // Provenance sweep: search the exact VIN for prior listings and results.
  const sweepCaller =
    deps.sweepCaller === null || (!deps.sweepCaller && !hasKey())
      ? null
      : (deps.sweepCaller ?? defaultVinSweepCaller);
  if (!check.valid || !sweepCaller) return;
  yield { kind: 'note', text: `tracing where this VIN has appeared before` };
  const channel = eventChannel<string>();
  const sweep = settle(
    tracer.time('vin: provenance sweep', 'model', () =>
      runVinSweep(check.vin, vehicle, sweepCaller, channel.push, deps.excludeUrl),
    ),
    deps.log,
  );
  for await (const note of channel.drainUntil(sweep)) yield { kind: 'note', text: note };
  const result = await sweep;
  if (result.ok) yield { kind: 'sightings', sightings: result.value };
  else yield { kind: 'sweep-failed', detail: result.detail };
}

// Merge the federal decode over the structural one. vPIC is authoritative
// where it speaks; identity mismatches against the claimed vehicle become
// red flags with a federal citation.
export function mergeVpic(
  structural: VinCheck,
  vpic: { make?: string; model?: string; year?: number; bodyClass?: string; plant?: string },
  claimed: { make: string; model: string; year: number },
): VinCheck {
  const mismatches = [...structural.mismatches];
  const norm = (s: string) => s.trim().toLowerCase();
  if (vpic.make && norm(vpic.make) !== norm(claimed.make)) {
    // Structural decode may have flagged this already; the federal wording wins.
    const already = mismatches.findIndex((m) => m.toLowerCase().includes('decodes to'));
    if (already >= 0) mismatches.splice(already, 1);
    mismatches.push(
      `NHTSA vPIC decodes this VIN as ${vpic.make}${vpic.model ? ` ${vpic.model}` : ''}; the listing claims ${claimed.make} ${claimed.model}`,
    );
  }
  if (vpic.year && vpic.year !== claimed.year) {
    mismatches.push(
      `NHTSA vPIC decodes model year ${vpic.year}; the listing claims ${claimed.year}`,
    );
  }
  return {
    ...structural,
    decoded: {
      wmi: structural.decoded?.wmi ?? structural.vin.slice(0, 3),
      serial: structural.decoded?.serial ?? structural.vin.slice(-6),
      country: structural.decoded?.country,
      make: vpic.make ?? structural.decoded?.make,
      model: vpic.model,
      year: vpic.year ?? structural.decoded?.year,
      bodyClass: vpic.bodyClass,
      plant: vpic.plant,
    },
    mismatches,
    note: 'Decoded against the federal vPIC database. Title, theft, and accident history were NOT checked; use the linked services for that.',
  };
}
