# SPEC — invariants

Numbered, testable, and each one cites the code that implements it and the
test that would fail if it broke. If a change violates one of these, the
change is wrong, not the spec — renumber only by appending.

## Interpretation

1. **Ambiguity is never silently resolved.** A query with more than one
   defensible reading (`c7`, `mk4`, `r32`) returns one branch per reading,
   each with its own label and constraints; the UI renders them side by side
   and never auto-picks. — `src/interpret/tokenize.ts` (`tokenize` returns
   one `Branch` per reading), `src/ui/results.tsx` (`Fork`); tested in
   `src/interpret/tokenize.test.ts` ("ambiguity forks") and eval
   cases 16/19/20 (`evals/queries.jsonl`).

2. **Every inference is an explicit assumption.** Any leap from input to
   meaning ("na" → NA generation, "tt" → twin turbo trim) is recorded as
   `{source, input, meaning, reason}` and shown in the UI as a dismissible
   chip; dismissing re-runs the query without that token. —
   `src/lib/types.ts` (`Assumption`), `src/ui/chips.tsx`; tested in
   `src/interpret/tokenize.test.ts` and `src/ui/format.test.ts`
   ("assumptionChip", "queryWithout").

3. **Negations parse.** "996 no turbo" excludes turbo trims and forced
   induction; "911 no pdk" flags pdk unfilterable rather than dropping it. —
   `src/interpret/tokenize.ts`; tested in `src/interpret/tokenize.test.ts`
   ("negations") and eval cases 4/39.

4. **Unfilterable terms are surfaced, never silently dropped.** A term the
   database cannot filter on (color, transmission) becomes
   `{term, reason, forwardedToListings}` on the constraint and is forwarded
   to the eBay query when marked. — `src/lib/types.ts`
   (`Constraint.unfilterable`); tested in `src/interpret/tokenize.test.ts`
   ("spec keywords and unfilterables"), `src/enrich/ebay.test.ts`
   ("buildListingQuery"), eval cases 36/37/39.

5. **The deterministic tokenizer wins over the model.** The model interpret
   stage only fills fields the tokenizer left unset and only maps tokens the
   tokenizer left unparsed; it can never overwrite a deterministic reading. —
   `src/interpret/model.ts` (`applyPatch`); tested in
   `src/interpret/model.test.ts`.

6. **Model output is validated, and validation failure degrades softly.**
   Both model stages parse output with zod; malformed output, network
   failure, or a missing `ANTHROPIC_API_KEY` fall back to the deterministic
   path with an explicit degraded status. — `src/interpret/model.ts`,
   `src/enrich/themes.ts`; tested in `src/interpret/model.test.ts` and
   `src/enrich/themes.test.ts`.

## Resolution

7. **Never invent vehicles.** Every card is grouped from rows the SQL query
   returned; no vehicle data originates from a model. JDM-only and nonsense
   queries return zero vehicles plus an honest assumption, not a guess. —
   `src/resolve/rank.ts`; tested in `src/resolve/rank.test.ts`,
   `src/interpret/tokenize.test.ts` ("honesty"), eval cases 24/25/26/44.

8. **Knowledge and catalog coverage are checked separately.** Curated
   interpretation rules are tested independently. Public-source coverage checks
   report missing catalog rows and naming differences without inventing data
   or treating a match as proof of an engine/trim fact. —
   `src/knowledge/knowledge.test.ts`, `scripts/catalog-coverage.ts`.

9. **Ranking is explainable.** Every returned vehicle carries `reasons`
   (which constraints it matched and how) and a deterministic `score`; ties
   break stably. — `src/resolve/rank.ts`; tested in
   `src/resolve/rank.test.ts`.

## Enrichment

