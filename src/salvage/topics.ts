/**
 * What the plan asks the world about, and what a bidder is about to miss.
 * `lineResearchTopics` picks the few repair lines worth a research worker —
 * the biggest expected dollars among the lines with a searchable phrasing,
 * because every worker is wall clock in the agent loop. `whatPeopleMiss`
 * states the platform and title facts that move a bid and do not appear in
 * any photo.
 */

import { usd } from '@/lib/money';
import type { VehicleProfile } from './tiers';
import type { DamageTriage, RepairPlan, SalvageLot } from './types';

export type LineResearchTopic = { lineId: string; topic: string; reason: string };

// The lines worth a research worker: the biggest expected dollars among the
// lines that have a searchable phrasing. Three is the budget: every worker
// is wall-clock in the agent loop.
export function lineResearchTopics(
  plan: RepairPlan,
  lot: SalvageLot,
  max = 3,
): LineResearchTopic[] {
  return [...plan.lines]
    .filter((l) => l.researchTopic)
    .sort((a, b) => b.expected - a.expected)
    .slice(0, max)
    .map((l) => ({
      lineId: l.id,
      topic: l.researchTopic!,
      reason: `${l.task}: ${usd(l.low)}–${usd(l.high)} curated for the ${lot.year} ${lot.make} ${lot.model}; cited prices narrow it`,
    }));
}

// -- What people miss -----------------------------------------------------------------------

export function whatPeopleMiss(
  triage: DamageTriage,
  lot: SalvageLot,
  profile: VehicleProfile,
): string[] {
  const missed: string[] = [];
  const damage = `${lot.damage.primary} ${lot.damage.secondary ?? ''}`.toLowerCase();
  const construction = profile.construction;

  if (/non-repairable|certificate of destruction/i.test(lot.titleBrand)) {
    missed.push(
      'The title brand is the dealbreaker most bidders skip: non-repairable/COD cars can never be road-registered in most states; this is a parts car or a track build at any price.',
    );
  }
  if (damage.includes('front')) {
    if (construction.chassis !== 'steel_unibody') {
      missed.push(
        `A "bumper hit" on this platform can be a chassis hit: the radiator support and front rails are structural sections. ${construction.note}`,
      );
    }
    if (profile.adas) {
      missed.push(
        'Front hits hide ADAS damage: radar, cameras, and sensors live in the nose, and recalibration after repair is mandatory, not optional.',
      );
    }
  }
  if (damage.includes('rear') && profile.midEngine) {
    missed.push(
      'On a mid-engine car the "trunk" you hit from behind contains the engine, gearbox, and subframe. Budget for drivetrain inspection before assuming a cosmetic rear hit.',
    );
  }
  if (damage.includes('vandalism')) {
    missed.push(
      'Vandalism lots hide the real story: check for missing ECUs, cut harnesses, and drained fluids; theft-recovery strip jobs are listed as vandalism.',
    );
  }
  if (triage.floodEvidence || damage.includes('water') || damage.includes('flood')) {
    missed.push(
      'Flood corrosion is a clock, not a state: connectors that test fine today fail over 24 months. Price the car as if every module eventually needs help.',
    );
  }
  if (profile.hybrid) {
    missed.push(
      'Hybrid packs discharge and brick when damaged cars sit for months in a yard; a dead HV pack can exceed the price of the whole lot.',
    );
  }
  if (triage.airbagsDeployed === 'yes') {
    missed.push(
      'Deployed airbags mean the seat belts, pretensioners, and possibly the dash are one line item; OEM SRS parts on exotics are shockingly expensive and rarely aftermarket-available.',
    );
  }
  if (lot.odometer === undefined) {
    missed.push(
      'Odometer "Unknown" resets the value math: assume the worst-supportable mileage when computing resale, because the market will.',
    );
  }
  missed.push(...profile.modelNotes);
  missed.push(
    profile.tier === 'exotic'
      ? 'Exotics need marque-specialist pre-purchase yard visits: keys, ECU presence, and engine turn-over change the bid math more than any photo.'
      : 'A yard visit before the sale (keys, engine turn-over, module presence) changes the bid math more than any photo.',
  );
  return missed;
}
