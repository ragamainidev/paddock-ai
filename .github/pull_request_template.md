## What

<!-- one paragraph: the change and why -->

## Checklist

- [ ] Behavior a test can pin → SPEC rule added/amended, cites code + test
- [ ] Recurring function / pattern / component / operational detail → `docs/<area>.md` section
- [ ] `pnpm docs:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm eval` pass locally
- [ ] Resolver behavior changed → `evals/results.*` regenerated in this PR
- [ ] Env var added → `.env.example`, `docs/deployment.md §3`, Vercel (Production, Sensitive)
- [ ] Migration added → production migrate command noted in the description
