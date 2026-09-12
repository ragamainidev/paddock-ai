/**
 * The priced repair lines: one function per body program, each returning the
 * lines that program needs at a given severity with the DIY/pro split and
 * the reason for it (SPEC 35). Structural work on carbon and aluminum is
 * never DIY; bolt-on panels, lamps, cooling and interior are. Numbers come
 * from the vehicle profile (tier defaults plus model overrides,
 * `src/salvage/tiers.ts`) and a line says which of the two it used.
 *
 * Every line also carries what the same task costs bought from a shop
 * (`pro`) and the equipment it cannot be done without (`requires`), so the
 * bidder layer can price a line the buyer has no booth, rack or jig for
 * without re-deriving the plan.
 */

import { add, PROGRAM_LABELS, scale, worst, type Ctx } from './programs';
import { SHOP_RATE, type VehicleProfile } from './tiers';
import type { DamageArea, MarqueTier, ProgramId, Range3, RepairLine, Severity } from './types';

export function mk(
  program: ProgramId,
  slug: string,
  task: string,
  who: 'diy' | 'pro',
  reason: string,
  range: Range3,
  ctx: Ctx,
  extra: Partial<RepairLine> = {},
): RepairLine {
  const line: RepairLine = {
    id: `${program}.${slug}`,
    program,
    task,
    who,
    reason,
    low: range.low,
    expected: range.expected,
    high: range.high,
    pro: range,
    requires: [], // the default; a line needing a rack, booth or jig says so
    evidence: 'curated',
    basis: `curated: ${ctx.profile.tierLabel}`,
    ...extra,
  };
  return { ...line, pro: proPrice(line, ctx.profile.tier) };
}

// A DIY line's range is parts and materials: the builder's hours are counted
// (`diyHoursTotal`) and priced at $0. Buying the same task from a shop keeps
// the parts and adds those hours at the tier's rate. A line that is already
// professional prices at its own range (docs/salvage-economics.md §4.1).
export function proPrice(line: RepairLine, tier: MarqueTier): Range3 {
  if (line.who !== 'diy') return { low: line.low, expected: line.expected, high: line.high };
  const labor = (line.diyHours ?? 0) * SHOP_RATE[tier];
  return { low: line.low + labor, expected: line.expected + labor, high: line.high + labor };
}

// Whether a parts typical came from a model override rather than the tier
// table: the chip says "override" only when the number is model-specific.
export function partsEvidence(
  profile: VehicleProfile,
  ...keys: (keyof VehicleProfile['parts'])[]
): RepairLine['evidence'] {
  return keys.some((k) => profile.overriddenKeys.includes(k)) ? 'override' : 'curated';
}

export function structuralLine(program: ProgramId, zones: DamageArea[], ctx: Ctx): RepairLine {
  const { profile } = ctx;
  const sev = zones.reduce<Severity>((s, z) => worst(s, z.severity), 'light');
  const heavyExtra = Math.max(0, zones.filter((z) => z.severity === 'heavy').length - 1);
  const factor = 1 + 0.25 * heavyExtra;
  const range = scale(profile.structural[sev], factor);
  const chassis = profile.construction.chassis;
  const reason =
    chassis === 'carbon_tub'
      ? 'Carbon monocoque damage cannot be judged visually; ultrasonic/tap testing and factory repair authorization decide whether the car exists.'
      : chassis === 'steel_unibody'
        ? 'Pulling a unibody straight needs a frame rack and laser measurement.'
        : 'Bonded/riveted aluminum sections need the factory jig, approved adhesives, and certified technicians: insurance-grade work, not garage work.';
  return mk(
    program,
    'structure',
    `${PROGRAM_LABELS[program]} structure: ${sev} (${zones.map((z) => z.area).join(', ')})`,
    'pro',
    reason,
    range,
    ctx,
    {
      requires: ['structural'],
      basis: `curated: ${chassis.replace(/_/g, ' ')} ${sev} rate${heavyExtra ? `, +25% per extra heavy zone (${zones.length} zones)` : zones.length > 1 ? ` (${zones.length} zones, one program)` : ''}`,
      evidence: profile.overriddenKeys.includes('structural') ? 'override' : 'curated',
      researchTopic: `${ctx.label} ${program === 'front' ? 'front' : program === 'rear' ? 'rear' : ''} chassis / frame section structural repair cost at an approved body shop`,
    },
  );
}

