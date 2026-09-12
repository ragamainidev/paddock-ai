# testing-and-evals

Three layers of verification, all offline by default, all run by hooks
before code leaves a machine. Live model calls are never a gate.

## 1. Layers

| Layer           | Command                                          | What it proves                                                                                                                       | Runs on        |
| --------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| Unit + contract | `pnpm test`                                      | Pure functions, parsers, merges, stores (contract), orchestrators over scripted callers, seed data integrity                         | pre-push, CI   |
| Offline evals   | `pnpm eval`                                      | Resolver cases end to end against the eval DB; inspector + salvage suites over fixtures graded per check; writes committed artifacts | pre-push, CI   |
| Live evals      | `pnpm eval:live`                                 | Resolver with the model fallback (needs a key)                                                                                       | by hand only   |
| Static          | `pnpm typecheck`, `pnpm lint`, `pnpm docs:check` | Types (incl. generated route types), lint, docs/SPEC integrity                                                                       | pre-commit, CI |

## 2. Unit tests

### 2.1 Where and how

vitest, `environment: node`, files `src/**/*.test.ts`, `scripts/**/*.test.ts`,
`evals/**/*.test.ts` (`vitest.config.ts`). Tests live beside the code.
`@/` resolves to `src/`.

### 2.2 Everything external is injected

Tests script the world through the `*Caller` / `Fetcher` / `Probe`
parameters (`docs/patterns.md §2`). A test never hits the network or the
Anthropic API. `null` switches a stage off; a function returning a fixture
scripts it; a function throwing tests degradation.

### 2.3 Contract tests

`src/runs/store.test.ts` runs the same suite against `MemoryRunStore`, an
in-memory `LibsqlRunStore`, and — when `POSTGRES_TEST_URL` names a
database — `PgRunStore` (`describe.skipIf`). The variable is
`POSTGRES_TEST_URL`, not the app's `POSTGRES_URL`: the contract writes real
rows, so it points at a throwaway database. CI's `checks` job provides one
as a `postgres:16` service (port 5434, migrated before the test step), and
`pnpm db:up` provides one locally. Unset, the arm skips and the test
bootstrap (`scripts/vitest-global-setup.ts`) says so, because a third of a
contract quietly not running looks exactly like it passing — and the
reporter shows nothing a worker prints, so the announcement has to come
from the main process. New store methods go in the contract, not in one
implementation's tests.

### 2.4 Data tested like code

- `src/knowledge/knowledge.test.ts` — validates mapping structure and names
  public source coverage gaps explicitly (SPEC 8).
- `src/knowledge/generation-catalog.test.ts` — eight family identities cite
  actual EPA records; generation boundaries remain unavailable (SPEC 37).
- `src/inspector/seed-listings.test.ts`, `src/salvage/seed-lots.test.ts` —
  VINs decode to the claimed identity, photos are https on the expected
  hosts, provenance present, comps resolve (SPEC 28, 34).
- `scripts/subset-spec.test.ts` — the public EPA sample predicate and
  provenance checksum are reproducible (SPEC 16).

The eval DB is built once per `pnpm test` by
`scripts/vitest-global-setup.ts` (`globalSetup` in `vitest.config.ts`)
before any worker starts, because five test files need it and five
concurrent ingests of one file lock each other out on a cold checkout. The
per-file `ensureEvalDb()` calls are then a stat and a path. `evals/run.ts`
builds it the same way in its own process.

### 2.5 What a good test looks like here

- Names the invariant it defends when there is one
  (`"no uncited claims survive"`, `"never reports a history verdict"`).
- Adversarial by default for parsers: malformed, empty, out-of-range,
  off-taxonomy input.
- Asserts on statuses and events, not on log output.
- Freezes time when timing is involved (`now` injection, `FROZEN_NOW`).

## 3. Evals

### 3.1 Resolver suite

`evals/queries.jsonl` — one case per line: `query`, optional `note`, and
`expect` where all listed expectations AND together (`top`, `k`,
`forkMakes`, `nothing`, `contains`, `assumption`, `unfilterable`;
`evals/score.ts`). Runs tokenize → SQL → rank against `data/eval.db`. A
case with no expectations fails by design.

### 3.2 Inspector and salvage suites

