import type { Client } from '@libsql/client';
import { interpretWithModel, type ModelCaller } from '@/interpret/model';
import { tokenize } from '@/interpret/tokenize';
import { failureReason } from '@/lib/failure';
import type { Branch, Interpretation, ResolvedVehicle, StageStatus } from '@/lib/types';
import { resolveVehicles } from '@/resolve/catalog';
import { MAX_ROWS } from '@/resolve/sql';
import { readCatalogMetadata } from '@/catalog/metadata';
import type { CatalogMetadata } from '@/catalog/types';

// The search half of the pipeline: interpret (deterministic, then model
// fallback) and resolve (SQL + rank), each reporting its own StageStatus.
// The model degrading never touches resolution; a database failure never
// touches the interpretation. Enrichment lives in ./enrich and runs later,
// per selected vehicle.

export type BranchResult = {
  branch: Branch;
  vehicles: ResolvedVehicle[];
};

export type SearchResult = {
  query: string;
  interpretation: Interpretation;
  branches: BranchResult[];
  statuses: StageStatus[];
  catalog: CatalogMetadata | null;
  coverageNotes: string[];
};

export type SearchDeps = {
  db: Client;
  // undefined = use the real Anthropic caller; null = no model configured.
  modelCaller?: ModelCaller | null;
};

async function interpret(
  query: string,
  modelCaller: ModelCaller | null | undefined,
): Promise<{ interpretation: Interpretation; status: StageStatus }> {
  const deterministic = tokenize(query);
  const complete = deterministic.unparsed.length === 0 && deterministic.branches.length > 0;
  if (complete) {
    return { interpretation: deterministic, status: { stage: 'interpret', ok: true } };
  }

  const caller = modelCaller === undefined && !process.env.ANTHROPIC_API_KEY ? null : modelCaller;
  if (caller === null) {
    return {
      interpretation: deterministic,
      status: {
        stage: 'interpret',
        ok: false,
        detail: 'model fallback skipped (no ANTHROPIC_API_KEY); some terms stayed uninterpreted',
      },
    };
  }

  const { interpretation, status } = await interpretWithModel(query, deterministic, caller);
  if (!status.ok) {
    return {
      interpretation,
      status: { stage: 'interpret', ok: false, detail: `model fallback failed: ${status.detail}` },
    };
  }
  return { interpretation, status: { stage: 'interpret', ok: true } };
}

async function resolveBranches(
  db: Client,
  interpretation: Interpretation,
  catalog: CatalogMetadata | null,
): Promise<{ branches: BranchResult[]; status: StageStatus }> {
  const branches: BranchResult[] = [];
  const failures: string[] = [];
  for (const branch of interpretation.branches) {
    try {
      branches.push({
        branch,
        vehicles: await resolveVehicles(db, branch.constraint, {
          catalogKind: catalog?.kind ?? null,
          catalogFormat: catalog?.format ?? null,
        }),
      });
    } catch (err) {
      console.error('search resolve: vehicle query failed:', err);
      failures.push(failureReason(err));
      branches.push({ branch, vehicles: [] });
    }
  }
  return {
    branches,
    status:
      failures.length > 0
        ? // Branches fail one at a time but share a vocabulary of fixed
          // reasons, so the same sentence would otherwise repeat per branch.
          { stage: 'resolve', ok: false, detail: [...new Set(failures)].join('; ') }
        : { stage: 'resolve', ok: true },
  };
}

export async function runSearch(query: string, deps: SearchDeps): Promise<SearchResult> {
  const { interpretation, status: interpretStatus } = await interpret(query, deps.modelCaller);
  const catalog = await readCatalogMetadata(deps.db).catch(() => null);
  const { branches, status: resolveStatus } = await resolveBranches(
    deps.db,
    interpretation,
    catalog,
  );
  const coverageNotes = [
    catalog
      ? `${catalog.label}: ${catalog.rowCount} source records, ${catalog.yearMin}–${catalog.yearMax}, ${catalog.market}.`
      : 'Catalog provenance and coverage are unavailable; completeness is unknown.',
    catalog?.format === 'epa' || catalog?.kind === 'epa'
      ? 'Each source record is an EPA configuration, not an exhaustive trim or parts-fitment record.'
      : 'Catalog records do not establish complete trim or fitment coverage.',
    'Years shown are observed catalog years, not production or generation boundaries. Unresolved filters are not verified matches.',
    `Search is limited to ${MAX_ROWS.toLocaleString('en-US')} source records per reading; broad searches may omit candidates.`,
  ];
  return {
    catalog,
    coverageNotes,
    query,
    interpretation,
    branches,
    statuses: [interpretStatus, resolveStatus],
  };
}
