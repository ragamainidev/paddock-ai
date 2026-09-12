# llm-patterns

How paddock calls models: the one shape every call takes, how prompts are
managed, how changes are evaluated, how failures degrade, and how
confidence is expressed. Model IDs and the reasons behind each choice are
in `README.md` ("Model choices"); this file is the engineering contract.

## 1. Where models are used

| Call                  | File                               | Model                            | Output tool                     | Validation                                                                   |
| --------------------- | ---------------------------------- | -------------------------------- | ------------------------------- | ---------------------------------------------------------------------------- |
| Interpret fallback    | `src/interpret/model.ts`           | `claude-sonnet-5`                | `map_tokens`                    | zod `OutputSchema`; deterministic-wins merge                                 |
| Complaint themes      | `src/enrich/themes.ts`             | `claude-haiku-4-5-20251001`      | `report_themes`                 | zod; themes for unknown components dropped                                   |
| Photo vision          | `src/inspector/vision.ts`          | `claude-sonnet-5`                | `report_inspection` (strict)    | `dropUnknownTypes` → zod; anchors clamped                                    |
| Web research workers  | `src/inspector/research.ts`        | `claude-sonnet-5` + `web_search` | `report_findings` (strict)      | zod; uncited findings discarded (SPEC 22)                                    |
| VIN provenance sweep  | `src/inspector/research.ts`        | `claude-sonnet-5` + `web_search` | `report_vin_sightings`          | zod; subject listing excluded                                                |
| Damage triage         | `src/salvage/triage.ts`            | `claude-sonnet-5`                | `report_damage_triage` (strict) | zod; anchors clamped                                                         |
| Salvage comps workers | `src/salvage/research.ts`          | `claude-sonnet-5` + `web_search` | `report_comps` (strict)         | zod per item; price must be a number, url http(s); lane stamped (SPEC 44)    |
| Salvage price workers | `src/salvage/research.ts`          | `claude-sonnet-5` + `web_search` | `report_prices` (strict)        | zod per item; low/high numbers, url http(s); line stamped (SPEC 44)          |
| Generation compile    | `scripts/compile-generations.ts`   | `claude-sonnet-5` + `web_search` | forced tool                     | rows validated against DB; citations mandatory (SPEC 37)                     |
| Listing intake        | `src/assessments/intake-caller.ts` | `claude-haiku-4-5-20251001`      | `report_listing_fields`         | zod; a filled field is never overwritten, an uncited quote dropped (SPEC 61) |

Everything else — resolve, rank, ledger math, plans, comps, verdict rules —
is deterministic on purpose.

## 2. Structured output against a defined schema

### 2.1 The one shape

Every model call is a **forced tool call** whose input _is_ the output:

```ts
tools: [TOOL],
tool_choice: { type: 'tool', name: TOOL_NAME, disable_parallel_tool_use: true },
```

The caller returns `toolUse.input` as `unknown`. No free-text parsing, no
JSON-in-prose, no regex over completions. When the model returns no
`tool_use` block the caller throws, and the stage degrades (§5).

### 2.2 Two schemas, one file, never drifting

Each call keeps its JSON tool schema and its zod schema in the same file,
next to each other (`REPORT_INSPECTION_TOOL` and the zod parser in
`vision.ts`; `MAP_TOKENS_TOOL` and `PatchSchema` in `model.ts`). Enums are
declared once as `as const` arrays and spread into both
(`ISSUE_TYPES`, `MOD_TYPES`, `KINDS`).

### 2.3 Strict where the API supports it

Tools whose taxonomy must not drift set `strict: true` and
`additionalProperties: false` (vision, triage, research). Constrained
decoding guarantees the wire shape; zod remains the second line of
defense because business rules (anchor ranges, citation presence,
component membership) are not expressible in JSON schema.

### 2.4 Parse functions are pure and take `unknown`

`parseVisionOutput`, `parseWebFindings`, `parseVinSightings`,
`parseTriageOutput`, `needsCitationNudge`, `isEmptyReport` — all pure, all
unit-tested with malformed, adversarial, and empty inputs (`vision.test.ts`,
`inspector/research.test.ts`, `salvage/triage.test.ts`). The orchestrator
never touches raw model output.

### 2.5 Post-parse business validation

