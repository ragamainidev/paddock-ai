# Agent assessments

## 1. Architecture

An assessment is a durable vehicle decision record. Eve sessions operate on
it through typed capabilities; the session is not the vehicle database.
The assessment service owns revisions, evidence applicability, investigation
budgets and deterministic recomputation through the existing salvage kernel.
Each evidence epoch has its own bounded Eve conversation. Retrying an epoch
reuses its session; an explicit refresh gets a new session without resetting
the assessment's lifetime research budget. Older sessions cannot act on a
newer epoch. This keeps model context/call limits from stranding the vehicle
record after a few updates.

## 2. Evidence and authority

A source observation and a model claim are different records. Evidence carries
its subject, source, acquisition time and provenance. A source URL alone does
not prove a price, a completed sale, clean title, or repairability. Unknown and
contradictory evidence remain visible. Existing arithmetic and conservative
cost policy remain authoritative. The agent cannot purchase, bid, send messages,
or execute arbitrary code.

## 3. Execution and testing

Fixture mode uses recorded and explicitly synthetic adversarial inputs. It runs
the same domain capabilities as live mode and labels every result. A fixture
language model exercises the real Eve runtime without spending API tokens.
Live-coordinator evaluation keeps evidence local and only pays for bounded
model decisions. Neither fixture tests nor mock-model success establish real
world appraisal accuracy.

## 4. Development contract

New agent capabilities require a typed input, domain enforcement, an observable
result, a budget and an offline behavioral eval. A completion message is not
the source of truth: inspect stored decision revisions and accepted evidence.
Provider calls stay behind injected adapters. Framework changes follow the
installed package documentation and runtime regression tests.

## 5. Run locally

Use Node 24 or newer and `pnpm install`; `pnpm dev` needs it too, because
`withEve()` in `next.config.ts` boots the agent beside Next and rewrites
`/eve/v1/**` to it. Eve is pinned to `0.52.2`; its public API documentation
ships in `node_modules/eve/docs/`. Create a random `PADDOCK_AGENT_TOKEN` and
set the same token wherever an agent or an app process runs. Point every
process at the same absolute
`ASSESSMENTS_DATABASE_URL=file:/absolute/path/assessments.db`. The parent
directory must exist. Local default is `file:data/assessments.db`.

`PADDOCK_AGENT_URL` is optional. The app addresses the co-hosted agent through
its own request origin, so leave it unset with `pnpm dev`. That origin is built
from `host`/`x-forwarded-host`, which the caller controls, so it is accepted
only for a loopback address (`localhost`, `127.0.0.1`, `[::1]`): the bridge
credential must never travel to a host a forged header named. A deployment that
serves any other hostname sets `PADDOCK_AGENT_URL`, or on Vercel is addressed
through `VERCEL_URL`, and is otherwise reported as not connected. Two cases
still need the variable locally: the `pnpm agent:worker --once` diagnostic has
no inbound request, so give it the Next origin
(`PADDOCK_AGENT_URL=http://localhost:3000`); and `pnpm agent:dev` runs the
agent standalone on `127.0.0.1:2001`, which the app reaches only when
`PADDOCK_AGENT_URL=http://127.0.0.1:2001` names it.

A local production run serves the agent from its own build output on port
`4274` (`EVE_NEXT_PRODUCTION_PORT` moves it), so run `pnpm build:all`
(`eve build && next build`) before `pnpm start`. `pnpm build` alone is enough
for a Vercel deployment, which builds the agent as its own service.

Run `pnpm dev`, open `/assessments` and select **Run recorded case**. The
default coordinator is a fixture model; the sources are Paddock's existing
recorded case with explicit provenance. Creating an assessment, adding evidence
and refreshing it persist research intent atomically with the assessment.
**Continue research** dispatches that intent inline and reports whether a
session actually started. `eve dev` never fires schedules, so a saved intent
that no request delivered waits until `pnpm agent:worker --once` takes it; that
script is a local diagnostic, never a deployed component. The detail view shows
delivery and watch state.

POST `/api/assessments` creates a record from `seedLotId` or `lot` with a caller
idempotency key. `/api/assessments/:id` reads it. POST suffixes `/run`,
`/refresh`, `/stop`, `/evidence`, `/review`, `/buyer`, `/watch` and `/outcome` operate on that owned record.
Creation, `/refresh`, `/evidence`, `/review` and `/buyer` attempt no delivery,
so the `research` block they answer with reports `saved` — the intent was
committed — beside `queued` and the intent's `status`. Only `/run` attempts a
delivery, and only it answers `accepted`, which means a session started
(SPEC 57). A route that could not commit anything answers `saved: false` and a
`message` fit to show the owner.
Mutation bodies carry `expectedRevision` and `idempotencyKey` where defined in
`src/assessments/schemas.ts`. Outcomes record `passed`, `purchased`, `sold` or
`observed` with a note and optional amount. They record an external result;
they never initiate a purchase or automatically retrain a model.

