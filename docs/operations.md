# operations

Runbooks and operator commands. Each entry is short: symptom → command →
expected result. Longer context lives in the linked docs.

## 1. Commands

| Command                                                                                              | Does                                                                             |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm dev` / `pnpm build` / `pnpm start`                                                             | Next dev server / production build / serve the build                             |
| `pnpm test` / `pnpm typecheck` / `pnpm lint`                                                         | Unit + contract tests / types (+ typegen) / eslint                               |
| `pnpm docs:check`                                                                                    | SPEC/docs integrity (`docs/workflows/spec-update.md`)                            |
| `pnpm eval` / `pnpm eval:live`                                                                       | Offline suites (writes committed artifacts) / resolver with the model            |
| `pnpm catalog:install` / `pnpm catalog:sample`                                                       | Official EPA → `data/ymm.db` / checksum-verified public fixture → `data/eval.db` |
| `pnpm db:up` / `db:migrate` / `db:reset` / `db:down`                                                 | Docker Postgres + migrate / migrate / drop+migrate (localhost only) / stop       |
| `pnpm knowledge:compile [family]`                                                                    | Optional generation research; needs key and independent citation review          |
| `pnpm agent:dev`                                                                                     | Run the eve agent standalone on `127.0.0.1:2001` (`pnpm dev` co-hosts it)        |
| `pnpm agent:build`                                                                                   | Build the agent's own output locally; `pnpm build:all` adds the Next build       |
| `pnpm agent:worker --once`                                                                           | Take one unit of queued research and print the result — a local diagnostic       |
| `pnpm eval:agent` / `pnpm eval:agent:live`                                                           | Real Eve runtime cases, no provider calls / one paid coordinator case            |
| `pnpm eval:decisions`                                                                                | Synthetic business-decision cohort (`evals/agent/decision-results.md`)           |
| `pnpm wt new`, `pnpm wt rm`, `pnpm wt ls`                                                            | Worktrees for concurrent agents (`docs/multi-agent.md`)                          |
| `pnpm auth:hash <user> [pw]` / `pnpm auth:secret`                                                    | Credential line / secret for Vercel env (`docs/auth.md`)                         |
| `vercel env ls/add/rm`, `vercel ls`, `vercel logs <url>`, `vercel redeploy <url>`, `vercel rollback` | Vercel operations                                                                |
| `tsx scripts/replay-money.ts <run.json>`                                                             | Replay recorded research through the money model                                 |
| `bash scripts/github-protect-main.sh`                                                                | Apply the `main` ruleset (needs admin `gh` login)                                |

## 2. Environment

Local: `.env.local` (gitignored). Production: Vercel env (`docs/deployment.md §3`).
`.env.example` documents every variable; keep it current when adding one.
Never commit `.env*` except `.env.example`; never `NEXT_PUBLIC_` a secret.

## 3. Runbooks

### 3.1 Missing `ANTHROPIC_API_KEY`

Symptom: search works but "model fallback skipped" meta line; inspect and
salvage POST return 503 "ANTHROPIC_API_KEY is not configured".
Fix: `vercel env add ANTHROPIC_API_KEY production` (Sensitive), redeploy.
Local: put it in `.env.local`.

### 3.2 Postgres down (local or hosted)

Symptom: run pages show "runs are not persisted · database unreachable";
`GET /api/inspect` capability probe says `persistence: false`. That means
both Postgres and the libSQL vehicle DB failed their probes.
Local: `pnpm db:up`, or make sure `DATABASE_URL` points at an existing
file DB. Hosted: check `POSTGRES_URL` (if set) and the Turso
`DATABASE_URL`/token; both probes re-run every 5 s after a failure, so
recovery is automatic once a DB answers. Runs made meanwhile were
memory-only and are gone after the instance recycles — that is the
documented degradation.

### 3.3 Vehicle DB unreachable

Symptom: `/search` shows a resolve-stage meta line with the driver error.
Check `DATABASE_URL` / `TURSO_AUTH_TOKEN` (`vercel env ls`); Turso tokens
can expire — mint a new one (`turso db tokens create <db>`), update the
env, redeploy. Local: `DATABASE_URL=file:data/eval.db` and the file exists
(`pnpm catalog:sample`).

### 3.4 Everything 503 "authentication is not configured"

`AUTH_USERS` / `AUTH_SECRET` missing, short, or malformed on Vercel.
`vercel env ls`; regenerate (`docs/auth.md §6.1`); redeploy.

### 3.5 Rotate credentials

- A user: `pnpm auth:hash <user>` → replace the line in `AUTH_USERS` →
  redeploy (`docs/auth.md §6.2`).
- Everyone out: `pnpm auth:secret` → replace `AUTH_SECRET` → redeploy.
- Anthropic key: new key in the console → `vercel env rm/add` → redeploy →
  revoke the old key.

### 3.6 A run never finishes

Read its trace (`view trace` on the run page): the slowest span names the
stage. A run that emits nothing for `EVENT_TIMEOUT_MS` says so and dies;
runs hitting `maxDuration` (300 s) reconcile to `error` on the next list. If
a stage is consistently slow, its budget constant is in the owning module
(§8, `docs/llm-patterns.md §6`), not in the route — and §8 is the ceiling
every change to one has to stay under.

### 3.7 Redeploy after env change

`vercel redeploy $(vercel ls --prod 2>/dev/null | awk 'NR==1{print $2}')`
or simply push a commit. Env values are read at request time, but a
deployment snapshots the env it was created with.

### 3.8 Regenerate the eval artifacts

`pnpm eval` writes `evals/results.{md,json}` and appends to
`evals/history.jsonl`; commit them with the change that altered behavior.
Never hand-edit.

### 3.9 Rebuild the vehicle DB

`pnpm catalog:install` downloads the official DOE/EPA source and installs
`data/ymm.db`. `pnpm catalog:sample` verifies the committed sample manifest
and installs the offline fixture in `data/eval.db`. For a separately supplied
richer catalog, use `pnpm ingest:user --csv /path/to/catalog.csv --db data/ymm.db`.
Imports validate before atomically replacing the catalog and metadata;
failures preserve the working catalog and unrelated durable tables.
`pnpm catalog:check` reports representative full-catalog search coverage,
including unresolved evidence rather than claiming every filter is supported.

### 3.10 Research generation knowledge

`data/public-generations.json` contains eight independently EPA-cited family
identities and no verified generation/facelift boundaries. `pnpm
knowledge:compile [family]` is optional model-assisted research, requires a
key and must never run in ordinary setup, tests or offline evals. Verify
proposed model-year boundaries against independent manufacturer references
before incorporating them; sparse catalog rows are not boundary evidence.
Regenerate resolver eval artifacts if accepted knowledge changes behavior.

### 3.11 The eve service is unreachable

Symptom: **Continue research** answers that the agent could not be reached; the
run route reports `accepted: false` with `reason: agent_unreachable` (or
`agent_not_configured` when no bridge token is set). The assessment is saved
either way and the intent stays queued.

1. `curl -s https://your-project.vercel.app/eve/v1/health` — the one eve route
   that carries no credential, and the one the app itself probes. A healthy
   service answers JSON with `ok: true` and `status: "ready"`. Anything else
   (HTML, 401, a timeout) means the service, not the bridge, is the problem;
   check that the deployment built both services.
