# Inspector — pre-purchase inspection agent

Photos in, sourced verdict out. The agent looks at a specific car's actual
photos, decides what that car needs researched, runs real web searches, pulls
NHTSA data, checks the VIN's structure, and positions the price against real
sold comps. Everything it asserts is either visible in a photo, cited to a
source URL, computed from data, or absent.

## What is real, and what is not

| Stage       | Source                                                                                                             | Honest limits                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Vision      | Claude Sonnet over the actual photos (forced tool call, zod-validated)                                             | Only what photos show; confidence drops with few/staged photos         |
| Web         | Live web search via the Anthropic server tool; one worker per topic, in parallel, each on a hard wall-clock budget | Findings without a source URL are discarded (SPEC 22)                  |
| NHTSA       | Federal complaints + recalls API                                                                                   | Complaint counts computed, never model-written                         |
| Reliability | Curated failure DB (`reliability.ts`)                                                                              | Says "no curated data" for uncovered cars                              |
| VIN         | Structural decode + claimed-vs-decoded mismatches                                                                  | No title/theft/accident history; never prints "clean" (SPEC 26)        |
| Market      | Seeded real sold results (`seed-listings.ts`, provenance + date)                                                   | Subject excluded from its own comps; no comps → visibly degraded stage |

There are no mock stages. A missing `ANTHROPIC_API_KEY` refuses the
inspection outright instead of inventing one.

## Flow

```
photos ──► pre-flight (dead URLs probed and dropped visibly; photos.ts)
              │
              ▼
           vision (structured findings, anchored to ORIGINAL photo indices)
              │
              ├─► plan: topics derived from THIS car's findings, reasons stated
              │       └─► parallel topic workers — one small agent per topic,
              │           tagged lanes stream to the console ([resale] searching: …),
              │           each worker aborts its own stream at its time budget
              ├─► NHTSA complaints/recalls, narrowed to detected issue types
              ├─► VIN structural decode + mismatch red flags
              ├─► market position vs real comps + repair exposure
              └─► synthesis: verdict / red flags / checks / negotiation math
```

The orchestrator (`inspector.ts`) is an async generator of typed
`InspectEvent`s; `/api/inspect` forwards them as NDJSON so the UI renders the
agent working (every web search appears as it runs — see `eventChannel` in
`src/agent/channel.ts`).
Dynamic means dynamic: a rusty car and a clean car produce different research
plans, and the tests prove it.

## Testing

Every dependency is injected (`InspectorDeps`); the whole orchestration runs
offline. `pnpm test src/inspector/` covers vision validation, research
planning and citation rules, market math, VIN decode/mismatch, stage
isolation, event ordering, and seed-catalog integrity (SPEC 21–29).

## Seeded listings

Six real Bring a Trailer auctions (real VINs, real sold prices, photo URLs
verified on the collection date) stand in for a live listings API, plus
sold-result comp sets per platform. The app never fetches BaT pages at
runtime. If photos rot, replace the entry — `seed-listings.test.ts` will
catch an entry whose VIN stops matching its identity.

## Environment

```
ANTHROPIC_API_KEY=…   # vision + web research; the only key the inspector needs
```
