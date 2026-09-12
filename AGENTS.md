<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Paddock development context

Read `SPEC.md` and the relevant entry in `docs/README.md` before changing behavior.
Assessment work starts with `docs/agent-assessments.md`; the current
initiative is `docs/initiatives/2026-09-06-bidding-desk.md`.

The durable assessment is the source of truth. Keep model choices outside
money, ownership, applicability, revision and budget rules. Add new capability
behavior through injected adapters, a domain test and an actual runtime eval.
Run `pnpm eval:agent` for fixture-only orchestration tests; paid model runs need
the explicit opt-in documented there. Inspect saved evidence and decisions,
not just the agent's final message. Use Node 24 or newer for Eve.

Run `pnpm eval:decisions` for independent synthetic business-decision cases.
Keep real outcome observations tied to an earlier decision revision; fixtures
do not count toward calibration. Review acceptance belongs to authenticated
domain operations, never a model tool. Inspection and quote review binds to
damage scope. Source artifacts, extraction and inference stay distinguishable.
Durable dispatch and bounded watches run from the eve schedule in
`agent/schedules/dispatch.ts`; `pnpm agent:worker --once` is a local diagnostic.
