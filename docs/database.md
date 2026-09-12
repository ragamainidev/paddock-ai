# database

Three databases with different jobs, different engines, and different
failure semantics. None of them may take the app down.

## 1. The three databases

| Database       | Engine                | Holds                                                                                  | Env                                                  | Absent →                                                        |
| -------------- | --------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------- |
| Vehicle DB     | libSQL (file / Turso) | `vehicles` — the year/make/model rows                                                  | `DATABASE_URL`, `TURSO_AUTH_TOKEN`                   | Resolve stage `ok: false`; page renders the meta line           |
| Runs DB        | Postgres 16           | `runs`, `run_events` — inspections, salvage assessments, their event streams and spans | `POSTGRES_URL`                                       | Memory store, `persisted: false` meta line (SPEC 31)            |
| Assessments DB | libSQL (file / Turso) | Saved assessments, their dispatch outbox, watches and agent activity                   | `ASSESSMENTS_DATABASE_URL`, `ASSESSMENTS_AUTH_TOKEN` | `/assessments` is unavailable; every other surface is untouched |

`DATABASE_URL` belongs to the vehicle DB and always has; the Postgres URL is
`POSTGRES_URL` on purpose so node-pg-migrate's default env var is not
misread (`scripts/migrate.ts`). The assessments DB is a separate libSQL
database from the vehicle DB even though both speak libSQL: the vehicle DB is
a derived, re-importable artifact (§2.3) and assessments are the only durable
user data paddock holds.

## 2. Vehicle DB (libSQL)

### 2.1 Client

`getDb()` in `src/lib/db.ts` — one lazy `@libsql/client` per process.
`file:` URLs for dev (`data/ymm.db` full, `data/eval.db` public sample);
`libsql://` for Turso in production with `TURSO_AUTH_TOKEN`. SPEC 17.

### 2.2 Schema

Created atomically by `src/catalog/import.ts`: `vehicles` retains normalized
identity and nullable specifications and adds `source_id`, `source_model`
and `transmission`. `catalog_metadata` holds the versioned source document
at `id = 1`: source/license references, checksum, format, kind, market,
year coverage and row count. EPA and user-CSV adapters share this boundary.
A failed import preserves the previous catalog and unrelated durable tables.

EPA preserves configuration labels and source IDs. `tCharger = T` and
`sCharger = S` provide positive turbo/supercharger evidence; neither marker
present means unknown aspiration, not naturally aspirated. Missing trim,
body, layout, doors and other optional fields remain unknown. These rows do
not establish exact trim, fitment or production/generation boundaries.

### 2.3 Building it

- `pnpm catalog:install` — explicitly download the official DOE/EPA source
  and install `data/ymm.db`; `pnpm ingest` is a compatibility alias.
- `pnpm catalog:sample` — verify the committed sample checksum and install
  the offline fixture in `data/eval.db`.
- `pnpm ingest:user --csv /path/to/catalog.csv --db data/ymm.db` — install
  a separately supplied richer CSV. Its provenance does not assert EPA origin
  or distribution rights.
- `scripts/ensure-eval-db.ts` verifies the sample against its provenance and
  compares the installed metadata checksum and fixture kind; stale or missing
  catalogs are rebuilt. Tests and evals need no network or original source.
- Production: build `ymm.db` locally, upload to Turso and set `DATABASE_URL`
  plus `TURSO_AUTH_TOKEN` on Vercel.

### 2.4 Query rules

- `resolveVehicles` in `src/resolve/catalog.ts` is the shared production and
  evaluation path. SQL uses bound values; source-specific model aliases retain
  the raw EPA label and do not establish exact variant identity.
- Constraints are matched, contradicted or unresolved. Unknown fields receive
  no match credit; candidates and unresolved filters remain visible. Ranking
  and grouping are deterministic (SPEC 7, 9).
- Knowledge tests validate structure, cited family identities and explicitly
  named coverage gaps. The eight public families have no independently
  verified generation boundaries yet (SPEC 8, 37).

