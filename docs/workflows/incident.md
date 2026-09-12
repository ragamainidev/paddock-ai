# workflow: incident

Production is wrong. Restore first, understand second.

## 1. Triage (2 minutes)

| Symptom                                           | Likely cause                                            | First move                                       |
| ------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------ |
| Every page 503 "authentication is not configured" | `AUTH_USERS` / `AUTH_SECRET` missing or short on Vercel | `vercel env ls`; re-add (`docs/auth.md §6`)      |
| Login rejects known-good credentials              | `AUTH_USERS` hash line malformed / rotated              | `pnpm auth:hash <user>` and re-add               |
| Inspect/salvage 503 "ANTHROPIC_API_KEY"           | key missing on Vercel                                   | `vercel env add ANTHROPIC_API_KEY production`    |
| Run page "run not found" mid-run                  | memory store on another instance (no Postgres)          | Set `POSTGRES_URL` (`docs/deployment.md §4`)     |
| Runs stall / never finish                         | `maxDuration` hit or upstream hang                      | Read the run's trace; check Vercel function logs |
| Search returns resolve error                      | Turso unreachable / token expired                       | `docs/operations.md §3.3`                        |
| Build failed on Vercel                            | Node/typegen mismatch, missing file                     | Read the build log; fix forward on `main`        |

## 2. Restore

- Bad code: `git revert <sha>` on `main`, push. Vercel redeploys in ~1 min.
- Bad env: fix the variable, then `vercel redeploy <url>` (env changes need
  a new deployment).
- Bad deployment with good `main`: `vercel rollback` (`docs/operations.md §4`).

## 3. Understand

- `vercel logs <deployment-url>` for function errors (`docs/logging.md §5`).
- The run's own trace (`/inspect/<id>`, `view trace`) for stage timings.
- Reproduce locally with the same env (`vercel env pull .env.vercel.local`,
  never commit it).

## 4. Close

- Fix forward with a test that pins the failure; SPEC/docs per
  `docs/workflows/spec-update.md`.
- If the incident revealed a missing runbook line, add it to
  `docs/operations.md`.
