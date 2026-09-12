import { Suspense } from 'react';
import { getDb } from '@/lib/db';
import type { BranchResult } from '@/pipeline/search';
import { runSearch } from '@/pipeline/search';
import { AssumptionChips } from './chips';
import { Enrichment } from './enrichment';
import { forwardedTerms, parseSelection, selectionParam } from './format';
import { StageNotes } from './meta';
import { VehicleCard } from './vehicle-card';

const MAX_PER_BRANCH = 12;

// The search half of the page: interpret + resolve, rendered server-side.
// Enrichment for the selected vehicle streams in below through its own
// Suspense boundary so a slow NHTSA never blocks the vehicle list.
export async function Results({ query, selection }: { query: string; selection?: string }) {
  const result = await runSearch(query, { db: getDb() });
  const { interpretation, branches, statuses } = result;

  const sel = parseSelection(selection);
  const selectedBranch = sel ? branches[sel.branch] : undefined;
  const selectedVehicle = selectedBranch?.vehicles[sel!.vehicle];

  const fork = branches.length > 1;
  const total = branches.reduce((n, b) => n + b.vehicles.length, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="type-meta flex flex-col gap-1">
        {result.coverageNotes.map((note) => (
          <p key={note}>{note}</p>
        ))}
        {result.catalog?.sourceUrl && /^https?:\/\//i.test(result.catalog.sourceUrl) && (
          <a className="underline" href={result.catalog.sourceUrl}>
            Catalog source
          </a>
        )}
      </div>
      {!fork && branches[0] && (
        <AssumptionChips query={query} assumptions={branches[0].branch.assumptions} />
      )}

      {branches.flatMap(({ branch }) =>
        (branch.constraint.unfilterable ?? []).map((term) => (
          <p key={`${branch.label}:${term.term}`} className="type-meta">
            Unresolved in {branch.label}: {term.term} — {term.reason}
          </p>
        )),
      )}

      {interpretation.conflicts.map((c) => (
        <p key={c} className="type-body text-dim">
          {c}
        </p>
      ))}

      {interpretation.unparsed.length > 0 && (
        <p className="type-meta">not interpreted: {interpretation.unparsed.join(', ')}</p>
      )}

      {total === 0 ? (
        <p className="type-body text-dim">
          No candidates found in this catalog for those constraints.
        </p>
      ) : fork ? (
        <Fork query={query} branches={branches} selection={sel} />
      ) : (
        <VehicleGrid query={query} branchIndex={0} branch={branches[0]} selection={sel} />
      )}

      <StageNotes statuses={statuses} />

      {sel && selectedVehicle && selectedBranch && (
        <section className="mt-2 border-t border-border pt-6">
          <Suspense fallback={<p className="type-meta">pulling NHTSA data and listings</p>}>
            <Enrichment
              vehicle={selectedVehicle}
              trims={selectedBranch.branch.constraint.trimContains}
              forwarded={forwardedTerms(selectedBranch.branch.constraint)}
            />
          </Suspense>
        </section>
      )}
    </div>
  );
}

// Ambiguity fork: side-by-side panels split by a 1px border-strong divider,
// each headed with its reading. Neither is preselected, ever.
function Fork({
  query,
  branches,
  selection,
}: {
  query: string;
  branches: BranchResult[];
  selection: { branch: number; vehicle: number } | null;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2">
      {branches.map((b, bi) => (
        <div
          key={b.branch.label}
          className={`flex flex-col gap-3 ${
            bi > 0
              ? 'mt-6 border-t border-border-strong pt-6 md:mt-0 md:border-t-0 md:border-l md:pt-0 md:pl-6'
              : 'md:pr-6'
          }`}
        >
          <h2 className="type-h2">{b.branch.label}</h2>
          <AssumptionChips query={query} assumptions={b.branch.assumptions} />
          <VehicleList
            query={query}
            branchIndex={bi}
            branch={b}
            selection={selection}
            columns={1}
          />
        </div>
      ))}
    </div>
  );
}

function VehicleGrid({
  query,
  branchIndex,
  branch,
  selection,
}: {
  query: string;
  branchIndex: number;
  branch: BranchResult;
  selection: { branch: number; vehicle: number } | null;
}) {
  return (
    <VehicleList
      query={query}
      branchIndex={branchIndex}
      branch={branch}
      selection={selection}
      columns={2}
    />
  );
}

function VehicleList({
  query,
  branchIndex,
  branch,
  selection,
  columns,
}: {
  query: string;
  branchIndex: number;
  branch: BranchResult;
  selection: { branch: number; vehicle: number } | null;
  columns: 1 | 2;
}) {
  const shown = branch.vehicles.slice(0, MAX_PER_BRANCH);
  const rest = branch.vehicles.length - shown.length;
  if (shown.length === 0) {
    return (
      <p className="type-body text-dim">No candidates found in this catalog for this reading.</p>
    );
  }
  return (
    <>
      <ul className={`grid grid-cols-1 gap-2 ${columns === 2 ? 'sm:grid-cols-2' : ''}`}>
        {shown.map((v, vi) => {
          const isSelected = selection?.branch === branchIndex && selection?.vehicle === vi;
          const params = new URLSearchParams({ q: query });
          // Clicking the selected card again deselects it.
          if (!isSelected) params.set('v', selectionParam(branchIndex, vi));
          return (
            <li key={`${v.make} ${v.model} ${v.yearMin} ${vi}`}>
              <VehicleCard vehicle={v} href={`/search?${params}`} selected={isSelected} />
            </li>
          );
        })}
      </ul>
      {rest > 0 && <p className="type-meta">{rest} more not shown</p>}
    </>
  );
}