## 3. Runs DB (Postgres)

### 3.1 Pool and probe

`src/db/pg.ts`: lazy `pg.Pool` (`max: 10`, `connectionTimeoutMillis: 1500`)
on `globalThis.__paddockPg`, an `error` listener so idle-client errors
never crash the process, and `pgAvailable()` — a cached `select 1` probe
(60 s TTL on success, 5 s on failure) so hot paths never pay a probe per
request and recovery is noticed quickly.

### 3.2 Store resolution

`resolveRunStore()` (`src/runs/resolve-store.ts`) returns `PgRunStore` when
`pgAvailable()`, else `LibsqlRunStore` on the vehicle database when
`libsqlAvailable()` (cached `select 1` probe, same TTLs as Postgres), else
the `MemoryRunStore` singleton. All three implement `RunStore`
(`src/runs/store.ts`) and pass the same contract test
(`src/runs/store.test.ts`: memory and an in-memory libSQL always, Postgres
when `POSTGRES_TEST_URL` is set — a service container in CI, `pnpm db:up`
locally). The ladder itself, including both cached probes, is tested in
`src/runs/resolve-store.test.ts`.

The libSQL store (`src/runs/libsql-store.ts`) exists so the hosted app has
durable, cross-instance runs with no extra service: production Turso
already holds the vehicle DB. Its `runs` / `run_events` tables mirror the
Postgres schema with JSON as text and are created lazily with
`create table if not exists`. Trade-offs: each event is one HTTP insert
to Turso (tens of ms per event), and re-importing the vehicle DB wholesale
into Turso would drop the runs tables — runs are not precious data.

### 3.3 Schema

`db/migrations/0001_runs.sql`:

- `runs(id uuid pk, kind check in ('inspect','salvage'), status check in
('running','done','error'), title, vehicle jsonb, input jsonb, report
jsonb, verdict, error, created_at, finished_at)` with indexes on
  `created_at desc` and `(kind, created_at desc)`.
- `run_events(run_id fk cascade, seq int, at, event jsonb, pk (run_id, seq))`.

The event log is the source of truth for replay; `report` is a convenience
column for list views and finished pages.

### 3.4 Migrations

- Tool: node-pg-migrate, plain SQL files, `checkOrder: true`, table
  `pgmigrations`. Files are `db/migrations/NNNN_<name>.sql` with
  `-- Up Migration` (and `-- Down Migration` when reversible).
- `pnpm db:up` (docker compose Postgres on `127.0.0.1:5433` + migrate),
  `pnpm db:migrate`, `pnpm db:reset` (refuses off localhost), `pnpm db:down`.
- Production: run `POSTGRES_URL=<hosted url> pnpm db:migrate` from a
  laptop once per new migration; there is no migrate-on-deploy step (a
  deploy must never depend on a schema change succeeding).
- Rules: additive first (new column/table), backfill, then a later
  migration removes; never rename in place; every migration is idempotent
  to re-run failures (`if not exists` where the DDL allows).

### 3.5 Functions and triggers

Policy: none. Sequencing, fan-out, and finalization live in the run
manager (`src/runs/manager.ts`) so they are testable offline against the
memory store; the database stores what it is told. If a trigger ever
becomes necessary (e.g. enforcing gapless `seq`), it goes in a migration
with a contract test that exercises it through `PgRunStore`, and a section
here explains why the invariant could not live in code.

### 3.6 Write path

`PgRunStore` is thin: `insert into runs`, `insert into run_events`,
`update runs … where id`, `select` by id / by `seq >= $2` / summaries with
`limit`. No transactions across events — each event is its own insert and
the manager tolerates a failed append by flipping the run to
`persistFailed` (persistence degraded, stream unaffected).

### 3.7 Retention

None automated. Runs accumulate; the list endpoint caps at 50. When it
matters, add a `delete from runs where created_at < now() - interval …`
runbook line in `docs/operations.md`, not a cron in code.