`evals/inspector/suite.ts` and `evals/salvage/suite.ts` run the
orchestrators over recorded fixtures (`evals/inspector/fixtures.ts`,
`evals/salvage/cases/*.json`) and grade per check with a class:
`invariant` (cites a SPEC rule), `behavior`, `honesty`, `realism`.
Adversarial cases are first-class. A salvage case is `{ lotId, triage,
evidence: { comps, prices, ebayRaw? }, expect? }` — the triage as the model
returned it and the comps/prices as their sources stated them, one entry per
car or part; `expect` carries the per-case behavior expectations
(`verdict`, `dealbreaker`, `noExit`, `exitLane`, `wreckMax`,
`oneFrontProgram`). `ebayRaw` is recorded eBay Browse item summaries: the
suite runs the live comps fetcher (`src/salvage/comps.ts`) over a stub
client and merges what survives screening into the case's comps, so the
fixed-price rule and the whole-vehicle floor are graded rather than assumed
(checks `comps-fixed-price-only`, `comps-whole-car`; SPEC 53). The floor
itself is restated band by band in the suite, never imported, so a fetcher
that stopped applying it fails the eval rather than agreeing with it.
`expect.progressIncludes` is a list of substrings the fetcher's progress
notes must contain (check `comps-progress`), which is how a case pins the
counts a screen reported — `3 dropped: 2 no fixed price, 1 under the
whole-vehicle floor`.

### 3.3 Artifacts

`pnpm eval` writes `evals/results.json` (rendered by `/evals`),
`evals/results.md` (human twin), and appends one line to
`evals/history.jsonl`. All three are committed. `--cases <path>` runs a
different case file and writes nothing: the artifact is the committed
suite's result, and a run over other cases has none. `evals/run.test.ts`
uses it to prove the exit code.

`pnpm eval:agent` writes `evals/agent/results.md` (committed) beside
`evals/agent/results.json` (gitignored). The markdown states each case's
checks and the saved `revision`, `investigations` and `evidence` counts;
the session id a run received is new every time, so it stays in the JSON,
where the run that produced it is read. `pnpm eval:decisions` writes
`evals/agent/decision-results.md` (committed) and
`evals/agent/decision-results.json` (gitignored).

The writers are prettier-stable: `results.json` and
`evals/agent/decision-results.md` (from `pnpm eval:decisions`) are written
through prettier's API, because lint-staged formats every committed
`*.json` and `*.md` and a writer that formats differently leaves the tree
modified after every run. `evals/results.md` is in `.prettierignore` and
`history.jsonl` has no prettier parser, so both are stable as written;
`evals/agent/results.md` is headings, list items and one-line paragraphs,
which prettier leaves alone.
`pnpm eval:check` (a CI step after each eval) asserts it: on a clean tree,
a re-run may differ from the committed artifacts only in their run header
— the resolver's `- date:`/`"gitSha":` lines, the cohort's `As of`, and the
runtime suite's `Generated:`. Regenerate them, never edit or hand-merge
them; on a rebase conflict, take either side and re-run `pnpm eval`.
SPEC 15, 20.

### 3.4 Adding a case

- Resolver: append a line to `queries.jsonl` with the tightest expectation
  that would catch the regression you fear; run `pnpm eval`; commit the
  regenerated artifacts with the code change.
- Agent suites: add a fixture (record real output when you can), add a
  case in the suite with checks, cite the SPEC rule on `invariant` checks.

### 3.5 The decision cohort, case by case

`evals/agent/decision-cohort.ts` runs one recorded lot
(`sf90-front-il`, fixture case `ready-candidate`) through the whole
decision loop for one stated buyer per case, and
`evals/agent/decision-cohort.test.ts` holds the literal expectations. Every
bidder case states its buyer in full, because a cohort case measures the
decision layer and a moving product default must not move it. The two
preset cases are the deliberate exception: `no-edge-walk` is
`BUYER_PRESETS.hobbyist` and `edge-positive-build` is the shop preset with
a `keep` exit and a limit that does not bind, because what they pin is the
product's own wedge and shop against the room (the comment above
`PRESET_CASES` says so). Editing a preset moves those two rows, and is
meant to. `split` is a label — `holdout` reserves a case from the ones the
design was written against; none of them is blind real-world validation
(SPEC 55).

