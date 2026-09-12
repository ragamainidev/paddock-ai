# git-workflow

Branches, commits, hooks, CI, and protection — arranged so that quality is
enforced locally (fast, free) and remotely once (cheap), and so that
production only ever moves by a push to `main`.

## 1. Model

- `main` is production. Every commit on it is deployable and deployed by
  the Vercel Git integration (`docs/deployment.md`). Linear history.
- Work happens on short-lived branches, usually in a worktree
  (`pnpm wt new <name>`, `docs/multi-agent.md`).
- Every change reaches `main` through a pull request — agents included.
  Rebase on `main`, run the gate, push the branch, `gh pr create`, let CI
  run, merge with `gh pr merge --squash` (or `--rebase` when the commits
  are worth keeping). The ruleset (§5) blocks direct pushes to `main`
  (`docs/workflows/integrate-and-deploy.md`).

## 2. Branches and commits

### 2.1 Branch names

`feat/<slug>`, `fix/<slug>`, `docs/<slug>`, `chore/<slug>`, `init/<slug>`
(initiatives), `preview/<slug>` (the only prefix that gets a Vercel
preview build). Slugs are kebab-case, ≤ 40 chars. One branch per task.

### 2.2 Commit messages

Conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`,
`test:`; optional scope in parentheses (`docs(initiative):`). Subject in
the imperative, ≤ 72 chars, no trailing period. The body says why, names
the SPEC rule and docs section touched, and the production migrate
command when a migration is included. Agent commits identify the actual contributing agent. Use provider/session
trailers only when they describe the agent and session that did the work. For
a Claude-authored change, for example:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_<id>
```

### 2.3 What one commit contains

The code, its tests, its SPEC rule, its docs section, and (when resolver
behavior changed) the regenerated `evals/results.*` — never split across
commits (`docs/workflows/spec-update.md §5`).

## 3. Local gates (husky)

| Hook       | Runs                                                                                                                           | Typical time |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| pre-commit | lint-staged (prettier + eslint `--max-warnings 0` on staged files), `pnpm typecheck` (incl. `next typegen`), `pnpm docs:check` | 10–20 s      |
| pre-push   | `pnpm test`, `pnpm eval`                                                                                                       | 30–90 s      |

`--no-verify` is never used. If a hook is wrong, fix the hook. The hooks
are why CI can be minimal.

## 4. CI (GitHub Actions)

`.github/workflows/ci.yml`:

- Triggers: `pull_request` (any base) and `push` to `main` only. No
  per-branch push runs — the pre-push hook already ran the same gate.
- `concurrency` with `cancel-in-progress`: a new push to the same PR or to
  `main` cancels the run in flight.
- Job `changes` (dorny/paths-filter, ~10 s) decides whether anything
  outside `docs/**` and `*.md` changed; the two code jobs run only then. A
  skipped job satisfies a required status check, so docs-only PRs merge
  without spending build minutes.

Three jobs do the work:

| Job             | Runs when                 | Steps                                                                                | Required      |
| --------------- | ------------------------- | ------------------------------------------------------------------------------------ | ------------- |
| `checks`        | code changed              | typecheck, lint, `db:migrate`, test, `eval`, `eval:check`, `eval:decisions`, `build` | yes           |
| `docs`          | every PR and push to main | `docs:check`                                                                         | yes           |
| `agent-runtime` | code changed              | `eval:agent`, `agent:build`                                                          | workflow gate |

- `checks` (`timeout-minutes: 15`) runs a `postgres:16` service container
  on port 5434 and migrates it before the test step, so the run-store
  contract's Postgres arm runs there (`POSTGRES_TEST_URL`). The port is
  deliberately not the 5433 the app's `POSTGRES_URL` defaults to: nothing
  but that contract test is meant to find a database in CI. It ends with
  the Next production build
  (`NEXT_TELEMETRY_DISABLED: 1`) — the only check that compiles every route,
  so a build break cannot reach a deploy. Its lint step is
  `eslint --max-warnings 0`, the same strictness lint-staged applies to
  staged files.
