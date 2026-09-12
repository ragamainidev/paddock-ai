# Initiative — the bidding desk

Started 2026-09-06. Foundation: branch `codex/eve-assessment` (two commits
ahead of `main` at `61078c8`), merged to `main` as `b6398da` (PR A). Work now
happens on `feat/bidding-desk-c` for PR C, in the same worktree
(`.worktrees/codex/eve-assessment`). This file is the approved design and the execution
table; it is written so an agent with no memory of the session can resume.

## 0. Resume protocol

1. `git status -sb` and `git log --oneline -15`. Confirm you are in the
   `.worktrees/codex/eve-assessment` worktree on the branch the header names.
2. Read §3 (decisions) and §5 (execution table). Find the first task whose
   status is not `done`. Its row names the files and the verification.
3. Read the last three entries of §8 for anything in flight.
4. Node 24 is required (`brew --prefix node@24`); the Vercel project is
   already on 24.x. Eve's API reference is `node_modules/eve/docs/`.
5. No live model calls for verification. Every model caller is injected;
   `PADDOCK_AGENT_MODE=fixture` is the default and stays the default in CI.
6. Hooks are the gate (pre-commit: prettier, eslint, typecheck, docs:check;
   pre-push: tests, offline eval). Never `--no-verify`. Every slice reaches
   `main` through a PR (`docs/git-workflow.md`).

Status legend: `todo` · `doing` · `done` · `blocked(<why>)` · `dropped(<why>)`.

## 1. The business problem

An insurer totals a car when the repair estimate crosses a threshold of its
value at the insurer's cost structure: retail body-shop labor, OEM parts,
rental and liability exposure, and a need for speed. Every salvage lot is a
car that the worst-case cost structure gave up on. Alpha is the gap between
that cost structure and the bidder's own.

The auction is competitive, so the obvious gap is priced in by exporters and
full-time rebuilders. What remains is bidder-specific:

| Edge        | What it is                                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------------------------------- |
| Damage read | Photos are ambiguous; platform knowledge (carbon tub, aluminum structure, HV battery, deployed SRS) moves a lot far  |
| Cost        | Internal labor rates, owned equipment, parts channel; a hobbyist's cash labor is zero but capability-capped          |
| Exit        | Retail with financing, private party, wholesale, export: each pays a different rebuilt discount and turn time        |
| Attention   | Thousands of lots a day; mislisted damage, poor photos and odd yards are where the crowd is not                      |
| Calibration | The winning bid is the most optimistic estimate in the room; the defense is knowing your own error and sizing margin |

Consequence that drives the design: **the ceiling is a property of (lot,
bidder), not of the lot.** The same wreck has three defensible ceilings.

| Ledger input       | Hobbyist                                     | Independent shop                       | Dealer                                   |
| ------------------ | -------------------------------------------- | -------------------------------------- | ---------------------------------------- |
| Auction access     | broker, 3–6% of the bid                      | business license, direct               | dealer license, Copart and IAA           |
| Labor              | own hours; no structural, no paint           | internal rate; rack, booth, scan tools | wholesale subcontract                    |
| Parts              | eBay, Car-Part, retail-ish                   | yard accounts, OEM at cost             | via shop                                 |
| Exit               | private party, steep discount, or keep it    | wholesale or retail, sometimes export  | retail with financing; turn time matters |
| Scarce resource    | cash, then weekends                          | bay-hours                              | inventory capital                        |
| Discipline         | very high; a bad buy is a garage ornament    | margin per bay-hour                    | statistical, across a portfolio          |
| The question asked | can I do this, up to what, what surprises me | which lots this week clear my margin   | what is my floor in my market            |

The first release serves the enthusiast hobbyist. The profile model covers
all three from day one because it is a typed input; the UX, the defaults,
the curated tables and the eval cases are tuned to the hobbyist.

## 2. Survey: what exists

### 2.1 `main` at `61078c8`

A deep single-lot appraiser over five seeded exotic lots: typed evidence,
cited money, a solved ceiling, dealbreakers that beat economics, 45 tested
invariants, 512 offline tests. Against the business: no user intake, one
implicit bidder persona with discipline hard-coded at 75%, no screening
funnel, no feedback loop, title and eligibility as a cost line rather than a
gate. The full audit (five dimensions) found:

| Area         | Finding                                                                                                                                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Live bugs    | `/` is statically prerendered, so its recent-runs list is frozen at build time. `ceiling-ladder.tsx:75` uses `bg-surface-raised`, which is not a token class; the bars render unfilled.                                                                                              |
| Security     | Photo URLs fetched server-side with no scheme or private-range block (SSRF oracle). Login limiter keys on client-controlled `x-forwarded-for` and never evicts. Any user can read any run.                                                                                           |
| Runtime      | Stage budgets (240 s worker + 180 s triage; 180 s vision + 150 s research + 100 s sweep) exceed `maxDuration = 300`; the manager's dead-run timeout is 600 s. Raw SDK and driver error strings reach the UI and the run record.                                                      |
| Verification | Real coverage over `src/` is 67% statements, not the reported 86%. `src/proxy.ts`, `src/runs/resolve-store.ts`, `src/runs/pg-store.ts` and every API route are at 0%. The Postgres store contract never runs in CI. Five test files race to build `data/eval.db` on a cold checkout. |
| CI           | Never runs `next build`. `lint` allows warnings that pre-commit rejects. `docs:check` is skipped on docs-only PRs.                                                                                                                                                                   |
| Structure    | ~250 duplicated lines across the two agents (VIN stage, tool-worker loop, `settle`, `usd`, `hostOf`); `salvage/` imports from the inspector's orchestrator file. `nhtsa.ts` skips failed slices silently while reporting `ok`.                                                       |
| Resolver     | Of 135 enthusiast queries outside the eval suite, 73 left tokens unparsed and 41 returned nothing (`s13`, `458`, `gt350`, `c63 amg` conflicts, `997.2` loses its facelift). 105 model words against 8,296 make/model pairs.                                                          |

### 2.2 `codex/eve-assessment`

103 files, ~11.7k lines, SPEC 46–55. A buyer profile (capabilities, labor
opportunity cost, DIY hours, holding cost, cash limit, required surplus,
jurisdiction), durable assessment records with revisions and idempotency,
typed evidence with provenance and owner review, investigations with
budgets, outcomes with forecast matching, and Vercel's eve as a thin
coordinator over three domain tools. Verified on this machine: typecheck,
lint, docs check, 628 tests, offline evals unchanged (47/47, 28/28,
113/113), decision cohort 9/9, and under Node 24 all 11 real eve runtime
cases and the eve production build.

What is right and is kept: authority stays in code (the model chooses only
from offered actions and cannot supply a verdict or ceiling; default tools
off; generic eve API closed); no buyer input can raise the ceiling above the
kernel's (`Math.min` against the kernel target); fail-closed live gating;
a real transactional outbox; honest evaluation framing.

What blocks a merge:

| #   | Blocker                                                                                                                                                                                                                                                                                                 | Where                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| B1  | Regression to `main`'s live salvage path: the whole-car price floor and top-price slice were removed, so parts listings can set the low exit; the auction guard fails open when `buyingOptions` is absent. The offline salvage eval never calls the fetcher, so the unchanged artifact is not evidence. | `src/salvage/comps.ts:19-23,72-74,106-115`                          |
| B2  | A reviewed shop quote on a DIY line raises the line to shop money while its hours are still charged as DIY labor.                                                                                                                                                                                       | `src/assessments/decision.ts:38-56,368`                             |
| B3  | The best-case bound keeps selling costs derived from the low exit while targeting the high exit; errs toward failing to stop.                                                                                                                                                                           | `src/assessments/decision.ts:386-403`                               |
| B4  | A write conflict after a successful paid investigation discards the evidence, bills the allowance and records a false reason.                                                                                                                                                                           | `src/assessments/service.ts:272-274`                                |
| B5  | The client copies a user-typed value into `source.observation`, so the review fingerprint check passes unconditionally; self-attested comps reach the ceiling unlabeled.                                                                                                                                | `src/ui/assessments/evidence-entry.tsx:132`, `validation.ts:423`    |
| B6  | No production path: eve is `eve dev` on a second port, the dispatcher is an infinite `tsx` loop, `next.config.ts` has no `withEve()`, and the run route answers "accepted, queued" without checking that anything can execute.                                                                          | `next.config.ts`, `scripts/assessment-worker.ts`, `handlers.ts:128` |
| B7  | Null ceiling renders as "Bid ceiling $0" in the accent color; buyer economics carry no basis; the explaining waterfall is collapsed at the bottom of an 825-line component; two pollers run every 1.5 s and 3 s forever.                                                                                | `src/ui/assessments/view.tsx:153,263-275,768,49-70`                 |
| B8  | `docs/database.md`, `deployment.md`, `operations.md`, `frontend.md`, `code-organization.md` not updated; `PRODUCT.md` is a sixth root document referenced by nothing; SPEC 46–55 cite no test names.                                                                                                    | docs                                                                |
| B9  | CI moves every check to Node 24 and adds a live eve process as a required PR gate; the buyer profile has no fee mode and no exit channel.                                                                                                                                                               | `.github/workflows/ci.yml`, `src/assessments/types.ts`              |

### 2.3 Eve, in one paragraph

Vercel's beta agent framework (`eve` 0.52.2, Node ≥ 24): a model-in-the-loop
harness on durable sessions (Workflow SDK; Vercel Workflow when deployed on
Vercel), with `withEve()` from `eve/next` to co-host an agent in a Next.js
project. `withEve()` rewrites only `/eve/v1/:path+` to the eve service;
custom channel routes at other paths are not reachable through Next. Eve
schedules become Vercel Cron Jobs (minute granularity on Pro; daily on
Hobby). The framework health route is public. Custom `AuthFn` entries on the
eve channel replace OIDC. The branch's fixture policy already follows the
domain's own action order, so the model's marginal decision is which offered
investigation to run next and why it stopped; the value eve adds is durable
per-epoch sessions, an event stream, human-in-the-loop parking, and a place
for a conversational layer later.

## 3. Decisions (approved 2026-09-06)

| #   | Decision                                                                                  | Consequence                                                                                           |
| --- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| D1  | No licensed lot feed. Users bring lots.                                                   | No screening funnel in this initiative; a lot-source seam only.                                       |
| D2  | The enthusiast hobbyist is the wedge.                                                     | Profile spans three segments; UX, defaults, tables and evals tune to the hobbyist.                    |
| D3  | Intake is VIN + photos + pasted listing text. No fetch of auction pages.                  | vPIC decodes identity; a model parses pasted text into typed fields shown as assumption chips.        |
| D4  | Approach B: the bidder-relative ledger is its own layer over the vehicle-relative kernel. | Two ceilings on the report: the marginal professional's and yours. The difference is the edge.        |
| D5  | Adopt `codex/eve-assessment` as the foundation; fix B1–B9 before merge.                   | Phase 0 below. The domain layer, store, queue, routes and eve tools are kept.                         |
| D6  | Eve runs in the same Vercel project through `withEve()`.                                  | Ingress moves to the framework channel; the worker loop becomes inline dispatch plus an eve schedule. |

## 4. Design

### 4.1 The two ceilings

`priceLot` stays vehicle-relative: what the work costs in the market, with
the kernel's fees, contingency and discipline. The bidder layer
(`src/assessments/decision.ts`, extended) transforms that plan:

- **Capability gates.** A line whose `who` is `diy` becomes `pro` at the
  bidder's rate when the profile lacks the equipment the line needs
  (`structural` → frame rack, `paint` → booth, `alignment` → shop,
  `hv` → isolation tooling). Structural work on carbon or aluminum stays
  `pro` for everyone (SPEC 35).
- **Labor.** DIY hours are shown as weekends and priced at the profile's
  stated opportunity cost; they are not cash and are excluded from the
  cash constraint.
- **Access.** `access: 'broker' | 'direct'` selects the fee mode: broker
  percentage and flat fee for hobbyists; zero broker fee and the licensed
  buyer schedule for shops and dealers.
- **Exit channel.** `exit: 'private_party' | 'wholesale' | 'retail' | 'keep'`
  selects the selling-cost band and the rebuilt-title discount band. `keep`
  values the car at the private-party typical and states that no sale is
  planned.
- **Title process.** Jurisdiction selects the rebuilt-inspection cost range
  and the eligibility gate that already exists.
- **Discipline.** A profile field with a sourced default per preset; the
  kernel's 75% stays the market persona's value until calibration data
  exists.

The report headline shows the market persona's ceiling (the professional
rebuilder described in `docs/salvage-economics.md §8`) beside yours. When
yours is below the market's, the lot is a walk with the reason "no edge on
this lot": you would be the optimist in the room. Every buyer-side line
carries a basis exactly as kernel lines do.

### 4.2 Intake

The salvage route's input union already accepts `seedLotId` or a full `lot`.
The intake form collects VIN, lot number, yard state, sale date, listed
damage, odometer, title brand as listed, current bid or ACV if shown, and
photos. Photos are `https:` addresses only, resolved hosts outside private
ranges, redirects re-validated; uploads are deferred to row 2.6, so nothing
rides the request as base64 today. A pasted listing block is parsed twice: a
deterministic pass for VIN, lot number, odometer and damage codes, then an
injected model caller for the remainder, validated with zod, every filled
field an assumption chip the user can correct. `SalvageLot.source` becomes
`'user-supplied listing'` with `url` optional; provenance shows on the report.

### 4.3 Hosting

`withEve(nextConfig, { eveRoot: './agent' })`. The eve channel
(`agent/channels/eve.ts`) gains a bridge `AuthFn` that accepts only the
server token and the owner attributes the Next route supplies, returning a
`SessionAuthContext` that the tools already scope on. The custom channel's
`run` logic (epoch continuation, receipt reconciliation) moves to Next-side
code that calls `/eve/v1/session` through `eve/client`. The framework health
route replaces the custom `/health`; capability is computed in Next from
environment. The proxy matcher excludes `/eve/v1/`. Dispatch is inline from
the run route; retries and watches run from `agent/schedules/dispatch.ts`
(cron `* * * * *` on Pro). The worker script stays as `--once` diagnostics.
The assessments database is a dedicated Turso database, never the vehicle
DB. The run route answers `accepted: false` with a reason whenever the eve
service is unreachable or misconfigured.

### 4.4 Calibration

Outcomes already record hammer, won or passed, repair actuals and sale
proceeds against the decision revision available at observation time. The
calibration view reports, with denominators: purchases above the recorded
ceiling, repair-range coverage, repair residuals, and exit residuals.
Fixtures never count. A documented procedure in `docs/salvage-economics.md`
says how a tier constant may be revised from calibration evidence and what
`n` is required before it may.

### 4.5 Proposed SPEC rules (appended, numbered 56+)

56. The ceiling is bidder-relative and both ceilings are shown; a bidder
    ceiling below the market persona's is a walk with the reason stated.
57. User-supplied lots and user-entered numbers carry user provenance; a
    self-attested number is labeled wherever it is used and never satisfies
    a gate alone.
58. The hosted agent runs in the deployment; a run is never reported as
    queued when nothing can execute it.
59. Every buyer-side ledger line carries a basis, and no buyer input can
    raise the ceiling above the kernel's.

## 5. Execution table

Sizes: S under a day, M one to three days, L a week. Verification is what a
reviewer runs, not a promise.

### 5.1 Phase 0 — land the foundation safely