10. **Failure isolation.** NHTSA, complaint themes, and eBay listings run
    independently; any one failing yields a `StageStatus` with `ok: false`
    and a human-readable detail while the others render their data. A stage
    that fetched none of what it went for is one of those failures: NHTSA
    reports `ok` only while at least one year/model slice answered. —
    `src/pipeline/enrich.ts`, `src/enrich/nhtsa.ts` (`enrichNhtsa`); tested
    in `src/pipeline/enrich.test.ts` and `src/enrich/nhtsa.test.ts` ("a
    total slice loss is a failed stage").

11. **Degradation is visible, never silent.** Every non-ok `StageStatus`
    renders as one meta line naming the stage and reason, and a stage that
    partly succeeded says what it lost: NHTSA fetches one `(model, year)`
    slice at a time, so an unreachable slice is a hole in the counts and
    the detail states how many of how many went missing, whether the stage
    ends `ok` or not. —
    `src/ui/meta.tsx`, `src/ui/format.ts` (`stageNote`),
    `src/enrich/nhtsa.ts` (`fetchComplaints`, `fetchRecalls`,
    `enrichNhtsa`); tested in `src/ui/format.test.ts` ("stageNote") and
    `src/enrich/nhtsa.test.ts` ("unreachable year/model slices are counted
    in the detail, never silent").

12. **NHTSA naming is a separate, failable mapping step.** Our make/model
    names are mapped to NHTSA's via `mapToNhtsaNames`, which reports what it
    matched (provenance shown in the UI) and fails on its own without
    killing the stage's other data. — `src/enrich/nhtsa.ts`; tested in
    `src/enrich/nhtsa.test.ts` ("mapToNhtsaNames").

13. **Complaint themes are grounded.** Theme counts and ordering are
    computed from the data; the model only names component groups it was
    given, and themes for components not in the data are discarded. —
    `src/enrich/themes.ts`; tested in `src/enrich/themes.test.ts`.

14. **Listings come from the eBay Browse API and fail on their own.** The
    listings fetch is independent of NHTSA and themes; its failure degrades
    the listings section only, with a visible reason. A second listings
    source is not implemented; when one is added it must fetch independently
    and degrade independently under this rule. — `src/enrich/ebay.ts`,
    `src/pipeline/enrich.ts`; UI in `src/ui/enrichment.tsx`; tested in
    `src/enrich/ebay.test.ts` and `src/pipeline/enrich.test.ts`.

## Evals and hygiene

15. **The offline eval is deterministic and hook-gated.** `pnpm eval` runs
    tokenize → catalog resolution against the committed EPA sample with no network and
    no model, writes `evals/results.md`, and exits non-zero on any failure;
    pre-push runs it. — `evals/run.ts`, `.husky/pre-push`; scoring tested in
    `evals/score.test.ts` and the gate itself in `evals/run.test.ts`
    ("exits non-zero on a failing case", "exits zero when every case
    passes"), which runs the real script over an injected case file.

16. **Public evaluation data is independent and reproducible.** Offline
    bootstrap uses a provenance-recorded public sample or explicitly synthetic
    contract records. It never requires the original vehicle master. SPEC 64
    governs source identity and installation; SPEC 66 governs public export. —
    `scripts/ensure-eval-db.ts`, `scripts/make-subset.ts`; tested in
    `scripts/subset-spec.test.ts`, `scripts/catalog-coverage.test.ts`.

17. **Secrets are server-side only.** Every variable in `.env.example` is
    read in server code and nothing is exposed via `NEXT_PUBLIC_`;
    `.env.example` is the list, and `pnpm docs:check` fails on a literal
    `process.env.X` read under `src/`, `scripts/`, `evals/` or `agent/` whose
    name is missing from it. A variable reached through an injected `env`
    parameter is invisible to that check and is covered by the tests of the
    module doing the injecting instead. — `src/lib/db.ts`,
    `src/interpret/model.ts`, `src/enrich/themes.ts`, `src/enrich/ebay.ts`,
    `.env.example`, `scripts/check-docs.ts`; tested in
    `scripts/check-docs.test.ts` ("flags an undeclared variable once, naming
    where it is read", "exempts variables the platform sets"), for the
    injected readers, `src/auth/config.test.ts` and
    `src/assessment-http/agent.test.ts`, and for where a read may happen,
    `src/secrets.test.ts` ("no NEXT_PUBLIC_ name exists outside a comment",
    "every variable in .env.example is read from server code alone").

## UI

18. **Only DESIGN.md tokens are expressible.** Tailwind's default palette is
    wiped (`--color-*: initial`) and replaced with the DESIGN.md tokens, so
    an off-palette color cannot be written as a class: it compiles to
    nothing and paints nothing. Every `bg-`/`text-`/`border-` class under
    `src/ui` and `src/app` therefore has to name a defined token. —
    `src/app/globals.css`; contract in `DESIGN.md`; tested in
    `src/ui/tokens.test.ts` ("every color class in src/ui and src/app
    resolves to a token").

19. **Search state lives in the URL.** `/search?q=` is the query, `?v=branch.vehicle`
    the selection; malformed or out-of-range selections are ignored, and
    every state is shareable. — `src/app/search/page.tsx`, `src/ui/results.tsx`;
    tested in `src/ui/format.test.ts` ("selection round-trip").

20. **The /evals page is a viewer, not a runner.** It renders the last
    committed eval artifact (`evals/results.json`, with `evals/results.md` as the
    human-readable twin); only `pnpm eval` writes results. —
    `src/app/evals/page.tsx`, `evals/run.ts`; tested in
    `src/app/evals/page.test.ts` ("imports no runner and no writer",
    "renders the committed artifact, which is the shape it expects").

## Inspector

21. **Photo findings anchor only to photos that exist.** Vision output is a
    forced tool call validated with zod; anchor indices outside the photo set
    are dropped, and a finding that loses every anchor keeps none rather than
    being assigned one. — `src/inspector/vision.ts` (`parseVisionOutput`);
    tested in `src/inspector/vision.test.ts` ("drops photo anchors").

22. **Web research findings must cite sources.** Every finding from the
    web-search agent carries at least one http(s) source URL or it is
    discarded during validation — an uncited claim is treated as an invented
    one. — `src/inspector/research.ts` (`parseWebFindings`); tested in
    `src/inspector/research.test.ts` ("no uncited claims survive").

23. **The research plan is derived and explained.** Topics come
    deterministically from the vision findings plus curated failure data,
    each with a stated reason shown in the console; two cars with different
    photos produce different research paths. — `src/inspector/research.ts`
    (`planResearchTopics`); tested in `src/inspector/research.test.ts` and
    `src/inspector/inspector.test.ts` ("rust in the photos changes the
    research plan").

24. **Inspection stages fail independently and visibly; only vision is
    fatal.** NHTSA, web research, VIN, and market each degrade to a streamed
    `InspectStageStatus` with a reason; a missing `ANTHROPIC_API_KEY` refuses
    honestly instead of mocking an analysis. The reason is one of a fixed
    set (`failureReason`), never a caught library error's own message —
    those name request ids, endpoints and SQLSTATE, and go to the server
    log instead. The exception is an error this codebase raises with
    wording meant for the reader (`statedFailure`), which is its own
    reason. — `src/inspector/inspector.ts`, `src/agent/settle.ts`,
    `src/lib/failure.ts`; tested in
    `src/inspector/inspector.test.ts` ("stage isolation", "a model SDK error
    never reaches the stream or the fatal message") and
    `src/lib/failure.test.ts` ("a stated failure carries its own message
    through failureReason", "an SDK error is never a stated failure").

25. **The inspection is a typed event stream, report last.** The orchestrator
    is an async generator of `InspectEvent`s forwarded as NDJSON; agent
    progress (each live web search) streams while research runs. —
    `src/inspector/inspector.ts` (`inspectCarStream`), `src/agent/channel.ts`
    (`eventChannel`), `src/app/api/inspect/route.ts`; tested in
    `src/inspector/inspector.test.ts` ("web progress notes stream") and
    `src/agent/channel.test.ts`.

26. **No VIN history verdict is ever printed.** The VIN stage is structural
    decode plus claimed-vs-decoded mismatch flags; title/theft/accident
    history is stated as unchecked, never "clean". — `src/inspector/vin.ts`;
    tested in `src/inspector/vin.test.ts` ("never reports a history
    verdict").

27. **Market position comes only from real comps.** Low/median/high and the
    price rail are computed from curated real sold results (provenance and
    collection date shown); the subject listing is excluded from its own
    comps, and no comps means a visibly degraded stage, not a guess. —
    `src/inspector/market.ts`, `src/inspector/seed-listings.ts`; tested in
    `src/inspector/market.test.ts` and `src/inspector/seed-listings.test.ts`.

28. **The seed catalog is tested like code.** Every seeded listing is a real
    auction whose VIN must decode cleanly against its own claimed identity,
    whose photos are https, and whose comps resolve. —
    `src/inspector/seed-listings.ts`; tested in
    `src/inspector/seed-listings.test.ts`.

29. **Photo intake is bounded at both ends.** Uploaded photos ride the
    request as base64, are size-capped, never touch disk, and the report
    carries only a photo count. A photo URL is https, and the pre-flight
    probe — the one place the server dereferences a caller-supplied URL —
    refuses it unless every address its host resolves to is public
    (loopback, link-local, private and unspecified ranges are refused);
    redirects are followed by hand, capped, and each hop is screened again.
    — `src/app/api/inspect/route.ts`, `src/inspector/types.ts`
    (`InspectorReport`), `src/inspector/photos.ts` (`createPhotoProbe`,
    `isPublicAddress`); tested in `src/inspector/inspector.test.ts` ("never
    echoes photo bytes") and `src/inspector/photos.test.ts` ("refuses an
    http url without dereferencing it", "refuses a host that resolves to the
    metadata endpoint", "screens every redirect hop, so a public host cannot
    hand off a private one", "a public https host with a 200 HEAD is
    alive").

## Runs and tracing

30. **Runs are detached and refresh-safe.** A run executes server-side,
    independent of any HTTP response; events get gapless sequence numbers
    and persist as they happen, so a client that refreshes (or joins late)
    replays from any cursor and then tails live. On serverless the
    starting route hands the run's completion promise to `after()` so the
    instance stays alive until the run finalizes, bounded by
    `maxDuration`; a stream or record read served by an instance that does
    not hold the run tails the store instead, and such a run is only
    reconciled to `error` once it is older than any run could be. —
    `src/runs/manager.ts` (`startRun`, `runCompletion`, `streamRun`,
    `reconcileInterrupted`),
    `src/runs/store.ts`, `src/app/api/inspect/route.ts`,
    `/api/runs/[id]/stream`; tested in `src/runs/manager.test.ts` ("the
    refresh case", "resumes from a cursor", "runCompletion settles", "runs
    owned by another instance"), `src/runs/store.test.ts`, one contract
    over the memory store and an in-memory libSQL on every run and over
    Postgres where `POSTGRES_TEST_URL` names one (a service container in
    CI), and the route tests
    `src/app/api/runs/[id]/stream/route.test.ts` ("frames one envelope per
    line as NDJSON that never buffers", "?from= resumes at a cursor instead
    of replaying the whole run") and `src/app/api/inspect/route.test.ts`
    ("hands the run completion to after() so the instance outlives the
    response").

31. **Persistence degrades visibly, never fatally.** The run store is
    Postgres when reachable, else the libSQL vehicle database when it
    answers (Turso in production, so hosted runs survive across serverless
    instances with no extra infrastructure), else the in-memory store; a
    store failure mid-run degrades persistence without touching the
    stream. Every run's first event states whether it is persisted, and
    the UI renders one meta line when it is not. —
    `src/runs/resolve-store.ts` (`resolveRunStore`, `libsqlAvailable`),
    `src/runs/libsql-store.ts`, `src/runs/manager.ts` (`run-meta`); tested
    in `src/runs/manager.test.ts` ("degraded persistence"),
    `src/runs/resolve-store.test.ts` ("falls to memory when neither
    answers, and says it is not persistent") and `src/runs/store.test.ts`,
    the one contract all three stores pass — memory and libSQL on every
    run, Postgres where `POSTGRES_TEST_URL` names a database: a service
    container in CI, `pnpm db:up` locally.

32. **Every stage and model/fetch call is a traced span on the event
    stream.** Spans carry wall-clock timings (and attrs like photo/topic
    counts), ride the same persisted stream as everything else, and the
    trace view is a pure projection of them. `begin` events precede stage
    statuses so the stage rail can never lie. — `src/trace/tracer.ts`,
    `src/inspector/inspector.ts`; tested in `src/trace/tracer.test.ts`,
    `src/inspector/inspector.test.ts` ("begin events and trace spans"), and
    eval checks `spans-streamed` / `begin-precedes-status`.

33. **The federal decode is real and its absence is stated.** VINs decode
    against NHTSA vPIC when reachable (identity mismatches cite the federal
    database and force `avoid`); when unreachable, the structural decode
    stands and the note says so. Provenance sightings obey the citation
    rule (SPEC 22) and exclude the subject listing. —
    `src/inspector/vin.ts`, `src/inspector/research.ts` (`runVinSweep`),
    `src/agent/vin-stage.ts` (`runVinStage`, `mergeVpic`); tested in
    `src/inspector/vin.test.ts`,
    `src/inspector/inspector.test.ts` ("vPIC federal decode", "VIN
    provenance sweep").

## Salvage

34. **The salvage lot catalog is tested like code.** Every seeded lot is a
    real Copart auction from a licensed broker's public listing: the VIN
    must decode cleanly against the claimed identity, photos are https on
    the Copart CDN, and provenance (source URL, collection date) is
    complete. Unknown facts are stated as unknown, never invented. —
    `src/salvage/seed-lots.ts`; tested in `src/salvage/seed-lots.test.ts`.

35. **The build plan states every split and its reason.** Repair tasks are
    derived deterministically from the triage plus curated construction
    knowledge; each task says whether it is DIY or professional and why,
    and structural work on carbon/aluminum platforms can never be DIY. —
    `src/salvage/repair-lines.ts`, `src/salvage/repair-plan.ts`; tested in
    `src/salvage/assess.test.ts` ("splits DIY from professional").

36. **Every ledger line carries its basis, and dealbreakers beat
    economics.** Fees cite the schedule date, repair lines cite the tier
    table, a model override, or the cited price behind them, the exit is
    either classified comps or a labeled ACV-derived band — and a
    non-repairable title forces `walk` regardless of the money. —
    `src/salvage/fees.ts`, `src/salvage/ceiling.ts`,
    `src/salvage/assess.ts`; tested in `src/salvage/ceiling.test.ts`
    ("solves ceiling, break-even, and stress consistently") and
    `src/salvage/assess.test.ts` ("non-repairable Huracán walks regardless
    of money").

## Knowledge compilation

37. **Generation boundaries require independent evidence.** Public family
    discovery is sourced from EPA identities; optional generation and facelift
    windows need independently reviewed citations. An empty generation array
    preserves family discovery and reports missing research without narrowing
    years. The optional paid compiler writes an ignored candidate artifact for
    review, never overwrites the public catalog during setup. —
    `scripts/compile-generations.ts`, `data/public-generations.json`,
    `src/knowledge/generation-catalog.ts`, `src/interpret/tokenize.ts`;
    tested in `src/knowledge/generation-catalog.test.ts` and
    `src/interpret/tokenize.test.ts`.

## Salvage economics

38. **The exit is selected from classified comps, never from a min/max
    sweep.** Comps arrive typed (lane, outcome, price, model year, date,
    title, variant); the selection strikes what is not this car at
    transacted money (branded titles in the clean lane, model years outside
    the window, off-spec variants, stale sales, outliers by MAD), states the
    reason on every struck comp, and derives low/typical/high from the
    quartiles of what remains; asks are haircut to sold money and join a
    thin sold pool. Rungs, best evidence first and each labeled: rebuilt-
    title sold comps, clean sold comps × the tier discount band, clean asks
    × the band, the listing's stated ACV × the band; none means no exit,
    never a guess. — `src/salvage/exit.ts` (`selectExit`); tested in
    `src/salvage/exit.test.ts` ("clean sold comps derive the band",
    "outlier is struck", "no ACV means no exit").

39. **The ceiling is solved, and a zero ceiling names its killers.** The
    bid ceiling is the highest $500 step whose all-in (bid + bid-dependent
    fees + fixed fees + transport + repairs at expected + hidden-damage
    contingency + title process + selling costs) stays at or under 75% of
    the low exit; break-even is the same solve at 100%; stress reprices
    every repair at its high. When nothing clears, the ledger lists the
    largest lines whose removal would turn it positive and the required
    value of each input holding the rest at expected; the summary names
    them. The wreck market is shown beside the ceiling and never enters the
    solve. — `src/salvage/ceiling.ts` (`buildLedger`, `solveMaxBid`),
    `src/salvage/assess.ts` (`synthesizeSalvage`); tested in
    `src/salvage/ceiling.test.ts` ("solves ceiling, break-even, and
    stress", "zero ceiling names its killers") and
    `src/salvage/assess.test.ts` ("zero ceiling that names its killers").

## Auth

40. **Hosted deployments are gated and fail closed.** Every route except
    `/login`, `/api/auth/*`, `/eve/v1/*`, and static assets requires a valid
    session; unauthenticated API calls get 401 JSON and pages redirect to
    `/login?next=<same-origin path>`. The eve service is excepted because it
    carries its own fail-closed gate: `bridgeAuth` refuses any bridge route
    that does not present the bridge credential and the owner scope, and only
    the framework's health route is public, by eve's contract. The session
    gate's exclusions and the proxy matcher's are one list. When `VERCEL_ENV`
    is set and `AUTH_USERS`/`AUTH_SECRET` are missing, short, or malformed,
    every request answers 503 with the reason instead of running open; local
    dev with neither variable set is open. — `src/proxy.ts`,
    `src/auth/authorize.ts` (`authorize`, `isPublicPath`, `safeNext`),
    `src/auth/config.ts` (`readAuthConfig`), `agent/lib/auth.ts`
    (`bridgeAuth`); tested in `src/auth/authorize.test.ts` ("agrees with every
    exclusion in the proxy matcher (docs/auth.md §2)", "matches the login
    surface, static assets and the eve service only") and
    `src/auth/config.test.ts`.

41. **Credentials are hashed and sessions are signed; secrets never leak.**
    Passwords are verified against scrypt hashes with a constant-time
    comparison and are never stored or logged in clear; sessions are
    HMAC-SHA256 tokens verified with WebCrypto in constant time, carried in
    an `HttpOnly`, `SameSite=Lax`, `Secure` (production) cookie, and expire
    server-side by their signed timestamp. Rotating `AUTH_SECRET` signs
    everyone out. Logging out replaces the cookie with the same name, path
    and flags, because a browser treats a mismatch as a second cookie
    rather than a replacement. — `src/auth/credentials.ts` (`hashPassword`,
    `verifyPassword`), `src/auth/session.ts` (`signSession`,
    `verifySession`), `src/app/api/auth/login/route.ts`,
    `src/app/api/auth/logout/route.ts`; tested in
    `src/auth/credentials.test.ts`, `src/auth/session.test.ts`,
    `src/app/api/auth/login/route.test.ts` ("sets a signed HttpOnly,
    SameSite=Lax session cookie scoped to the site") and
    `src/app/api/auth/logout/route.test.ts` ("clears the session cookie
    with the attributes login set, in either environment").

42. **Login failures are generic, slow, and rate-limited.** A wrong user or
    password yields the same message after a fixed delay; more than ten
    failures per fifteen minutes per IP or per username answers 429 with
    `Retry-After`; a successful login resets both counters. The IP key is
    the platform-set `x-vercel-forwarded-for`, never a header the caller
    can choose, and both limiter maps are bounded — expired windows are
    swept on every hit, with oldest-first eviction at `MAX_KEYS` behind
    that. Redirect targets are sanitized to same-origin paths so the login
    flow cannot be used as an open redirect. —
    `src/app/api/auth/login/route.ts` (`clientIp`), `src/auth/rate-limit.ts`
    (`createRateLimiter`), `src/auth/authorize.ts` (`safeNext`); tested in
    `src/auth/rate-limit.test.ts` ("sweeps windows that have expired instead
    of keeping every key seen", "caps the key count, evicting the oldest
    window first"), `src/app/api/auth/login/route.test.ts` ("a spoofed
    x-forwarded-for does not reset the counter") and
    `src/auth/authorize.test.ts` ("safeNext").

## The bid ceiling

43. **One damage event is priced once.** Triage zones fold into repair
    programs (front, rear, a side, roof/glass, interior, underbody, wheels,
    electrical, SRS, flood) plus one paint program and the platform
    baseline; a program carries at most one structural line, priced at its
    worst zone's severity with a stated increment per additional heavy
    zone, and paint is one respray program across every refinished zone.
    Three heavy front zones are one front program. —
    `src/salvage/repair-plan.ts` (`deriveRepairPlan`),
    `src/salvage/programs.ts` (`programForArea`);
    tested in `src/salvage/knowledge.test.ts` ("three heavy structural
    front zones become ONE front program") and `src/salvage/assess.test.ts`
    ("three front zones are ONE front program").

44. **Money enters through structured fields, never regex over prose.**
    Research workers report typed comps and typed prices through forced
    tool calls; an entry without a numeric price or an http(s) source is
    dropped in the parser, each worker's asked lane or line is stamped over
    the model's echo, and a retail figure written into a wreck comp's note
    cannot become its price. Evidence is then screened by what it IS: a
    salvage-auction listing is wreck evidence whatever lane it was filed
    under, and an off-spec, aftermarket, comparison, warranty, structure-
    under-panels, or duplicate price is set aside with its reason and never
    summed; a cited parts sum lifts a line to at most 1.5× its curated high.
    Every cost line and every comp carries its basis and source. —
    `src/salvage/research.ts` (`parseComps`, `parsePrices`),
    `src/salvage/variants.ts` (`effectiveLane`, `offSpec`),
    `src/salvage/evidence.ts` (`screenPriceEvidence`), `src/salvage/comps.ts`;
    tested in `src/salvage/research.test.ts` ("comps parse one at a time",
    "a retail value written into a wreck comp cannot bleed"),
    `src/salvage/exit.test.ts` ("filed as \"rebuilt sold\" is wreck
    evidence"), `src/salvage/knowledge.test.ts` ("set aside, never summed",
    "at most 1.5× its curated high"), and the salvage suite checks
    `wreck-max`, `wreck-min`, `panels-max` (`evals/salvage/suite.ts`).

45. **The verdict is bid or no bid; the wreck market is context.** A
    salvage assessment resolves to `build` (a positive ceiling and no
    dealbreaker) or `walk`; a non-repairable title, fire, heavy structural
    damage on a carbon tub, or a parts-car triage forces `walk` regardless
    of the money, and the money never argues back. What lots like this
    hammer for is shown as context and never flips the verdict. —
    `src/salvage/assess.ts` (`synthesizeSalvage`); tested in
    `src/salvage/assess.test.ts` ("non-repairable Huracán walks regardless
    of money") and the salvage suite check `wreck-is-context`
    (`evals/salvage/suite.ts`).

## Persistent agent assessments

46. **Assessment state outlives an agent session.** Assessments, accepted
    evidence, investigation outcomes and decision revisions persist separately
    from Eve state. Updates check the expected revision; duplicate operations
    cannot spend twice or append duplicate evidence. — `src/assessments/service.ts`,
    `src/assessments/store.ts`; tested in `src/assessments/service.test.ts`
    ("imports seed input idempotently and scopes every operation to its owner
    (SPEC 46)", "reserves concurrent work exactly once and returns its pending
    record on retries") and `src/assessments/store.test.ts` ("isolates owners,
    rejects changed creation replays, and returns detached snapshots", "allows
    one competing update and preserves the winning revision", "reopens a
    separate assessment database with decision history, evidence and
    reservations intact").

47. **An investigation cannot broaden its authority.** Only investigations
    offered by the current assessment may execute. Identity and evidence
    applicability, remaining budget and terminal conditions are enforced in
    domain code. An unresolved identity conflict prevents an actionable bid
    recommendation. — `src/assessments/decision.ts`, `src/assessments/validation.ts`;
    tested with stale work, wrong-vehicle evidence, conflicting identity and
    exhausted budgets in `src/assessments/service.test.ts` ("validates manual
    lots and refuses fixture evidence for a different car (SPEC 47)",
    "preserves unverified stale observations and refuses to price them",
    "stopping pending work discards late completion and never resurrects the
    assessment") and `src/assessments/adapters.test.ts` ("captures federal
    model identity contradictions but never supplies a title-history verdict",
    "does not assign a different returned VIN to the requested vehicle").

48. **Every agent result states how it was obtained.** Fixture evidence and
    fixture-model runs are labeled and never masquerade as live observations.
    Offline agent evals run without provider credentials; live-coordinator evals
    have explicit call/token bounds and reuse local evidence. — `agent/agent.ts`,
    `scripts/agent-eval.ts`; tested through the real authored runtime entrypoint
    in `evals/agent/contracts.test.ts` ("defaults to a fixture and requires
    every live switch"), `evals/agent/provider-budget.test.ts` ("atomically
    admits at most twelve provider attempts per durable session") and
    `evals/agent/policy.test.ts` ("does not invent authority or call an
    unavailable capability").

49. **Only the owner can operate an assessment.** App routes resolve the
    authenticated owner from its signed session, and the app bridge asserts
    that owner, assessment and evidence epoch on every agent session request,
    where `bridgeAuth` turns them into the session principal or refuses the
    request. Model tool arguments never supply authority. —
    `src/assessment-http/handlers.ts`, `src/assessment-http/agent.ts`,
    `agent/lib/auth.ts` (`bridgeAuth`); tested at the HTTP and tool boundaries
    in `src/assessment-http/handlers.test.ts`, `src/assessment-http/auth.test.ts`,
    `src/assessment-http/agent.test.ts` ("starts a session with the owner,
    epoch and delivery scope, then records the receipt"), and
    `evals/agent/contracts.test.ts` ("answers 403 for another owner, an unknown
    assessment and a superseded epoch", "returns exactly the assessment
    principal the tools already read").

50. **A bid belongs to a specific buyer.** How the bidder reaches the auction
    (broker or a direct licensed account), how they expect to exit (private
    party, wholesale, retail, or keeping the car), the discipline share they
    hold, their tools, workspace, lift, diagnostics, specialist access, frame
    rack, paint booth, alignment rack and high-voltage tooling, available time,
    labor opportunity cost, holding costs, all-in affordability and required
    surplus constrain the recommendation. The equipment gate binds only on a
    plan that carries DIY lines needing equipment: no curated plan does, since
    every equipment-bearing line is already professional for every bidder
    (SPEC 35), so the conversion is pinned on a fixture line rather than on a
    curated one. Three presets — hobbyist, independent
    shop, dealer — supply those inputs as explicit assumptions and never as
    facts; a profile whose values diverge from every preset is `custom`, and a
    record saved before a field existed reads back with that field's default
    rather than being rewritten. Cash affordability
    excludes sale-time selling costs, which are paid from proceeds. Only owner
    review moves the buyer's own work to a shop: a reviewed whole-job quote on
    a DIY line converts it to professional work and its hours leave the labor
    line, while a shop quote that is unreviewed, or reviewed under an earlier
    damage scope, is held out of the estimate and named as a residual risk.
    Registration eligibility applies to the buyer's explicitly selected
    jurisdiction; an unspecified jurisdiction cannot pass that gate. — `src/assessments/buyer-profile.ts`, `src/assessments/buyer-ledger.ts`, `src/assessments/decision.ts`, `src/assessments/service.ts`, `src/assessments/store.ts`, `src/ui/assessments/buyer-form.ts`;
    tested in `src/assessments/decision.test.ts` ("a reviewed quote on a DIY
    line converts it to professional and drops its hours", "an unreviewed shop
    quote on a DIY line does not raise the line or the ceiling", "a DIY shop
    quote whose review scope is stale is deferred, not priced", "the best-case
    bound prices selling costs at the high exit", "cash affordability excludes
    selling costs"), `src/assessments/buyer-profile.test.ts` ("every preset is
    a profile the server accepts", "names the preset a profile matches and
    calls any change custom", "fills a record saved before the profile learned
    who is bidding", "names a record from its values, never from the label the
    record carries", "names the preset a custom profile is nearest to, and the
    wedge on a tie", "defaults a legacy payload and bounds discipline"),
    `src/assessments/store.test.ts` ("reads a record saved before the buyer
    profile learned who is bidding") and
    `src/ui/assessments/buyer-form.test.ts` ("reads access, exit, discipline
    and the equipment the form collects", "names the preset the fields describe
    and calls one changed field custom", "a typed state does not move the
    selector off the preset the values describe", "chips every preset value the
    buyer has not changed, and no others", "keeps chipping a saved profile that
    diverges in one field") and `src/assessments/buyer-ledger.test.ts` ("a buyer
    without a booth buys the paint line, at the shop price and with the
    reason").

51. **Review can close an evidence gap but cannot manufacture a fact.** An
    owner can record an auditable acceptance of applicable source-backed
    inspection, title, registration and price evidence. Models cannot grant
    that acceptance. Stale observations, invalid identity, model inference and
    unresolved contradictions cannot become physical or legal verification.
    — `src/assessments/validation.ts`, `src/assessments/service.ts`; tested in
    `src/assessments/decision.test.ts` ("audits an owner review and refuses
    cross-owner and stale-revision review", "does not turn supplied documents
    or photo inference into a physical inspection", "refuses owner promotion of
    wrong-vehicle, stale, invalid identity or model-only inspection evidence")
    and `src/assessment-http/handlers.test.ts` ("does not let a review payload
    nominate its own reviewer or accept model inference").

52. **Research serves the next decision.** Offered investigations expose their
    expected decision impact, source dependencies and execution allowance.
    Fresh identity and damage evidence survive a market refresh; lifetime
    budgets survive every refresh. A ready decision or demonstrated economic
    rejection stops unnecessary work. — `src/assessments/decision.ts`,
    `agent/lib/board.ts`; tested in `src/assessments/decision.test.ts` ("a
    refreshed ready case waits for new evidence and preserves the lifetime
    budget", "a material repair change reopens prior inspection and quote
    scope", "expiry on a plain read retracts a ready ceiling, without an
    explicit refresh").

53. **Market evidence preserves what was observed.** Active asks are not sold
    prices; omitted title status stays unknown. Deterministic source selection
    cannot cherry-pick the most expensive listings. A listing that does not
    declare a fixed price is not an ask and is excluded, and a whole-vehicle
    price floor screens the ask lanes of exotic and premium lots so parts
    money cannot enter the pool as a car — a damaged listing under the floor
    is wreck evidence and survives. The floor is a function of tier and model
    year, read against the collection date and stated with its band: an exotic
    carries it at any age, a premium lot through twenty model years at a
    falling amount, a mainstream lot never; a model year or a collection date
    the screen cannot read as a year takes the strictest band rather than the
    loosest, so it fails closed. What the counted screens dropped is reported
    beside what survived them, per screen and in the order they run. Captured artifacts, extraction and
    model inference have distinct provenance. — `src/salvage/comps.ts`,
    `src/assessments/adapters.ts`; tested in `src/salvage/comps.test.ts`
    ("excludes an item that does not declare FIXED_PRICE", "excludes an
    AUCTION item: a current bid is not a fixed asking price", "applies the
    whole-vehicle floor to exotic and premium tiers", "the whole-vehicle floor
    states its tier and its age band", "an old premium car is a whole car
    under $10,000: a 2003 330i and a 2006 IS survive", "a recent premium car
    keeps the $10,000 floor: a 2021 M3 at $6,500 is parts money", "the premium
    floor is $4,000 between thirteen and twenty model years", "an exotic
    carries the whole-vehicle floor at any model year", "a sub-floor damaged
    listing on a premium lot survives into the wreck lane", "a sub-floor
    clean-titled listing on a premium lot is excluded", "keeps a cheap
    mainstream whole car", "an unreadable model year or clock takes the
    strictest band: the screen fails closed", "a collection date that carries
    a time reads its calendar year", "the progress note counts the listings
    the screens dropped"), `src/assessments/adapters.test.ts`, and the salvage
    suite
    checks `comps-fixed-price-only`, `comps-whole-car` and `comps-progress`
    (`evals/salvage/suite.ts`).

54. **Saved research intent survives delivery failure.** Durable dispatch is
    committed with assessment state. Leases, retry limits, epochs and domain
    budgets constrain recovery; a stopped assessment cannot be resurrected by
    an old job. Watches are explicit, bounded and selective. —
    `src/assessments/store.ts`, `src/assessment-queue/`; tested in
    `src/assessment-queue/queue.test.ts` ("commits the document and intent
    atomically, including failed creation and failed CAS", "lets one worker
    lease an intent, and old acknowledgements cannot resurrect a stopped
    epoch", "bounds repeated runtime outages without endless reruns", "watches
    require opt-in, bounded policy and ownership; owner stop disables them
    atomically") and `src/assessments/store.test.ts` ("reopens a separate
    assessment database with decision history, evidence and reservations
    intact").

55. **Agent evaluation measures saved decisions.** Independent scenario
    expectations, evidence availability dates and provenance accompany decision
    cohorts. Runtime tests exercise the authored Eve transport and tools.
    Synthetic success never claims historical appraisal accuracy; observed
    outcomes remain separate from the evidence available at decision time.
    — `scripts/agent-eval.ts`, `evals/agent/`; tested in
    `evals/agent/decision-cohort.test.ts` ("meets independent positive,
    rejection and abstention expectations without spending provider tokens")
    and `evals/agent/epoch.test.ts` ("rejects all old-epoch capabilities even
    when the model supplies a fresh revision and action"). The bidder-relative
    cases are `broker-vs-direct`, `private-party-vs-retail`, `keep-not-sell`,
    `no-edge-walk`, `edge-positive-build` and `state-title-process` in
    `evals/agent/decision-cohort.ts`, and the runtime case that reads both
    ceilings off a decision the real runtime saved is
    `shop-preset-carries-market-and-edge`; what each one pins is stated in
    `docs/testing-and-evals.md` §3.5.

56. **Self-attested numbers are labeled and never satisfy a gate alone.** A
    number the owner typed carries user provenance: the server strips any
    client-supplied observation, artifact, extraction and basis, so review binds
    the owner's rationale to an https source instead of to a capture. Such a
    record reads `self-attested` in the evidence list and in decision lineage,
    every self-attested number the arithmetic used is counted in the residual
    risks, and the market gate requires at least one captured source among the
    qualified comparables the exit uses. — `src/assessments/validation.ts`,
    `src/assessments/service.ts`, `src/assessments/decision.ts`; tested in
    `src/assessments/service.test.ts` ("strips client-supplied observations and
    artifacts from user evidence", "review accepts a self-attested price with an
    https source and no artifact", "refuses to review a self-attested
    comparable behind a plaintext source"), `src/assessments/decision.test.ts`
    ("three reviewed self-attested comps do not satisfy the market gate", "two
    captured comps plus one reviewed self-attested comp satisfy the market
    gate", "labels a self-attested claim as self-attested in the decision
    lineage", "counts a self-attested comparable the exit used from the fallback
    pool"), and the `self-attested-market` case in
    `evals/agent/decision-cohort.ts`.

57. **A run is never reported as accepted when nothing can execute it.** The run
    route commits the intent, then performs one bounded delivery attempt for
    that assessment alone and reports `accepted` only for a received session id;
    otherwise it answers a `reason` and leaves the saved intent to the
    deployment's schedule, which retries intents and refreshes watches in place
    of a separate daemon. — `src/assessment-http/handlers.ts`,
    `src/assessment-queue/worker.ts`, `agent/schedules/dispatch.ts`; tested in
    `src/assessment-http/handlers.test.ts` ("run answers accepted:false with
    agent_unreachable when dispatch fails and keeps the intent", "run answers
    accepted:true after a successful inline dispatch", "run answers
    accepted:false with already_running while a live lease holds the intent"),
    `src/assessment-queue/worker.test.ts` ("tickFor dispatches only the named
    assessment", "tick returns idle when nothing is claimable"), and the
    `inline-run-dispatches-and-accepts` case in `scripts/agent-eval.ts`.

58. **No buyer input raises the ceiling above the kernel's for the buyer's own
    fee mode and exit channel.** The buyer's target is the least of their
    discipline share, the low exit minus their required surplus, and the
    kernel's own disciplined target; labor, holding, the cash limit, the
    required surplus and the discipline share only lower the ceiling, and every
    buyer field is schema-bounded non-negative. Access, exit channel and
    jurisdiction select which kernel lines apply rather than loosening the
    target, each selected line stating its basis, so a bidder who genuinely
    pays fewer charges — a licensed account, a car that is never sold — clears
    a higher bid than the market persona while the kernel's own lines never
    change. The ledger records which of the four arms produced the ceiling, so
    a sentence quoting the ceiling names a binding cash limit rather than the
    margin that limit left intact beneath it. —
    `src/assessments/buyer-ledger.ts`, `src/assessments/validation.ts`
    (`buyerProfileSchema`), `src/salvage/ceiling.ts` (`solveMaxBid`),
    `src/assessments/decision.ts`; tested in
    `src/assessments/decision.test.ts` ("no buyer profile can raise the ceiling
    above the kernel's for the same fee mode and exit channel", "a cash-bound
    ceiling below the room’s price is a walk that names both numbers"),
    `src/assessments/buyer-ledger.test.ts` ("a profile
    that assumes what the kernel assumes reproduces the kernel exactly",
    "discipline tightens the ceiling and can never loosen it past the kernel
    (SPEC 58)", "the ceiling names the arm that bound it, and a cash limit is
    one of them", "no buyer input edits the kernel: same inputs and ledger
    before and after") and `evals/agent/decision-cohort.test.ts` ("prices one lot for
    three bidders: fee mode, exit channel, and a car that is never sold"),
    which pins $151,000 for the kernel, $157,000 for a direct licensed account,
    $140,000 for a retail exit and $162,000 for a car that is never sold on one
    lot.

59. **Every buyer-side ledger line carries its basis, and the kernel stays
    vehicle-relative.** Fee mode, exit channel, title process, discipline and
    capability conversions are applied by the buyer layer over the kernel's
    plan and cost lines; every line it adds or changes states its basis and
    reads `derived`, and the kernel's own lines are unchanged by any buyer
    input. A DIY line whose equipment the buyer does not own is bought at the
    tier's shop rate and its hours leave the labor line, while professional
    work is never handed back (SPEC 35); a stated jurisdiction replaces the
    national title band and an untabulated one keeps it untouched; a channel
    other than the private sale the tier already prices replaces the selling
    band, and a car that is not for sale carries a zero selling line saying so. —
    `src/assessments/buyer-ledger.ts`, `src/salvage/fees.ts`,
    `src/salvage/exit-channels.ts`, `src/salvage/title-process.ts`; tested in
    `src/assessments/buyer-ledger.test.ts` ("a profile that assumes what the
    kernel assumes reproduces the kernel exactly", "no buyer input edits the
    kernel: same inputs and ledger before and after", "three presets bid three
    different ceilings on one lot, every line with a basis", "a buyer without a
    booth buys the paint line, at the shop price and with the reason", "a
    capability gate never hands professional work back to the buyer (SPEC 35)",
    "direct access drops the broker lines and lifts what this buyer can pay",
    "wholesale lowers the exit and charges the lane its own seller costs",
    "a car that is never sold carries a zero selling line, and says so",
    "a tabulated state replaces the title line; an untabulated one keeps the
    kernel band",
    "discipline tightens the ceiling and can never loosen it past the kernel
    (SPEC 58)"), `src/salvage/fees.test.ts` ("direct access omits the broker
    percentage line; broker keeps it", "direct access omits the Copart broker
    charge from the flat total"), `src/salvage/title-process.test.ts` ("a
    tabulated state returns its own range, named and sourced", "an untabulated
    state falls back to the tier default and says so") and
    `evals/agent/decision-cohort.test.ts` ("prices one lot for three bidders:
    fee mode, exit channel, and a car that is never sold").

60. **The ceiling is bidder-relative and both ceilings are shown.** A decision
    carries this buyer's ceiling and the market persona's on the same plan, the
    same exit evidence and the same solver: the marginal professional rebuilder
    of docs/salvage-economics.md §8 — shop equipment, a direct licensed
    account, a retail exit, the kernel's discipline, and no cash arm, because
    the room's price is set by capitalized shops. Their difference is the edge,
    and when it is negative the verdict is a walk whose first reason names both
    numbers, because the lot could only be won above this buyer's own ceiling; an
    equal ceiling is not a walk. The persona is a documented reference point,
    never a preset a buyer can select, and it never turns a dealbreaker: a veto
    answers before any money does (SPEC 45). A stored decision short of a field
    the current one carries — the persona's ceiling, the buyer's lines, the arm
    that bound the bid — is projected again on read, at the record's own time
    and without rewriting the row, so a saved decision satisfies its own type
    once read; every projection states an absence rather than reading through
    it. —
    `src/assessments/buyer-profile.ts` (`MARKET_PERSONA`),
    `src/assessments/buyer-ledger.ts`, `src/assessments/decision.ts`,
    `src/assessments/service.ts`,
    `src/ui/assessments/format.ts`, `src/ui/assessments/decision-headline.tsx`;
    tested in `src/assessments/buyer-ledger.test.ts` ("the market persona prices
    the same lot for the room, and the hobbyist has no edge on it", "a shop with
    a retail exit and no cash arm is the market persona: the edge is zero"),
    `src/assessments/buyer-profile.test.ts` ("the market persona is the shop
    preset selling retail with no cash arm, and is never a preset"),
    `src/assessments/decision.test.ts` ("a cash-bound ceiling below the
    room’s price is a walk that names both numbers", "a dealbreaker still
    beats the edge (SPEC 45)"), `src/assessments/store.test.ts` ("re-projects a
    decision saved before the ceiling became bidder-relative, without rewriting
    it"), `src/ui/assessments/format.test.ts` ("states the
    two ceilings and the edge between them (SPEC 60)", "reads a negative edge as
    the optimist in the room, and an equal one as neither", "reads a decision
    saved before the ceiling became bidder-relative", "summarizes a ledger
    with its money and hides the lines that cost nothing") and
    `evals/agent/decision-cohort.test.ts` ("two ceilings on one lot: the wedge
    has no edge on it, and a shop that keeps the car does"), which pins
    $144,500 for the persona against $0 for the hobbyist preset and $167,000 for
    a shop that never sells the car on one lot.

61. **A user-supplied lot is parsed, never fetched, and every inference is a
    chip.** Intake reads only what the buyer pasted or typed: the listing text,
    the VIN, and public https photo addresses. The listing URL is provenance the
    server keeps and never dereferences, and `SalvageLot.url` is absent on a lot
    brought without one, which every reader states rather than reads through.
    Deterministic extraction wins: a model proposal for a field the regex pass
    already read is discarded, as is one whose quote is absent from the pasted
    text, and an absent key skips the step with a visible note. vPIC supplies
    identity nobody typed and blocks a lot whose stated identity it contradicts;
    an unreachable decode leaves the identity as typed and says so. Every photo
    address is screened through the request-forgery boundary (SPEC 29) before
    the lot exists, and a refused address refuses the lot by position. The lot
    records its provenance: `source` is `user-supplied listing`, its notes name
    which pass filled which field, and the chips behind every field are saved
    with it and returned to the workspace, where a correction the buyer types is
    their own value and outranks every pass; a field carries one chip, so an
    unreachable decode amends the VIN reading's own rather than opening a
    second. Every field intake knows is correctable, including one no pass
    filled and which therefore carries no chip, and creation follows a reading
    of the listing as it stands: a listing never read, a reading that cannot
    become a lot, and a reading whose text, VIN or photo addresses have changed
    since each leave `Create assessment` closed with the reason stated. The lot a reading becomes is held to `salvageLotSchema` before it
    is saved, and each field it carries is capped at a length past which a
    capture is a paste fragment rather than a value. That provenance is stated
    wherever the lot is read: a surface shows `user-supplied listing` with the
    day it was collected where a source link would be, the saved chips are read
    back on the assessment without their correcting inputs, the decision carries
    `Listing details were typed or pasted by the owner and not captured from the auction page`
    as a residual risk, and the coordinator's packet names the lot's source, so
    a model can never read a typed listing as a captured page. —
    `src/assessments/intake.ts`, `src/assessments/intake-caller.ts`,
    `src/assessments/validation.ts`,
    `src/assessments/service.ts`, `src/assessment-http/handlers.ts`,
    `src/app/api/assessments/route.ts`,
    `src/app/api/assessments/intake/preview/route.ts`,
    `src/ui/assessments/intake-form.ts`, `src/ui/assessments/intake.tsx`,
    `src/ui/assessments/format.ts`, `src/ui/assessments/lot-provenance.tsx`,
    `agent/lib/board.ts`; tested in `src/assessments/intake.test.ts` ("reads every labeled field a
    complete Copart block states", "leaves the fields an IAA block labels
    differently absent rather than guessed", "never overwrites a field the
    deterministic pass already read (SPEC 5)", "discards a proposal whose quote
    is not in the pasted text", "degrades with a visible note when the step is
    skipped or malformed", "blocks a lot whose stated identity the VIN
    contradicts", "keeps the identity as typed and opens no second chip when vPIC is
    unreachable", "refuses the first link the probe will not dereference, by
    position", "names the user as its source, keeps the listing URL as
    provenance, and records which pass filled what", "orders the passes so what
    you typed wins, the text beats the model, and vPIC fills the rest",
    "applies a correction to a field no pass filled, as a chip of your own"),
    `src/assessments/service.test.ts` ("creates a lot from pasted text alone and
    carries the chips behind every field", "keeps a listing URL as provenance and
    never dereferences it", "refuses a photo link the screen will not
    dereference", "takes exactly one of a seed lot, a stated lot or an intake"),
    `src/assessment-http/handlers.test.ts` ("creates a lot from intake and
    answers with the chips behind it (SPEC 61)", "refuses a photo link that is
    not a public https address, with a fixed reason", "previews a reading
    without creating an assessment") and
    `src/ui/assessments/intake-form.test.ts` ("builds the creation request with
    the photo links, the listing link and the corrections", "refuses input the
    server would refuse, before the request is spent", "states a chip as source,
    field and meaning, grouped by who read it", "seeds the VIN field from the
    query parameter the showroom action carries", "lists every field the
    reading left absent, so a value nobody read can still be stated", "carries
    a correction to a field no pass filled into the request it was typed for",
    "fingerprints what a reading was read from, so a later edit makes it
    stale", "opens creation only on a reading of the listing as it stands"),
    `src/ui/assessments/format.test.ts` ("user lot renders provenance, not a
    link"), `src/assessments/decision.test.ts` ("states that a lot the owner
    typed was never captured from the auction page") and
    `evals/agent/board.test.ts` ("states the lot source, so a lot the buyer
    brought is never read as an auction page").

62. **Outcomes are asked for once the sale is over, and record the market's
    answer even when the owner did not buy.** Once a lot's sale date is behind
    it — a stated calendar day counting as over only once the day after the
    stated day has also closed, so no fire asks on the morning of the sale or
    the morning after —
    the deployment's schedule asks the owner what happened: once per
    assessment per week, only for a decision that reached a ceiling or a walk,
    never for one that already carries an outcome, and only in the assessment's
    own activity log — no message leaves the deployment and no model is called
    to write it. The activity log records and displays that no model ran even
    on a live-coordinator deployment. The prompt phase runs once after an idle
    or failed delivery drain, and a prompt failure does not undo its deliveries.
    The workspace states the open question under the headline and
    beside the saved decision it belongs to. An outcome records the winning bid
    as its own figure, and `lost_to_hammer` records a pass the market answered,
    so the price a lot made is captured whether or not the owner bought it. —
    `src/assessment-queue/queue.ts` (`dueOutcomePrompts`,
    `recordOutcomePrompt`), `src/assessment-queue/schema.ts`,
    `src/assessment-queue/worker.ts` (`promptOutcomes`),
    `agent/schedules/dispatch.ts`, `src/assessment-http/activity.ts`
    (`recordActivity`, `lastPromptedAt`), `src/assessments/outcome-prompt.ts`
    (`saleIsOver`), `src/assessment-http/handlers.ts`,
    `src/assessments/validation.ts`, `src/assessments/service.ts`,
    `src/ui/assessments/format.ts`, `src/ui/assessments/decision-headline.tsx`,
    `src/ui/assessments/workspace.tsx`; tested in
    `scripts/assessment-schedule.test.ts` ("asks for outcomes once after an idle
    delivery drain", "asks for outcomes once after a delivery drain failure",
    "keeps completed deliveries when the outcome phase fails", "bounds a busy
    delivery drain to twenty ticks before asking for outcomes"),
    `src/assessments/outcome-prompt.test.ts` ("treats a calendar sale date as
    over only after its day has fully closed", "settles a stated instant a day
    after the instant itself", "asks nothing about a lot that states no sale, or
    states one nobody can read", "holds an ask open until an outcome recorded
    after it answers"), `src/assessment-queue/queue.test.ts` ("asks for an
    outcome once the sale is over and the decision is one worth measuring",
    "asks at most once a week for the same assessment", "waits out the whole day
    a calendar sale date states", "returns at most the number of prompts it was
    asked for"), `src/assessment-queue/worker.test.ts` ("asks what happened once a
    week, in the activity log and nowhere else", "asks nothing about a lot whose
    sale has not happened"), `src/assessment-http/activity.test.ts` ("records
    the outcome prompt as an inspectable event with no model behind it", "reads
    the last ask per assessment for one owner"),
    `src/assessment-http/handlers.test.ts` ("marks the saved decisions the desk
    is waiting on, in one read for the list (SPEC 62)"),
    `src/ui/assessments/format.test.ts` ("keeps the outcome prompt pending until
    an outcome answers it", "reads the ask the record carries, so a second week
    reopens an answered prompt", "names a lost lot as the pass it was, not as the stored
    kind"), `src/ui/assessments/payloads.test.ts` ("records the winning bid on a
    lot the owner did not buy", "refuses a lot that changed hands without the
    price it made"), `src/assessments/service.test.ts` ("records the winning bid
    on a lot the owner passed on and lost (SPEC 62)"),
    `src/assessment-reporting/outcomes.test.ts` ("reads a purchase price from
    the hammer field a newer record states (SPEC 62)") and the
    `outcome-prompt-after-the-sale` case in `scripts/agent-eval.ts`.

63. **Calibration compares a forecast only with outcomes observed after it,
    excludes fixtures, prints denominators, and never changes a constant by
    itself.** Every statistic the desk reports — purchases above the recorded
    ceiling, the hammer against the buyer's ceiling and against the market
    persona's, repair-range coverage, the repair residual and the exit residual
    — is read over the outcomes that carry it: one observation per assessment,
    the latest that states the figure against a forecast saved before it was
    observed. A recorded demonstration is never an observation, an outcome no
    earlier forecast answers is counted as unmatched rather than as a success,
    and an outcome whose forecast never held the figure to compare against is
    excluded from that statistic alone and counted there. Below five
    observations a statistic prints its count and `too few outcomes to read`
    instead of a number, because a median of three lots is not a reading.
    Residuals are reported as a median and an interquartile range. The exit
    residual compares net sale proceeds with the same revision's typical exit
    minus its expected selling costs; a missing selling line excludes that
    observation from the exit statistic alone. Nothing here fits, retrains or
    proposes a constant: revising one is the documented procedure in
    `docs/salvage-economics.md` §14, which requires twenty distinct lots for the
    tier in the relevant statistic's own denominator, a residual sign consistent
    across that same sample's interquartile range, and the outcome ids recorded
    in the constant's own basis string. The disclosure summary's outcome-record
    count is not that denominator. —
    `src/assessment-reporting/outcomes.ts` (`summarizeOutcomes`),
    `src/assessment-reporting/quantiles.ts`,
    `src/ui/assessments/calibration-format.ts`,
    `src/ui/assessments/calibration.tsx`, `src/ui/assessments/workspace.tsx`,
    `src/assessment-http/handlers.ts`, `docs/salvage-economics.md`; tested in
    `src/assessment-reporting/outcomes.test.ts` ("reads every statistic off the
    observations it could match against an earlier forecast", "prints no number
    below five matched outcomes, and a recorded demonstration is not one",
    "excludes a forecast that never held the figure from that statistic alone",
    "measures a lot the market answered without the owner buying it, but never
    as a purchase", "counts a lot once per statistic however many times it was
    reported", "compares net proceeds with the typical exit net of the compared
    revision's selling costs"), `src/assessment-reporting/quantiles.test.ts` ("reads the middle
    and both quartiles off an odd sample", "interpolates between the order
    statistics either side of a quartile", "keeps a negative residual negative
    and reports no quantiles for an empty sample") and
    `src/ui/assessments/calibration-format.test.ts` ("summarizes the section by
    what was matched and what was set aside", "states a share as its count over
    its denominator, and money with its spread", "prints no number under five
    outcomes and says what the statistic could not read", "names one lot as one
    observation in the basis it states") and
    `src/assessment-http/handlers.test.ts` ("answers the list with calibration
    statistics that count no recorded demonstration (SPEC 63)").

## Public catalog

64. **Public catalog installation preserves source identity and unknowns.**
    EPA rows retain source IDs, URLs, licensing references and source checksum.
    Optional fields are not invented. A failed import preserves the previous
    working catalog and unrelated durable data. — `src/catalog/`,
    `scripts/ingest.ts`; tested in `src/catalog/import.test.ts`,
    `scripts/ingest.test.ts`, `scripts/install-catalog.test.ts`.

65. **Catalog coverage cannot masquerade as vehicle certainty.** Unsupported
    or missing filter evidence is visible, never credited as a verified match.
    Contradictions do not become candidates. Engine searches reject known
    mechanical mismatches and leave exact engine codes unresolved; broad
    model/year fitments alone cannot certify them. Source gaps do not establish
    production or generation boundaries. — `src/resolve/`,
    `src/pipeline/search.ts`, `src/ui/results.tsx`; tested in
    `src/resolve/catalog.test.ts`, `src/pipeline/catalog-search.test.ts`,
    `src/ui/catalog-card.test.ts`.

66. **A public snapshot is independent of private data and history.**
    Public setup and offline evaluations need no original master or paid
    provider. Export includes reviewed source and public fixtures, excludes
    Git history, credentials and runtime databases, and fails on unsafe inputs.
    Export and temporary Git fixtures discard inherited hook repository variables
    so they cannot address another checkout or its index.
    — `scripts/export-public.ts`; tested in `scripts/export-public.test.ts`.
