import type { InValue } from '@libsql/client';
import type { Constraint, FitmentFilter } from '@/lib/types';

// Constraint → one parameterized SELECT. Every user-supplied value travels as
// an argument, never in the SQL text. `models` entries are trusted LIKE
// patterns from the knowledge table; free-text terms get their wildcards
// escaped so user input can only ever match literally.

export type VehicleRow = {
  id: number;
  make: string;
  model: string;
  year: number;
  engine: string | null;
  submodel: string | null;
  trim: string | null;
  body: string | null;
  drive: string | null;
  block_type: string | null;
  cylinders: number | null;
  displacement: number | null;
  aspiration: string | null;
  fuel: string | null;
  doors: number | null;
};

export type VehicleQuery = { sql: string; args: InValue[] };

// Raw-row cap: rank groups rows into vehicles, so this bounds work, not
// results. The widest legitimate query (a whole make) stays under it.
export const MAX_ROWS = 2000;

function likeContains(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// trim/submodel are nullable; LIKE against NULL is NULL, which OR treats as
// false — right for inclusion, wrong for exclusion (NOT NULL is still NULL
// and would drop the row). COALESCE makes exclusion null-safe.
const TRIM_MATCH =
  "(trim LIKE ? ESCAPE '\\' OR submodel LIKE ? ESCAPE '\\' OR model LIKE ? ESCAPE '\\')";
const TRIM_MISS =
  "(COALESCE(trim, '') NOT LIKE ? ESCAPE '\\' AND COALESCE(submodel, '') NOT LIKE ? ESCAPE '\\' AND model NOT LIKE ? ESCAPE '\\')";

// The identity clauses shared by the top-level constraint and anyOf fitments.
function identityClauses(
  f: Pick<FitmentFilter, 'make' | 'models' | 'yearMin' | 'yearMax'>,
  where: string[],
  args: InValue[],
): void {
  if (f.make) {
    where.push('make = ? COLLATE NOCASE');
    args.push(f.make);
  }
  if (f.models && f.models.length > 0) {
    where.push(`(${f.models.map(() => 'model LIKE ?').join(' OR ')})`);
    args.push(...f.models);
  }
  if (f.yearMin !== undefined) {
    where.push('year >= ?');
    args.push(f.yearMin);
  }
  if (f.yearMax !== undefined) {
    where.push('year <= ?');
    args.push(f.yearMax);
  }
}

// One OR-group of trim alternatives; groups AND together at the call site.
function trimGroupClause(
  terms: string[],
  where: string[],
  args: InValue[],
  reviewed = false,
): void {
  where.push(
    `(${terms.map(() => TRIM_MATCH).join(' OR ')}${reviewed ? ' OR trim IS NULL OR submodel IS NULL' : ''})`,
  );
  for (const term of terms) {
    const p = likeContains(term);
    args.push(p, p, p);
  }
}

export function buildVehicleQuery(c: Constraint, reviewed = false): VehicleQuery | null {
  const where: string[] = [];
  const args: InValue[] = [];

  identityClauses(c, where, args);
  for (const group of c.trimContains ?? []) {
    if (group.length > 0) trimGroupClause(group, where, args, reviewed);
  }
  if (c.cylinders !== undefined) {
    where.push(reviewed ? '(cylinders = ? OR cylinders IS NULL)' : 'cylinders = ?');
    args.push(c.cylinders);
  }
  if (c.displacement !== undefined) {
    where.push(reviewed ? '(displacement = ? OR displacement IS NULL)' : 'displacement = ?');
    args.push(c.displacement);
  }
  if (c.blockType) {
    where.push(reviewed ? '(block_type = ? OR block_type IS NULL)' : 'block_type = ?');
    args.push(c.blockType);
  }
  if (c.aspiration) {
    where.push(reviewed ? '(aspiration = ? OR aspiration IS NULL)' : 'aspiration = ?');
    args.push(c.aspiration);
  }
  if (c.drive) {
    where.push(reviewed ? '(drive = ? OR drive IS NULL)' : 'drive = ?');
    args.push(c.drive);
  }
  if (c.body) {
    where.push("body LIKE ? ESCAPE '\\'");
    if (reviewed) where[where.length - 1] = `(${where[where.length - 1]} OR body IS NULL)`;
    args.push(likeContains(c.body));
  }
  if (c.doors !== undefined) {
    where.push(reviewed ? '(doors = ? OR doors IS NULL)' : 'doors = ?');
    args.push(c.doors);
  }
  if (c.fuel) {
    where.push(reviewed ? '(fuel = ? OR fuel IS NULL)' : 'fuel = ?');
    args.push(c.fuel);
  }
  for (const term of c.exclude?.trimContains ?? []) {
    where.push(TRIM_MISS);
    const p = likeContains(term);
    args.push(p, p, p);
  }
  if (c.anyOf && c.anyOf.length > 0) {
    const alternatives: string[] = [];
    for (const f of c.anyOf) {
      const sub: string[] = [];
      identityClauses(f, sub, args);
      if (f.trimContains && f.trimContains.length > 0)
        trimGroupClause(f.trimContains, sub, args, reviewed);
      if (sub.length > 0) alternatives.push(`(${sub.join(' AND ')})`);
    }
    if (alternatives.length > 0) where.push(`(${alternatives.join(' OR ')})`);
  }
  if (c.exclude?.aspiration && c.exclude.aspiration.length > 0) {
    // Only rows explicitly marked are dropped. A NULL aspiration means
    // "unknown", not "not turbo" — those rows stay and rank explains why.
    where.push(
      `(aspiration IS NULL OR aspiration NOT IN (${c.exclude.aspiration.map(() => '?').join(', ')}))`,
    );
    args.push(...c.exclude.aspiration);
  }

  if (where.length === 0) return null;

  const sql =
    'SELECT id, make, model, year, engine, submodel, trim, body, drive, block_type, cylinders, displacement, aspiration, fuel, doors' +
    ` FROM vehicles WHERE ${where.join(' AND ')}` +
    ` ORDER BY year DESC, make, model, id LIMIT ${MAX_ROWS}`;
  return { sql, args };
}