| Task | What                                                                                                                                                                                                                                                                                                                                                                                                  | Files                                                                                                                                                                                                             | Verify                                                                                                                                  | Size | Status |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ |
| 0.1  | B1: restore a whole-vehicle signal (price floor per tier or a positive whole-car predicate), make the buying-options guard fail closed, type `buyingOptions` on `ItemSummary`, add a recorded eBay fixture so the salvage eval exercises the fetcher                                                                                                                                                  | `src/salvage/comps.ts`, `src/enrich/ebay.ts`, `src/salvage/comps.test.ts`, `evals/salvage/`                                                                                                                       | new eval check `comps-whole-car`; `comps.test.ts` absent-field case; `pnpm eval` re-committed                                           | M    | done   |
| 0.2  | B2–B4: quotes apply only to `pro` lines (a quote on a DIY line converts the line to `pro` and removes its hours); best case re-derives fixed lines at the high exit as `ceiling.ts` scenarios do; the completion save leaves the failure `catch` and retries a merge; `maxAllIn` excludes sale-time selling costs                                                                                     | `src/assessments/decision.ts`, `service.ts`, `decision.test.ts`, `service.test.ts`, `evals/agent/decision-cases.ts`                                                                                               | new cohort cases: `quote-on-diy-line`, `best-case-high-exit`, `conflict-after-paid-result`                                              | M    | done   |
| 0.3  | B5: the server ignores client `observation` for `capturedBy: 'user'`; user-entered comps and prices are `unverified` with a `self-attested` label; a review may accept them but the decision states how many self-attested numbers it rests on and they never satisfy the market gate alone (proposed rule 57)                                                                                        | `src/assessments/validation.ts`, `service.ts`, `decision.ts`, `src/ui/assessments/evidence-entry.tsx`, `view.tsx`                                                                                                 | `service.test.ts` rejects fabricated observations; `decision.test.ts` gate case; UI label present                                       | M    | done   |
| 0.4  | B6: `withEve()`; bridge `AuthFn` on the eve channel; Next-side session start through `eve/client` with epoch continuation and receipt reconciliation; framework health; proxy matcher excludes `/eve/v1/`; `agent/schedules/dispatch.ts`; inline dispatch from the run route; `accepted: false` when unreachable (proposed rule 58); worker kept as `--once`                                          | `next.config.ts`, `src/proxy.ts`, `agent/channels/*`, `agent/schedules/`, `src/assessment-http/*`, `src/assessment-queue/worker.ts`, `scripts/assessment-worker.ts`                                               | preview deployment: `/eve/v1/health` 200, fixture assessment runs end to end, cron visible in Settings; `pnpm eval:agent` under Node 24 | L    | done   |
| 0.5  | B7: null ceiling renders an en dash and its reason in `--danger`; buyer economics reuse the cost table and numbers strip with a basis per line; the baseline ladder moves beside the headline; polling stops on terminal status and backs off, or tails the run stream; `view.tsx` splits along its eleven sections; buttons follow the DESIGN action-button spec; synthetic fixtures labeled as such | `src/ui/assessments/*`, `DESIGN.md`                                                                                                                                                                               | `lines.ts`-style projection tests for the new pure formatters; visual check on 390 px and desktop                                       | M    | done   |
| 0.6  | B8: `docs/database.md` (third database, tables), `deployment.md` (services, env matrix), `operations.md` (runbooks: eve unreachable, cron missed), `frontend.md` (workspace pattern), `code-organization.md` (new folders); fold `PRODUCT.md` into `README.md` and `docs/`; SPEC 46–55 cite test names                                                                                                | docs, `SPEC.md`, `README.md`                                                                                                                                                                                      | `pnpm docs:check`; `check-docs.ts` extended to verify quoted test names exist                                                           | S    | done   |
| 0.7  | B9: CI runs `pnpm build`; `lint` uses `--max-warnings 0`; `docs:check` is its own unguarded job; `eval:agent` is a separate job, non-required until eve leaves beta; Node 24 everywhere (project already 24.x); `@types/node@24`; `.nvmrc`                                                                                                                                                            | `.github/workflows/ci.yml`, `package.json`, `.nvmrc`                                                                                                                                                              | green CI on the PR                                                                                                                      | S    | done   |
| 0.8  | `main` audit fixes: `/` reads run data per request; `bg-raised`; photo URL SSRF guard; login limiter keyed on `x-vercel-forwarded-for` with window sweep; stage budgets and dead-run timeout under `maxDuration`; fixed user-facing failure reasons with raw errors logged server-side only; `nhtsa.ts` reports skipped slices                                                                        | `src/app/page.tsx`, `src/ui/run/ceiling-ladder.tsx`, `src/inspector/photos.ts`, `src/app/api/inspect/route.ts`, `src/auth/rate-limit.ts`, `src/runs/manager.ts`, `src/salvage/research.ts`, `src/enrich/nhtsa.ts` | tests per fix; `pnpm build` output shows `/` dynamic                                                                                    | M    | done   |
| 0.9  | Verification debt: tests for `src/proxy.ts`, `resolve-store.ts`, every API route, the two report normalizers; coverage config over `src/**`; eval DB built once in `globalSetup`; Postgres service in CI or SPEC 30/31 corrected                                                                                                                                                                      | `vitest.config.ts`, `src/**/*.test.ts`, `.github/workflows/ci.yml`, `SPEC.md`                                                                                                                                     | coverage report over `src/` committed to the PR description; no skipped store contract in CI                                            | M    | done   |
| 0.10 | Structure: `src/agent/` shared module (worker loop, `settle`, VIN stage, `hostOf`, `usd`); `deriveRepairPlan` split on its dividers; dead `topicTag` branches removed                                                                                                                                                                                                                                 | `src/inspector/*`, `src/salvage/*`, `src/lib/*`                                                                                                                                                                   | tests unchanged and green; `salvage/` no longer imports `inspector/inspector.ts`                                                        | M    | done   |

PR slicing: PR A = 0.1–0.7 (the codex branch made mergeable). PR B = 0.8–0.9.
PR C = 0.10. Each PR re-runs `pnpm eval` and commits its artifact.

### 5.2 Phase 1 — the hobbyist's ceiling

| Task | What                                                                                                                                                                                                                                                                                                                                                                                                               | Files                                                                                                                                                 | Verify                                                                                   | Size | Status                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---- | ------------------------- |
| 1.1  | Profile fields: `access`, `exit`, `discipline`, equipment capabilities `structural`, `paint`, `alignment`, `hv`; presets `hobbyist`, `shop`, `dealer` as explicit assumption chips; sourced defaults in `docs/salvage-economics.md` §10                                                                                                                                                                            | `src/assessments/types.ts`, `buyer-profile.ts`, `validation.ts`, `docs/salvage-economics.md`                                                          | `validation` tests; docs cite sources                                                    | M    | done — `9216245..cee1ecf` |
| 1.2  | Bidder layer, executed as two slices: 1.2a exposes the kernel knobs the layer needs (fee mode, `pro` and `requires` per repair line, exit channels, title process by state) without wiring them; 1.2b applies them in `buyerLedger` — capability gates flip lines, every buyer line states its basis (SPEC 59), and the kernel stays vehicle-relative                                                              | `src/salvage/fees.ts`, `exit-channels.ts`, `title-process.ts`, `src/assessments/buyer-ledger.ts`, `decision.ts`                                       | `buyer-ledger.test.ts`: same lot, three presets, three ceilings; no line without a basis | L    | done — `cee1ecf..9f61107` |
| 1.3  | Two ceilings headline and the "no edge" walk reason (SPEC 60); edge shown as a difference with its largest contributors                                                                                                                                                                                                                                                                                            | `src/assessments/buyer-profile.ts`, `decision.ts`, `src/ui/assessments/format.ts`, `decision-headline.tsx`, `DESIGN.md`                               | projection tests; cohort cases `no-edge-walk` and `edge-positive-build`                  | M    | done — `9f61107..a203c02` |
| 1.4  | Cohort cases `broker-vs-direct`, `private-party-vs-retail`, `keep-not-sell`, `no-edge-walk`, `edge-positive-build` and `state-title-process` (the booth conversion stays a unit test: no curated DIY line requires equipment); the results table gains access, exit and both ceilings; one runtime case prices the recorded lot as a stated shop through the real eve process; both artifacts committed and stable | `evals/agent/decision-cohort.ts`, `scripts/decision-eval.ts`, `scripts/agent-eval.ts`, `scripts/check-eval-artifacts.ts`, `docs/testing-and-evals.md` | `pnpm eval:decisions` and `pnpm eval:agent` green; `pnpm eval:check` clean on a re-run   | S    | done — `a203c02..1afc352` |

