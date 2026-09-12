/**
 * The program vocabulary: which repair program a triage zone belongs to,
 * what each program is called, what order programs render in, and the
 * severity and range arithmetic every priced line is built from. One damage
 * event is one program however many zones describe it (SPEC 43) — this
 * module decides which one. Nothing here prices anything.
 */

import type { VehicleProfile } from './tiers';
import type { DamageArea, ProgramId, Range3, SalvageLot, Severity } from './types';

// -- Severity and range arithmetic ---------------------------------------------------

export const SEV_RANK: Record<Severity, number> = { light: 0, moderate: 1, heavy: 2 };
export const worst = (a: Severity, b: Severity): Severity => (SEV_RANK[a] >= SEV_RANK[b] ? a : b);
const zero: Range3 = { low: 0, expected: 0, high: 0 };
export const add = (...rs: Range3[]): Range3 =>
  rs.reduce(
    (s, r) => ({ low: s.low + r.low, expected: s.expected + r.expected, high: s.high + r.high }),
    zero,
  );
export const scale = (r: Range3, k: number): Range3 => ({
  low: Math.round(r.low * k),
  expected: Math.round(r.expected * k),
  high: Math.round(r.high * k),
});

// What every priced line needs to know about the car it is priced for.
export type Ctx = { lot: SalvageLot; profile: VehicleProfile; label: string };

// -- Labels and render order -----------------------------------------------------------

export const PROGRAM_LABELS: Record<ProgramId, string> = {
  front: 'Front end',
  rear: 'Rear end',
  side_left: 'Left side',
  side_right: 'Right side',
  side: 'Body side',
  roof_glass: 'Roof and glass',
  interior: 'Interior',
  underbody: 'Underbody',
  wheels_suspension: 'Wheels and suspension',
  electrical: 'Electrical',
  srs: 'SRS',
  flood: 'Flood remediation',
  paint: 'Paint',
  baseline: 'Platform baseline',
};

export const PROGRAM_ORDER: ProgramId[] = [
  'front',
  'rear',
  'side_left',
  'side_right',
  'side',
  'roof_glass',
  'underbody',
  'wheels_suspension',
  'interior',
  'electrical',
  'srs',
  'flood',
  'paint',
  'baseline',
];

// -- Zone → program ------------------------------------------------------------------

export function programForArea(area: DamageArea, lot: SalvageLot): ProgramId {
  const a = area.area.toLowerCase();
  if (area.kind === 'electrical' || /electr|harness|hv|hybrid|battery|module|wiring/.test(a)) {
    return 'electrical';
  }
  if (/wheel|suspension|tire|tyre|axle|control arm|strut|hub|upright/.test(a)) {
    return 'wheels_suspension';
  }
  if (/interior|seat|dash|console|cabin|steering wheel/.test(a)) return 'interior';
  if (/roof|windshield|windscreen|glass|window|sunroof/.test(a)) return 'roof_glass';
  if (/underbody|floor|undercarriage|underside/.test(a)) return 'underbody';
  if (/front|hood|bonnet|nose|headl|radiator|grille|bumper(?!.*rear)/.test(a) && !/rear/.test(a)) {
    return 'front';
  }
  if (/rear|tail|trunk|decklid|diffuser|exhaust|engine|gearbox|transmission|boot/.test(a)) {
    return 'rear';
  }
  if (/left|driver/.test(a)) return 'side_left';
  if (/right|passenger/.test(a)) return 'side_right';
  if (/side|door|rocker|quarter|pillar|fender|wing|sill/.test(a)) return 'side';
  // A mechanical zone with no location word belongs to the listed damage end.
  if (area.kind === 'mechanical') {
    return /rear/i.test(lot.damage.primary) ? 'rear' : 'front';
  }
  return /rear/i.test(lot.damage.primary) ? 'rear' : 'front';
}
