# workflow: integrate-and-deploy

Landing a finished branch on `main`, which deploys production.

## 1. Preconditions

- The branch's gate passed on the branch (`docs/workflows/feature.md §4`).
- You hold the primary checkout on `main` (`docs/multi-agent.md §1`).
- Any new env var is already set on Vercel (`docs/deployment.md §3`); any
  new migration is ready to run against production (`docs/database.md §3.4`).

## 2. Steps

```sh
# primary checkout
git switch main && git pull --ff-only

# in the worktree
cd .worktrees/<branch>
git rebase main
pnpm install                     # only if package.json changed
pnpm typecheck && pnpm lint && pnpm docs:check && pnpm test && pnpm eval
git status --short evals/        # regenerated artifacts? commit them
git commit -am "chore(eval): regenerate results after rebase"   # if needed
git push -u origin <branch>       # pre-push hook: tests + eval
git checkout evals/               # pre-push re-stamped the SHA; drop if that is all
gh pr create --fill               # template checklist; CI runs once
gh pr checks --watch              # wait for `checks`
gh pr merge --squash --delete-branch
pnpm wt rm <branch>

# primary checkout
git switch main && git pull --ff-only
# the merge deploys production by itself (Vercel Git integration)
```

## 3. Watch the deploy

```sh
vercel ls                         # newest deployment → Ready
curl -sI https://your-project.vercel.app/ | head -1          # 302/307 → /login
curl -s https://your-project.vercel.app/api/runs | head -c 200     # 401 JSON
```

Then sign in and start a seeded inspection; the run page must tail. If
anything is wrong: `docs/workflows/incident.md`.

## 4. Close the loop

Flip the task to `done` in the initiative doc, append a log line, commit
as `docs(initiative): …` on `main` (docs-only: no CI, no build).