export function frontLines(sev: Severity, structural: boolean, ctx: Ctx): RepairLine[] {
  const { profile } = ctx;
  const p = profile.parts;
  const lines: RepairLine[] = [];
  const effective: Severity = structural ? 'heavy' : sev; // structure gone means the skin is gone
  const panels =
    effective === 'light'
      ? p.bumperCover
      : effective === 'moderate'
        ? add(p.bumperCover, p.hood, p.fender)
        : add(p.bumperCover, p.hood, scale(p.fender, 2));
  lines.push(
    mk(
      'front',
      'panels',
      effective === 'light'
        ? 'Front bumper cover: replace, fit, align'
        : effective === 'moderate'
          ? 'Front panels: bumper cover, hood, one fender'
          : 'Front panels: bumper cover, hood, both fenders',
      'diy',
      'Bolt-on panels and trim are patient-hands work: fit, gap, torque.',
      panels,
      ctx,
      {
        diyHours: effective === 'light' ? 6 : effective === 'moderate' ? 16 : 30,
        evidence: partsEvidence(profile, 'bumperCover', 'hood', 'fender'),
        researchTopic: `${ctx.label} front bumper cover, hood, and fender OEM part prices`,
      },
    ),
  );
  if (effective !== 'light') {
    const n = effective === 'moderate' ? 1 : 2;
    lines.push(
      mk(
        'front',
        'lamps',
        `Headlamp assembl${n === 1 ? 'y' : 'ies'} (${n})`,
        'diy',
        'Plug-in units; the cost is the part, not the labor.',
        scale(p.headlamp, n),
        ctx,
        {
          diyHours: 2 * n,
          evidence: partsEvidence(profile, 'headlamp'),
          researchTopic: `${ctx.label} OEM LED headlamp assembly price`,
        },
      ),
    );
    lines.push(
      mk(
        'front',
        'cooling',
        effective === 'moderate'
          ? 'Cooling stack: partial (one radiator/condenser)'
          : 'Cooling stack: radiators, condensers, intercoolers, fans',
        'diy',
        'Radiators and condensers unbolt; the work is fluids and bleeding, the money is the parts.',
        scale(p.cooling, effective === 'moderate' ? 0.5 : 1),
        ctx,
        {
          diyHours: effective === 'moderate' ? 8 : 20,
          evidence: partsEvidence(profile, 'cooling'),
          researchTopic: `${ctx.label} front radiator, condenser, and intercooler OEM part prices`,
        },
      ),
    );
    if (profile.adas) {
      lines.push(
        mk(
          'front',
          'sensors',
          'Front sensors: radar, cameras, park sensors',
          'diy',
          'The units swap by hand; calibration afterwards is the pro line in the baseline.',
          p.sensors,
          ctx,
          { diyHours: 4, evidence: partsEvidence(profile, 'sensors') },
        ),
      );
    }
  }
  return lines;
}

export function rearLines(
  sev: Severity,
  structural: boolean,
  ctx: Ctx,
  mechanical: DamageArea[],
): RepairLine[] {
  const { profile } = ctx;
  const p = profile.parts;
  const lines: RepairLine[] = [];
  const effective: Severity = structural ? 'heavy' : sev;
  const panels =
    effective === 'light'
      ? scale(p.bumperCover, 0.9)
      : effective === 'moderate'
        ? add(scale(p.bumperCover, 0.9), p.fender)
        : add(scale(p.bumperCover, 0.9), scale(p.fender, 2));
  lines.push(
    mk(
      'rear',
      'panels',
      effective === 'light'
        ? 'Rear bumper cover: replace, fit, align'
        : effective === 'moderate'
          ? 'Rear panels: bumper cover, diffuser, one quarter/valance'
          : 'Rear panels: bumper cover, diffuser, both quarters/valance',
      'diy',
      'Bolt-on panels and trim are patient-hands work: fit, gap, torque.',
      panels,
      ctx,
      {
        diyHours: effective === 'light' ? 6 : effective === 'moderate' ? 16 : 30,
        evidence: partsEvidence(profile, 'bumperCover', 'fender'),
        researchTopic: `${ctx.label} rear bumper, diffuser, and quarter panel OEM part prices`,
      },
    ),
  );
  if (effective !== 'light') {
    const n = effective === 'moderate' ? 1 : 2;
    lines.push(
      mk(
        'rear',
        'lamps',
        `Tail lamp assembl${n === 1 ? 'y' : 'ies'} (${n})`,
        'diy',
        'Plug-in units; the cost is the part.',
        scale(p.tailLamp, n),
        ctx,
        {
          diyHours: n,
          evidence: partsEvidence(profile, 'tailLamp'),
        },
      ),
    );
  }
  // Mid-engine: the rear clip is the engine bay. Drivetrain exposure is one
  // line at the worst of the mechanical zones and the program severity.
  const mechSev = mechanical.reduce<Severity>((s, z) => worst(s, z.severity), 'light');
  if (mechanical.length > 0 || (profile.midEngine && effective !== 'light')) {
    const s =
      mechanical.length > 0 ? worst(mechSev, profile.midEngine ? effective : 'light') : effective;
    lines.push(
      mk(
        'rear',
        'mechanical',
        profile.midEngine
          ? `Rear mechanicals: engine, gearbox, subframe exposure (${s})`
          : `Rear mechanicals (${s})`,
        'diy',
        'Suspension arms, subframe hardware, driveshafts, and accessories are torque-spec work a serious builder does at home; a cracked case or bent input shaft is a used-unit swap priced here.',
        profile.mechanical[s],
        ctx,
        {
          diyHours: s === 'heavy' ? 60 : s === 'moderate' ? 30 : 12,
          evidence: profile.overriddenKeys.includes('mechanical') ? 'override' : 'curated',
          researchTopic: `${ctx.label} used engine and gearbox prices and rear subframe part cost`,
        },
      ),
    );
  }
  return lines;
}

export function sideLines(
  program: ProgramId,
  sev: Severity,
  structural: boolean,
  ctx: Ctx,
): RepairLine[] {
  const { profile } = ctx;
  const p = profile.parts;
  const effective: Severity = structural ? 'heavy' : sev;
  if (effective === 'light') return []; // paint carries a light side hit
  const panels = effective === 'moderate' ? p.door : add(p.door, p.fender, scale(p.glass, 0.5));
  return [
    mk(
      program,
      'panels',
      effective === 'moderate'
        ? 'Side panels: door skin/shell, mirror'
        : 'Side panels: door, quarter/fender, side glass',
      'diy',
      'Doors and quarters bolt or bond on; alignment is patience.',
      panels,
      ctx,
      {
        diyHours: effective === 'moderate' ? 12 : 24,
        evidence: partsEvidence(profile, 'door', 'fender'),
        researchTopic: `${ctx.label} door shell and quarter panel OEM part prices`,
      },
    ),
  ];
}
