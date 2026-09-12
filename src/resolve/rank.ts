import { likeToRegex } from '@/lib/like';
import type { Constraint, EngineSummary, FitmentFilter, ResolvedVehicle } from '@/lib/types';
import type { VehicleRow } from './sql';

// Rows → cards. Split at missing observed model years to avoid claiming a
// catalog record for an absent year. A gap does not establish production or
// generation boundaries; the search UI labels these as catalog years.
const YEAR_GAP = 1;

function describeEngineConfig(blockType?: string, cylinders?: number): string | null {
  if (blockType === 'R') return 'rotary';
  const names: Record<string, string> = { L: 'inline-', V: 'V', H: 'flat-', W: 'W' };
  if (blockType && cylinders !== undefined) return `${names[blockType]}${cylinders}`;
  if (cylinders !== undefined) return `${cylinders}-cylinder`;
  if (blockType) return `${names[blockType]?.replace(/-$/, '')} engine`;
  return null;
}

const ASPIRATION_WORDS: Record<string, string> = {
  NA: 'naturally aspirated',
  Turbo: 'turbocharged',
  Supercharged: 'supercharged',
  Twincharged: 'twincharged',
};

function yearReason(c: Constraint, yearMin: number, yearMax: number): string | null {
  if (c.yearMin !== undefined && c.yearMax !== undefined)
    return `${yearMin}–${yearMax} within ${c.yearMin}–${c.yearMax}`;
  if (c.yearMin !== undefined) return `${yearMin}–${yearMax}, ${c.yearMin} or newer`;
  if (c.yearMax !== undefined) return `${yearMin}–${yearMax}, ${c.yearMax} or older`;
  return null;
}

function constraintDimensions(c: Constraint): number {
  let n = 0;
  if (c.make) n++;
  if (c.models?.length) n++;
  if (c.yearMin !== undefined || c.yearMax !== undefined) n++;
  if (c.trimContains?.length) n++;
  if (c.cylinders !== undefined) n++;
  if (c.blockType) n++;
  if (c.aspiration) n++;
  if (c.drive) n++;
  if (c.body) n++;
  if (c.doors !== undefined) n++;
  if (c.fuel) n++;
  if (c.exclude?.trimContains?.length || c.exclude?.aspiration?.length) n++;
  return n;
}

function fitmentMatches(
  f: FitmentFilter,
  sample: VehicleRow,
  yearMin: number,
  yearMax: number,
): boolean {
  if (f.make && f.make.toLowerCase() !== sample.make.toLowerCase()) return false;
  if (f.models?.length && !f.models.some((p) => likeToRegex(p).test(sample.model))) return false;
  if (f.yearMin !== undefined && yearMax < f.yearMin) return false;
  if (f.yearMax !== undefined && yearMin > f.yearMax) return false;
  return true;
}

function distinct(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => v !== null))].sort();
}

function buildCard(rows: VehicleRow[], c: Constraint, baseScore: number): ResolvedVehicle {
  const { make, model } = rows[0];
  const years = rows.map((r) => Number(r.year));
  const yearMin = Math.min(...years);
  const yearMax = Math.max(...years);

  const engineCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.engine) engineCounts.set(r.engine, (engineCounts.get(r.engine) ?? 0) + 1);
  }
  const engines: EngineSummary[] = [...engineCounts.entries()]
    .map(([engine, count]) => ({ engine, count }))
    .sort((a, b) => b.count - a.count || a.engine!.localeCompare(b.engine!));

  const reasons: string[] = [];
  let score = baseScore;

  const exactModel = (c.models ?? []).some(
    (p) => !p.includes('%') && !p.includes('_') && p.toLowerCase() === model.toLowerCase(),
  );
  if (exactModel) {
    score += 1;
    reasons.push(`model ${model}`);
  } else {
    const hit = (c.models ?? []).find((p) => likeToRegex(p).test(model));
    if (hit) reasons.push(`model matches ${hit}`);
  }

  const yr = yearReason(c, yearMin, yearMax);
  if (yr) reasons.push(yr);

  for (const group of c.trimContains ?? []) {
    const hit = group.find((term) =>
      rows.some((r) =>
        `${r.trim ?? ''} ${r.submodel ?? ''} ${r.model}`.toLowerCase().includes(term.toLowerCase()),
      ),
    );
    if (hit) reasons.push(`trim contains "${hit}"`);
  }

  for (const f of c.anyOf ?? []) {
    if (f.label && fitmentMatches(f, rows[0], yearMin, yearMax)) reasons.push(f.label);
  }

  const engineConfig = describeEngineConfig(c.blockType, c.cylinders);
  if (engineConfig) reasons.push(engineConfig);
  if (c.aspiration) reasons.push(ASPIRATION_WORDS[c.aspiration]);
  if (c.drive) reasons.push(c.drive);
  if (c.body) reasons.push(`body matches "${c.body}"`);
  if (c.doors !== undefined) reasons.push(`${c.doors}-door`);
  if (c.fuel) reasons.push(c.fuel.toLowerCase());
  for (const term of c.exclude?.trimContains ?? []) reasons.push(`excluding trim "${term}"`);
  for (const asp of c.exclude?.aspiration ?? []) reasons.push(`excluding ${ASPIRATION_WORDS[asp]}`);

  return {
    make,
    model,
    yearMin,
    yearMax,
    trims: distinct(rows.map((r) => r.trim)),
    engines,
    drive: distinct(rows.map((r) => r.drive)),
    body: distinct(rows.map((r) => r.body)),
    score,
    reasons,
    rowCount: rows.length,
  };
}

export function rankVehicles(rows: VehicleRow[], constraint: Constraint): ResolvedVehicle[] {
  const groups = new Map<string, VehicleRow[]>();
  for (const row of rows) {
    const key = `${row.make}\0${row.model}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const baseScore = constraintDimensions(constraint);
  const cards: ResolvedVehicle[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => Number(a.year) - Number(b.year));
    let segment: VehicleRow[] = [];
    for (const row of group) {
      const prev = segment[segment.length - 1];
      if (prev && Number(row.year) - Number(prev.year) > YEAR_GAP) {
        cards.push(buildCard(segment, constraint, baseScore));
        segment = [];
      }
      segment.push(row);
    }
    if (segment.length > 0) cards.push(buildCard(segment, constraint, baseScore));
  }

  return cards.sort(
    (a, b) =>
      b.score - a.score ||
      b.rowCount - a.rowCount ||
      b.yearMax - a.yearMax ||
      a.make.localeCompare(b.make) ||
      a.model.localeCompare(b.model),
  );
}
