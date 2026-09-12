# Initiative — the rebuild bid ceiling

Started 2026-08-17. Branch `feat/rebuild-ceiling`. This file is the
single source of truth for the initiative: the approved design (§1–§3),
the execution table (§4), and the log (§6). It is written so that an
agent with no memory of the session can resume from it.

## 0. Resume protocol (read this first after a context reset)

1. `git status -sb` and `git log --oneline -15` — confirm you are in the
   `feat/rebuild-ceiling` worktree (`.worktrees/feat/rebuild-ceiling`).
2. Read §4. Find the first task whose status is not `done`. Its row names
   the files it touches and how to verify it.
3. Read the last three entries of §6 for anything in flight.
4. Continue. After finishing any task: flip its status, append a log
   line, commit, move on.
5. Live model calls against the project's `ANTHROPIC_API_KEY` are NOT used
   for verification (the owner's instruction: save API credits for the
   build). Pipeline tests inject callers; real-world numbers for curated
   tables and fixtures come from the agent's own web tools or subagents.
6. Hooks are the gate (pre-commit: prettier+eslint+typecheck+docs:check;
   pre-push: tests+eval). Never `--no-verify`. The initiative ends with a
   PR to `main`, not a push to `main`.

Status legend: `todo` · `doing` · `done` · `blocked(<why>)` · `dropped(<why>)`.

## 1. Why: what the last SF90 run got wrong

Run `0bd944d0` (2026-08-15, verdict `walk`) on the 2021 SF90 Stradale
front hit:

- Hammer band $193,000–$850,000: the research worker wrote
  `"$193,000-$262,000 (bids, not sold) vs $850,000 retail value"` and the
  regex range parser swallowed the retail figure. Downstream: buyer fee
  $14k–$64k, "winning bid" line $193k–$850k, all-in $259k–$1.13M, part-out
  "130–180% of the wreck market" $251k–$1.53M, outcome range −$940k to
  +$154k.
- One front hit priced three times: triage returned `front clip`,
  `left front corner`, `right front corner` as separate heavy structural
  areas → 3 × $12k–$45k of jig work for one damage event.
- Exit $193k–$413k from a clean band of $275k–$935k (min/max across every
  finding including a special-series ask), 2× cap, then 60–75%.
- Root cause common to all three: money entered the model as freeform
  `costEstimate` strings parsed by regex, with no sold/ask distinction,
  no sample count, no date, and no notion of "typical".

## 2. Goals and non-goals

**Goals**

- G1 One verdict a bidder acts on: `BID TO $X` or `NO BID`, from a solved
  ceiling under stated discipline. A zero ceiling names its killers and
  what would have to be true to unlock a positive number.
- G2 Money enters only through structured fields (typed comps, typed
  price evidence); the exit is selected from classified comps, never
  from a min/max sweep over prose.
- G3 One damage event is priced once: triage zones group into repair
  programs with per-vehicle (tier + model override) pricing and expected
  values, narrowed by cited part prices.
- G4 A result page that answers in five seconds and can be falsified in
  five minutes: ceiling ladder, sensitivity rows, comps table, repair
  program table.
- G5 Research is "best of both": parallel structured workers, ~2–4 min
  wall clock, every dollar cited.

**Non-goals**

- No part-out / parts-car lane, no "walk because the wreck market
  outbids you" rule (the wreck market is shown as context only).
- No holding-cost bucket (too variable; stated as a watch item).
- No changes to the inspector's own research contract beyond extracting
  the shared worker loop.
- No live-run verification against the project's API key.

## 3. Design (approved 2026-08-17)

### 3.1 The money model

**Exit** `E = {low, typical, high, lane, basis}` — the rebuilt-title sale
price for this car. Rungs, best evidence first, each labeled:

1. `rebuilt_sold`: ≥2 rebuilt/branded-title sold comps for the model.
2. `clean_sold_derived`: clean sold comps × tier rebuilt-discount band.
3. `clean_ask_derived`: clean asks, haircut to sold, × discount band.
4. `acv_derived`: the listing's stated ACV × discount band.

Comp selection (`src/salvage/exit.ts`, pure): model-token match, MY±2
(prefer ±1), variant mismatch struck, asks haircut, stale comps (>18 mo)
down-weighted, MAD outlier strike, median = typical, P25 = low, P75 =
high; n<3 widens the band and says so. Struck comps stay in the report
with their reason.

**Cost lines** (`src/salvage/ceiling.ts`), each `{low, expected, high,
basis, evidence}` where evidence ∈ `schedule | curated | override |
cited | derived`:

- Copart buyer fee (bid-dependent), internet bid fee, gate + title +
  environmental, broker fee — schedule re-verified against the 2026
  published table (`fees.ts`).
- Transport (distance-dependent range).
- Repair programs (§3.2), one line each.
- Hidden-damage contingency: base 10% of expected repairs; +10 heavy
  structural; +5 hybrid HV involved; +5 photo confidence < 0.6; +5
  odometer unknown; capped 35%; tier dollar floor (module resets, ADAS
  calibration, alignment, fluids).
