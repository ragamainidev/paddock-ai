# Public catalog release

## 1. Goal and scope

Publishable application code uses a reproducible DOE/EPA FuelEconomy.gov
catalog by default. A separately supplied richer catalog is optional. The
original master, derived eval subset and unverified generation artifact are
not inputs to public setup, tests or distribution. Preserve existing private
Git history; this branch does not change repository visibility or deploy.

The buyer-facing assessment remains independent of catalog completeness.
Source identity does not establish condition, exact options, fitment, title
history or an authoritative bid. Existing assessment evidence gates stay in force.

## 2. Design

Keep libSQL and deterministic interpretation. Normalize source rows through
explicit EPA and user-CSV adapters. Store source IDs, source URL, license URL,
source checksum, coverage and row granularity alongside a versioned catalog.
Install the official source with an explicit command; never fetch or invoke a
paid model during ordinary tests or initial module loading. A failed or invalid
import must preserve a working catalog and unrelated durable tables.

The official data description is https://www.fueleconomy.gov/feg/ws/index.shtml.
The data catalog https://catalog.data.gov/dataset/fuel-economy-label-and-cafe-data
identifies https://edg.epa.gov/EPA_Data_License.html. Retain those references
and the source-row identity. A record is an EPA configuration, not an exhaustive
trim or parts-fitment record. Blank optional fields remain unknown.

Search distinguishes verified matches, contradictions and unresolved filters.
Unknown filters never earn match credit; they are visible to users. Sparse
catalog years do not establish manufacturing or generation boundaries.
Generation knowledge needs independent citations; missing knowledge remains
an explicit limitation. No LLM may fill missing catalog facts to satisfy tests.

Public tests use independent fixtures and an openly sourced EPA sample. Keep
contract, business-decision and actual Eve runtime evaluations offline. A
separate full-catalog coverage report measures representative searches and
reports unsupported evidence rather than rewriting expected facts to pass.

## 3. Interfaces and ownership

The importer preserves the existing `ingestCsv(csvPath, dbPath)` user-CSV API
and adds explicit EPA installation. `vehicles` keeps its existing nullable
columns and adds source identity/transmission as needed. Metadata is a single
JSON document in `catalog_metadata` (`id = 1`, `json`).

`src/catalog/types.ts` exports `CatalogMetadata`: `schemaVersion: 1`, `id`,
`label`, `sourceUrl`, `licenseUrl`, `sourceSha256`, `kind` (`epa`, `user`,
`fixture`), `market`, `yearMin`, `yearMax`, and `rowCount`.
`src/catalog/metadata.ts` exports `readCatalogMetadata(db)` returning validated
metadata or null for a legacy database. Null metadata is not proof of completeness.

| Task           | Owned files                                                                                                        | Verification                                                         | Status   |
| -------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | -------- |
| Catalog import | `src/catalog/types.ts`, `metadata.ts`, EPA mapping/import files; `scripts/ingest.ts`, installer and targeted tests | malformed/checksum/unknown/atomic import tests                       | verified |
| Search honesty | resolver, search pipeline, result DTO/UI and targeted tests                                                        | real SQL with complete/incomplete rows; exclusion and score cases    | verified |
| Public data    | public EPA sample, ingestion fixture, independent generation definitions, knowledge/fixture tests                  | deterministic fixtures, source provenance, coverage                  | verified |
| Integration    | SPEC/docs, bootstrap/eval runner, package/CI, export and coverage commands                                         | fresh install, full tests, offline evals, builds, actual Eve runtime | verified |

## 4. Release acceptance

- No original master/subset or original generation artifact in the release tree.
- Explicit default install succeeds with the official public source and records provenance.
- Offline bootstrap, tests and evaluations do not access the original data or paid models.
- Search exposes unknown constraints and does not imply exhaustive catalog coverage.
- The complete assessment workflow and its real runtime fixture evaluation pass.
- A snapshot exporter omits private Git history, runtime databases and secrets.
- Push only the feature branch to `ragamainidev/paddock` using the personal SSH identity.
- No PR, merge, deployment, repository creation or visibility change in this task.

## 5. Execution log

- Verified SSH and CLI identity `ragamainidev`; commit email `ragamaini@gmail.com`.
- Integration worktree: `codex/public-catalog`, based on `024347e`.
- Baseline: 102 files / 1,069 tests passed; six existing skips. No paid calls.

- Official installer: 50,242 configurations, 1984–2027; source and sample
  checksums are recorded in `data/epa-sample.provenance.json`.
- Review corrected EPA hybrid classification, source provenance, exact-engine
  overclaims and RS 7 spelling; missing generation boundaries remain unresolved.
- Integrated verification: 110 test files, 1,125 passed, six existing Postgres
  skips; resolver 47/47, inspector 28/28 and salvage 131/131 checks; decisions
  18/18; actual Eve runtime 16/16. Next and Eve production builds passed.
- Full public catalog coverage over the 47 queries: zero resolver errors,
  42 queries returned candidates and 28 had a candidate with every parsed
  constraint supported. This measures retrieval/evidence coverage, not accuracy
  of a vehicle appraisal. The other conditions stay explicitly unresolved.
- Snapshot export and private feature-branch push follow the final commit;
  no repository visibility change or PR is authorized.

- Post-push integrity verification caught Git fixture commands inheriting the
  hook's repository variables. Restored the local checkout metadata and branch
  to the verified commit; main and the pushed source commit were unchanged.
  Isolated fixture/export Git environments, disabled ambient fixture hooks and
  signing, and added a passing bystander-repository regression. The correction
  is a normal follow-up commit; no force push or private-history rewrite.
