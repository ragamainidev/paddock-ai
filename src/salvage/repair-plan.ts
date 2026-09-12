/**
 * The repair plan: a triage becomes repair PROGRAMS — one per damage event,
 * plus the condition programs a photo can force (SRS, flood), one paint
 * program across every refinished zone, and the platform baseline every
 * rebuild of this car owes before it drives (SPEC 35, 43).
 *
 * The phases are named because each answers a different question: which
 * zones belong to which program, what that program costs, what one respray
 * covers, what the platform owes regardless of the hit, and what the whole
 * thing adds up to in money and in the owner's own hours. A damage event is
 * priced once however many triage zones describe it.
 */

import {
  add,
  PROGRAM_LABELS,
  PROGRAM_ORDER,
  programForArea,
  scale,
  SEV_RANK,
  worst,
  type Ctx,
} from './programs';
import {
  frontLines,
  mk,
  partsEvidence,
  rearLines,
  sideLines,
  structuralLine,
} from './repair-lines';
import type { VehicleProfile } from './tiers';
import { whatPeopleMiss } from './topics';
import type {
  DamageArea,
  DamageTriage,
  ProgramId,
  RepairLine,
  RepairPlan,
  RepairProgram,
  SalvageLot,
  Severity,
} from './types';

export function deriveRepairPlan(
  triage: DamageTriage,
  lot: SalvageLot,
  profile: VehicleProfile,
): RepairPlan {
  const ctx: Ctx = { lot, profile, label: `${lot.year} ${lot.make} ${lot.model}` };
  const programs = [...damagePrograms(triage, ctx), ...conditionPrograms(triage, ctx)];
  const paint = paintProgram(triage, ctx);
  if (paint) programs.push(paint);
  programs.push(baselineProgram(programs, ctx));
  return rollUp(programs, triage, ctx);
}

// -- Zones → programs ------------------------------------------------------------------

function programOf(id: ProgramId, zones: DamageArea[], lines: RepairLine[]): RepairProgram {
  return {
    id,
    label: PROGRAM_LABELS[id],
    zones: zones.map((z) => z.area),
    photos: [...new Set(zones.flatMap((z) => z.photos))],
    severity: zones.reduce<Severity>((s, z) => worst(s, z.severity), 'light'),
    structural: zones.some((z) => z.kind === 'structural'),
    lines,
  };
}

// Every triage zone folds into the program that owns its damage event, in
// render order. Three heavy front zones are one front program.
function damagePrograms(triage: DamageTriage, ctx: Ctx): RepairProgram[] {
  const groups = new Map<ProgramId, DamageArea[]>();
  for (const area of triage.areas) {
    const id = programForArea(area, ctx.lot);
    groups.set(id, [...(groups.get(id) ?? []), area]);
  }
  const programs: RepairProgram[] = [];
  for (const id of PROGRAM_ORDER) {
    const zones = groups.get(id);
    if (!zones || zones.length === 0) continue;
    programs.push(programOf(id, zones, programLines(id, zones, ctx)));
  }
  return programs;
}

