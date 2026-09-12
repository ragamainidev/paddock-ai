# Debug tooling (zero API cost)

- `POST /api/debug-run` (only when `PADDOCK_DEBUG=1`): starts a synthetic
  run that emits staged events on a fixed schedule, for verifying live
  console behavior (timers, pacing, reconnects) without spending credit.
- `node scripts/timer-probe.mjs <runId>`: samples the run page's header,
  cursor, and rail timers once a second via headless Chrome and prints
  them, proving tick behavior instead of eyeballing it.
- `pnpm tsx scripts/replay-money.ts <run.json>...`: replays recorded
  research findings through the current money model.
