# patterns

The architectural patterns every module in paddock follows. Each one names
the code that embodies it and the SPEC rule it serves. New code copies these
shapes; a new shape gets a section here first.

## 1. Stages that fail alone

### 1.1 StageStatus, never throw

Every stage returns `{ stage, ok, detail? }` (`src/lib/types.ts`
`StageStatus`; `InspectStageStatus` in `src/inspector/types.ts`) instead of
throwing across a boundary. Callers collect statuses and render one meta
line per non-ok stage (`src/ui/meta.tsx`, `stageNote` in `src/ui/format.ts`).
SPEC 10, 11, 24.

### 1.2 Independent sources run in parallel, dependent ones after

`enrichVehicle` (`src/pipeline/enrich.ts`) runs NHTSA and eBay with
`Promise.all` — neither can fail the other — and runs themes afterwards
because themes read NHTSA's complaints. Order expresses data dependency,
never convenience.

### 1.3 Empty-but-rendered shapes

A failed stage still returns its shape (`complaints: []`, `themes: []`) so
the UI never branches on `undefined`. The status carries the reason. A
stage that only partly succeeded says so in the same place: NHTSA fetches
one `(model, year)` slice per request, so `fetchComplaints` and
`fetchRecalls` return `{records, attempted, skipped}` and the stage detail
names the holes ("3 of 15 year/model slices unreachable"). Partial data is
still `ok`; losing every slice is not, because a stage that fetched nothing
did not succeed (SPEC 10). An empty section with no such note means there
was nothing to find.

### 1.4 The reason is fixed; the error goes to the log

A caught error's `message` never becomes the `detail` a user reads. It is
written by a library for an engineer — SDK request ids, SQLSTATE,
connection strings — and it varies with the deployment. Instead:
`failureReason(err)` from `src/lib/failure.ts` picks one of five fixed
strings (`classifyError` → model, database, upstream, timeout, unknown) and
the raw error goes to `console.error` under `docs/logging.md §2.2`'s
grammar. The exception is a `statedFailure`, an error our own code raises
with a message written for the reader ("vision output failed validation"):
that message is the reason, because a generic one would erase what the
stage actually learned.

## 2. Injected callers

### 2.1 Every external call is a typed function parameter

Model, fetch, and probe dependencies are function types with a default
implementation and an injection point: `ModelCaller`
(`src/interpret/model.ts`), `ThemeCaller` (`src/enrich/themes.ts`),
`VisionCaller`, `WebResearchCaller`, `VinSweepCaller`, `VpicFetcher`,
`PhotoProbe`, `VinHistoryProbe` (`src/inspector/*`), `TriageCaller`
(`src/salvage/triage.ts`), `SalvageEvidenceCaller` and `CompsFetcher`
(`src/salvage/research.ts`, `src/salvage/comps.ts`), `Fetcher`
(`src/enrich/nhtsa.ts`). Orchestrators
take a `Deps` object (`InspectorDeps`, `EnrichDeps`, `SearchDeps`).

### 2.2 `undefined` means default, `null` means off

`SearchDeps.modelCaller?: ModelCaller | null` — `undefined` uses the real
Anthropic caller, `null` says "no model configured". The same convention
holds for `webCaller`, `vpicFetcher`, `photoProbe`, `vinHistory` in
`InspectorDeps`. Tests pass `null` to switch a stage off, or a fixture
function to script it.

### 2.3 SDK imports are lazy and live in the default caller only

`await import('@anthropic-ai/sdk')` inside `defaultCaller` keeps the SDK out
of every bundle that runs offline (evals, tests, `/evals`). Logic never
imports the SDK directly.

## 3. Deterministic beats model

### 3.1 The tokenizer is authoritative

`tokenize` runs first; `interpretWithModel` may fill only fields left unset
and map only tokens left unparsed (`applyPatch`, `merge` in
`src/interpret/model.ts`). SPEC 5.

### 3.2 Counts, ordering, and plans are computed; the model names

Complaint themes: counts and grouping from data, model supplies titles
(`src/enrich/themes.ts`, SPEC 13). Research topics: derived from findings
with a stated reason (`planResearchTopics`, SPEC 23). Repair plans: derived
from triage plus curated knowledge (`src/salvage/repair-plan.ts`, SPEC 35).

### 3.3 Curated tables outrank family knowledge outrank the model

`src/knowledge/{chassis,engines,variants,models}.ts` → independently cited
`data/public-generations.json` (SPEC 37) → model fallback. The public catalog
currently provides eight family identities and no verified generation or
facelift boundaries. Tests validate structure, source identity and named
coverage gaps; row presence cannot prove engine codes or generation dates.
Unknown catalog filters receive no match credit. Positive EPA turbo/supercharger
markers are evidence; their absence does not prove natural aspiration.

## 4. Honest output

### 4.1 Never invent; state absence