- Title & rebuilt inspection (state process, small range).
- Selling costs: tier channel default (exotic 3–8%, 5% expected) of the
  exit low.

**Ceiling**: the highest bid `b` with
`b + fee(b) + fixed + repairs_expected + contingency + selling + title ≤ 0.75 × E.low`,
solved numerically (fees scale with the bid), floored to $500.
**Break-even**: same at 1.0 × E.low. **Stress**: every repair line at
its high. No exit → no ceiling, and the report says why.

**Zero ceiling** → `killers` (lines ranked by dollars until the sum
exceeds the headroom) and `unlocks` (the biggest line's required cost
holding everything else; the required exit holding costs), each stated
against what the evidence says.

**Sensitivity** rows re-solve the ceiling: exit at typical; biggest line
at low; biggest line at high; every line at high; contingency waived
(yard-verified); HV line at low when hybrid.

**Wreck market** `{low, median, high, n, basis}` from `wreck` lane comps
(sold and bid_no_sale distinguished) — informational, never a verdict
input.

**Verdict**: `build` (ceiling > 0 and no dealbreaker) or `walk`.
Dealbreakers: non-repairable/COD title, fire, heavy structural on a
carbon tub, triage `parts_car`. Legacy values (`part_out`, `parts_car`,
`watch`) render only for persisted reports.

### 3.2 Repair programs, dynamic per vehicle

`src/salvage/knowledge.ts` groups triage zones into programs: `front`,
`rear`, `left`, `right`, `roof_glass`, `interior`, `wheels_suspension`,
`electrical` (HV when hybrid), `srs`, `flood`. Structural work is priced
ONCE per program at the worst zone's severity, +25% per additional heavy
zone. Paint is one program across the cosmetic zones. Every line carries
`low · expected · high`, `who` (`diy | pro`), `reason`, `evidence`.

`src/salvage/tiers.ts`: marque tier (`exotic`: Ferrari, Lamborghini,
McLaren; `premium`: Porsche, AMG/M/RS, Aston, Bentley, Maserati;
`mainstream`: the rest) → parts multipliers, structural rates by chassis
type, paint per zone, headlamp/bumper/radiator typicals, ADAS presence by
model year, HV rules, rebuilt discount band, selling channel and cost.
Model overrides for the seeded lots (SF90, 296 GTB, 458 Italia, Huracán
EVO, Artura). Unknown makes fall through to `mainstream`, labeled.

Cited price evidence for a line raises its low; a `job_quote` or
`part_new` citation for the whole line also sets its expected.

### 3.3 Research: structured evidence

`src/inspector/research.ts` exposes a parametric tool worker
(`runToolWorker`: system, report tool, validator, budget). The inspector
keeps `report_findings`; salvage workers (`src/salvage/research.ts`) use
`report_comps` and `report_prices`:

```
Comp   { lane: clean|rebuilt|wreck, outcome: sold|ask|bid_no_sale, price,
         year?, mileage?, date?, title?, variant?, damage?, url, source, note? }
Price  { line, item, kind: part_new|part_used|labor|job_quote, low, high, url, source, note? }
```

A payload item without a numeric price contributes no dollars. Workers,
all parallel: rebuilt/branded comps; clean sold (MY±1); clean asks; wreck
results; one per top-3 repair line. 3 searches, 4 turns, 240 s cap each.
eBay comps (`comps.ts`) keep the clean/damaged car lanes as `Comp`s;
component lanes are dropped.

### 3.4 Result UX (DESIGN.md first)

Verdict banner `BID TO $X` / `NO BID` + why → numbers strip
`bid ceiling · break-even (the wall) · rebuilt exit low/typical` with a
wreck-market meta line → ceiling ladder (inline SVG waterfall, break-even
marker, killers in `--danger`) → what would change the answer → comps
table (used/struck, sold/ask, title, MY, miles, date, host; wreck comps
beneath) → repair programs table (program → lines → who → low/exp/high →
evidence chip; photo anchors) → damage, what people miss, history, before
you bid. Persisted pre-initiative reports normalize at the read boundary
to a legacy view.

### 3.5 Contract

SPEC 38 amended (exit from classified comps), 39 amended (the ceiling is
solved; a zero ceiling names its killers), new 43 (one damage event is
priced once), 44 (money enters through structured fields), 45 (verdict is
bid/no-bid; wreck market is context). `docs/salvage-economics.md`
rewritten with the sourced constants. Eval suite re-graded; the five
recorded cases hand-converted to structured comps (noted per case) plus
`sf90-hammer-bleed` from run `0bd944d0`.

## 4. Execution structure