### 5.3 Phase 2 — intake

| Task | What                                                                                                                                                                                        | Files                                                                                            | Verify                                                           | Size | Status                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ---- | ------------------------- |
| 2.1  | Intake form with VIN decode and a pasted listing block; deterministic pass then injected model parse with zod and chips (uploads moved to 2.6)                                              | `src/ui/assessments/intake.tsx`, `src/assessments/intake.ts`, `src/app/api/assessments/route.ts` | `intake.test.ts` on recorded listing blocks; no network in tests | L    | done — `af5246d..2d01918` |
| 2.2  | `SalvageLot` user provenance; triage caller accepts uploads; report shows provenance                                                                                                        | `src/salvage/types.ts`, `triage.ts`, `src/ui/run/salvage-report.tsx`                             | `seed-lots.test.ts` unchanged; new lot-builder tests             | M    | done — `2d01918..0dc7f1b` |
| 2.3  | Seeded lots become labeled examples; showroom links to intake                                                                                                                               | `src/app/page.tsx`, `src/ui/assessments/workspace.tsx`                                           | visual check                                                     | S    | done — `2d01918..0dc7f1b` |
| 2.4  | Make the whole-vehicle floor a function of tier and model year, or a fraction of the lot's own ACV, before user lots ship (`docs/salvage-economics.md` §10 discloses the premium-tier bias) | `src/salvage/comps.ts`, `docs/salvage-economics.md`                                              | `comps.test.ts` cases for a 2003 330i and a 2006 IS              | M    | done — `6bd8368..d45a4c3` |
| 2.5  | Surface comps dropped for a missing `buyingOptions` field as a count in the progress note (SPEC 10–11 spirit)                                                                               | `src/salvage/comps.ts`                                                                           | `comps.test.ts`                                                  | S    | done — `6bd8368..d45a4c3` |
| 2.6  | Client-side downscaled photo uploads stored in the assessments database with a total cap, on the inspect photo schema (SPEC 29); intake stores addresses only until then                    | `src/assessments/intake.ts`, `src/assessments/store.ts`, `src/ui/assessments/intake.tsx`         | upload size cap and round-trip tests; no bytes in the run record | M    | todo                      |

### 5.4 Phase 3 — calibration

| Task | What                                                                                                     | Files                                                                | Verify                             | Size | Status                    |
| ---- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------- | ---- | ------------------------- |
| 3.1  | Outcome prompt after the sale date from the dispatch schedule; hammer, won or passed, later actuals      | `agent/schedules/dispatch.ts`, `src/ui/assessments/*`                | queue tests; fixture runtime case  | M    | done — `e37f9d5..e4c13e0` |
| 3.2  | Calibration view with denominators; revision procedure for tier constants in `docs/salvage-economics.md` | `src/assessment-reporting/outcomes.ts`, `src/ui/assessments/*`, docs | `outcomes.test.ts`; docs procedure | M    | done — `8ea7789..dedabeb` |

### 5.5 Not in this initiative

- A screening funnel over a lot feed (D1). The lot-source seam is the only
  provision.
- The conversational bidding desk on eve (follow-up questions, channels).
  The coordinator landing in Phase 0 makes it a small later initiative.
- Resolver knowledge reach (database-derived model lexicon, dotted Porsche
  generations, missing chassis and trim codes). Separate initiative; the
  probe results are in §2.1.
- Part-out lanes, bidding or purchasing, scraping of auction or broker
  pages, dealer and shop UX beyond presets.

### 5.6 Accepted risks

Found while pinning behavior in Task 0.9. Both are current behavior; neither
is scheduled here.

- **The login limiter counts attempts, not failures** (SPEC 42,
  `src/auth/rate-limit.ts`). Ten failures against a known username, from any
  addresses, spend that username's window: the eleventh attempt answers 429
  before the credentials are checked, so the owner of the correct password is
  locked out for the remainder of the fifteen minutes. Accepted for a
  two-user deployment, where the lockout is cheap and the brute-force brake
  is the point. Follow-up if the user count grows: count a per-address
  attempt only after a failed credential check, or give the per-user key a
  cap distinct from the per-address lockout.
- **Attaching a stream to a run this process does not hold reconciles it**
  (`src/app/api/runs/[id]/stream/route.ts` → `getRun` →
  `reconcileInterrupted`). On a single-instance deployment a stored
  `running` run is marked `error` the moment a client attaches, and the
  stream closes rather than tailing the store. This is SPEC 30 as written —
  multi-instance deployments wait out `STALE_RUNNING_MS` first — and the
  visible effect is local: after a `pnpm dev` restart, reattaching to a run
  ends it. No action.

## 6. Cost and safety posture

Fixture mode is the default everywhere, including production until the owner
flips it. Live mode requires three explicit settings and live evidence a
fourth. Model coordination is bounded per session (12 calls, 512 output
tokens, 30 s, $0.25) and investigations per assessment (allowance in cents,
count-capped); refresh preserves lifetime spend. The agent has no default
tools, cannot bid, purchase, message or fetch arbitrary URLs, and cannot
supply a verdict or ceiling.

## 7. Manual actions