- Photo anchors outside the photo set are dropped; a finding that loses
  every anchor keeps none (SPEC 21).
- Findings without an http(s) source are discarded (SPEC 22).
- Themes for components not in the supplied groups are discarded (SPEC 13).
- Model patches never overwrite a deterministic field (SPEC 5).
- Generation windows using a year the rows do not contain are rejected
  (SPEC 37).

## 3. Prompt management

### 3.1 Prompts live with their tool, as constants

`SYSTEM_PROMPT` / `RESEARCH_SYSTEM` / `WORKER_DISCIPLINE` are
`const` strings in the module that owns the tool. There is no prompt
registry, no templating library, and no prompt in a database. Version
control is the prompt history; a prompt change is a normal diff reviewed
with the schema and tests beside it.

### 3.2 Prompt structure

- System prompt: role in one sentence, then a `Rules:` list. Rules encode
  the invariants in the model's terms ("Never invent vehicles", "CITATIONS
  ARE MANDATORY", "Return the component names verbatim").
- User turn: labeled data blocks (`Full query:`, `Leftover tokens:`,
  `Deterministic readings so far:`), JSON-serialized so the model sees exact
  strings. Photos are `Photo N:` text labels interleaved with image blocks
  (`photoContentBlocks`).
- The tool description restates the deliverable ("Call exactly once, after
  searching").

### 3.3 Changing a prompt

1. Change the constant.
2. Add or adjust a fixture in the module's tests if the output shape
   changes; the scripted-caller tests must still pass.
3. Run `pnpm eval` (offline suites) — the inspector/salvage suites grade
   behavior over recorded model outputs, so schema-affecting changes show up.
4. If the change is meant to alter live behavior, run the relevant live
   path once (`pnpm eval:live` for interpret; a seeded inspection or lot for
   the agents) and note the observed change in the commit message.

### 3.4 Model IDs

Declared once per file as `const *_MODEL`. Changing a model is a one-line
change plus a README table row update. `temperature` is not set (the
current model generation deprecates `0`).

## 4. Experimentation

### 4.1 Offline suites are the gate

`pnpm eval` runs three deterministic suites with no network and no model:
resolver (query cases → tokenize → SQL → rank), inspector (orchestrator
over recorded fixtures graded per check), salvage (recorded triage plus
typed evidence replayed through the ceiling pipeline). Results are committed (`evals/results.{md,json}`,
`evals/history.jsonl` keeps one line per run) and rendered at `/evals`.
Pre-push runs it. SPEC 15, 20.

### 4.2 Live experiments are explicit and never gate

`pnpm eval:live` adds the model fallback to the resolver suite; needs
`ANTHROPIC_API_KEY`. `scripts/replay-money.ts` replays recorded research
findings through the current money model — change the model, replay,
diff the ledger. `POST /api/debug-run` (only with `PADDOCK_DEBUG=1`)
emits a synthetic run for UI work at zero cost.

### 4.3 Fixtures are recorded reality

`evals/inspector/fixtures.ts` and `src/enrich/fixtures/*.json` are captured
outputs (vision reports, web findings, NHTSA responses) including
adversarial variants (`VISION_BAD_ANCHORS`, `WEB_MIXED_CITATIONS`,
`VPIC_MISMATCH`). Add an adversarial fixture whenever a new validation rule
lands.

### 4.4 What to measure

Grade per check, not per run: `invariant` (a SPEC rule), `behavior` (this
input → this verdict/plan/flag), `honesty` (refuse or degrade visibly
instead of inventing), `realism`. A change that improves behavior while
breaking an invariant is a regression.

## 5. Fallback and degradation

| Failure                        | Behavior                                                                                               | Where                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| No `ANTHROPIC_API_KEY`         | Interpret stays deterministic; themes show raw counts; inspect/salvage POST return 503 before starting | `search.ts`, `themes.ts`, `api/inspect/route.ts` |
| Network / SDK error            | Stage `ok: false` with the error message as `detail`; other stages unaffected                          | every caller                                     |
| No `tool_use` block            | Caller throws → same as network error                                                                  | every default caller                             |
| Schema mismatch                | zod `safeParse` fails → deterministic result + "model output failed validation"                        | `model.ts`, `themes.ts`                          |
| Off-taxonomy entries           | Dropped individually before strict parse                                                               | `dropUnknownTypes`                               |
| Empty report after real search | One push-back turn in the same conversation, then accept empty                                         | `isEmptyReport`                                  |
| Uncited findings               | One citation-repair turn, then discard the uncited                                                     | `needsCitationNudge`                             |
| Worker over budget             | Stream aborted at `WORKER_BUDGET_MS`; progress line says so; other topics unaffected                   | `agent/worker.ts`                                |
| Vision failure                 | Fatal for the inspection (nothing to inspect); stated as such                                          | SPEC 24                                          |

Rule: a model failure never 500s and never leaks an SDK error string to the
UI unmodified through a page; it becomes a stage `detail`.

## 6. Timeouts, retries, budgets

- SDK clients: `new Anthropic({ timeout, maxRetries })` per call site —
  60 s/1 for themes and interpret (both degrade to a deterministic result,
  and neither runs inside an agent's serial chain), 100 s/0 for vision
  (`VISION_TIMEOUT_MS`), 120 s/0 for triage (`TRIAGE_TIMEOUT_MS`), 90 s/0
  for research workers and the VIN sweep (they own their retry loop; SDK
  retries would eat the wall-clock budget), 30 s/0 for listing intake (one
  call, one forced tool, on the create request rather than a run's serial
  chain).
- `timeout` bounds one **attempt**, not one call: a caller that allows
  retries costs `timeout × (maxRetries + 1)`. Vision and triage are bounded
  by that timeout alone, so each exports the attempts it allows
  (`VISION_ATTEMPTS`, `TRIAGE_ATTEMPTS`) and passes `maxRetries: ATTEMPTS - 1`;
  the budget test multiplies by them and reads every agent caller's source
  to hold the retry setting at zero. Worker loops abort their own stream at
  a wall-clock deadline, so their budget bounds them whatever the SDK does.
- Agent loops carry a hard deadline that aborts the stream
  (`WORKER_BUDGET_MS` = 120 s inspector, 150 s salvage; `SWEEP_BUDGET_MS`
  = 60 s) because a request timeout does not bound a stream that keeps
  trickling. A run that ends without a report says whether the budget ran
  out or the worker never called its tool (`docs/patterns.md §5.5`); a
  caller that re-derives that from the clock reads a silent worker as an
  honest empty answer.
- Every one of those is sized so the serial chain fits under the route's
  `maxDuration`; the arithmetic and its test are `docs/operations.md §8`.
- Per-worker limits: `WORKER_MAX_SEARCHES = 2`, `WORKER_MAX_TURNS = 3`,
  `WORKER_MAX_TOKENS = 3000` sized so the findings JSON fits in one turn.
- Cost control: one worker per topic, `MAX_TOPICS = 5`; photos are probed
  for reachability before vision spends money on them; the interpret
  fallback only runs when the tokenizer left tokens unparsed.

## 7. Confidence and verdicts

- No bare percentages in the interface. Confidence is an audited ledger of
  named factors with signed deltas (`confidenceLedger` in
  `src/salvage/assess.ts`): photo triage baseline, cited anchors,
  federal decode match, VIN history found, minus unknown odometer and few
  photos. The UI shows the factors.
- Verdicts are rules over evidence, not model opinions: dealbreakers beat
  economics (SPEC 36); identity mismatch forces `avoid` (SPEC 33); a
  non-repairable title forces `walk`.
- The model's own severity/quality enums are inputs to those rules, never
  the verdict.

## 8. Adding a new model call — checklist

1. Define `<Name>Caller` type and `default<Name>Caller` with a lazy SDK
   import, `timeout`, `maxRetries`.
2. Tool schema + zod schema side by side; enums as `as const` arrays;
   `strict: true` when the taxonomy matters.
3. `parse<Name>Output(raw: unknown)` pure, with tests for malformed, empty,
   adversarial input.
4. Wire into the orchestrator with `begin` → work → `stage` status; spans
   via the tracer.
5. Guard on `ANTHROPIC_API_KEY` when the default caller is in use.
6. Add a SPEC rule for the invariant the validation defends; add a fixture
   and a suite check in `evals/`.
7. Add the row to §1 and the README model table.