| id  | task                                                                                                              | files                                                                                         | verify                                          | status |
| --- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------ |
| T1  | Types: `Comp`, `PriceEvidence`, `RepairProgram/Line`, new `SalvageLedger`, `SalvageEvent` additions               | `src/salvage/types.ts`                                                                        | `pnpm typecheck` (expected to fail until T9)    | done   |
| T2  | Tiers + model overrides, sourced                                                                                  | `src/salvage/tiers.ts`, `tiers.test.ts`, `docs/salvage-economics.md`                          | `vitest src/salvage/tiers`                      | done   |
| T3  | Fees re-verified against the 2026 schedule                                                                        | `src/salvage/fees.ts`, `fees.test.ts`                                                         | `vitest src/salvage/fees`                       | done   |
| T4  | Programs: zone grouping, once-per-program structural, expected values, evidence narrowing                         | `src/salvage/knowledge.ts`, `knowledge.test.ts`                                               | `vitest src/salvage/knowledge`                  | done   |
| T5  | Exit selection + wreck summary from comps                                                                         | `src/salvage/exit.ts`, `exit.test.ts`                                                         | `vitest src/salvage/exit`                       | done   |
| T6  | Ceiling solver, cost lines, contingency, selling, killers, unlocks, sensitivity                                   | `src/salvage/ceiling.ts`, `ceiling.test.ts`                                                   | `vitest src/salvage/ceiling`                    | done   |
| T7  | Parametric tool worker in the inspector research module; inspector behavior unchanged                             | `src/inspector/research.ts`, `research.test.ts`                                               | `vitest src/inspector`                          | done   |
| T8  | Salvage research: topics, `report_comps`/`report_prices` tools, zod, parsers, caller                              | `src/salvage/research.ts`, `research.test.ts`; `comps.ts` → `Comp`s                           | `vitest src/salvage/research src/salvage/comps` | done   |
| T9  | Orchestrator + synthesis rewired; assess tests rewritten                                                          | `src/salvage/assess.ts`, `assess.test.ts`                                                     | `vitest src/salvage`                            | done   |
| T10 | Console projections: lane tags, evidence lines, legacy normalizer                                                 | `src/ui/run/lines.ts`, `lines.test.ts`                                                        | `vitest src/ui/run`                             | done   |
| T11 | DESIGN.md: ceiling ladder, sensitivity rows, comps table, program table, evidence chip, numbers strip amendment   | `DESIGN.md`                                                                                   | read                                            | done   |
| T12 | Report UI: banner, strip, ladder (SVG), sensitivity, comps, programs, legacy view                                 | `src/ui/run/salvage-report.tsx`, `ceiling-ladder.tsx`, `comps-table.tsx`, `program-table.tsx` | `pnpm typecheck && pnpm lint`; screenshot       | done   |
| T13 | SPEC 38/39 amended, 43–45 added; docs (economics, code-organization, llm-patterns §1, patterns §10, README index) | `SPEC.md`, `docs/*.md`, `CLAUDE.md`                                                           | `pnpm docs:check`                               | done   |
| T14 | Evals: suite re-graded, cases converted, `sf90-hammer-bleed` added; artifacts regenerated                         | `evals/salvage/**`, `evals/results.*`                                                         | `pnpm eval`                                     | done   |
| T15 | Gate, PR                                                                                                          | —                                                                                             | `gh pr create`, `gh pr checks --watch`          | doing  |

## 5. Manual human actions

None required before the PR. After merge: production deploys from `main`
(docs/deployment.md); the first live SF90 run on production is the
owner's call and spends real credits.

## 6. Log

- 2026-08-17 initiative opened; design approved in-session; worktree cut
  from `origin/main` (`8ec2a1c`); three research subagents dispatched for
  fee schedule, tier constants, and real comps/part prices.
- 2026-08-17 T1–T14 landed in one change: typed evidence, exit selection,
  ceiling solver, programs, tiers with sourced overrides (SF90, 296, 458,
  Huracán, Artura), structured comps/prices workers on the shared tool
  loop, the ledger UI (ladder, sensitivity, comps, programs), SPEC 38/39
  amended and 43–45 added, `docs/salvage-economics.md` rewritten from the
  research, eval cases converted plus `sf90-hammer-bleed`. Research
  findings worth keeping: no rebuilt-title SF90/296/458/Huracán/Artura
  sale exists anywhere public (the exotic retention band is a prior);
  Copart's buyer fee is 7.5% uncapped above $15k and non-dealer brokers
  charge 3–6%; photo-based estimates run 50–60% in supplements; a Michigan
  scrap certificate kills the VIN (the Huracán lot); Ferrari cut off parts
  to a branded-title 296 rebuild. The Huracán lot D was bid to $90k and
  $95k in consecutive weeks and rejected both times; the SF90 subject VIN
  was listed pre-loss at $494,990 in Aug 2024 and a front-hit SF90 hammered
  at $152,000 in Mar 2026.
- Live verification against the project's API key was not run (owner's
  instruction); the pipeline is tested with injected callers and graded
  offline. The first production run on the SF90 lot is the owner's call.
