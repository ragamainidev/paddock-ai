@AGENTS.md

# paddock — agent notes

Enthusiast query → real vehicles + live listings + known failures.
Invariants are numbered in SPEC.md; each cites its test. If code and SPEC.md
disagree, the code is wrong. The visual contract is DESIGN.md — if it isn't
specified there, add it there first, then use it. The knowledge base is
`docs/` (index: `docs/README.md`) — how and why, one numbered file per area.

## Knowledge base rule

Any recurring function, permanent or critical architectural pattern,
component, or operational detail is documented in `docs/<area>.md` in the
same change that introduces it; behavior a test can pin gets a SPEC rule.
Procedure: `docs/workflows/spec-update.md`. `pnpm docs:check` (pre-commit,
CI) fails on SPEC citations that point nowhere, a quoted test title its
cited file does not contain, repeated rule numbers, unnumbered docs
headings, a docs file missing from the index, a routing-table directory
that does not exist, or a literal `process.env.X` read whose name is absent
from `.env.example` (a variable read off an injected `env` parameter is not
seen; its own module's tests cover it). Multi-session efforts get
`docs/initiatives/YYYY-MM-DD-<slug>.md` with a resume protocol; read the
current one first after a context reset.

## Routing table

| To change…                                               | Touch                                                                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| What a code/shorthand means (`e46`, `2jz`, `gt3`)        | `src/knowledge/` (validated against DB by `knowledge.test.ts`)                                                                       |
| How queries parse (negations, years, forks)              | `src/interpret/tokenize.ts`                                                                                                          |
| Model fallback for unparsed tokens                       | `src/interpret/model.ts`                                                                                                             |
| Constraint → SQL                                         | `src/resolve/sql.ts`                                                                                                                 |
| Ranking / match reasons                                  | `src/resolve/rank.ts`                                                                                                                |
| NHTSA fetch + name mapping                               | `src/enrich/nhtsa.ts`                                                                                                                |
| Complaint theme naming (Haiku)                           | `src/enrich/themes.ts`                                                                                                               |
| eBay listings query                                      | `src/enrich/ebay.ts`                                                                                                                 |
| Search orchestration / enrichment isolation              | `src/pipeline/`                                                                                                                      |
| Pages, streaming, URL state                              | `src/app/`, `src/ui/results.tsx`                                                                                                     |
| Pure UI formatting (year ranges, chips, stage notes)     | `src/ui/format.ts`                                                                                                                   |
| Design tokens / type scale                               | `DESIGN.md` first, then `src/app/globals.css`                                                                                        |
| Eval cases                                               | `evals/queries.jsonl` (expectations AND together)                                                                                    |
| Catalog install / user ingest / public sample            | `scripts/`                                                                                                                           |
| Inspection agent (vision, research, verdict)             | `src/inspector/` (SPEC 21–29; deps injected; shared runtime `src/agent/`)                                                            |
| Seeded real listings + sold comps                        | `src/inspector/seed-listings.ts` (integrity-tested data)                                                                             |
| Salvage assessor (triage, programs, exit, ceiling)       | `src/salvage/` (SPEC 34–36, 38–39, 43–45; deps injected)                                                                             |
| Durable assessments / evidence / decisions               | `src/assessments/`, `docs/agent-assessments.md` (SPEC 46–49, 56)                                                                     |
| Outcome loop: prompt cadence, outcome kinds              | `src/assessments/outcome-prompt.ts`, `src/assessment-queue/worker.ts` ← `docs/agent-assessments.md §12`                              |
| Calibration: outcome statistics and denominators         | `src/assessment-reporting/`, `src/ui/assessments/calibration-format.ts` ← `docs/salvage-economics.md` §14                            |
| Eve tools, authority, coordinator / runtime evals        | `agent/`, `evals/agent/`, `scripts/agent-eval.ts`; installed `node_modules/eve/docs/`                                                |
| Assessment workspace / HTTP bridge                       | `src/ui/assessments/`, `src/assessment-http/`, `src/app/api/assessments/`                                                            |
| Intake: pasted listing, VIN, photo links (SPEC 61)       | `src/assessments/intake.ts` (`intake-caller.ts` holds the prompt), `src/ui/assessments/intake.tsx` ← `docs/agent-assessments.md §14` |
| Salvage money constants (tiers, fees, discipline)        | `src/salvage/tiers.ts`, `fees.ts`, `ceiling.ts` ← `docs/salvage-economics.md`                                                        |
| Exit channel bands / title process by state              | `src/salvage/exit-channels.ts`, `title-process.ts` ← `docs/salvage-economics.md` §12–13                                              |
| Bidder-relative ledger (fees, exit, title, discipline)   | `src/assessments/buyer-ledger.ts` (SPEC 58–59) ← `docs/salvage-economics.md` §11–13                                                  |
| Salvage research workers (comps, prices, tools)          | `src/salvage/research.ts` (shared loop: `runToolWorker` in `src/agent/worker.ts`)                                                    |
| Salvage report UI (ladder, sensitivity, comps, programs) | `DESIGN.md` first, then `src/ui/run/salvage-report.tsx` + `ceiling-ladder.tsx`                                                       |
| Worker loop, event channel, `settle`, VIN stage          | `src/agent/` (both agents; `docs/patterns.md §5.5`)                                                                                  |
| Money and source-host formatting (`usd`, `hostOf`)       | `src/lib/money.ts`, `src/lib/url.ts`                                                                                                 |
| Run persistence / refresh-safety / live tail             | `src/runs/` (manager + stores; SPEC 30–31)                                                                                           |
| Trace spans + waterfall                                  | `src/trace/tracer.ts`, `src/ui/run/trace.tsx` (SPEC 32)                                                                              |
| Postgres schema / migrations                             | `db/migrations/` via node-pg-migrate (`pnpm db:migrate`)                                                                             |
| Run page UI (console v2, stage rail, choreography)       | `src/ui/run/` (`lines.ts` is the pure projection — test it)                                                                          |
| Inspector eval suite (fixtures, graded checks)           | `evals/inspector/`                                                                                                                   |
| Generation catalog (gen N / facelift / family words)     | `src/knowledge/generation-catalog.ts` → `data/public-generations.json` (SPEC 37; family identities, generation gaps)                 |
| Auth: sessions, credentials, enforcement modes           | `src/auth/` (pure, tested), `src/proxy.ts` (thin), `docs/auth.md`                                                                    |
| Login page / auth routes                                 | `src/app/login/`, `src/app/api/auth/`                                                                                                |
| How models are called (schemas, prompts, fallback)       | `docs/llm-patterns.md`                                                                                                               |
| Architectural patterns / anti-patterns                   | `docs/patterns.md`, `docs/frontend.md`                                                                                               |
| Where a new file goes                                    | `docs/code-organization.md`                                                                                                          |
| Databases, migrations, functions/triggers policy         | `docs/database.md`                                                                                                                   |
| Logging and redaction                                    | `docs/logging.md`                                                                                                                    |
| Test layers, evals, adding cases                         | `docs/testing-and-evals.md`                                                                                                          |
| Deploying, env matrix, runbooks                          | `docs/deployment.md`, `docs/operations.md`                                                                                           |
| Branches, hooks, CI, protection                          | `docs/git-workflow.md`                                                                                                               |
| Several agents at once (worktrees, ownership)            | `docs/multi-agent.md`, `pnpm wt`                                                                                                     |
| Recurring procedures                                     | `docs/workflows/`                                                                                                                    |

## Commands

- `pnpm dev` · `pnpm test` · `pnpm typecheck` · `pnpm lint`
- `pnpm eval` — offline, both suites, writes committed `evals/results.{md,json}`
- `pnpm eval:live` — model fallback on top; needs key; never a hook gate
- `pnpm catalog:install` (official EPA → `ymm.db`) · `pnpm catalog:sample` (checksum-verified fixture → `eval.db`)
- `pnpm ingest:user --csv /path/to/catalog.csv --db data/ymm.db` — separately supplied richer CSV
- `pnpm db:up` (docker Postgres + migrate) · `db:migrate` · `db:reset` · `db:down`
- `pnpm knowledge:compile [family]` — optional model-assisted research;
  independently verify manufacturer sources before accepting boundaries.
  The public artifact currently has eight families and no verified generations.
- `pnpm docs:check` — SPEC/docs integrity (pre-commit gate)
- `pnpm wt new <name>` / `pnpm wt rm <name>` — worktree per agent/branch
- `pnpm auth:hash <user>` / `pnpm auth:secret` — credential lines for `AUTH_USERS` / `AUTH_SECRET`

## Comment style

- File headers are `/** ... */` blocks stating the module's responsibility
  and the invariants it owns. Everything else is `//`.
- An inline comment states a constraint or a reason the code cannot express,
  in one or two declarative sentences, present tense.
- Never: first person, war stories, references to reviews, users, sessions,
  or "an earlier revision". Provenance lives in commit messages. Citing
  SPEC rules and docs (`SPEC 38`, `docs/salvage-economics.md`) is
  encouraged; narrating how a bug was found is not.
- Section dividers stay `// -- Name ----`.

## Invariants you must not break

- Ambiguity forks; it is never silently resolved (SPEC 1).
- Every inference is an explicit assumption chip (SPEC 2).
- Never invent vehicles — every card comes from SQL rows (SPEC 7).
- Deterministic tokenizer beats the model; model patches never overwrite (SPEC 5).
- Stages fail independently and visibly; one meta line per degraded stage (SPEC 10–11).
- Three search data sources: DB, NHTSA, eBay Browse API (no listing-site
  scraping); the agents add vPIC, live web research, and the seeded
  real-lot catalogs.
- Runs execute detached from HTTP (kept alive on Vercel via `after()`) and
  persist to Postgres when reachable, else the libSQL vehicle DB, else
  memory with one visible meta line (SPEC 30–31). Never let a missing
  database 500 a run.
- Keys are server-side only; no `NEXT_PUBLIC_` secrets (SPEC 17).
- Vercel deployments are gated by `src/proxy.ts` and fail closed when auth
  is unconfigured; local dev without auth vars is open (SPEC 40–42).

## Things you'd get wrong

- **This Next.js is newer than your training data.** `searchParams` is a
  Promise (`await props.searchParams`); page props use generated
  `PageProps<'/route'>` helpers from `next typegen` (runs in `pnpm typecheck`).
  Read `node_modules/next/dist/docs/` before writing app-router code.
- **AGENTS.md is regenerated by `next dev`.** Don't fight the uncommitted
  change; commit it alongside your work if it reappears.
- **Tailwind's palette is wiped** in `globals.css` (`--color-*: initial`).
  Only DESIGN.md token classes (`bg-surface`, `text-dim`, `border-border`,
  `text-danger`…) exist; `bg-zinc-800` silently produces nothing.
- **Year ranges use an en dash, no spaces** (`2001–2006`), from
  `yearRange()` in `src/ui/format.ts`. Don't hand-format them.
- **Both model stages guard on `ANTHROPIC_API_KEY`** and degrade cleanly
  when it's absent. Keep it that way: no code path may 500 or leak an SDK
  error string into the UI because a key is missing.
- **The model callers are injected** (`ModelCaller`, `ThemeCaller`) so every
  merge/validation path tests offline. Don't call SDKs directly in logic.
- **`pnpm eval` output is a committed artifact.** If you change resolver
  behavior, re-run it and commit `evals/results.md` in the same change.
- **Downloaded source CSVs and `*.db` files are gitignored**. The public
  sample, provenance and family knowledge are committed. Tests use the
  checksum-verified offline sample via `scripts/ensure-eval-db.ts`; no original
  catalog or paid model is required. EPA blanks remain unknown; positive
  `tCharger` / `sCharger` markers provide aspiration evidence.
- **Hooks are the gate**: pre-commit = prettier + eslint + typecheck +
  docs:check, pre-push = tests + offline eval. Never `--no-verify`.
- **Every change reaches `main` through a PR** (`gh pr create` →
  `gh pr checks --watch` → `gh pr merge --squash`); the ruleset refuses
  direct pushes. `gh` in this directory is the `ragamainidev` account
  (`docs/git-workflow.md §5`).
- **NHTSA names ≠ our names.** Mapping happens in `mapToNhtsaNames` with
  provenance surfaced in the UI. Don't query NHTSA with raw model names.

## Persistent assessment extensions

Read `docs/agent-assessments.md` before assessment work. Run
`pnpm eval:decisions` for synthetic business-decision cases and
`pnpm eval:agent` for actual Eve transport and tool behavior. Paid calls remain
explicit opt-ins. Dispatch needs no daemon: the run route delivers inline and
reports `accepted` only for a received session, and `agent/schedules/dispatch.ts`
drains the queue on its schedule (daily by default on Hobby;
`PADDOCK_DISPATCH_CRON` on Pro) (SPEC 57). `pnpm agent:worker --once` is a local
diagnostic. Money, buyer constraints, inspection scope, owner review,
source applicability and lifetime budgets belong to typed domain code. Model
tools cannot review physical or legal evidence. Real outcomes reference the
decision available at observation time; fixture results are not calibration.
