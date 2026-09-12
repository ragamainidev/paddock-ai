# workflow: feature

From idea to a commit that is ready to integrate.

## 1. Before code

1. Read the current initiative (`docs/initiatives/`) if the work belongs to
   one; claim the task (`docs/multi-agent.md §3`).
2. Find the owning module in `CLAUDE.md`'s routing table and read its
   file header and tests.
3. Decide what the change needs in SPEC/docs (`docs/workflows/spec-update.md §1`).

## 2. Workspace

```sh
pnpm wt new feat/<slug>
cd .worktrees/feat/<slug>
```

## 3. Build

1. Test first: write the failing test beside the code (`docs/testing-and-evals.md §2.5`).
2. Implement following `docs/patterns.md` (injected callers, stage
   status, no throws across stages, deterministic beats model).
3. Any user-facing shape → DESIGN.md token check (`docs/frontend.md §1`).
4. Any model call → the checklist in `docs/llm-patterns.md §8`.
5. Any env var → `.env.example`, `docs/deployment.md §3`.
6. Add the SPEC rule / docs section decided in §1.
7. If resolver behavior changed: add a case to `evals/queries.jsonl` and
   run `pnpm eval`.

## 4. Gate and commit

```sh
pnpm typecheck && pnpm lint && pnpm docs:check && pnpm test && pnpm eval
git add -A && git commit    # conventional message; body names SPEC/docs touched
```

## 5. Hand off

Push the branch and open the PR (`docs/workflows/integrate-and-deploy.md`);
the template carries the checklist. Every change reaches `main` this way.