2. `vercel env ls` — `PADDOCK_AGENT_TOKEN` must be set and at least 24
   characters, or `bridgeAuth` refuses every call. Leave `PADDOCK_AGENT_URL`
   unset in production: the app addresses the co-hosted agent through its own
   origin.
3. If Deployment Protection is on, the health call returns the challenge page.
   Set `VERCEL_AUTOMATION_BYPASS_SECRET` so the server-to-server call is let
   through, then redeploy.
4. Retry from the assessment. The saved intent is also retried by the dispatch
   schedule without anyone asking.

### 3.12 The dispatch cron missed

Symptom: an assessment's research stays `pending` past the schedule's next
fire, and no delivery attempt appears in the activity log.

1. Vercel dashboard → Settings → Cron Jobs: the schedule from
   `agent/schedules/dispatch.ts` should be listed against the eve service.
   Observability → Cron Jobs shows whether it fired.
2. Check the expression against the cadence you expected. The default is
   `0 6 * * *`, one fire a day at 06:00 UTC, which is all the Hobby plan
   allows, so a wait of up to a day is expected and the inline dispatch on the
   run route is the only prompt path. `PADDOCK_DISPATCH_CRON` overrides the
   expression at build time — minute granularity needs Pro — so changing it
   takes effect on the next deploy, not on the next fire.
