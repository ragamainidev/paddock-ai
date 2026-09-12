import type { Client } from '@libsql/client';
import { likeToRegex } from '@/lib/like';
import type { Constraint, FitmentFilter, ResolvedVehicle } from '@/lib/types';
import { rankVehicles } from './rank';
import { readCatalogMetadata } from '@/catalog/metadata';
import type { CatalogMetadata } from '@/catalog/types';
import { catalogModelState, withCatalogModelAliases } from './model-aliases';
import { buildVehicleQuery, type VehicleRow } from './sql';

type State = 'matched' | 'contradicted' | 'unknown';
type Fact = { label: string; state: State };
const and = (states: State[]): State =>
  states.includes('contradicted')
    ? 'contradicted'
    : states.includes('unknown')
      ? 'unknown'
      : 'matched';
const or = (states: State[]): State =>
  states.includes('matched') ? 'matched' : states.includes('unknown') ? 'unknown' : 'contradicted';
const compare = (actual: string | number | null, matches: boolean): State =>
  actual == null ? 'unknown' : matches ? 'matched' : 'contradicted';
const not = (state: State): State =>
  state === 'unknown' ? state : state === 'matched' ? 'contradicted' : 'matched';
function trimState(row: VehicleRow, terms: string[]): State {
  return or(
    terms.map((term) =>
      or(
        [row.trim, row.submodel, row.model].map((value) =>
          compare(value, value?.toLowerCase().includes(term.toLowerCase()) ?? false),
        ),
      ),
    ),
  );
}
function identity(
  row: VehicleRow,
  c: Pick<FitmentFilter, 'make' | 'models' | 'yearMin' | 'yearMax'>,
  epa = false,
): Fact[] {
  const facts: Fact[] = [];
  if (c.make)
    facts.push({
      label: `make ${c.make}`,
      state: compare(row.make, row.make.toLowerCase() === c.make.toLowerCase()),
    });
  if (c.models?.length)
    facts.push({
      label: `model ${row.model}`,
      state: epa
        ? catalogModelState(row.make, row.model, c.models)
        : compare(
            row.model,
            c.models.some((p) => likeToRegex(p).test(row.model)),
          ),
    });
  if (c.yearMin !== undefined || c.yearMax !== undefined)
    facts.push({
      label: 'requested years',
      state: compare(
        row.year,
        (c.yearMin === undefined || row.year >= c.yearMin) &&
          (c.yearMax === undefined || row.year <= c.yearMax),
      ),
    });
  return facts;
}
export function reviewVehicle(row: VehicleRow, c: Constraint, epa = false): Fact[] {
  const facts = identity(row, c, epa);
  for (const group of c.trimContains ?? [])
    if (group.length)
      facts.push({ label: `trim ${group.join(' or ')}`, state: trimState(row, group) });
  const fields = [
    ['cylinders', 'cylinders', 'cylinders'],
    ['displacement', 'displacement', 'displacement'],
    ['blockType', 'block_type', 'engine layout'],
    ['aspiration', 'aspiration', 'aspiration'],
    ['drive', 'drive', 'drive'],
    ['doors', 'doors', 'doors'],
    ['fuel', 'fuel', 'fuel'],
  ] as const;
  for (const [key, column, label] of fields)
    if (c[key] !== undefined)
      facts.push({
        label: row[column] === c[key] ? `${label}: ${c[key]}` : label,
        state: compare(row[column], row[column] === c[key]),
      });
  if (c.body)
    facts.push({
      label: `body ${c.body}`,
      state: compare(row.body, row.body?.toLowerCase().includes(c.body.toLowerCase()) ?? false),
    });
  for (const term of c.exclude?.trimContains ?? [])
    facts.push({ label: `excluding trim "${term}"`, state: not(trimState(row, [term])) });
  for (const aspiration of c.exclude?.aspiration ?? [])
    facts.push({
      label: `excluding aspiration ${aspiration}`,
      state: not(compare(row.aspiration, row.aspiration === aspiration)),
    });
  if (c.anyOf?.length) {
    const alternatives = c.anyOf.map((f) => ({
      label: f.label,
      state: and([
        ...identity(row, f, epa).map((v) => v.state),
        ...(f.trimContains?.length ? [trimState(row, f.trimContains)] : []),
      ]),
    }));
    const state = or(alternatives.map((f) => f.state));
    facts.push({
      label:
        alternatives.find((f) => f.state === 'matched')?.label ?? 'engine fitment alternatives',
      state,
    });
  }
  for (const unsupported of c.unfilterable ?? [])
    facts.push({ label: `${unsupported.term}: ${unsupported.reason}`, state: 'unknown' });
  return facts;
}

// SQL retains unknown optional facts; review rejects contradictions again and
// groups only rows with the same evidence, so one complete row cannot vouch
// for another incomplete configuration. This is the production/eval entrypoint.
export async function resolveVehicles(
  db: Client,
  constraint: Constraint,
  options: {
    catalogKind?: CatalogMetadata['kind'] | null;
    catalogFormat?: CatalogMetadata['format'] | null;
  } = {},
): Promise<ResolvedVehicle[]> {
  const metadata =
    options.catalogFormat === undefined && options.catalogKind === undefined
      ? await readCatalogMetadata(db).catch(() => null)
      : null;
  // Format controls name normalization; it does not establish source rights.
  const epa =
    (options.catalogFormat ?? metadata?.format ?? options.catalogKind ?? metadata?.kind) === 'epa';
  const query = buildVehicleQuery(epa ? withCatalogModelAliases(constraint) : constraint, true);
  if (!query) return [];
  const result = await db.execute({ sql: query.sql, args: query.args });
  const groups = new Map<string, { rows: VehicleRow[]; facts: Fact[] }>();
  for (const row of result.rows as unknown as VehicleRow[]) {
    const facts = reviewVehicle(row, constraint, epa);
    if (facts.some((f) => f.state === 'contradicted')) continue;
    const key = JSON.stringify([row.make, row.model, facts]);
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { rows: [row], facts });
  }
  const cards: ResolvedVehicle[] = [];
  for (const { rows, facts } of groups.values()) {
    for (const card of rankVehicles(rows, {})) {
      cards.push({
        ...card,
        score: facts.filter((f) => f.state === 'matched').length,
        reasons: facts.filter((f) => f.state === 'matched').map((f) => f.label),
        unresolved: facts.filter((f) => f.state === 'unknown').map((f) => f.label),
        catalogYears: [
          ...new Set(
            rows.filter((r) => r.year >= card.yearMin && r.year <= card.yearMax).map((r) => r.year),
          ),
        ].sort((a, b) => a - b),
      });
    }
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