## 6. Low-cost verification

| Command                | What it proves                                                                                           | Provider spend       |
| ---------------------- | -------------------------------------------------------------------------------------------------------- | -------------------- |
| `pnpm test`            | Evidence gates, deterministic money, ownership, durable store and runtime policies                       | None                 |
| `pnpm eval`            | Existing resolver, inspector and salvage fixture regressions                                             | None                 |
| `pnpm eval:decisions`  | Independent synthetic decision expectations, buyer constraints and as-of evidence                        | None                 |
| `pnpm eval:agent`      | Actual Eve HTTP transport, model/tool loop, durable sessions, changed evidence, cancellation and restart | None                 |
| `pnpm eval:agent:live` | A real model chooses from the same capabilities against local evidence                                   | Explicit paid opt-in |

The runtime harness starts an isolated Eve process and libSQL database. It
grades saved evidence, decision revisions, investigations and persisted runtime
events. Read `evals/agent/results.md` and `results.json` for inspectable results.
The concise fixture report is versioned; the full JSON transcript is a local
generated artifact, kept out of Git to avoid duplicating every captured record.
The model chooses from the current offered actions; domain tests separately
challenge hostile/stale arguments instead of assuming the model obeys.
Recorded observations and synthetic adversarial changes are labeled separately.
Zero-cost runs do not test semantic model judgment or source availability.
The fixture policy follows the domain's action order and continues until a
decision, evidence boundary or budget ends useful work. Selective refreshes
exercise new sessions while retaining fresh identity and damage evidence.

For one paid coordinator case, set `PADDOCK_AGENT_LIVE_ACK=yes`,
`AI_GATEWAY_API_KEY` and an explicit `PADDOCK_AGENT_MODEL`, then run
`pnpm eval:agent:live`. Its evidence stays local even if the host has provider
credentials. It is intentionally excluded from normal CI. The coordinator is
bounded to 12 provider attempts per session, 512 output tokens per call and a
30-second provider timeout. Eve also enforces session token/cost limits; costs
reported by a provider can settle after a call, so they are not a prepaid cap.
Inspect actual model usage before expanding the case set. Optional
`pnpm eval:agent:live --trials=3` repeats the coordinator policy case in three
fresh sessions. This can use up to 36 provider attempts; it does not establish
source quality or appraisal accuracy. The default is one trial.

## 7. Live sources and budget policy

Live evidence is a separate opt-in: `PADDOCK_AGENT_MODE=live-coordinator`, the
live-model settings above, and `PADDOCK_AGENT_ALLOW_LIVE_EVIDENCE=yes`.
This enables the existing fixed vPIC/eBay and photo/repair adapters for `live`
assessments. The health endpoint reports the effective modes; fixture-model
and live-model activity remain distinguishable from evidence provenance.

An assessment defaults to six investigations and zero paid research allowance.
Inputs allow at most twelve investigations and 2,000 cents. Photo triage
reserves 300 cents, repair research 150 cents, and vPIC/eBay reserve zero.
These are conservative execution allowances, not measured provider invoices;
investigations label `allowance_estimate` versus `metered`. Refresh preserves
lifetime spending and investigation counts. Model coordination has its own
separate limits. Exhaustion stops research; it cannot authorize more spending.

Investigator captures and explicitly owner-reviewed observations can affect
arithmetic. Supplied claims remain unverified until the owner records a review
of their applicability and supporting source. Claiming provider provenance
does not grant authority. Model inference cannot receive documentary acceptance.
Live repair research returns claims with citations, not captured source pages,
so those claims stay outside the ledger. Photo inference describes visible
damage only. The live adapters cannot establish physical repairability or
registration eligibility by themselves. A supported bid requires scoped
physical inspection, title/eligibility records, professional repair quotes,
qualified market evidence and feasible buyer constraints.