// What one program costs at its zones' worst severity: at most one
// structural line, then the panels, lamps and mechanicals that program
// implies on this platform.
function programLines(id: ProgramId, zones: DamageArea[], ctx: Ctx): RepairLine[] {
  const { profile } = ctx;
  const p = profile.parts;
  const structuralZones = zones.filter((z) => z.kind === 'structural');
  const mechanicalZones = zones.filter((z) => z.kind === 'mechanical');
  const sev = zones.reduce<Severity>((s, z) => worst(s, z.severity), 'light');
  const lines: RepairLine[] = [];
  if (structuralZones.length > 0) lines.push(structuralLine(id, structuralZones, ctx));
  switch (id) {
    case 'front': {
      lines.push(...frontLines(sev, structuralZones.length > 0, ctx));
      if (mechanicalZones.length > 0) {
        const s = mechanicalZones.reduce<Severity>((a, z) => worst(a, z.severity), 'light');
        lines.push(
          mk(
            'front',
            'mechanical',
            `Front mechanicals: cooling, steering, accessories (${s})`,
            'diy',
            'Torque-spec work a serious builder does at home.',
            profile.mechanical[s],
            ctx,
            {
              diyHours: s === 'heavy' ? 40 : s === 'moderate' ? 20 : 8,
            },
          ),
        );
      }
      break;
    }
    case 'rear':
      lines.push(...rearLines(sev, structuralZones.length > 0, ctx, mechanicalZones));
      break;
    case 'side_left':
    case 'side_right':
    case 'side':
      lines.push(...sideLines(id, sev, structuralZones.length > 0, ctx));
      break;
    case 'roof_glass':
      lines.push(
        mk(
          'roof_glass',
          'glass',
          'Glass: windshield / side glass',
          'pro',
          'Bonded glass on an exotic is a mobile-glass or dealer job: HUD/acoustic laminates and ADAS camera brackets.',
          scale(p.glass, sev === 'heavy' ? 2 : 1),
          ctx,
          {
            evidence: partsEvidence(profile, 'glass'),
          },
        ),
      );
      break;
    case 'interior':
      lines.push(
        mk(
          'interior',
          'trim',
          sev === 'heavy' ? 'Interior: seats, dash, trim' : 'Interior: trim and detail',
          'diy',
          'Interior work is patience and part numbers.',
          sev === 'heavy'
            ? p.interiorHeavy
            : sev === 'moderate'
              ? scale(p.interiorHeavy, 0.4)
              : p.interiorLight,
          ctx,
          {
            diyHours: sev === 'heavy' ? 24 : 8,
          },
        ),
      );
      break;
    case 'underbody':
      if (mechanicalZones.length > 0 || structuralZones.length === 0) {
        lines.push(
          mk(
            'underbody',
            'mechanical',
            `Underbody mechanicals (${sev})`,
            'diy',
            'Undertrays, lines, and hardware; anything bent in the structure is the pro line.',
            profile.mechanical[sev],
            ctx,
            {
              diyHours: sev === 'heavy' ? 30 : 12,
            },
          ),
        );
      }
      break;
    case 'wheels_suspension': {
      lines.push(
        mk(
          'wheels_suspension',
          'corner',
          `Suspension: arms, uprights, dampers (${sev})`,
          'diy',
          'Suspension arms and uprights are torque-spec work a serious builder does at home.',
          profile.mechanical[sev],
          ctx,
          {
            diyHours: sev === 'heavy' ? 40 : sev === 'moderate' ? 20 : 8,
            // The geometry the work disturbs is its own baseline line
            // (`baseline.alignment`, priced pro); the corner itself is hand
            // tools and a torque wrench, so it requires no rack of its own.
            evidence: profile.overriddenKeys.includes('mechanical') ? 'override' : 'curated',
            researchTopic: `${ctx.label} suspension arm, upright, and damper OEM part prices`,
          },
        ),
      );
      const wheels = sev === 'light' ? 1 : 2;
      lines.push(
        mk(
          'wheels_suspension',
          'wheels',
          `Wheels (${wheels}) + tires`,
          'diy',
          'Forged wheels are the money; mounting is a shop hour.',
          add(scale(p.wheel, wheels), {
            low: 400 * wheels,
            expected: 600 * wheels,
            high: 900 * wheels,
          }),
          ctx,
          {
            diyHours: 2,
            evidence: partsEvidence(profile, 'wheel'),
          },
        ),
      );
      break;
    }
    case 'electrical':
      if (profile.hybrid) {
        lines.push(
          mk(
            'electrical',
            'hv',
            `High-voltage system inspection + repair (${sev})`,
            'pro',
            'Hybrid HV batteries and orange-cable systems are lethal and warranty-locked; isolation testing is dealer equipment.',
            sev === 'light'
              ? scale(profile.hv.repair, 0.4)
              : sev === 'moderate'
                ? profile.hv.repair
                : scale(profile.hv.repair, 1.4),
            ctx,
            {
              requires: ['hv'],
              evidence: profile.overriddenKeys.includes('hv') ? 'override' : 'curated',
              researchTopic: `${ctx.label} hybrid HV battery pack and e-motor / inverter replacement cost`,
            },
          ),
        );
      } else {
        lines.push(
          mk(
            'electrical',
            'harness',
            `Wiring/electronics repair (${sev})`,
            'diy',
            '12V harness and module work is tedious but safe with a wiring diagram.',
            sev === 'heavy' ? scale(profile.harness, 1.5) : profile.harness,
            ctx,
            {
              diyHours: sev === 'heavy' ? 30 : 20,
            },
          ),
        );
      }
      break;
    default:
      break;
  }
  return lines;
}

// -- Condition programs: what the photos force regardless of the zones -------------------

function conditionPrograms(triage: DamageTriage, ctx: Ctx): RepairProgram[] {
  const { profile } = ctx;
  const programs: RepairProgram[] = [];
  if (triage.airbagsDeployed === 'yes') {
    programs.push(
      programOf(
        'srs',
        [],
        [
          mk(
            'srs',
            'system',
            'SRS system: airbags, pretensioners, module reset',
            'pro',
            'Deployed airbag replacement is liability work: modules, sensors, and legal exposure if it ever deploys wrong.',
            profile.srs,
            ctx,
            {
              researchTopic: `${ctx.label} airbag SRS replacement cost after deployment`,
            },
          ),
        ],
      ),
    );
  }
  if (triage.floodEvidence) {
    programs.push(
      programOf(
        'flood',
        [],
        [
          mk(
            'flood',
            'remediation',
            'Full connector-by-connector corrosion remediation',
            'diy',
            'Flood recovery is thousands of connectors, dielectric grease, and patience; no shop bills honestly for it.',
            profile.tier === 'exotic'
              ? { low: 3_000, expected: 6_000, high: 12_000 }
              : { low: 1_500, expected: 3_000, high: 8_000 },
            ctx,
            {
              diyHours: 120,
            },
          ),
        ],
      ),
    );
  }
  return programs;
}

