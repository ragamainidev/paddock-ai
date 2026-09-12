# Initiative — persistent agent assessments

Closed 2026-09-06. Its branch `codex/eve-assessment` became the foundation of
[the bidding desk](2026-09-06-bidding-desk.md); the blockers found when that
initiative reviewed this work are tracked in its Phase 0 execution table (§5.1),
not here. Kept for the design record.

## 0. Resume protocol

Work in the `codex/eve-assessment` worktree. The owner requested a verified
worktree only: do not push, open a PR, merge, or deploy. Read
`docs/agent-assessments.md`, the appended SPEC rules, and this task table.
All implementation is original to Paddock and public Eve documentation;
no external company's application material belongs in this repository.

## 1. Goal

Maintain a revisable salvage assessment whose agent selects bounded
investigations, accepts scoped evidence, recomputes the existing deterministic
bid ceiling, and records why it stopped. Persist domain state independently
of Eve conversations. Support a fixture world and inspectable real-runtime
agent evals without provider credentials or network research.

## 2. Design

- Preserve the existing resolver, inspector, salvage money kernel, and run views.
- Add canonical assessment records with owner, source lot, revision, evidence,
  decision history, investigations, budget, and explicit fixture/live provenance.
- Expose domain operations as typed tools. The model selects available work;
  code enforces identity, applicability, budget, revision and stopping rules.
- Use Eve 0.52.2 from the public npm package in a separate agent process with
  an authenticated entrypoint. No shell, arbitrary SQL, or purchasing tools.
- Seeded lots and validated manual listing input both enter through the same
  contract. Source URLs are references, not permission for arbitrary fetching.
- Fixture runs exercise Eve with a deterministic model and local recorded
  evidence. Optional capped live-coordinator runs reuse the fixture world;
  they measure model tool selection without paying for vision/web research.
- The app presents saved assessments, evidence, decision revisions and agent
  activity. Evidence events and explicit refresh use the same continuation path.

## 3. Verification seams

Test the domain service/store through public operations, provider evidence
adapters through validated records, HTTP ownership/admission, and the actual
Eve runtime through its authored channel and tools. Use adversarial evidence,
duplicate work, stale revisions, restart persistence, budget exhaustion and
changed evidence. Fixture-runtime success is not a claim about live-model
accuracy. Paid calls are opt-in and bounded; ordinary tests need no secrets.

## 4. Tasks

| Task                                                         | Files                                                                     | Verification                            | Status |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- | --------------------------------------- | ------ |
| Evidence, decisions, persistence and investigation contracts | `src/assessments/`                                                        | 29 targeted service/store/adapter tests | done   |
| Eve runtime, tools, fixture model and runtime evals          | `agent/`, `scripts/agent-*.ts`, `evals/agent/`                            | real local runtime, no provider calls   | done   |
| App routes and assessment view                               | `src/app/assessments/`, `src/app/api/assessments/`, `src/ui/assessments/` | API tests, browser interaction          | done   |
| Integration, developer documentation and checks              | config, SPEC, docs, commands                                              | sequential complete verification        | done   |

## 5. Manual actions

None required for fixture operation. Live operation requires explicitly configured
provider credentials. No external communications or financial commitments are
part of the tool surface.

## 6. Log

- 2026-09-06: baseline at `61078c8`; 512 tests pass, 6 optional tests skipped.
  Public Eve 0.52.2 installed. Original checkout remains unchanged.
- 2026-09-06: independent review fixed stale accepted evidence, fresh price
  reversions, listing-title verification, permanent conversation-limit exhaustion,
  lost-response creation retries and misleading refresh-success notices.
- 2026-09-06: browser verification covered creation, persisted results, evidence
  refresh into a new session, lifetime budget retention, runtime outage with saved
  refresh, and a 390px mobile viewport. Fixed header overflow; no browser errors.
  Runtime tests use isolated state. No paid provider calls were made.
- 2026-09-06: final integration checks pass: 566 unit/contract tests (6 optional
  skips), 9 actual Eve HTTP cases, existing offline evals (resolver 47/47,
  inspector 28/28, salvage 113/113), Next production build and Eve production
  build. Local development processes stopped after verification. The worktree's
  ignored environment is configured for fixture mode; no PR, push or deployment.
- 2026-09-06: closed. The branch was adopted as the foundation for
  [the bidding desk](2026-09-06-bidding-desk.md) rather than merged on its own.
  That initiative's review of this work produced blockers B1–B9, tracked as
  tasks 0.1–0.10 in its §5.1 execution table; nothing further is planned here.

## 7. Decision completion and autonomy

The second slice serves an equipped US enthusiast rebuilder, with DIY labor
and specialist access. The owner selected this persona and emphasized that
these buyers commonly have more equipment than an average household. Each
assessment records the actual capabilities and financial constraints rather
than assuming every enthusiast can do structural, SRS or high-voltage work.

The architecture separates captured artifacts, source claims, review decisions,
repair hypotheses and the current buyer decision. An owner review is recorded
as an accountable judgment, never described as independent verification by AI.
Validated inspection and jurisdiction-specific eligibility can close previously
permanent gaps. Residual risk, asking-price uncertainty and cost priors stay
visible. Economic sensitivity orders the agent's work; typed domain operations
remain authoritative for money and stopping.

| Task                                                                     | Owned files                                                  | Verification                                                                         | Status |
| ------------------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------ |
| Buyer economics, evidence review, selective research and decision cohort | Assessment domain except store/adapters; compact agent board | Independent positive/negative scenarios, review abuse, affordability, stale evidence | done   |
| Representative market samples and artifact provenance                    | Salvage comps; assessment adapters/artifacts                 | Wrong vehicle, title unknown, ask/sold separation, source capture                    | done   |
| Durable dispatch, bounded recovery and selective watches                 | Assessment store, queue worker, Eve runtime                  | Real libSQL leases/conflicts/retries; actual runtime                                 | done   |
| Usable buyer/evidence/outcome controls and integration                   | App routes/UI, runtime eval, docs and commands               | HTTP authorization, browser, complete sequential checks                              | done   |

No paid model or research calls are required. A production appraisal claim
still requires separately acquired inspection reports, representative historical
transactions and actual repair outcomes. The branch provides a reproducible
evaluation and outcome-capture path without inventing that validation data.

### 7.1 Verification record

Verified on September 6, 2026 with no paid provider calls:

- 628 unit/integration tests passed; 6 optional database/catalog tests remained skipped.
- Existing offline regressions passed: resolver 47/47, inspector 28/28 and salvage 113/113.
- Independent synthetic decision cohort: 9/9, with zero unsafe positive results in this small authored cohort.
- All 11 actual Eve runtime cases passed, including runtime outage recovery, cancellation, duplicate delivery and selective refreshes. Report: `evals/agent/results.md`.
- Next production build and Eve production build passed.
- Production browser flow: the worker collected the synthetic evidence bundle, reviews closed the required gates, and a conditional bid ceiling appeared. Reducing the buyer cash limit from $200,000 to $150,000 lowered the ceiling from $124,500 to $80,000. Outcomes saved against an earlier decision.
- Desktop and 390px mobile checks found no horizontal overflow or browser errors. A Host-aware same-origin fix was verified on both localhost and 127.0.0.1; forwarded headers cannot broaden its authority.

These are engineering and synthetic decision checks. No real-model judgment,
live source availability, realized profitability or historical calibration is
claimed. The remaining empirical work is to obtain representative records,
expert labels and observed repair outcomes, then run the documented shadow cohort.