A number the owner types is self-attested, not captured. The server owns
provenance: `recordEvidence` drops any client-supplied observation, artifact,
extraction and basis from user evidence, so the entry form cannot echo its own
fields back as the capture behind them, and only the inference marker the server
derives from a claimed model capture survives. Review still works on such a
record — its source URL must be `https:` and the owner's rationale is retained —
while subject match, comparability, freshness, the model-inference wall and
identity rules apply unchanged; a captured source still needs its retained
observation to match the claimed fields. Accepted self-attested numbers read
`self-attested` in the evidence list and in decision lineage, and every one the
arithmetic used is counted in the residual risks — including a comparable the
exit took from the fallback pool it uses when fewer than three comps qualify.
They cannot carry the market gate alone: the exit needs at least one qualified
comparable from a captured source (SPEC 56).

Freshness policies are initial planning bounds, not calibrated market
guarantees: 30 days for triage, comps and inspection; 90 days for repair,
title and registration captures. Identity is stable. Source event dates and
eligibility expiry also apply. Reads retract expired actionable decisions.
Watches may request more frequent observations within their explicit limits.
Never replace an old capture timestamp with the replay date.

## 8. Durable deployment and recovery

The app and the agent deploy as one Vercel project. `withEve()` writes the
Build Output service for `./agent` and routes `/eve/v1/**` to it before
filesystem routing, so the agent has no ingress of its own; `pnpm agent:build`
produces that output locally. `src/proxy.ts` excludes `/eve/v1/` and
`isPublicPath` agrees, because the agent runs its own fail-closed auth walk
there. Persist Eve's `.eve/.workflow-data` directory and the assessment
database independently. Hosted Next requires an explicit assessment DB URL;
it must connect to the same durable database as Eve, never a container-local
copy or the vehicle reference database. Use `ASSESSMENTS_AUTH_TOKEN` for
remote libSQL. Do not deploy two independent local workflow stores as one
coordinator. Distributed deployment needs a configured shared Workflow World.

The bridge token authenticates the trusted server, while the app resolves the
assessment owner from its signed session. Every session request carries that
verified scope in `x-paddock-owner`, `x-paddock-assessment`, `x-paddock-epoch`
and `x-paddock-dispatch`; `bridgeAuth` turns them into the session principal
and refuses anything else. A missing or unusable credential or scope answers
401; an unknown assessment, a superseded epoch and unacknowledged live evidence
answer 403, because each refuses authority rather than reporting bad input.
Tools get owner/assessment scope from runtime authentication, never model
arguments, and the default tools stay disabled. Every session and inspection
route under `/eve/v1` runs that walk, so an anonymous caller is refused there.

The rest of the framework surface is narrower than "closed" would suggest.
`GET /eve/v1/health` is the only route that carries no credential of any kind.
Eve's own callback routes — `/eve/v1/callback/`, `/eve/v1/task-input/`,
`/eve/v1/activity/` and the connection callbacks under `/eve/v1/connections/` —
skip the walk because each ends in an opaque per-operation token the framework
minted and verifies, so they authenticate the operation rather than the caller.
`POST /eve/v1/cron/:token`, which eve reserves once the app defines a schedule,
authenticates the same way: the token in the path is the framework's own, so the
platform's cron can fire the schedule without a bridge scope. Routes under
`/eve/v1/dev/` exist only while `eve dev` is the host. The workflow webhook lives
outside the prefix, so `withEve()` never routes it to the agent and
`src/proxy.ts` still gates it. Do not expose the bridge token in client
code. When the deployment has protection enabled, set
`VERCEL_AUTOMATION_BYPASS_SECRET` so a server-to-server call reaches the agent
instead of the challenge page.

A local `file:` assessments database is opened by the app, the worker and the
agent at once, so `prepareSharedDatabase` puts it in WAL with a busy timeout
and every statement retries a reported lock. A remote libSQL server owns its
own locking and ignores both settings.

Each investigation reserves a revision and budget before a provider call.
Late results after stop or lease expiry are discarded; uncertain interrupted
calls consume their reservation rather than automatically repeating paid work.
Providers may continue running after cancellation. Continue a saved assessment
to recover expired work, or refresh explicitly to offer a new evidence epoch.
Refresh is not an unlimited retry or budget reset.

## 9. Automotive evidence behind the design