## 4. Local development

```sh
pnpm catalog:sample          # data/eval.db
pnpm db:up                    # docker Postgres + migrations (optional)
DATABASE_URL=file:data/eval.db pnpm dev
```

The docker identifiers (`panelgap`) predate the rename and stay put so the
existing volume keeps working (`docker-compose.yml`).

## 5. Adding a table or column

1. `db/migrations/NNNN_<name>.sql` (next number, `-- Up Migration`).
2. Store method(s) on `RunStore`, implemented in both memory and Postgres.
3. Contract test in `src/runs/store.test.ts` (runs against both).
4. `pnpm db:migrate` locally; note the production migrate command in the
   commit body.
5. Section 3.3 here and, if the shape is user-visible, a SPEC rule.

## 6. Assessments DB (libSQL)

The saved assessment is the one record paddock cannot rebuild. It lives in its
own libSQL database, read and written by three processes at once: the Next app,
the co-hosted eve agent, and the `pnpm agent:worker --once` diagnostic.

### 6.1 Client and tables

`ASSESSMENTS_DATABASE_URL` (plus `ASSESSMENTS_AUTH_TOKEN` for a remote server)
names it; every process must point at the same one, or the queue one drains is
not the queue another fills.

| Table                          | Holds                                                                          | Created by                        |
| ------------------------------ | ------------------------------------------------------------------------------ | --------------------------------- |
| `assessments`                  | The owner-scoped document and its revision, plus the creation idempotency key  | `src/assessments/store.ts`        |
| `assessment_dispatch`          | One research intent per assessment: epoch, generation, status, lease, attempts | `src/assessment-queue/schema.ts`  |
| `assessment_delivery`          | One row per delivery attempt, with the runtime receipt that settles it         | `src/assessment-queue/schema.ts`  |
| `assessment_watches`           | An explicit watch policy, its refresh count and next due time                  | `src/assessment-queue/schema.ts`  |
| `assessment_outcome_prompts`   | When the desk last asked what happened to a lot whose sale is over (SPEC 62)   | `src/assessment-queue/schema.ts`  |
| `assessment_agent_events`      | The inspectable agent activity log the workspace renders                       | `src/assessment-http/activity.ts` |
| `assessment_agent_model_calls` | One row per live coordinator call, which is how the per-session cap is held    | `src/assessment-http/activity.ts` |

`assessment_agent_events` carries one index,
`assessment_agent_events_by_assessment` on `(assessment_id, event_type,
emitted_at)`. It serves the scoped read end to end: the last-ask lookup for one
assessment states the assessment, the event type and takes the latest
`emitted_at`, which is the index's own order. The other two reads are not
index-ordered. The collection-wide last-ask lookup states an owner and a type
but no assessment, so the leading column does not bind and it scans the owner's
events; `listActivity` states an assessment but no type, so the index finds that
assessment's rows and the `emitted_at, id` order is still sorted afterwards.
Both are bounded reads — one owner's log, one assessment's log capped at 500
rows — and the scoped read is the one the schedule runs per assessment.

The agent writes activity through `agent/lib/events.ts`, which reaches the same
two tables through `activityStatement` rather than over HTTP. The app writes
into `assessment_agent_events` too, for the events the deployment itself
produces rather than a model session: `recordActivity` in
`src/assessment-http/activity.ts` records the outcome prompt under the session
id `schedule`.

### 6.2 Schema without migrations

Every statement above is `create table if not exists`, run once per process on
first use (`LibsqlAssessmentStore.ensure`, `ensureQueueSchema`, the `activity.ts`
connection). §3.4's migration rules govern Postgres; they do not reach libSQL,
and §3.2 is the precedent — the libSQL run store creates its tables the same
way. The reason is the same in both places: two independent services open this
database, neither owns a deploy step, and there is no migration runner either of
them could wait on. Additive DDL only. Anything that must drop or rename a
column needs a written procedure here first, because no tool will sequence it.