// -- Paint: one program across every refinished zone -------------------------------------

// Interior, underbody, wheels, and electrical zones are not painted. Paint
// is unified rather than charged per zone: a booth is set up once, and one
// blend program covers whatever it covers.
function paintProgram(triage: DamageTriage, ctx: Ctx): RepairProgram | null {
  const { profile } = ctx;
  const painted = triage.areas.filter((a) => {
    const id = programForArea(a, ctx.lot);
    return (
      !['interior', 'underbody', 'wheels_suspension', 'electrical'].includes(id) &&
      a.kind !== 'mechanical' &&
      a.kind !== 'electrical'
    );
  });
  if (painted.length === 0) return null;
  const zoneCost = add(...painted.map((z) => profile.paint.zone[z.severity]));
  return programOf(
    'paint',
    [],
    [
      mk(
        'paint',
        'program',
        `Paint: one respray program across ${painted.length} zone${painted.length === 1 ? '' : 's'} (${painted.map((z) => z.area).join(', ')})`,
        'pro',
        'Exotic paint match and blend needs a booth; one program covers every zone, and rattle-can economics destroy resale.',
        add(profile.paint.setup, zoneCost),
        ctx,
        { requires: ['paint'] },
      ),
    ],
  );
}

// -- Platform baseline: what every rebuild of this car needs before it drives -------------

function baselineProgram(programs: RepairProgram[], ctx: Ctx): RepairProgram {
  const { profile } = ctx;
  const baseline: RepairLine[] = [];
  if (profile.hybrid) {
    baseline.push(
      mk(
        'baseline',
        'hv_isolation',
        'HV battery isolation test before any other work',
        'pro',
        'Non-negotiable on a damaged hybrid: prove the pack is safe before wrenching near it.',
        profile.hv.isolation,
        ctx,
        { requires: ['hv'] },
      ),
    );
  }
  const bodyHit = programs.some(
    (pr) =>
      ['front', 'rear', 'side_left', 'side_right', 'side'].includes(pr.id) &&
      SEV_RANK[pr.severity] >= 1,
  );
  if (profile.adas && bodyHit) {
    baseline.push(
      mk(
        'baseline',
        'adas_calibration',
        'ADAS calibration: radar, cameras, park sensors',
        'pro',
        'Static/dynamic calibration needs targets and the marque tool; mandatory after any front or side repair, not optional.',
        profile.adasCalibration,
        ctx,
      ),
    );
  }
  if (
    programs.some(
      (pr) =>
        pr.structural ||
        pr.id === 'wheels_suspension' ||
        (['front', 'rear'].includes(pr.id) && SEV_RANK[pr.severity] >= 1),
    )
  ) {
    baseline.push(
      mk(
        'baseline',
        'alignment',
        'Four-wheel geometry / alignment',
        'pro',
        'Laser geometry after any structural or suspension work; a shop hour, not a garage job.',
        profile.alignment,
        ctx,
        { requires: ['alignment'] },
      ),
    );
  }
  baseline.push(
    mk(
      'baseline',
      'diagnostics',
      'Module scan, fault memory, keys',
      'pro',
      'The marque tool reads crash data and clears what the repair does not; a missing key is a dealer order.',
      profile.diagnostics,
      ctx,
    ),
  );
  return programOf('baseline', [], baseline);
}

// -- Roll-up: money and the owner's own hours --------------------------------------------

// The owner's labor is counted, never priced: DIY hours are the second
// currency a rebuild is paid in and the plan states them separately.
function diyHoursTotal(lines: RepairLine[]): number {
  return lines.reduce((s, l) => s + (l.diyHours ?? 0), 0);
}

function rollUp(programs: RepairProgram[], triage: DamageTriage, ctx: Ctx): RepairPlan {
  const lines = programs.flatMap((pr) => pr.lines);
  const total = add(...lines);
  return {
    programs,
    lines,
    diyHoursTotal: diyHoursTotal(lines),
    low: total.low,
    expected: total.expected,
    high: total.high,
    tier: ctx.profile.tier,
    tierLabel: ctx.profile.tierLabel,
    missed: whatPeopleMiss(triage, ctx.lot, ctx.profile),
  };
}