- `docs` (`timeout-minutes: 5`) carries no `if:` guard. `pnpm docs:check`
  is the whole gate a docs-only PR has to pass, and it also validates
  `.env.example` coverage, SPEC test titles, `DESIGN.md` headings and the
  `CLAUDE.md` routing table against the code — so it runs on every PR and
  every push to `main`, docs-only ones included.
- `agent-runtime` (`timeout-minutes: 15`) runs `pnpm eval:agent` against a
  real `eve dev` process and compiles the agent with `pnpm agent:build`.
  The fixture run makes zero provider calls. A failure fails the workflow;
  the framework's beta status does not waive orchestration correctness.
- Every job pins `node-version: 24` (matching `.nvmrc` and `engines.node`)
  with `pnpm/action-setup@v4` before `setup-node` and `cache: pnpm`.
- Nothing needs a secret or a network service; the eval DB is built from
  the committed public EPA sample.

`checks`, `docs` and `agent-runtime` are the intended required statuses. The
configured ruleset must be checked separately in GitHub; changing workflow
failure behavior does not change branch-protection settings. No ruleset
mutation is part of the public-catalog change.

Budget: one PR ≈ 6–8 minutes of runner time across the three jobs; a
docs-only PR ≈ 40 s (the `docs` job is the only one that does work;
`changes` still runs).

## 5. Protecting `main`

Ruleset "main" (GitHub → Settings → Rules → Rulesets), applied by
`scripts/github-protect-main.sh` when `gh` is logged in as an admin
account:

- Require a pull request before merging; 0 approvals required
  (single-owner repo — raise when a second human joins); merge methods
  squash and rebase only.
- Block deletions and force pushes (`non_fast_forward`).
- Require linear history.
- Require status check `checks` (the CI job name) — with `strict: false`
  so a green PR need not be re-run after `main` moves.

`gh` account per volume: `~/Downloads/personal/` uses the
`ragamainidev` login through `GH_CONFIG_DIR=~/.config/gh-personal`
(set by `~/.zshenv` at shell start and by a `chpwd` hook in `~/.zshrc`),
mirroring the git `includeIf` for that directory; other directories keep
the default `~/.config/gh` account. `gh auth status` shows which is active.

## 6. Merging

- Through the PR: `gh pr merge <n> --squash --delete-branch` by default
  (one clean commit per task; keep the body rules from §2.2 in the squash
  message), `--rebase` when each commit on the branch stands on its own.
- Never merge commits (`--no-ff`) onto `main`; linear history is required.
- Never push to `main` directly; the ruleset refuses it anyway.
- The integrator regenerates `evals/results.*` after rebasing if the
  branch or `main` touched resolver behavior; artifacts are never
  hand-merged.

## 7. Minimizing action and build minutes

| Lever                                 | Where                            |
| ------------------------------------- | -------------------------------- |
| No CI on branch pushes                | `on.push.branches: [main]`       |
| Cancel superseded runs                | `concurrency.cancel-in-progress` |
| Skip docs-only changes                | `changes` job + `if:`            |
| Cache pnpm store                      | `setup-node` `cache: pnpm`       |
| Hard timeout                          | `timeout-minutes`                |
| No Vercel preview unless `preview/*`  | `vercel.json` `ignoreCommand`    |
| No Vercel build for docs-only commits | `scripts/vercel-ignore.sh`       |
| Local hooks catch failures before CI  | husky                            |

## 8. Recovering

- Bad commit on `main`: `git revert <sha>` and push (Vercel redeploys).
  Do not force-push `main` (blocked by the ruleset).
- Bad deploy with a good `main`: `vercel rollback` or promote a previous
  deployment in the dashboard (`docs/operations.md §4`).
- Rebase conflict in `evals/results.*`: take either side, `pnpm eval`,
  continue.
- Dirty `evals/results.*` right after a push: the pre-push hook re-ran
  `pnpm eval`, which stamps the current git SHA into the artifacts. If the
  diff is only the SHA/date lines, `git checkout evals/`; if checks
  changed, something is wrong — investigate before the next commit.
  `pnpm eval:check` answers that question directly: it passes when the only
  difference is the header, and prints the offending lines when it is not.
  CI runs it after `pnpm eval` and after `pnpm eval:decisions`.