| Case                        | Split       | What it pins                                                                                                                                       |
| --------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| equipped-opportunity        | development | The positive path: a complete, reviewed bundle for an equipped buyer builds.                                                                       |
| cash-constrained            | development | A cash limit that binds ends the lot, rather than quietly shrinking the ceiling.                                                                   |
| missing-physical-inspection | development | No physical inspection is abstention, never a bid.                                                                                                 |
| ineligible-title            | development | A certificate of destruction vetoes before any arithmetic runs (SPEC 45).                                                                          |
| wrong-jurisdiction          | holdout     | An eligibility record for another state does not close the registration gate.                                                                      |
| future-sale-leakage         | holdout     | A comparable dated after the decision is never promoted into it.                                                                                   |
| unknown-title-market        | holdout     | Comparables of unknown title cannot carry the market gate.                                                                                         |
| unequipped-buyer            | holdout     | A buyer without the tools the plan wants is asked for evidence, not given a bid.                                                                   |
| above-optimistic-bound      | holdout     | A required surplus above the low exit leaves no bid to clear even at the optimistic bound.                                                         |
| quote-on-diy-line           | holdout     | A reviewed quote converts a DIY line to professional work and removes its hours, so a buyer with no time can build.                                |
| dominated-at-high-exit      | holdout     | The optimistic bound prices selling costs at the high exit, and screens an observed bid it cannot clear (SPEC 39).                                 |
| self-attested-market        | holdout     | Owner-typed comparables never satisfy the market gate alone (SPEC 56).                                                                             |
| broker-vs-direct            | holdout     | A direct licensed account pays neither broker charge and clears a higher bid than the broker seat (SPEC 58).                                       |
| private-party-vs-retail     | holdout     | The retail channel's own exit factors and selling band; a broker seat selling retail is the persona minus the broker cut, so it walks on the edge. |
| keep-not-sell               | holdout     | A car that is never sold carries a zero selling line and states the value it retains instead (SPEC 59).                                            |
| no-edge-walk                | holdout     | The hobbyist wedge cannot reach an exotic rebuild: a ceiling below the room's price is a walk naming both numbers (SPEC 60).                       |
| edge-positive-build         | holdout     | A capitalized shop that keeps the car genuinely pays less than the persona, and builds on a positive edge (SPEC 60).                               |
| state-title-process         | holdout     | A stated jurisdiction prices the title line from California's published band and leaves the kernel's national band untouched (SPEC 59).            |

`no-booth-converts-paint` is deliberately not a cohort case: no curated DIY
line on these lots requires equipment — paint is priced professional for
every buyer — so a cohort case could not build the situation it names. The
capability gate is pinned instead by the fixture-line unit test "a buyer
without a booth buys the paint line, at the shop price and with the reason"
in `src/assessments/buyer-ledger.test.ts`, whose plan states a DIY paint
line requiring a booth.

## 4. Hooks and CI

- pre-commit (`.husky/pre-commit`): lint-staged (prettier, eslint
  `--max-warnings 0`), `pnpm typecheck`, `pnpm docs:check`.
- pre-push (`.husky/pre-push`): `pnpm test`, `pnpm eval`.
- CI (`.github/workflows/ci.yml`) runs three jobs on PRs and `main`:
  `checks` (typecheck, lint, test, `pnpm eval`, `pnpm eval:decisions`,
  `pnpm build`) and `agent-runtime` (`pnpm eval:agent`, `pnpm agent:build`,
  mandatory for code changes) are skipped for docs-only changes; `docs` (`pnpm docs:check`)
  is unguarded and runs on docs-only PRs too. `docs/git-workflow.md §4`.
  `pnpm eval:agent` starts a real `eve dev` process, so it scales every wait
  budget ×4 when `CI=true`; `PADDOCK_AGENT_EVAL_SLOW=1` does the same on a
  slow local machine.
- `--no-verify` is never used. A hook that is wrong gets fixed, not
  bypassed.

## 5. Coverage expectations

No numeric target. The rule is structural: every exported pure function
has a test; every parser has adversarial tests; every SPEC rule cites a
test that would fail if it broke; every model call has a scripted-caller
test of its degradation path. `@vitest/coverage-v8` is installed for
spot checks (`pnpm exec vitest run --coverage`).