3. Confirm both services read the same `ASSESSMENTS_DATABASE_URL`. A schedule
   pointed at a different database drains an empty queue and reports nothing.
4. The schedule has no inbound request, so it cannot fall back to a request
   origin: it needs `VERCEL_URL` (Vercel sets it) plus the protection bypass,
   or an explicit `PADDOCK_AGENT_URL`.
5. `eve dev` never fires schedules. Locally, use `pnpm agent:worker --once`.
6. The fire has a third phase after the drain: the outcome prompts (§3.15). It
   owns its own failure, so a prompt that could not be written is logged as
   `outcome prompts were not recorded` and costs the fire nothing else.

### 3.13 The assessments database is refused on Vercel

Symptom: `/assessments` shows "Hosted assessments require a durable
ASSESSMENTS_DATABASE_URL"; `GET /api/assessments` answers 503 with code
`unavailable`. Search, inspect and salvage are unaffected.

Cause: on Vercel the variable is unset or starts with `file:`. A file database
lives in one instance's filesystem, is invisible to the eve service, and is gone
when the instance recycles, so `getAssessmentService()` refuses it rather than
losing saved decisions (`docs/database.md` §6.3).

Fix: create a Turso database, set `ASSESSMENTS_DATABASE_URL` (`libsql://…`) and
`ASSESSMENTS_AUTH_TOKEN` as Production/Sensitive, redeploy. Never point it at
the vehicle DB — that one is re-imported wholesale.

### 3.14 A write to the assessments file fails `SQLITE_BUSY`

Symptom: a save, a dispatch or the `agent-runtime` job dies with
`SQLITE_BUSY: cannot commit transaction - SQL statements in progress`, raised
from `tx.commit()` in `src/assessment-queue/schema.ts`. It appears under load
that puts two processes on one `file:` database at once — the eve service and
the app, or the eval's two processes — and not on a laptop that runs them more
slowly.

Cause: the message is not lock contention. A write statement refused for
another process's lock stays live on the connection that issued it, and SQLite
then refuses every commit on that connection. The refusal happens only where a
connection has no busy timeout, which is a per-connection setting the client
does not carry across the connections it opens (`docs/database.md` §6.4).

Fix: none at run time — clients carry `timeout: BUSY_TIMEOUT_MS`,
`openWriteTransaction` re-applies the pragma, and a connection already refused
is replaced rather than reused, so the statement waits instead. A recurrence
means a client was built without the option: check every `createClient` that
opens `resolveAssessmentsUrl`.

The wait has a price worth knowing before it surprises anyone: it is
synchronous, three attempts each spend up to `BUSY_TIMEOUT_MS`, and a write
transaction pays that twice — once to open, once to commit — so under sustained
contention a local-file write can block the process for about 30 s before
failing. Real contention beyond that still surfaces as
`SQLITE_BUSY: database is locked`, which is the honest symptom and calls for a
durable server (§3.13), not a longer wait.

### 3.15 The outcome prompt never appears

Symptom: a lot whose sale date has passed shows no `The sale date has passed`
banner on its assessment and no `outcome due` tag in the saved-decisions list.

1. The ask is written by the schedule, not by a page: on Hobby the next fire can
   be up to a day away (§3.12). `pnpm agent:worker --once` runs the same phase
   locally.
2. The rule is narrow by design (SPEC 62). The lot must state a `saleDate` now
   in the past — a `Future Sale` lot has none and is never asked about — the
   latest decision must have reached a ceiling (`ready`) or a walk, and the
   assessment must carry no outcome yet. A decision still reading
   `More evidence needed` is not asked about.
3. The desk asks once a week per assessment. The last ask is
   `assessment_outcome_prompts.prompted_at`; an ask answered by an outcome
   closes the banner until the next one.
4. Nothing is sent anywhere else. There is no email, push or webhook to check:
   the prompt lives in the assessment's activity log and the workspace reads it.

## 4. Rollback

`vercel rollback` (previous production deployment, instant) or
`git revert <sha>` on `main` (durable). `docs/deployment.md §7`.

## 5. Costs

- Anthropic: interpret fallback (only when tokens are left unparsed),
  themes (Haiku, per selected vehicle), vision + up to 5 research workers +
  VIN sweep per inspection, triage + workers per salvage assessment.
  Auth is the spend gate; the capability probe tells the UI when the key
  is absent.