Vehicle identity, title, physical repair scope and market exit are separate
questions. [NHTSA vPIC](https://vpic.nhtsa.dot.gov/api/) decodes manufacturer
identity data, including partial VINs; it does not supply title or accident
history. [Copart terms](https://www.copart.com/termsAndConditions) treat lot
information and arrival observations as limited representations. A Run and
Drive badge cannot establish current roadworthiness.

[NMVTIS consumer disclosures](https://vehiclehistory.bja.ojp.gov/sites/g/files/xyckuh261/files/media/document/CAPDisclaimer_1.pdf)
describe gaps and reporting delays; absence of a brand is not proof of no
damage. [I-CAR's diagnostic guidance](https://rts.i-car.com/crn-642.html)
distinguishes diagnostic codes from a completed repair diagnosis. Accordingly,
missing records stay unknown, observed asking prices stay asking prices,
and a model's citation cannot turn its claim into a verified observation.

## 10. Equipped enthusiast decisions

`src/assessments/buyer-profile.ts` records editable planning assumptions for
three bidders, because the ceiling belongs to (lot, bidder) rather than to the
lot. The hobbyist preset is the product default: a broker seat at the auction,
a private-party exit, a 0.75 discipline share, tools, workspace and specialist
access but no lift, no diagnostics and none of the frame rack, paint booth,
alignment rack or high-voltage tooling; 200 available DIY hours at $25/hour
opportunity cost, 90 holding days at $10/day, a $40,000 cash limit and $5,000
minimum surplus. The shop and dealer presets state a direct licensed account
and a wholesale or retail exit against their own equipment, rates and turn.
Every value is listed with what it assumes in `docs/salvage-economics.md` §11;
none is an industry average, and a profile that diverges from every preset is
`custom`. Registration jurisdiction starts unspecified for all three. The form
shows each unedited value as an assumption chip and asks the buyer to replace
it with their actual situation. A record saved before a field existed reads
back with that field's default and is rewritten on its next save.

Cash affordability and economic surplus constrain separate ceiling solves.
The cash arm is what leaves the buyer's account to acquire the car, so it
excludes selling costs, which are paid out of sale proceeds, and the buyer's
own labor, which is time rather than money; both remain in the economic arm.
The optimistic bound sells at the high exit and derives its selling costs
there. The existing conservative exit margin, auction fees and repair
contingency remain. Every professional repair line needs a reviewed whole-job
quote; quotes can raise conservative priors without a model-citation cap, and a
reviewed quote on a DIY line buys that work, so the line becomes professional
and its hours leave the labor line. Only review does that: a DIY line prices
materials, so an unreviewed shop quote on one is held out of the estimate and
named as a residual risk rather than charged at shop rates; captured part
prices still apply to DIY materials. Lower quotes do not automatically erase
hidden-damage priors. Unsupported platform cost priors still limit the estimate
even when documents are reviewed.

The same lot has one ceiling per bidder (SPEC 59). `buyerLedger`
(`src/assessments/buyer-ledger.ts`) reprices the kernel's plan for the saved
profile: `access` selects the fee mode, so a licensed account pays neither the
broker percentage nor Copart's own per-vehicle broker charge; `exit` selects
where the car transacts and what selling it costs, and `keep` charges nothing
to sell, carrying a zero selling line that says no sale is planned; a stated
jurisdiction replaces the national title band with that state's published
fees, while an untabulated one keeps the national band untouched; and a DIY
line whose frame rack, booth, alignment rack or high-voltage tooling the buyer
does not own is bought at the tier's shop rate, its hours leaving the labor
line. Professional work is never handed back to the buyer, whatever the
profile says. Every line the layer adds or changes carries its basis and a
derived chip, and `buyerEconomics.lines` carries all of them: the bid plus
those lines is the all-in at the ceiling. `kernelMaxBid` is the kernel's own
vehicle-relative ceiling for the same lot. The buyer's target never exceeds the
kernel's, so a discipline looser than 0.75 cannot lift the ceiling; a bidder who
genuinely pays less can still clear a higher bid than the market persona, and
the ledger names the lines that did it.

The lot has two ceilings, and the workspace shows both (SPEC 60). The same
`buyerLedger` prices the same plan and the same exit evidence for
`MARKET_PERSONA` — the marginal professional rebuilder of
`docs/salvage-economics.md` §8, with shop equipment, a direct account, a retail
exit and no cash arm — and the decision carries it as
`buyerEconomics.market` (its ceiling, its basis and its own lines) beside
`edge`, the difference between the two. Both are solved in the same place, so a
decision that carries one carries the other. A negative edge is a walk whose
first reason names both numbers: the lot could only be won above this buyer's
own ceiling, which is the winner's curse. An equal ceiling is not a walk, and a
dealbreaker still answers before any of this money does (SPEC 45). The persona
is a fixed reference point rather than a preset, so a buyer never selects it,
and a cash limit that binds below the room's price is itself a reason a bidder
cannot reach that price — a synthetic case that is not about cash states a
limit that does not bind.

Inspection and quote reviews bind to the damage scope at acceptance. Changed
damage reopens those gates. Required physical systems include structure, SRS,
powertrain and water/fire exposure, plus HV for electrified or unresolved powertrains. Equipment
does not substitute for a qualified inspection. Eligibility is evidence for
one jurisdiction and stated conditions, not a general legal inference.

Market readiness needs three usable known-title observations: completed sales
or explicitly reviewed asks. Asking-price and branded-title adjustments remain
visible assumptions. eBay Browse supplies active offers, not completed sales.
Its adapter samples the eligible price distribution rather than the highest
asks; unknown titles remain unknown and inexpensive whole vehicles are retained.

## 11. Research, lineage and autonomous recovery

The compact Eve packet contains the vehicle, buyer, gates, recent evidence,
repair hypotheses, sensitivities and offered actions. Source blobs stay in
durable evidence. The typed lineage connects source claims, repair hypotheses,
gates and decisions. It is inspectable data rather than a separate graph service.
Prioritize free identity checks, establish damage and exit, then target large
repair uncertainties. A qualified optimistic economic bound can stop further
research when the lot cannot meet buyer constraints even under favorable inputs.
This is a conditional economic rejection, not proof of physical repairability.

The assessment document and outbox share a write transaction. The dispatcher
leases work, sends an epoch/generation-scoped request, and tracks actual Eve
completion. Five delivery attempts, bounded backoff, runtime heartbeats and a
five-minute runtime lease prevent endless retry. Transport delivery is at least
once; stored receipts, serialized epoch turns and domain idempotency guard its
effects. A runtime receipt alone never proves completed research. A finished
investigation is settled separately from the work itself: if the completion
write loses a revision race, it is re-applied to the record it lost to, up to
three attempts, so a paid result is not discarded and is never billed twice.
After the third, the investigation is billed once as a failure whose detail says
the completed result could not be saved, which is a different sentence from an
investigation that was unavailable, timed out or returned invalid evidence.

An explicit watch selects source kinds, interval, deadline and refresh count.
It stops at its deadline or the listing's sale time, shares lifetime research
budgets, and preserves fresh sources it did not request. Owner stop disables
the watch. Uncertain paid work is not automatically repeated by a watch.
Current watches refresh the implemented source adapters; they do not stream
auction bids, place bids or send external notifications.

Nothing supervises a daemon. `POST /api/assessments/:id/run` commits the intent
and then makes one delivery attempt for that assessment alone, bounded to ten
seconds, so the answer reports `accepted: true` only for a session id the
runtime returned (SPEC 57). Otherwise it names why this request could not start
the work and the saved intent stays queued: `already_running` when another
claimant holds a live lease on it, `agent_unreachable` or
`agent_not_configured` when the intent is queued and unclaimed, and
`not_runnable` when the domain has nothing left to run or the epoch moved on.
The queued remainder — retries, expired leases and watch refreshes — belongs to
`agent/schedules/dispatch.ts`, an eve schedule that drains
`getAssessmentWorker().tick()` up to twenty times inside `waitUntil`, so the
cron task outlives the handler's return. The schedule has no inbound request, so
unlike a route handler it cannot fall back to a request origin: it needs
`PADDOCK_AGENT_URL` or, on Vercel, `VERCEL_URL` plus the protection bypass. It
also only sees an intent when the app and the agent share one
`ASSESSMENTS_DATABASE_URL`; a container-local copy leaves the queue it drains
empty. Vercel reads the cron expression in UTC. The default is `0 6 * * *`,
daily at 06:00, because the project runs on the Hobby plan and Hobby allows one
fire per day; `PADDOCK_DISPATCH_CRON` replaces the expression at build time, so
a Pro project sets `* * * * *` for minute granularity. The cadence never delays
the first attempt — the run route dispatches inline — but a retry, an expired
lease and a watch refresh all wait for the next fire. `eve dev` never fires
schedules at all, so local development relies on the inline dispatch
and on `pnpm agent:worker --once`, which takes one unit of work and prints the
result (`.env.local` is loaded if present). Queue status and bounded failure
messages appear in the assessment; the cause of a failed delivery is on the
server log, because the retry row records only a generic message. After retry
exhaustion, investigate the runtime before explicitly requesting another run.

## 12. Evaluation and learning from outcomes

`pnpm eval:decisions` evaluates original synthetic scenarios against literal
expectations. Cases cover a supported opportunity, insufficient cash, missing
inspection, title veto, wrong jurisdiction, future-sale leakage, unknown-title
market observations, missing equipment, an impossible surplus target, a quote
that buys out the buyer's own labor, and a bid the optimistic bound rejects
once selling costs are priced at the high exit. The
reported holdout labels reserve authored contract variants; they are not a blind
historical benchmark. Baseline columns show where shortcut decisions fail.

The actual Eve suite separately tests transport, source gathering, owner-review
boundaries, changed evidence, bounded spending and recovery after a real process
outage. This distinction follows the separation of transcript and environmental
outcome in [Anthropic's evaluation guidance](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).
The compact packet follows its [context engineering guidance](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
while keeping authority in domain code.

Outcomes record actual observation time and the earlier decision revision being
compared. A future decision cannot be used as that forecast. Fixtures and
unmatched historical records do not count as successful predictions. These
descriptive comparisons neither estimate avoided losses nor prove profit. No
model automatically retrains from an owner's unvalidated note.

Nothing is learned from a sale nobody reported, so the desk asks (SPEC 62). The
dispatch schedule's third phase — after the delivery drain and the watch
refreshes, in `src/assessment-queue/worker.ts` as `promptOutcomes` — selects the
assessments whose sale is over, whose latest decision reached a ceiling
(`readiness: 'ready'`) or a walk, and which carry no outcome yet.

Over is `saleIsOver` in `src/assessments/outcome-prompt.ts`, and it is stricter
than "in the past". A listing states a calendar day (`2026-09-06`), which parses
as that day's own midnight UTC, so a naive comparison would have the 06:00 fire
announce that the sale has passed on the morning of the sale itself. A stated
day therefore counts as over only once a full day has elapsed after that day
closed — two days from the parsed midnight — so neither the morning of the sale
nor the morning after asks, whatever timezone the yard ran on. A sale stated as
a full instant settles a day after the instant. A lot with no sale date at all,
or one nobody can parse, is never asked about. Each is asked at most once a week: `assessment_outcome_prompts` holds one
row per assessment with the time of the last ask, and
`dueOutcomePrompts(now)` skips anything asked inside
`OUTCOME_PROMPT_INTERVAL_MS`. The ask itself is an `outcome_prompt` event in the
assessment's own activity log, written by `recordActivity` under the session id
`schedule` with activity mode `no-model`, irrespective of the deployment's
coordinator setting. The activity reader also recognizes the `schedule` session
on older events, and the view labels it `schedule · no model · $0 model cost`.
Nothing leaves the deployment: no email, no push, no webhook, and no
model call — the sentence is a constant, and the phase owns its own failure so a
prompt nobody could write never costs the fire its deliveries. The workspace
reads the same event: a banner under the decision headline links to the outcome
form while an ask is unanswered, and the saved-decisions list tags such a lot
`outcome due` from a single grouped read of the log.

What the owner can answer grew with the question. A purchase records its winning
bid as `hammer` rather than as the generic `amount`, and `lost_to_hammer` is a
pass the market answered: the owner did not buy, and the price the lot made is
recorded anyway. Both kinds require the hammer, because a sale reported without
its price teaches nothing. Records written before the field existed keep their
hammer in `amount`, and the outcome summary reads `hammer ?? amount` for a
purchase. A lot the owner passed on without losing it to another bidder stays
`passed`, and `observed` remains the kind for a later observation of a lot
already accounted for.

The calibration view is what those answers add up to. `summarizeOutcomes` in
`src/assessment-reporting/outcomes.ts` reports six statistics, each over the
denominator it was read on: purchases above the recorded ceiling, the hammer
against the buyer's own ceiling and against the market persona's (both
`purchased` and `lost_to_hammer` price a lot), repair-range coverage, the repair
residual and the exit residual (SPEC 63). The exit residual compares net sale
proceeds with the same revision's typical exit minus its expected selling
costs; a missing selling line excludes that observation from this statistic
alone. Each counts one observation per
assessment — the latest matched outcome that states the figure — so a lot
reported three times is one data point rather than three. A residual is a median
and an interquartile range, because one repair that ran away moves a mean and
moves neither quartile. Below five observations a statistic prints
`too few outcomes to read (n of 5)` and no number at all. The section sits
collapsed on the workspace list (`src/ui/assessments/calibration.tsx` over the
pure projections in `calibration-format.ts`) and states what it left out:
recorded demonstrations, outcomes no earlier forecast answers, and per statistic
the matched outcomes whose forecast never held the figure to compare against.

What the view never does is decide anything. It fits nothing, proposes nothing,
calls no model, and changes no constant. Moving a tier table or the discipline
default is the procedure in `docs/salvage-economics.md` §14 — twenty distinct
lots for that tier in the relevant statistic's denominator, a residual whose
sign holds across that same sample's interquartile range, and the outcome ids
written into the constant's own basis string. The disclosure summary counts
outcome records and is not this denominator. The view does not segment by tier,
so the per-tier sample and its quartiles are read from the assessments by hand
until it does.

Real calibration requires representative completed transactions and full repair
outcomes, including failed and passed opportunities. Acquire those records with
appropriate rights, preserve their availability dates, and have automotive
experts label decision expectations before evaluating a candidate policy. Keep
policy and model versions fixed during a shadow cohort. Add supported document
or inspection adapters behind the existing validation/review seam as their
quality is demonstrated; this is how routine review can become progressively
more automated without broadening model authority.

## 13. Who the workspace is for

Its primary reader is the buyer: someone looking at a current decision, the
evidence behind it, and what changed since they last looked. Everything a
reader needs to act sits on the surface; execution detail belongs in the
expandable activity log and in this file. Recorded demonstrations are labeled
as recordings wherever they appear.

The first complete acquisition path serves an equipped enthusiast rebuilder
with DIY capacity and specialist access (§10). A supported decision is specific
to that buyer's equipment, available hours, cash commitment and registration
jurisdiction, which is why the ceiling is bidder-relative rather than a market
price. Research advances on its own within explicit limits; the buyer reviews
the physical and documentary findings the source adapters cannot establish by
themselves. Actual outcomes are compared with the forecast that was available
at the time, and synthetic demonstrations never count as measured performance
(§12).

The visual contract in `DESIGN.md` applies unchanged: dense, near-black, amber
for interaction, real vehicle photography where it belongs, aligned monetary
values, quiet borders. The search, inspection and salvage surfaces are
untouched by this workspace.

## 14. Intake: a lot the buyer brought

There is no licensed lot feed, and the server never fetches an auction or
broker page (initiative §3 D1, D3). A lot therefore arrives as three things a
buyer can copy out of the tab they already have open: the listing's text
block, the VIN, and the public `https:` photo addresses. `POST
/api/assessments` accepts `{ intake: { text, vin?, edits?, photoUrls,
listingUrl? } }` as the third member of its exactly-one union beside
`seedLotId` and `lot`. Intake reads a lot, never a bidder: the buyer profile
is the one the caller states, or the schema's default.

`src/assessments/intake.ts` owns the reading, in four passes whose order is
the invariant (SPEC 61). Its only SDK import lives in
`src/assessments/intake-caller.ts`, which holds the prompt, the tool schema and
the single call's budget and decides nothing about what a proposal means:

| Pass | What it does                                                                         | Chip source |
| ---- | ------------------------------------------------------------------------------------ | ----------- |
| R4   | `screenIntakePhotos`: every address through the probe in `src/inspector/photos.ts`   | none        |
| R1   | `parseListingText`: regexes over the pasted block; a field no rule matched is absent | `intake`    |
| R2   | `completeIntake`: an injected caller proposes only for fields still absent           | `llm`       |
| R3   | `decodeIntakeVin`: vPIC fills identity nobody stated and contradicts identity stated | `vpic`      |

The photo screen runs first at creation even though it is numbered last: a
link the server will not dereference refuses the lot, and it should refuse it
before a model call is spent on the block.

A correction the buyer types is applied before R2 and R3 and replaces the chip
of whichever pass had spoken for that field, so one field carries one chip and
the buyer's own value outranks every reading. A model proposal is discarded
when the field is already filled or when its quote is absent from the pasted
text. A decode that disagrees with the listing blocks creation with
`VIN decodes to <year make>; the listing says <year make>`; an unreachable
decode leaves the identity as typed and amends the VIN reading's own chip with
`vPIC unavailable` rather than opening a second one, because a field carries
one chip (DESIGN.md). A photo address the probe refuses blocks creation with
`photo link N is not a public https address`, by position, before anything is
saved.

Every value any pass produces goes through `coerceField`, which is where a
field's type, range and maximum length live: a capture longer than a field's
cap is refused rather than truncated, because a five-hundred-character `model`
is a paste fragment and those fields are interpolated into research topics,
triage prompts and comps queries. The lot the reading becomes is then held to
`salvageLotSchema` exactly as a caller-stated lot is, and a reading that cannot
satisfy it is refused with a fixed reason rather than an echoed validator.

`buildUserLot` then produces a `SalvageLot` whose `source` is
`user-supplied listing`, whose `url` is the listing link when one was given and
absent otherwise, and whose `notes` name which pass filled which field. The
chips are saved on the record as `lotAssumptions` and returned beside the
assessment, so the workspace shows the provenance of every value it displays.

Three dependencies are injected through the service factory
(`AssessmentServiceDeps.intake`): the `IntakeCaller`, the `VpicFetcher` and
the `PhotoProbe`. `null` disables a pass rather than defaulting it, which is
how `service.test.ts`, the HTTP tests and `pnpm eval:agent` run the whole
path offline. `POST /api/assessments/intake/preview` runs R1 to R3 and
creates nothing; the workspace calls it so the buyer can argue with the
reading before an assessment exists.

Each `Parse listing` click spends one model call — authenticated, Haiku, 1024
output tokens, a thirty-second timeout and no SDK retries (`intake-caller.ts`)
— and that call sits outside the per-assessment budget, because no assessment
exists yet to charge it to; a signed-in reader can therefore re-read a block
as often as they like. A per-owner ceiling on preview calls is the follow-up
before the deployment carries more than a couple of users (initiative §8).

Creation takes at least one photo address and at most twelve
(`INTAKE_MIN_PHOTOS`, `INTAKE_MAX_PHOTOS`, enforced by the create schema and
again by the form). A lot with no photographs cannot be triaged, and until
uploads land (§5.3 row 2.6) an address is the only way a photograph reaches
the assessment.

### 14.1 What the surfaces state

A lot the buyer brought has no page of its own, so nothing renders a link
where a listing would be. `lotProvenance` in `src/ui/assessments/format.ts` is
the one projection every surface reads: `text` (a source host, or the source
that stated the lot), `href` where there is a page to open, `day`, and whether
the lot is a recorded example. Each surface writes its own sentence around
those — `LotProvenanceLine` on the assessment header and the salvage lot
detail, `lotFooterSentence` for the run report's closing line, which the
component renders as three parts — and only `text` ever sits inside the link. The coordinator's packet
(`agent/lib/board.ts`) carries `vehicle.source`, so a model reading the board
can never mistake a typed listing for a captured page. The decision adds one
residual risk for such a lot: `Listing details were typed or pasted by the
owner and not captured from the auction page`.

The chips the reading produced are saved on the record as `lotAssumptions` and
read back under the lot header, grouped by source and without the correcting
inputs — the reading is over, and what remains is the record's own provenance.
A lot from the recorded catalog has none, and shows nothing.

Because nothing corrects a reading after it is saved, the form is the last
place it can be argued with, and two rules in
`src/ui/assessments/intake-form.ts` hold it there. `unreadFields` lists every
field no pass filled under `not stated on your listing`, each with the same
input the chips carry: `runIntake` applies an edit for any `INTAKE_FIELDS`
member, so a field with no chip would otherwise be correctable by nobody, and
`primaryDamage`, `titleBrand` and `location` are the ones a triage, a title
process and a yard state are read from. `intakeFingerprint` records the text,
the VIN and the photo addresses a reading was made from, and `createGateNote`
refuses creation until there is a reading, it can become a lot, and those three
have not moved since — a reading of text that has since changed is a reading of
another lot. The button states which of the three it is waiting for
(DESIGN.md).

The five catalog lots are labeled examples. `isRecordedLot` in
`src/salvage/seed-lot-ids.ts` is what a surface asks — ids alone, so a client
bundle that only needs the predicate does not carry the catalog's lot data;
`seed-lot-ids.test.ts` holds the two lists to each other. `USER_LOT_SOURCE`
lives in `src/assessments/lot-source.ts` for the same reason: a formatter that
compares a lot's source against it must not pull `intake.ts`, and `node:crypto`
with it, into a client bundle. `intake.ts` re-exports it. The `recorded example` tag
(DESIGN.md) sits beside the lot list on `/salvage`, the featured lot on the
showroom, and the recorded case in the workspace. The showroom's featured lot
offers `assess a lot like this`, which links to `/assessments?vin=…`; the page
reads the parameter through `prefilledVin` and hands it to the intake form as
its VIN field's initial value, opening the form. Nothing else is prefilled, and
nothing at all is unless the reader chose that action.

Uploads are deferred (initiative §5.3 row 2.6). Photos are addresses only;
no bytes are stored.
