# logging

What paddock records about its own execution, where it goes, and what
must never be written down. The product's primary observability is not a
log file: it is the run's own persisted event stream and span trace, which
the user sees. Server logs are the thin layer under that.

## 1. Three layers

| Layer      | Mechanism                                                       | Audience                         | Where it lands                                |
| ---------- | --------------------------------------------------------------- | -------------------------------- | --------------------------------------------- |
| Run events | Typed events yielded by orchestrators, persisted per run        | The user, live and later         | `run_events` (Postgres) or memory; UI console |
| Spans      | `Tracer` spans (`stage` / `model` / `fetch`, ms, ok, attrs)     | The user (trace view), engineers | Same stream (`{type:'span'}`), SPEC 32        |
| Server log | `console.error` / `console.warn` / `console.log` in server code | Engineers                        | Vercel function logs; terminal in dev         |

Rule: if a user could reasonably want to know it happened, it is a run
event or a stage status, not a server log line.

## 2. Server log conventions

### 2.1 Levels

- `console.error` — something failed that a stage status or run event
  cannot fully explain, or that happened outside a run (store attach,
  finalize, list). Always include the run id when there is one.
- `console.warn` — a degraded-but-handled state worth noticing in
  aggregate (auth misconfiguration on Vercel, rate-limit trips).
- `console.log` — reserved for scripts (`scripts/*`) and the auth audit
  lines below. Not for request tracing; Vercel already records requests.

### 2.2 Line grammar

`<subject> <id?>: <what happened>: <error>` — e.g.
`run 3f9c…: persistence degraded: <err>`,
`run 3f9c… stream attach failed: <err>`. Lowercase, present-tense noun
phrase, one line, the error object last so the runtime prints its stack.

### 2.3 Where lines exist today

`src/runs/manager.ts` (persistence degraded, finalize failed),
`src/app/api/runs/route.ts` (list unavailable),
`src/app/api/runs/[id]/route.ts` (read failed),
`src/app/api/runs/[id]/stream/route.ts` (attach failed, stream failed),
`src/app/api/auth/login/route.ts` (audit lines, §4).

Research dispatch adds three, all `console.error`, all for a cause the user
cannot be shown: the assessment reports that delivery failed, and the retry row
stores only a generic message, so the error object survives nowhere else.

| Line                                                  | Where                                                     | Fires when                                                                                  |
| ----------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `assessment <id>: research dispatch failed: <err>`    | `src/assessment-queue/worker.ts` (`deliver`)              | A claimed intent could not be delivered; the claim is retried                               |
| `assessment <id>: inline dispatch failed: <err>`      | `src/assessment-http/handlers.ts` (`startResearch`)       | The run route's own delivery attempt threw (SPEC 57)                                        |
| `assessment queue: scheduled dispatch stopped: <err>` | `agent/schedules/dispatch.ts`                             | The cron drain could not reach the queue; this fire ends there                              |
| `assessments: request failed: <err>`                  | `src/assessment-http/auth.ts` (`assessmentErrorResponse`) | A request threw something that is not a domain error; the client reads the fixed 503 reason |

The assessment id is the run id's equivalent here, so it leads the line the
same way. `agent/schedules/dispatch.ts` has no assessment in hand when the queue
itself is unreachable, which is why its subject is the queue, and
`assessmentErrorResponse` has none either — it answers whatever the handler
threw, and only the domain class (`AssessmentError`) is answered by its own
message. Everything else — a driver error carries a `code` too — becomes the
fixed 503 reason, so the error object survives only in this line.

Every stage that catches an error adds one more, for the same reason: the
user reads a fixed reason (`docs/patterns.md §1.4`), so the error object
survives nowhere else. The subject is the agent and the stage, since a
generator has no run id in hand.

| Line                                          | Where                                             |
| --------------------------------------------- | ------------------------------------------------- |
| `inspection <stage>: stage failed: <err>`     | `src/inspector/inspector.ts` (vision, nhtsa, web) |
| `inspection vin: provenance sweep failed:`    | `src/inspector/inspector.ts`                      |
| `inspection research: worker "<topic>" …`     | `src/inspector/research.ts`                       |
| `salvage <stage>: stage failed: <err>`        | `src/salvage/assess.ts` (triage)                  |
| `salvage research: live comps failed: <err>`  | `src/salvage/assess.ts`                           |
| `salvage research: evidence workers failed:`  | `src/salvage/assess.ts`                           |
| `salvage vin: provenance sweep failed: <err>` | `src/salvage/assess.ts`                           |
| `salvage research: worker "<tag>" failed:`    | `src/salvage/research.ts`                         |
| `search interpret: model fallback failed:`    | `src/interpret/model.ts`                          |
| `search resolve: vehicle query failed: <err>` | `src/pipeline/search.ts`                          |
| `nhtsa: name mapping failed: <err>`           | `src/enrich/nhtsa.ts`                             |
| `ebay: listing search failed: <err>`          | `src/enrich/ebay.ts`                              |
| `themes: naming failed: <err>`                | `src/enrich/themes.ts`                            |
| `run <id>: run failed: <err>`                 | `src/runs/manager.ts` (the generator threw)       |

The three enrichment stages are shared by search, the inspector and the
salvage assessor, so their subject is the stage alone — no agent leads a
line that any of them can write.

## 3. Redaction — never log

- `ANTHROPIC_API_KEY`, `TURSO_AUTH_TOKEN`, `EBAY_CLIENT_SECRET`,
  `AUTH_SECRET`, `POSTGRES_URL` (contains a password), `DATABASE_URL`
  when it carries a token.
- Passwords, password hashes, session cookies or tokens, `Authorization`
  headers.
- Uploaded photo bytes or their base64 (SPEC 29). Log the count.
- Full model prompts or responses. Spans carry sizes and token counts, not
  content.

SDK errors are logged as thrown; the Anthropic SDK does not include the
key in error messages. If a new client library might echo credentials in
errors, wrap and strip before logging.

## 4. Auth audit lines

`auth login ok user=<name>` and
`auth login failed user=<name|?> ip=<ip> reason=<bad-credentials|rate-limited|misconfigured>`
via `console.log`/`console.warn` in `src/app/api/auth/login/route.ts`.
The username is user-supplied input: it is truncated to 64 chars and
stripped of control characters before logging. Never the password.

## 5. Reading logs

- Dev: the `pnpm dev` terminal.
- Production: `vercel logs <deployment-url>` or the Vercel dashboard →
  project → Logs (function logs, ~1 h retention on the free tier). For
  anything longer-lived, the persisted run stream is the record.
- Runs: `/inspect/<id>` and `/salvage/<id>` render the full event log and
  the trace waterfall; `GET /api/runs/<id>/stream?from=1` dumps it as NDJSON.

## 6. Adding a log line

1. Ask whether it should be a stage status or run event instead. Usually
   it should.
2. Use the grammar in §2.2 and include the run id.
3. Check §3; if any listed value could reach the line, do not write it.
4. If the line is a new class of event (not a one-off), add it to §2.3.