| Action                                                                                                                 | Owner | Status                                                                       |
| ---------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------- |
| Create Turso database `paddock-assessments`; set `ASSESSMENTS_DATABASE_URL` and `ASSESSMENTS_AUTH_TOKEN` on Vercel     | owner | todo                                                                         |
| Generate and set `PADDOCK_AGENT_TOKEN`; set `PADDOCK_AGENT_MODE=fixture` in production until live is approved          | owner | todo                                                                         |
| Confirm the Vercel plan tier; cron cadence for the dispatch schedule depends on it (minute on Pro, daily on Hobby)     | owner | done — Hobby (deploy of #6 failed on `* * * * *`; default cron is now daily) |
| Confirm Vercel Workflow is available to the team (eve uses it on deploy; the Agent Runs tab needs enablement)          | owner | todo                                                                         |
| `.vercel/project.json` still names `ymm-resolver`; re-run `vercel link` to `paddock`                                   | owner | todo                                                                         |
| Remove merged worktrees `feat/rebuild-ceiling` and `fix/evidence-hygiene` (`pnpm wt rm`)                               | agent | todo                                                                         |
| Visual check of the two-ceiling headline at 390 px and desktop on production                                           | owner | todo                                                                         |
| Visual check of the calibration disclosure on the saved-decisions list at 390 px and desktop                           | owner | local production build with synthetic data passed; production check todo     |
| Vercel Pro, if minute-granularity dispatch is wanted (`PADDOCK_DISPATCH_CRON`); the daily fire serves the outcome loop | owner | optional                                                                     |
| `pnpm dev`, paste a Copart or IAA listing block into `Bring your own lot`, parse, correct a chip, create and run it    | owner | todo                                                                         |

## 8. Log

- 2026-09-06 Audits of `main` (dependencies and CI, architecture, tests and
  evals, docs and SPEC, security and runtime) and a 135-query resolver probe
  completed; findings in §2.1.
- 2026-09-06 Decisions D1–D4 approved in session.
- 2026-09-06 `codex/eve-assessment` reviewed (domain, bridge and operations,
  UI) and reproduced: 628 tests, offline evals, decision cohort, 11 eve
  runtime cases under Node 24, both production builds. Blockers B1–B9.
- 2026-09-06 Decisions D5–D6 approved. This document written for approval.
- 2026-09-06 Task 0.1 (B1) `4b43816..18316c9`: the whole-vehicle price floor
  screens the ask lanes, `buyingOptions` is typed and fails closed, and a
  recorded eBay fixture puts the fetcher under the salvage eval.
- 2026-09-06 Task 0.2 (B2–B4) `18316c9..090fc76`: quotes apply to professional
  lines and a reviewed quote converts a DIY line, the best case re-derives at
  the high exit, a completion that loses a revision race is re-applied, and
  cash affordability excludes sale-time selling costs.
- 2026-09-06 Task 0.3 (B5) `090fc76..fc88d79`: the server owns evidence
  provenance, an owner-typed number reads `self-attested`, and self-attested
  comparables cannot carry the market gate alone. Landed as SPEC 56, not the
  57 §4.5 proposed.
- 2026-09-06 Task 0.4 (B6) was executed as two slices rather than one.
  0.4a `fc88d79..19b2d6d`: `withEve()` co-hosts the agent, the bridge `AuthFn`
  reads the `x-paddock-*` scope on the framework channel, `src/proxy.ts`
  excludes `/eve/v1/`, and Next starts sessions through
  `src/assessment-http/agent.ts`. 0.4b `19b2d6d..a7bdfc9`: the run route
  dispatches inline and reports `accepted` with a reason,
  `agent/schedules/dispatch.ts` replaces the daemon, and the worker script is
  demoted to a `--once` diagnostic. Landed as SPEC 57, not the 58 §4.5
  proposed.
- 2026-09-06 Task 0.5 (B7) `a7bdfc9..74f988d`: the decision surface states an
  honest headline with a basis per figure, `view.tsx` splits one file per
  section, and polling is bounded by a pure schedule that stops.
- 2026-09-07 Task 0.6 (B8) `74f988d..96ec4d4`: the third database, the two
  deployed services and their settings, the eve/cron/database runbooks, the
  workspace data-flow pattern and the assessment folders are documented;
  `PRODUCT.md` folded into `README.md` and `docs/agent-assessments.md` §13 and
  deleted; SPEC 46–55 cite tests by name; `scripts/check-docs.ts` gained four
  checks (quoted test titles, `.env.example` coverage, DESIGN.md headings,
  routing-table paths) and `agent/` as a checked root. Review round 1 narrowed
  three claims to what the code does and re-anchored the title marker.
- 2026-09-07 Task 0.7 (B9) `1ac0c65..1b2d761` plus this review-fix commit:
  `checks` ends with `pnpm build`, `pnpm lint` is `--max-warnings 0`
  repo-wide, `docs:check` moved to its own unguarded `docs` job that runs on
  docs-only PRs, and `eval:agent` + `agent:build` moved to `agent-runtime`
  with `continue-on-error` until eve leaves beta. Node 24 is pinned in
  `.nvmrc`, `@types/node@24` and every job. Making `docs` a required check on
  the ruleset stays an owner action.
- 2026-09-06 PR A merged to main as b6398da (#6); PR B branch feat/bidding-desk-b.
- 2026-09-08 Hotfix `fix/hobby-cron`: the production deploy of `main` (b6398da,
  PR #6) failed at Vercel's `patchBuild` step with `cron_jobs_limits_reached`
  because `agent/schedules/dispatch.ts` declared `* * * * *` on a Hobby project.
  The expression is now read at build time and defaults to `0 6 * * *`;
  `PADDOCK_DISPATCH_CRON` restores minute granularity on Pro. The plan tier is
  confirmed Hobby (§7).
- 2026-09-06 Task 0.8 (PR B, first half) `b6398da..HEAD`: `/` renders per
  request, the token contract has a test, the photo probe screens scheme,
  address and every redirect hop, the login limiter keys on the platform
  address and bounds its maps, stage budgets fit under `maxDuration`, a
  caught error's message stops reaching the reader, and NHTSA counts the
  year/model slices it lost. SPEC 11, 18, 24, 29 and 42 gained the pinning
  tests; `docs/operations.md` gained §7 known limitations and §8 stage
  budgets.
- 2026-09-06 Task 0.9 (PR B, second half) `5b67910..HEAD`: coverage reports
  every file under `src/` rather than the imported ones, and the gate, the
  persistence ladder, all nine API routes, both report normalizers and
  `stageLabel` have tests of their own. The eval database is built once in a
  vitest `globalSetup` (a cold checkout used to race five workers into
  SQLITE_BUSY), CI runs a `postgres:16` service so the run-store contract's
  third arm runs and the skip announces itself where it can be read, and the
  eval writers go through prettier so a run on a clean tree no longer dirties
  the artifacts — `pnpm eval:check` states that property and CI enforces it.
  SPEC 15, 17, 20, 30 and 31 gained the citations; statements over `src/`
  69.97% → 72.84%, branches 60.53% → 62.64%.
- 2026-09-08 PR B whole-branch review, final fix wave `6f4e76d..HEAD`: a
  stage bound is its timeout times its attempts, so vision and triage stop
  allowing an SDK retry and spend part of the reclaimed headroom (90 s →
  100 s and 120 s); the budget test multiplies by the attempts and reads
  every agent caller's source. `assessmentErrorResponse` answers by class
  rather than by a `code` field, so a driver's message can no longer reach
  the client. The Postgres store contract closes its pool, the photo probe
  refuses 100.64/10 and 198.18/15, a resolve failure states each distinct
  reason once, and both research parsers use `statedFailure`. Tasks 0.8 and
  0.9 stay `done`; `docs/operations.md` §7 gained the shared limiter bucket
  and the probe's second lookup, §8 the attempt arithmetic.
- 2026-09-09 Task 0.10 (PR C) `a59dd8b..HEAD`: `src/agent/` holds what both
  agents run — `runToolWorker`, `eventChannel`, `settle`, `runVinStage` — and
  `src/lib/{money,url}.ts` the two formatters the UI shares, so
  `src/salvage/*` no longer imports `src/inspector/inspector.ts` and the VIN
  sweep stops carrying its own copy of the worker loop. `knowledge.ts` (948)
  splits into `programs.ts` (94), `repair-lines.ts` (273), `repair-plan.ts`
  (447, `deriveRepairPlan`'s phases named), `evidence.ts` (145) and
  `topics.ts` (100) behind a 17-line facade; `inspector.ts` 717 → 581,
  `assess.ts` 689 → 663, `inspector/research.ts` 711 → 478,
  `salvage/research.ts` 461 → 448. Dead `topicTag` lanes,
  `evidenceTopicsForConsole`, `hasReliabilityData`, `EBAY_CATEGORY_PARTS` and
  the vestigial `RepairPlan` re-export are gone. `parseVinSightings`,
  `needsCitationNudge` and `parseTriageOutput` now have the tests
  `docs/llm-patterns.md §2.4` claimed: 865 → 883 assertions, none changed.
  One live-console difference: the VIN sweep's progress notes carry the
  shared `[vin]` lane tag and the loop's lifecycle notes.
- 2026-09-09 PR C whole-branch review, final fix wave `c2bc74e..HEAD`:
  `runToolWorker` returns `{ result }` or
  `{ stopped: 'out-of-time' | 'never-reported' }` instead of an
  undifferentiated `null`, so `defaultVinSweepCaller` stops re-deriving the
  reason from the clock — four completed turns with no tool call, ending
  inside the loop's early-exit window, used to resolve `{ sightings: [] }`
  and claim a VIN had no public history. The findings and evidence workers
  drop the topic on either stop, unchanged; `EARLY_EXIT_MS` is module-private
  again. Both consumers of
  `runVinStage` assert the decode rather than casting `as VinCheck`.
  `docs/patterns.md §5.5` carries the return contract, `docs/llm-patterns.md`
  §6 the budget half of it, and `docs/code-organization.md` §5 now names
  `src/assessments/decision.ts` (≈755) alongside `tokenize.ts` over the
  ~700-line line. 882 → 883 assertions.
- 2026-09-09 Task 1.1 `9216245..cee1ecf`: the buyer profile states who is
  bidding — auction access (a broker seat or a direct licensed account), the
  exit channel, the discipline share and four equipment capabilities — and the
  `hobbyist`, `shop` and `dealer` presets supply those inputs as explicit
  assumptions, with `presetFor` naming the preset a profile's values describe.
  `normalizeBuyerProfile` fills what a record saved before these fields
  existed does not state, so no migration was needed, and chips are decided
  per field against `nearestPreset`, because one replaced number does not make
  the other eighteen the buyer's own. No money logic moved — nothing priced
  the new fields yet — so `pnpm eval:decisions` stayed byte-identical.
  883 → 896 assertions.
- 2026-09-09 Task 1.2 `cee1ecf..9f61107`, executed as two slices rather than
  one. 1.2a (`0dc8001`) exposed the knobs the bidder layer needs while the
  kernel still knew nothing about who is bidding: fees take an access mode,
  every repair line carries what the same task costs bought (`pro`) and the
  equipment it cannot be done without (`requires`), `EXIT_CHANNELS` prices
  each way of leaving the car, and `titleProcessFor` replaces the national
  band with twelve states' published fees and says so for the rest. 1.2b
  (`0dc8001..9f61107`) applied them in `buyerLedger`: a DIY line whose rack,
  booth or tooling the buyer does not own is bought at the tier's shop rate
  with its hours leaving the labor line, professional work is never handed
  back (SPEC 35), labor and holding became lines of their own, and every line
  the layer adds or changes states its basis and reads `derived` (SPEC 59).
  Two of the claims 1.2a's prose makes were only true after `ded5d68`, which
  landed inside 1.2b: `wheels_suspension.corner` had claimed an alignment rack
  belonging to the geometry line priced after it, and Ohio's rebuilt-title fee
  and the exotic tier's title basis cited sources that do not carry them.
  SPEC 58 was amended in the same slice, because its original wording — no
  buyer input raises the ceiling above the kernel's — is false once a fee mode
  and an exit channel exist: a direct licensed account pays neither broker
  charge and a car that is never sold pays nothing to sell, so both
  legitimately clear more than the kernel's broker/private-party number. The
  rule now binds the target (the least of the buyer's discipline, the low exit
  minus their required surplus, and the kernel's own target) and states that
  access, exit and jurisdiction select which kernel lines apply rather than
  loosening it. 896 → 932 assertions.
- 2026-09-09 Task 1.3 `9f61107..a203c02`: `MARKET_PERSONA` states the bidder
  the room's price is set by — the shop preset's equipment and rates, a direct
  account, a retail exit, the kernel's discipline and no cash arm, because the
  room is made by capitalized shops rather than by a budget — and
  `buyerLedger` solves it over the same plan, the same exit evidence and the
  same solver, returning `market` and `edge` beside the buyer's own numbers.
  `marketMaxBid` became `kernelMaxBid`, which is what it always was. A ready
  decision whose ceiling is below the persona's is a walk whose first reason
  names both numbers (SPEC 60); an equal ceiling is not, and a dealbreaker
  still answers before any of this money does (SPEC 45). The headline strip
  gained `your ceiling`, `what a pro can pay` and `edge` as pure projections
  in `format.ts`. The cohort gained `no-edge-walk` and `edge-positive-build`,
  and the shared cohort cash limit moved $200,000 → $400,000: the persona has
  no cash arm, so a limit that binds below the room's price is itself a reason
  a bidder cannot reach it, and a case about equipment or evidence must be
  decided by equipment or evidence rather than by a cash bind. Every verdict
  held except `private-party-vs-retail`, which now walks by construction — a
  broker seat selling retail is the persona minus the broker cut.
  932 → 943 assertions.
- 2026-09-09 Task 1.4 `a203c02..1afc352` and the docs commit `9520d8a`
  carrying this entry: Phase 1's cases and artifacts. The cohort gained
  `state-title-process`, which reads California's published title band on the
  buyer's ledger and the untouched national band on the kernel's (SPEC 59).
  `no-booth-converts-paint` was dropped rather than written: no curated DIY
  line on these lots requires equipment — paint is priced professional for
  every buyer — so the gate stays pinned by the fixture-line unit test in
  `buyer-ledger.test.ts`, and
  `docs/testing-and-evals.md` §3.5 now lists every cohort case and the one
  thing it pins. `decision-results.md` gained access, exit and both ceilings,
  so the artifact shows the bidder-relative numbers a verdict rests on. The
  runtime suite gained `shop-preset-carries-market-and-edge`: the recorded lot
  for a stated shop through the real eve process, whose saved decision carries
  the market ceiling ($144,500) and the edge (−$50,500 against the shop's
  cash-bound $94,000), so both ceilings are proven to survive persistence and
  not only the domain call. `evals/agent/results.md` dropped the per-run
  session id — it stays in the gitignored JSON — which makes the committed
  artifact reproducible, so `eval:check` now reads it too and CI checks it
  after `eval:agent`. Four carry-overs from the 1.3 review: the market persona
  is priced through the buyer's own jurisdiction, so a state's title process
  moves both ceilings and can never make or unmake an edge (no cohort number
  moved — California's $163 gap sits inside the $500 bid step); a strip cell
  for a ceiling of zero states a short basis instead of repeating the long
  no-edge sentence `reasons` already carries; the cohort fixture copies a
  preset's capabilities rather than aliasing them; and the ready-path decision
  test says what it exercises, a cash-bound ceiling below the room's price.
  The review round added the sign to the runtime case — the shop seat is
  $94,000 against the room's $144,500, so a persona that ever collapsed onto
  the buyer would fail there rather than pass quietly — and corrected the
  cohort's own documentation: two of its cases track the product presets on
  purpose, and a preset edit is meant to move them. 943 → 945 assertions.
- 2026-09-10 PR D whole-branch review, final fix wave `9520d8a..HEAD`: a
  decision saved before the ceiling became bidder-relative reads back current.
  `service.getAssessment` projects such a record again — at the record's own
  time, appending no history and writing no row — beside the expiry
  re-projection it already ran, and `marketCell`, `edgeCell` and the two ledger
  disclosures state an absent market ceiling or absent lines rather than
  reading through them, so a pre-branch record renders every section instead of
  taking the workspace down with it. The preset selector stops reading `Custom`
  after a typed state: `divergedFromPreset` leaves `jurisdiction` out of the
  divergence, as `presetFor` and `nearestPreset` already leave it out of
  theirs, so the radio agrees with the preset a save would name. `buyerLedger`
  records which of the four arms produced the ceiling (`discipline.bound`), and
  a cash-bound decision says the cash limit set it instead of crediting the
  low-exit margin the limit left intact beneath it. Three statements were
  narrowed to what the code does: `report.ledger` is the kernel's own number
  and not the persona's (`docs/patterns.md` §10.3), the priced persona
  registers where the buyer does while the constant keeps `US-unspecified`
  (`docs/salvage-economics.md` §8), and the SPEC 58 ready-path test is scoped
  to one fee mode and exit channel. SPEC 50 states that the equipment gate
  binds only on a plan with DIY lines needing equipment — none curated, so it
  is pinned on a fixture line — and §11 that owned equipment never lowers a
  line the kernel already priced professional. The runtime case pins the
  persisted market ceiling at $144,500 and its edge assertion states the
  expectation it checks rather than a conclusion. Phase 1's commit ranges in
  §5.2 and in this log are rewritten to their post-rebase shas, and 1.2a's
  prose now says which of its claims `ded5d68` corrected inside 1.2b.
  945 → 949 assertions.
- 2026-09-09 Tasks 2.4 and 2.5 `6bd8368..d45a4c3` (post-rebase shas;
  documentation in `7545835` and `af5246d`): the whole-vehicle floor is
  `wholeVehicleFloor(tier, year, now)` rather than a flat $10,000 — an exotic
  keeps $10,000 at any age, a premium lot carries $10,000 through twelve model
  years, $4,000 from thirteen to twenty and none past that, and a mainstream
  lot still carries none — so a 2003 330i or a 2006 IS listed at $6,500 stays
  in its own market instead of being screened out as parts money. That is a
  precondition for Task 2.1: the flat floor was safe only while every lot came
  from a showroom of late-model exotics. The age is read off the collection
  date the fetcher already takes, never the wall clock, so a replay screens
  the way the live run did, and each band names itself in the opening progress
  note. The closing note now counts the two screens that drop items —
  `3 dropped: 2 no fixed price, 1 under the whole-vehicle floor` — so a Browse
  schema change that stopped populating `buyingOptions` reads as a lost fetch
  rather than an empty market (SPEC 10–11). The salvage suite restates the
  bands instead of importing them, grades them against `COLLECTED_ON`, and
  gained `expect.progressIncludes`, which pins those counts on
  `sf90-ebay-screening`; that lot is exotic, so its floor and every one of its
  money figures are unchanged and the artifact moved by the one new check.
  SPEC 53 was amended in place, and `docs/salvage-economics.md` §10 carries
  the bands, their disclosure as planning assumptions and the drop counts.
  Review round 1 (`d45a4c3`) corrected §10's claim that a listing struck for
  the wrong model, year or variant is in neither count — the floor screen runs
  before the applicability test, so a sub-floor listing for the wrong car does
  raise the floor count, and the paragraph now states the order the screens
  run rather than reordering them. In the suite, `comps-whole-car` is emitted
  only where the band sets a floor (a $0 band graded `price >= 0`, which the
  fetcher already guarantees) and `comps-progress` moved outside the `ebayRaw`
  block, so a case expecting notes the fetcher never ran to emit fails instead
  of passing silently. 949 → 955 assertions.
- 2026-09-11 Task 2.1 done (`af5246d..2d01918`; the branch was rebased onto
  `main`, so the range is the one this log can be read against). Intake is the
  one path to a lot of your own: the workspace's manual listing form is
  replaced, not joined. `src/assessments/intake.ts` reads a pasted block in
  four passes — regexes, then an injected model caller for what they left
  absent, then vPIC for identity nobody stated, then the photo screen — and
  every value is a chip the buyer corrects before the assessment exists (SPEC
  61). A decode that contradicts the listing and a photo address the probe
  refuses each block creation with a fixed reason. `SalvageLot.url` is now
  optional and every reader states its absence; `lotProvenanceUrl` cites the
  first photo where an observation needs an address.
  `POST /api/assessments/intake/preview` runs the reading alone. The three
  intake dependencies are injected through the service factory, so
  `service.test.ts`, the HTTP tests and `pnpm eval:agent` run the whole path
  offline; the runtime suite gained `user-supplied-lot-intake`, which also
  pins that a user lot inherits no seeded evidence. 992 offline tests, 15
  runtime cases. Uploads are deferred to row 2.6.
- 2026-09-11 Tasks 2.2 and 2.3 done (`2d01918..0dc7f1b`; documentation in
  `cf57db0` and `7ade5c8`). A lot the buyer brought reads as one wherever it
  is read. `lotProvenance` in `src/ui/assessments/format.ts` is the single
  projection: a source host and its link for a lot with a page, and otherwise
  the source with the day it was collected, so no surface offers a link a user
  lot cannot honor. `LotProvenanceLine` renders it on the assessment header
  and the `/salvage` lot detail; the decision gained the residual risk that
  the listing was typed rather than captured; `agent/lib/board.ts` states
  `vehicle.source`, so the coordinator cannot read a typed listing as a
  captured page. The chips saved with such a lot are read back under the lot
  header without their correcting inputs. The five catalog lots are labeled
  `recorded example` on `/salvage`, the showroom and the workspace, and the
  showroom's featured lot offers `assess a lot like this`, which opens intake
  with that VIN and nothing else (`/assessments?vin=…`, read through
  `prefilledVin`). `intake.buyerPreset` is gone: it was unreachable over HTTP,
  where the create schema defaults the buyer and the form always sends one.
  1011 offline tests, 15 runtime cases. Review round 1 (`0dc7f1b`) took the
  last surface that still formatted provenance itself: the run report's footer
  branched on `lot.url` and printed `lot.collectedOn` raw, which for a brought
  lot is an ISO timestamp, so `lotProvenance` now returns `text`, `href`,
  `day` and `example` separately and every surface composes its own sentence
  around them. `isRecordedLot` moved to `src/salvage/seed-lot-ids.ts`, ids
  alone, because the predicate reaches client bundles and the catalog's notes
  and photo addresses have no reason to travel with it.
- 2026-09-11 Follow-ups from the intake reading, neither scheduled: a Copart
  block states `FERRARI` and `SF90 STRADALE` in caps and the lot carries them
  as written, so titles and research topics read as shouting — title-casing
  them needs a known-make table, because `BMW`, `GT-R` and `SF90` are not
  title case. And `TITLE_BRAND` accepts `Title:`, `Title Type:`,
  `Title Code:`, `Title Status:` and `Title History:` alike, so a block
  carrying two of them is read from whichever appears first rather than from
  the one that states the brand; which label outranks which is a question
  about Copart's own wording, not about the parser.
- 2026-09-11 PR E whole-branch review, final fix wave `7a46422..HEAD`
  (`823d29a` salvage, `5820e1a` intake, `1ad7f63` the header line, and this
  documentation commit): a field no pass filled can now be stated by the
  buyer. `runIntake` and `intakeEdits`
  already applied an edit for any `INTAKE_FIELDS` member, but the chip list
  showed only what something had read, so `primaryDamage`, `titleBrand` and
  `location` on a thin block were correctable by nobody; `unreadFields` closes
  the reading with a `not stated on your listing` group carrying the same
  input, and a value typed there is a `user` chip on the next read.
  `Create assessment` no longer precedes the reading it is meant to follow:
  `intakeFingerprint` records the text, the VIN and the photo addresses a
  reading was made from and `createGateNote` opens creation only on a reading
  that exists, can become a lot and has not gone stale since — which matters
  because nothing corrects a reading after it is saved, so the form is the
  last place it can be argued with. In comps, `dayStart` slices its input to
  ten characters, so a caller handing the fetcher a full ISO timestamp loses a
  time rather than the whole year to an invalid clock and a premium lot's band
  with it; the fail-closed NaN band it was masking now has the test that
  claimed it. The closing note counts a third screen,
  `outside this lot's market`, so the drop counts and the eligible pool close
  against what Browse returned — everything but the word-list strikes, the
  malformed summaries and a repeat of a listing already held, each named in
  `docs/salvage-economics.md` §10. The lot provenance line sits under the VIN
  where DESIGN.md puts it, above the record's own revision line rather than
  below it. DESIGN.md gained the absent-field group and the creation rule;
  `docs/agent-assessments.md` §14 gained what a `Parse listing` click spends
  and the photo minimum intake holds until row 2.6. SPEC 53 gained the
  fail-closed band and the screen order, SPEC 61 the rule that every field is
  correctable and that creation follows a reading of the listing as it stands.
  No money figure moved: the eval artifacts differ by their date and sha
  header alone. 1012 → 1019 offline tests.
- 2026-09-11 Follow-up, not scheduled: `POST /api/assessments/intake/preview`
  spends one Haiku call for every `Parse listing` click, outside any
  assessment's budget because no assessment exists yet to charge it to, and
  authentication is the only limit on it today. A per-owner ceiling belongs on
  that route before the deployment carries more than a couple of users
  (`docs/agent-assessments.md` §14).
- 2026-09-11 Task 3.1, code `e37f9d5..e4c13e0` (docs `ac177c4` and `9212002`):
  the desk asks what happened. The dispatch
  schedule gained a third phase — `promptOutcomes` in the queue worker — which
  selects lots whose sale date has passed on a decision that reached a ceiling or
  a walk and carries no outcome, and records an `outcome_prompt` event in the
  assessment's own activity log, once a week per assessment
  (`assessment_outcome_prompts`). No notification leaves the deployment and no
  model is called. The workspace states the open question under the headline and
  tags the saved-decisions row `outcome due` from one grouped read. Outcomes gained
  `hammer` and the kind `lost_to_hammer`, so the price a lot made is recorded even
  when the owner did not buy. Landed as SPEC 62. Runtime case
  `outcome-prompt-after-the-sale`.
- 2026-09-11 Task 3.1 review round 1 `cf94ab7..e4c13e0`: a stated sale day is
  over only once that whole day has closed — `Date.parse('2026-09-06')` is that
  day's midnight, so the 06:00 fire had been announcing the sale on the morning
  of the sale — and the headline banner and the list tag now read one
  server-computed fact instead of the banner scanning an event window. The
  activity log carries the index for its scoped last-ask read; the
  collection-wide read scans, as clarified in the 3.2 review below.
- 2026-09-11 Follow-up, not scheduled here: a relisted lot. An outcome closes
  the asking forever, so a lot that did not sell, was relisted and sold later is
  never asked about again. Re-opening on a new sale date after an outcome is a
  product rule (which outcomes are final, what a re-listing does to the earlier
  decision) and belongs with the calibration view in 3.2 or its own row.
- 2026-09-11 Task 3.2 `8ea7789..dedabeb`: the desk states how its own forecasts
  have done. `summarizeOutcomes` reports six statistics beside the three it
  carried — purchases above the recorded ceiling, the hammer against your
  ceiling and against the market persona's, repair-range coverage, the repair
  residual and the exit residual — each over the denominator it was read on and
  each counting one observation per assessment: the latest matched outcome that
  states the figure, so a lot reported three times is one data point rather than
  three. Below five observations a statistic prints
  `too few outcomes to read (3 of 5)` and no number, because a median of three
  lots is not a reading, and a residual is a median and an interquartile range
  rather than a mean, which one repair that ran away moves on its own. A matched
  outcome whose forecast never held the figure to compare against — a decision
  saved before the ceiling became bidder-relative carries no market ceiling — is
  that statistic's own exclusion, counted there and never in the global
  unmatched count, which stays for an outcome no forecast answers at all. The
  workspace's one-line summary became a collapsed disclosure over pure
  projections in `src/ui/assessments/calibration-format.ts`, so no arithmetic
  happens in JSX and every cell has a test. The rule for acting on any of it is
  `docs/salvage-economics.md` §14: twenty distinct lots in the relevant
  statistic for the tier whose constant would move, a residual whose sign holds
  across that same sample's interquartile
  range, and the outcome ids written into the constant's own basis string.
  Nothing retrains, and the view segments by nothing, so that per-tier count is
  a manual read until it does. Landed as SPEC 63. Two carry-overs from the 3.1
  review came with it: the activity index serves the scoped last-ask read and
  not the collection-wide one or `listActivity`, and SPEC 62's own clause now
  states the two days `saleIsOver` waits rather than the one it read as. The
  collection endpoint has its own contract test: the list carries the statistics
  the workspace renders, a recorded demonstration is excluded rather than
  counted, and a purchase recorded against a decision that solved no ceiling is
  that statistic's exclusion instead of a hit. 1039 → 1052 offline tests.
- 2026-09-11 Phase 3 closed, and with it this initiative. What shipped: the
  bidder-relative ceiling and the market persona beside it (Phase 1), intake for
  a lot you brought (Phase 2), and the outcome loop with the calibration view
  that reads it (Phase 3). What remains is named rather than left implied. Three
  are initiatives of their own, scoped in §5.5: resolver knowledge reach, whose
  probe results are in §2.1; the conversational bidding desk on eve, which the
  coordinator landing in Phase 0 makes small; and the screening funnel over a
  lot feed, for which the lot-source seam is the only provision made here. One
  row of this initiative is unshipped — 2.6, client-side downscaled photo
  uploads; intake holds photo addresses until it lands. Seven smaller follow-ups
  are recorded above rather than scheduled: a per-owner ceiling on
  `POST /api/assessments/intake/preview`, which spends a model call per click
  outside any assessment's budget; re-asking about a relisted lot, since an
  outcome closes the asking forever; title-casing a make and model a listing
  shouts, which needs a known-make table because `BMW`, `GT-R` and `SF90` are
  not title case; which of Copart's title labels, including `Title History:`,
  outranks which when a block carries two; whether the reference bidder should
  remain the best-resourced shop represented by the shipped persona or instead
  represent the marginal winner whose bid sets the lot's price; the
  saved-decisions rows, which carry the evidence mode but not
  the lot's own provenance, so a lot you brought reads there like a recorded
  example; and an outbound link for a pasted listing's URL, which is kept as
  provenance and offered by no surface — a DESIGN.md line before any of it.
  The open owner actions in §7 remain outstanding; closing the implementation
  does not complete deployment setup or the recorded visual checks.
- 2026-09-12 PR F core review fixes, `7b0676d..5185aea`: exit residuals now compare
  actual net proceeds with the compared revision's typical exit minus its
  expected selling line; a missing line excludes that lot from this statistic
  alone. The revision procedure counts twenty distinct lots in the relevant
  statistic for the tier and takes both quartiles from that same sample, never
  from the disclosure summary's outcome-record count. Schedule events store
  `no-model`, legacy schedule rows read the same way, and the activity view
  states that no model ran even on a live-coordinator deployment. Direct drain
  tests pin the idle and failure paths and the twenty-tick bound. The final
  copy corrections distinguish decision and ledger ceilings, use lot-based
  denominators, name R-7 quantiles, and correct the reference-bidder question.
  Independent scoped re-review found no remaining
  actionable issue. The full gate passed: 1052 → 1069 tests across 102 files
  (six Postgres contract cases skipped locally, covered by CI), resolver
  47/47, inspector 28/28, salvage 131/131, the independent decision cohort,
  sixteen actual Eve fixture-runtime cases, stable artifacts, and both builds.
- 2026-09-12 PR F mobile layout: a visual check found labels colliding with long
  quartile values at 390 px. Calibration rows now stack their label and value
  below `sm`, retaining the two-column layout above it. This additional change
  follows the core review-fix range above and is documented in DESIGN.md.
  Confirmation on the rebuilt local production app passed at 390 px and desktop
  for populated and empty samples, with no overlap or horizontal overflow;
  disclosure toggling, counts, net values and fixture labels also passed.
- 2026-09-12 Follow-ups retained from the PR F review: segment calibration by
  tier so the documented sample and quartiles can be read without manual
  selection; replace the global 500-candidate prompt window with bounded
  pagination or another fair selection. Older assessments beyond that window
  can remain unasked because prompting does not update their sort timestamp.
  Legacy outcome summary fields remain for compatibility. These do not change
  the relisted-lot rule or the open owner actions in §7.