- Vercel: builds only from `main` (and `preview/*`), never for docs-only
  commits; function time bounded by `maxDuration`.
- GitHub Actions: one run per PR head and per `main` push; docs-only PRs
  skip the job (`docs/git-workflow.md §7`).
- Turso and Neon: free tiers at this scale.

## 6. Retention

Runs accumulate in Postgres; the list caps at 50. To prune:
`delete from runs where created_at < now() - interval '90 days'`
(cascades to `run_events`). No automated job; add one here first if it
becomes routine.

## 7. Known limitations

Recorded here so they are decisions, not surprises. Each is a follow-up, not
a defect being tolerated silently.

| Limitation                                                                                                                               | Consequence                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runs carry no owner. Any authenticated user can read any run by id (`/api/runs/*`, `/inspect/<id>`, `/salvage/<id>`)                     | Fine for a two-user instance; an owner column and a filter are the fix                                                                                                                                                                                                                                                                                       |
| Responses carry no security headers (`next.config.ts` has no `headers()`): no CSP, HSTS, `X-Content-Type-Options` or frame ancestors     | The app relies on the platform defaults; a header block is a small change                                                                                                                                                                                                                                                                                    |
| The login rate limiter is per instance and per process                                                                                   | Serverless fan-out dilutes it; the fixed delay and scrypt cost still apply                                                                                                                                                                                                                                                                                   |
| Off Vercel there is no platform address, so `clientIp` buckets every login attempt under `'unknown'` (`src/app/api/auth/login/route.ts`) | Availability, not authentication: ten failures from anyone spend the shared bucket for the window, and the eleventh attempt answers 429 before credentials are checked. Rejecting a caller-supplied header is the trade — this Next version exposes no connection address to a route handler (docs/auth.md §5)                                               |
| The photo probe screens resolved addresses, then `fetch` resolves the name again (`src/inspector/photos.ts`)                             | A TTL-0 rebinding record can win that second lookup. Bounded by what the probe does with the answer: the result is one boolean, the body is cancelled unread, and no response content reaches a model or the reader — so the window buys blind reachability of an internal address, not its contents. Pinning the screened address needs a custom dispatcher |

## 8. Stage budgets

Every stage bound has to fit under the route's `maxDuration` (300 s on
`/api/inspect`, `/api/salvage` and the stream route). A budget above the
ceiling never fires: the platform kills the instance first, and the run
reads as dead without naming the stage that overran.

A request `timeout` bounds one **attempt**. A caller that allows SDK
retries therefore costs `timeout × attempts`, and a budget written as a
single timeout silently doubles. Vision and triage are bounded by their
timeout alone, so each exports the attempts it allows and passes
`maxRetries: ATTEMPTS - 1`; both are one attempt. The worker loops abort
their own stream at a wall-clock deadline, so their budget bounds them
whatever the SDK does.

| Budget              | Where                       | Attempts | Wall clock |
| ------------------- | --------------------------- | -------- | ---------- |
| `VISION_TIMEOUT_MS` | `src/inspector/vision.ts`   | 1        | 100 s      |
| `WORKER_BUDGET_MS`  | `src/inspector/research.ts` | deadline | 120 s      |
| `SWEEP_BUDGET_MS`   | `src/inspector/research.ts` | deadline | 60 s       |
| `TRIAGE_TIMEOUT_MS` | `src/salvage/triage.ts`     | 1        | 120 s      |
| `WORKER_BUDGET_MS`  | `src/salvage/research.ts`   | deadline | 150 s      |
| `EVENT_TIMEOUT_MS`  | `src/runs/manager.ts`       | —        | 240 s      |
| `TAIL_DEADLINE_MS`  | `src/runs/manager.ts`       | —        | 240 s      |

Serially, an inspection spends vision → one research worker → the VIN sweep
(280 s) and a salvage assessment spends triage → one research worker
(270 s); research workers run one per topic in parallel, so the slowest
worker is the cost, not the sum. `EVENT_TIMEOUT_MS` is a hang detector, not
a stage bound: it sits above every single stage and below the ceiling, so a
wedged run says "no events for 4 minutes" instead of vanishing at the wall.
The remaining 20 s absorbs the photo pre-flight, the federal decode,
finalize and the last store write. `src/runs/budgets.test.ts` holds the
arithmetic, including a source check that no agent caller leaves the SDK
free to retry; change a constant and the test says whether it still fits.