No vehicle, comp, price, or history verdict originates from a model.
Missing data is a visible line ("no comps for this model", "history
unchecked"), never a guess. SPEC 7, 26, 27, 34.

### 4.2 Every inference is an assumption chip

`Assumption {source, input, meaning, reason}` on each branch, rendered
dismissible (`src/ui/chips.tsx`), and dismissing re-runs without the token.
SPEC 2.

### 4.3 Ambiguity forks

`tokenize` returns one `Branch` per defensible reading; the UI renders a
`Fork`. Nothing auto-picks. SPEC 1.

### 4.4 Citations are mandatory for research

`parseWebFindings` drops any finding without an http(s) source; a lone
uncited answer is treated as invented. `needsCitationNudge` allows one
cheap repair turn in the same conversation. SPEC 22.

## 5. Typed event streams

### 5.1 Orchestrators are async generators

`inspectCarStream` and `assessSalvageStream` `yield` typed events
(`InspectEvent`, `SalvageEvent`): `begin`, `thought`, `stage`, `span`,
`report`, `fatal`. The report is last. SPEC 25.

### 5.2 Push channel for callbacks inside awaited work

`eventChannel()` (`src/agent/channel.ts`) turns progress callbacks
fired inside a promise into generator yields while the promise runs — how
each live web search surfaces in the console.

### 5.3 `begin` precedes status; spans ride the stream

Every stage yields `begin` before it can yield its `stage` status, so the
stage rail cannot lie; the tracer's spans are drained at each yield point.
SPEC 32.

### 5.4 Runs are detached, persisted, replayable

`startRun` (`src/runs/manager.ts`) drives the generator independent of the
HTTP response, numbers events gaplessly, mirrors them to a `RunStore`, and
fans out to subscribers. Clients tail `/api/runs/:id/stream?from=<seq>` as
NDJSON. SPEC 30, 31.

### 5.5 One agent runtime, two agents

An inspection and a salvage assessment ask different questions over the same
machinery, so what both run lives in `src/agent/` and neither imports the
other's orchestrator:

- `runToolWorker` (`worker.ts`): one small agent, one forced report tool, a
  hard wall-clock deadline that aborts its own stream, and the `[lane] note`
  progress grammar the console parses. The caller supplies the tool, the
  system prompt and up to two push-backs (a citation repair, an empty-report
  nudge); the loop owns no prompt, no schema and no domain knowledge.
  It returns `{ result }` — the accepted report's tool input, unparsed — or
  `{ stopped }` naming why there is none: `out-of-time` when the budget ran
  out (the early exit before a turn it cannot finish, or the deadline abort)
  and `never-reported` when the worker spent every turn without calling its
  tool. The two are different facts, so the loop states them rather than
  leaving a caller to infer one from the clock: the findings workers drop
  the topic on either, while the VIN sweep answers `out-of-time` with "no
  history found" and raises on `never-reported`
  (`src/inspector/research.test.ts`).
- `eventChannel` (`channel.ts`): §5.2.
- `settle` (`settle.ts`): a stage's promise becomes `{ ok: true, value }` or
  `{ ok: false, detail }`, with the error logged under the stage's own name,
  so an orchestrator never wraps its yields in a try/catch to keep failure a
  state (§1.4, §1.1).
- `runVinStage` (`vin-stage.ts`): the structural decode, the federal vPIC
  merge, the free-history probe and the provenance sweep as typed steps.

A shared stage yields steps, not events. The inspector streams them as they
happen and the assessor runs the same steps in parallel with triage and
reports only the outcome; each maps the steps into its own console grammar.
A difference between the two agents belongs in that mapping, never in a flag
threaded through the shared code.

## 6. Degradation is a supported state

### 6.1 Missing key → deterministic path or honest refusal

Interpret and themes degrade to their deterministic halves; the inspector
and salvage routes refuse before starting (`503`, "ANTHROPIC_API_KEY is not
configured"). Nothing 500s. SPEC 6, 24.

### 6.2 Postgres down → libSQL store → memory store, one meta line

`resolveRunStore` probes `pgAvailable()` then `libsqlAvailable()` (cached
60 s ok / 5 s fail) and falls through Postgres → the libSQL vehicle DB →
`MemoryRunStore`. Only the last is not persistent; the run's first event
says `persisted: false` and the UI prints one line. SPEC 31.

### 6.3 Every network call has a bound

SDK clients are constructed with `timeout` and `maxRetries` (60 s themes,
100 s vision and 120 s triage, 90 s research workers; `maxRetries: 0`
everywhere inside an agent, since `timeout` bounds one attempt and a retry
spends the budget twice); fetches use `AbortSignal.timeout` or an abort timer
(vPIC 8 s, photo probe 5 s, history probe 6 s). Long agent loops carry a
wall-clock deadline that aborts the stream (`runToolWorker` in
`src/agent/worker.ts`, against `WORKER_BUDGET_MS` and `SWEEP_BUDGET_MS`). Every bound is chosen
against the serverless ceiling, not on its own: a budget above the route's
`maxDuration` never fires, so the sums are pinned by
`src/runs/budgets.test.ts` and tabulated in `docs/operations.md §8`.

### 6.4 A caller-supplied URL is screened before it is dereferenced

The photo pre-flight in `src/inspector/photos.ts` is the only place the
server fetches a URL the caller chose, so it carries the request-forgery
boundary (SPEC 29): https only, every address the host resolves to must be
public, and redirects are followed by hand — capped at three hops, each hop
screened again — because `redirect: 'follow'` would hand a public host the
ability to point at the private network. The resolver is injected
(`AddressResolver`), so the screen is tested without DNS. A refused URL is
not an error: it degrades to the same visible "photo N unreachable,
skipped" line a rotted CDN link produces, so the salvage triage path
inherits the guard by sharing the probe.

## 7. Data tested like code

Seeded real listings, salvage lots, comps, and the knowledge tables are
TypeScript modules with tests that check them against reality: VINs decode
against their claimed identity, photos are https on the expected CDN,
provenance is complete, and knowledge mappings either have source identity
evidence or an explicitly recorded coverage gap. Missing source coverage
does not establish that a real vehicle never existed.
`src/inspector/seed-listings.test.ts`, `src/salvage/seed-lots.test.ts`,
`src/knowledge/knowledge.test.ts`, `src/knowledge/generation-catalog.test.ts`.
SPEC 8, 28, 34, 37.

## 8. Pure projections

Anything the UI derives from a stream is a pure function of the event log:
`reduceRun` (`src/ui/run/lines.ts`) for the console, stage rail, and trace
waterfall; `stageNote`, `assumptionChip`, `yearRange` (`src/ui/format.ts`).
Pure functions are unit-tested; components stay thin.

## 9. Process-wide singletons via `globalThis`

Lazy resources that must survive Next dev hot reloads hang off `globalThis`
under a namespaced key: `__paddockPg` (pool + probe), `__paddockRuns`
(active runs), `__paddockStores` (store instances). Construction is lazy
so env handling is a runtime concern, not a build-time one (`getDb`,
`getPool`).

## 10. Ledgers with a basis

Money is never a bare number: every cost line carries its basis and an
evidence chip (`schedule`, `curated`, `override`, `cited`, `derived`),
every comp behind the exit is typed and either used or struck with a
reason, and confidence is an audited ledger of named factors
(`buildLedger` in `src/salvage/ceiling.ts`, `selectExit` in
`src/salvage/exit.ts`, `confidenceLedger` in `src/salvage/assess.ts`;
constants sourced in `docs/salvage-economics.md`). Money enters the model
only through structured tool fields, never regex over prose (SPEC 44).
SPEC 36–39, 43–45.

### 10.1 A solved number, not a scenario

The salvage ledger does not run "at a bid": it solves the highest bid
that satisfies the discipline (`solveMaxBid`), records what would change
it (`sensitivity`), and, at zero, what ate it (`killers`) and what would
have to be true (`unlocks`). Anything that scales with the bid (buyer,
virtual bid, and broker fees) is inside the solve; anything that scales
with the exit (selling costs) is recomputed per scenario. SPEC 39.

### 10.2 One damage event, one program

Triage zones fold into repair programs keyed by damage event; a program
carries at most one structural line, sized by its worst zone with a
stated increment per extra heavy zone, and paint is one program across
every refinished zone (`deriveRepairPlan`, `src/salvage/repair-plan.ts`).
Per-vehicle numbers come from a profile — marque tier defaults plus model
overrides (`src/salvage/tiers.ts`) — so two cars with the same photos
price differently. SPEC 43.

### 10.3 The buyer layer over the kernel

The kernel prices the lot vehicle-relatively; the buyer layer (`buyerLedger`,
`src/assessments/buyer-ledger.ts`) prices the same plan for one bidder. It
reads `CeilingInputs` and returns new lines rather than editing the kernel's,
so `report.ledger` stays the kernel's own vehicle-relative number — the market
persona's is `buyerEconomics.market.maxBid`, a third figure solved through the
same layer — and all of them can be shown side by side. Only what a buyer input decides is replaced: the fee
mode's flat and bid-dependent fee lines (`access`), the exit channel's band and
selling costs — except the private sale the tier's own band already prices,
whose channel percentages are informational — the stated jurisdiction's title
process, and every DIY line
whose equipment the buyer does not own, bought at the tier's shop rate with its
hours leaving the labor line. The buyer's own time and holding join the ledger
as lines of their own. Each line the layer adds or changes states its basis and
reads `derived`; a line it does not touch keeps the kernel's chip and basis.
The target is the least of the buyer's discipline, the low exit minus their
required surplus, and the kernel's disciplined target, so a looser discipline
cannot lift the ceiling — while a bidder who genuinely pays less (a licensed
account, a car that is never sold) clears a higher bid, and the lines say which
ones did it. The bid is then the lesser of that solve and the cash solve, and
`discipline.bound` names the arm that produced it, so the decision's own
sentence can say a cash limit set the ceiling rather than crediting the margin
that limit left intact. SPEC 58–59.

## 11. Anti-patterns (do not)

- Throw across a stage boundary; return a status.
- Call an SDK inside logic; inject a caller.
- Let a model write a count, a price, a vehicle, or a verdict about history.
- Resolve ambiguity silently or drop an unfilterable term.
- Add a network call without a timeout or a loop without a deadline.
- Print a percentage confidence to the user (removed on purpose); show the
  factors.
- Read `process.env` in client code or prefix a secret with `NEXT_PUBLIC_`.