### 6.3 The hosted rule

`resolveAssessmentsUrl(env)` in `src/assessments/database-url.ts` owns both the
refusal and the default, and all three connections below open the address it
returns. It refuses a hosted deployment that has no durable database: with
`VERCEL` set, a missing `ASSESSMENTS_DATABASE_URL` or one starting with `file:`
throws `unavailable`, which the routes answer as 503. A container-local file is
not shared with the agent and does not survive the instance. Off a deployment it
returns the configured URL or an absolute path to `data/assessments.db`, so the
three connections agree whatever each process's working directory is. Never point it at the vehicle DB: that database is re-imported
wholesale (§2.3), which would take the assessments with it.

### 6.4 The journal mode belongs to the file, the busy timeout to the connection

Four clients open this database: the activity connection
(`src/assessment-http/activity.ts`), the queue's
(`src/assessment-queue/queue.ts`), the store's
(`src/assessments/service.ts`) and the runtime eval's
(`scripts/agent-eval.ts`), which drives a store and a queue of its own against
the same file the eve process writes. Every one of them reaches
`prepareSharedDatabase`, which sets `PRAGMA journal_mode = WAL` and
`PRAGMA busy_timeout` — the activity connection calls it directly, the queue's
reaches it through `ensureQueueSchema`, and the store's through
`LibsqlAssessmentStore.ensure`, which also splices `queueSchema` into its own
schema batch.

WAL is unaffected by which client set it, because on a local `file:` database
the journal mode is stored in the file rather than on the connection: whichever
of them opens it first converts it, the conversion survives every later
process and restart, and `-wal` / `-shm` sidecars appear beside it. Going back
needs an explicit `PRAGMA journal_mode = DELETE` — copy the `.db` file alone and
you copy a database missing its uncheckpointed writes. A remote libSQL server
owns its own locking and ignores both pragmas.

The busy timeout is the opposite kind of setting, and the client does not hold
one connection to keep it on. `transaction()` hands its current connection to
the transaction and lazily opens a fresh one for everything after, so a pragma
run at startup covers the first transaction and nothing that follows. Two
things therefore carry `BUSY_TIMEOUT_MS`: every client that opens this database
is constructed with `timeout`, which the driver applies to each connection it
opens, and `openWriteTransaction` re-applies the pragma to the connection each
`BEGIN IMMEDIATE` is about to take. The second is not redundant with the first
— it is what makes a client built elsewhere, in a test or a script, wait too.

Getting it wrong costs a write, not just time: a write statement SQLite refuses
for another process's lock stays live on that connection, and every later
commit on it answers `SQLITE_BUSY: cannot commit transaction - SQL statements
in progress`, permanently, for that connection. No wait clears it, so the
connection is replaced instead, on every refusal and whatever the message:
`openWriteTransaction` discards one whose `BEGIN IMMEDIATE` was refused and
`withBusyRetry` one whose `execute` or `batch` was, both on the way out as well
as between attempts, so none is ever left for the next caller. A commit is the
exception: its transaction owns its connection, nothing can be swapped
underneath it, so `commitTransaction` waits out a lock and rethrows the rest.

The wait is synchronous: the driver blocks the thread. A lock this process
holds on its own event loop therefore cannot be waited out — only another
process's can, which is the only kind these four clients meet. It also sets the
worst case. Each of the three attempts (`MAX_BUSY_ATTEMPTS`) can spend a full
`BUSY_TIMEOUT_MS`, and a write transaction spends them twice over — once
opening, once committing — so under sustained contention **a local-file write
can block the process for about 30 s** before it fails. That is the deliberate
trade against losing the write; it is also a reason the hosted rule (§6.3)
keeps a `file:` database off a deployment. `src/assessment-queue/schema.test.ts`
pins the parts: the timeout every rotated connection reports, a held lock
waited out from a second thread, the attempt bound, and a refused batch whose
client recovers on the next call.
