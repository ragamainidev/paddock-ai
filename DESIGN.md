# DESIGN.md

## Assessment workspace

The saved assessment extends the existing instrument grammar. Its first row
shows the vehicle, research mode, current readiness and revision. The decision
and unresolved questions precede an evidence list and a chronological record
of investigations and decision changes. Use existing h1/body/spec/meta styles,
thin border separators and the established amber action links. Readiness has
words as well as state color. A provisional ceiling must be labeled and never
look like a ready-to-bid recommendation. Recorded evidence is labeled beside
the vehicle and source entries. On narrow screens, sections stack and long
VINs, URLs, reasons and part descriptions wrap.

Buyer constraints and the evidence needed to close each gate are editable
inside the assessment. Source-entry, watch configuration and calculation
details use disclosures to keep the current decision readable. Captured asks
can be reviewed, and an inspection or quote can be reviewed again after a
scope change. The vehicle baseline is explicitly labeled as preceding buyer
constraints; only the buyer-specific headline is the current recommendation.

The headline is the action, in the verdict-headline grammar: `Bid ceiling $X`
in `--accent` when a ceiling is solved, `$0` and `No bid` in `--danger`,
`More evidence needed` in `--text-dim`, and a refusal on economic dominance in
`--danger`. A ceiling the decision never solved is an en dash with the
decision's own reason in `meta` under it, never `$0` — the two states mean
different things. Under the headline sits the numbers strip in its standard
form, and the lot has two ceilings rather than one: `your ceiling` /
`what a pro can pay` / `edge`, each cell a `label` over a 20px mono value with
its basis, or an en dash and its reason, in `meta`. `your ceiling` is the only
accent cell and takes the accent only when it is the headline's own number, so
a walk states the ceiling without recommending it, and `$0` or less is
`--danger` with the decision's reason. `what a pro can pay` is the marginal
professional rebuilder's ceiling on the same evidence, its value in
`--text-dim` because it is context rather than an instruction. `edge` is the
difference: `--ok` when positive, `--danger` when negative. Two `meta` lines
sit under the strip — the investigation count and exit band, then what the edge
is and what its sign means. The vehicle-baseline ceiling ladder follows the
strip directly, labeled `vehicle baseline · before your constraints`, so the
explanation sits beside the number it explains rather than behind a disclosure.
Each buyer-side figure below states the basis it was solved from in `meta` and
carries the `derived` evidence chip; a figure that solves below zero keeps its
sign. `cash at ceiling` and `all-in at ceiling` are a 2-up strip inside the
buyer's economics, above two collapsed ledgers — `your lines` and
`market lines` — whose summaries carry the count, the expected money and how
many lines cost nothing; a line that costs nothing is counted there instead of
taking a row.

Intake is the one path to a lot of your own, under `Bring your own lot` in the
workspace. It collects the pasted listing text, the VIN, the photo links one
per line, the listing link (kept as provenance, never fetched) and the research
allowance, then the buyer constraints. It has two steps and one primary action:
`Parse listing` is an `--accent` text link that reads the block without saving
anything, and `Create assessment` is the button. Between them sits the reading,
under `What the listing says`: one section per source that filled a field, its
heading in `label` — read from your listing text, proposed by the model,
decoded from the VIN, corrected by you — and inside it one chip per field in
the assumption-chip grammar, `source · field = meaning`, with a narrow input
beside it labeled `correct it` and the reason in `meta` on its own line. A
field carries one chip: a value you correct moves to the corrected-by-you
group rather than appearing twice. A last group closes the reading —
`not stated on your listing` — with one row per field no pass filled: the
field name alone in the chip's mono inside a `--border` outline rather than the
assumption chip's `--warn` one, because nothing was inferred and so nothing is
an assumption, with the same narrow input beside it labeled `state it` and no
reason line. A value typed there is yours, so on the next read it leaves this
group for the corrected-by-you one. A step that was skipped states so in
`meta`; a reading that cannot become a lot states why in `--warn` above the
chips.

`Create assessment` stays disabled until the listing has been read and that
reading can become a lot, and goes back to disabled whenever the pasted text,
the VIN or the photo links change after it — a stale reading is not a reading.
A `meta` note sits beside the button and states which of those is missing:
`read the listing first`, `read the listing again` or
`correct the reading first`.

A lot states where its data came from in one `meta` line under the VIN: `lot
data from`, then the source host as a link when the lot has a page of its own
and the source that stated it otherwise, then `collected <day>` —
`lot data from user-supplied listing · collected 2026-09-11` — because a lot the
buyer brought has no page to link and a link is not the place to say so
(SPEC 61). A lot from the
recorded catalog carries the recorded-example tag beside that line. The chips
the reading produced are saved with such a lot and read back under the lot
header in the same chip grammar, grouped by source, with no `correct it` inputs
and no `not stated on your listing` group, and behind a disclosure whose
summary counts them: the reading is over, what remains is the record's
provenance, and the decision is what the reader came for.

Once the sale date has passed and nobody has said what happened, the headline
carries one `meta` line under it: `The sale date has passed · ` and
`Record outcome` as an `--accent` text link to the outcome form, which is the
page's own anchor rather than a second screen. The line closes as soon as an
outcome is recorded, and returns if the desk asks again a week later. The same
state reads as an `outcome due` tag in the saved-decisions list, in `meta`
after the status, because a list is where a reader notices a lot they have
stopped thinking about.

The saved-decisions list closes with `Estimates against observed outcomes`, a
collapsed `details` in the collapsed-evidence grammar:
`calibration — 7 matched outcomes · 2 fixtures excluded`; omit the fixtures
clause when none were excluded. Open, it states in
`body` what the comparison is and what it is not, then one row per statistic —
the statistic's name in `body`, its reading in 13px tabular mono on the right
from the `sm` breakpoint, and stacked beneath the name on narrower screens so
long quartiles never overlap a label. The denominator it was read over follows
in `meta`, and the section closes with one
`meta` line naming what the whole section excludes and how many of each.
A statistic with fewer than five matched observations prints
`too few outcomes to read (3 of 5)` where its number would be, because the count
is the honest reading and a median of three lots is not one. Money keeps the
workspace's signed grammar; a share reads as its count over its denominator and
a percentage. The accent stops at the disclosure summary. The readings are a
record of how the desk has done, not an instruction.

The screen has one primary action: continue the research, or refresh it when
the assessment is stopped. Stop, review, watch, evidence entry and outcome
recording are `--accent` text links. Nothing on the page recomputes money: the
figures are read from the saved decision.

The visual system. Build against these tokens. If something isn't specified here, it doesn't exist yet — add it here first, then use it.

## Premise

This is an instrument, not a landing page. BMW has lit its gauges at roughly 605nm since the 1970s, a convention borrowed from fighter cockpits: the eye reads amber against black without losing dark adaptation when it looks back up at the road. Everything below follows from that. High contrast, low light, no decoration that isn't carrying information.

Reference points: a service manual, Linear's density, Bring a Trailer's respect for detail — and, for photography-led surfaces only, Bentley's configurator restraint: one large image allowed to breathe, captions kept technical and small. Not Stripe, not a SaaS marketing site.

## Wordmark

**paddock** — always lowercase, always mono, 13px/500 in the header. The
paddock is where the cars wait before they run: auctions, inspections, the
moment before commitment. The favicon is a supplied mark, distinct from the
UI palette on purpose: a cream classic coupe on an orange roundel with a 45°
flat shadow (`src/app/icon.svg`, redrawn as vector; `favicon.ico` generated
to match). The roundel's orange lives only in the favicon — the interface
keeps its single 605nm amber.

## Color

Near-black base, one accent, nothing else chromatic except state.

```
--bg              #0A0A0B   page
--surface         #121214   cards, search field
--surface-raised  #1A1A1D   hover, popovers
--border          #26262B   default 1px rules
--border-strong   #3A3A42   focus, active, table headers

--text            #EDEDEF   primary
--text-dim        #9A9AA3   labels, secondary
--text-faint      #6B6B75   metadata, timestamps

--accent          #FF7A00   605nm amber. Interactive, active, emphasis.
--accent-dim      #B35400   accent borders, inactive accent
--accent-wash     rgba(255,122,0,0.10)   selected row background

--warn            #E5A100   assumptions, ambiguity
--danger          #E5484D   recalls, safety
--ok              #3DD68C   used sparingly, never decoratively
```

Accent is scarce on purpose. If more than roughly 5% of a screen is amber, it stops meaning anything.

## Type

Two families. Sans for prose and labels, mono for anything a machine produced or a spec sheet would print.

```
Sans:  Instrument Sans (fallback Inter, system-ui)
Mono:  JetBrains Mono (fallback ui-monospace, SFMono-Regular)
```

Every number, spec, year, displacement, price, and code is mono with `font-variant-numeric: tabular-nums`. Columns of numbers must align.

```
display   28px / 32px  600  -0.02em   page title only
h1        20px / 26px  600  -0.01em   vehicle name
h2        16px / 22px  600            section
body      14px / 20px  400            prose
label     12px / 16px  500  0.02em    uppercase, --text-dim
spec      13px / 18px  400            mono
meta      11px / 14px  400  0.03em    uppercase, --text-faint
```

Sentence case everywhere except `label` and `meta`, which are uppercase. No title case.

## Space and shape

4px base unit. Use 4, 8, 12, 16, 24, 32, 48. Nothing else.

Radius: `2px` default, `4px` for the search field and cards. Nothing rounder. No pills except assumption chips, which are `2px`.

Borders: 1px, `--border`, always visible. Panels are separated by rules, not by shadow or spacing alone. Exactly one shadow exists in the system, for popovers: `0 8px 24px rgba(0,0,0,0.6)`.

Max content width 1200px. Dense is correct; whitespace is not the goal.

## Components

**Header nav.** The wordmark left, tabs right in `label`. The active tab is `--text` with a 1px `--accent` underline sitting on the header's bottom rule; inactive tabs are `label` dim, hover to `--text`. One amber underline is the whole selection language — no fills, no pills.

**Showroom (the homepage).** The one photography-led surface: real cars carry the page and the interface recedes. A featured car opens the page full-width at 21:9, `object-cover`, 1px `--border`, with its caption UNDER the image (title in h1, facts in `meta` mono, one accent link into the lot, and under the caption a second `meta` accent link into intake) — never text over photographs. Below, two labeled grids: sold listings at 3-up and salvage lots at 4-up, in the listing-card grammar with 4:3 photos. Spacing may run looser here (48–64px between sections); everywhere else density rules. A slim search affordance links to /search styled as the search field at rest. No hero copy, no taglines — the label, the cars, the prices.

**Search field.** Full width, 56px tall, `--surface`, 1px `--border`, 4px radius. Input text is mono, 14px. Focused: border `--accent-dim`, plus a 1px inset ring in `--accent-wash`. No glow, no scale transform. Placeholder cycles through real enthusiast queries every 4s, fading at 150ms. Autofocus on load. `/` refocuses from anywhere.

**Assumption chip.** Inline row above results. `--warn` 1px border, transparent fill, 11px mono, 2px radius. Format: `992 → Porsche 911, 2019+`. Clicking removes the assumption and re-runs the query without it. That interaction is the point — the user can argue with the interpreter.

On a form the same chip states what a value would be if the reader says nothing: same border, fill, type and radius, but static, reading `assumed: exit = private party`. It is not clickable, because the field beside it is already the way to argue with it; editing the field removes that field's chip and no other. The judgment is per value, not per form: a form the reader has already customized still chips every value that is still its nearest preset's, because one replaced number does not make the other eighteen the reader's own.

**Preset selector.** A row of radios in body type above the fields they fill, one per preset, plus a fourth reading `Custom` that appears only once a field diverges and is then the selected one. Choosing a preset refills every field it owns and restates the whole assumption-chip row. No fills, no pills, no segmented control — the selection language is the radio and the chips underneath it, which say what the choice actually did.

A field whose meaning is a formula rather than a name carries one line of helper text directly under it, in `spec` mono at `--text-dim`, sentence case — never `meta`, which is reserved for genuine metadata.

**Ambiguity fork.** When a term resolves multiple ways, render side-by-side panels with a 1px `--border-strong` divider, each headed with the reading (`Corvette C7, 2014–2019` / `Audi A7 C7, 2011–2018`). Neither is preselected. Never auto-pick.

**Vehicle card.** `--surface`, 1px border, 4px radius, 16px padding. Title in h1 with the year range beside it in 16px mono `--text-dim` — sibling cards from one query often share a name, and the years are what tell them apart at a glance. Specs as a two-column mono grid, labels in `label` style, values in `spec`. Year range always shown as `2019–2026`, en dash, no spaces. Match reasons under the specs are explanations, not metadata: 12px mono, `--text-dim`, sentence case, `·` separated — never uppercase `meta`, which is reserved for genuine metadata. Long provenance lists anywhere (the NHTSA queried-names list) collapse behind a disclosure showing the count.

**Listing row.** 72px tall, 64px square thumbnail with 2px radius, title truncated to one line, price right-aligned in mono at 16px/600. Hover raises to `--surface-raised` and shows the border in `--border-strong`. Entire row is the link.

**Listing card.** When the photo is the point (the inspector's pick-a-car state), the row grows into a card: 4:3 photo full-bleed at the top, 1px `--border`, 4px radius, then a 12px-padded footer — title on one line, price right-aligned mono 16px/600, and a `meta` line under it. Hover: border `--border-strong`, photo unchanged (no zoom, no dim). Selected: 1px `--accent-dim` border. The photo carries the card; nothing is drawn over it.

**Recall item.** `--danger` 2px left rule, no fill. Component name in `label`, summary in body, campaign number in `meta`. Complaint themes render as a count plus the theme in body, expandable to representative quotes in mono at 12px, since the source text is verbatim owner writing and should look like it.

**Eval table.** Mono throughout. Pass and fail in the left gutter as `PASS` / `FAIL` in `meta`, colored `--ok` and `--danger`. Failing rows get `--accent-wash`. Sortable by status.

**Photo filmstrip.** The photos under inspection are the primary artifact; everything else annotates them. Square tiles, `2px` radius, 1px `--border`, `object-cover`, laid in a responsive grid. Each tile carries its index in `meta` mono at the top-left corner on `--bg`. A tile referenced by the active finding gets a 1px `--accent` border; clicking a tile opens it full-size in a popover (the one shadow) on a `--bg` scrim at 80%.

**Console.** The inspection's stream of consciousness. Mono 12px on `--surface`, 1px border, 4px radius, one line per event, newest last, auto-following. Prefix per line in `meta`: the stage name in a fixed-width gutter. The line grammar is fixed so the eye can separate narration from evidence at a glance:

- _Thoughts_ (narration) are `--text-dim`.
- _Evidence_ (photo observations, decoded facts, counts) is `--text`. Photo observations start with a `photo N` chip in the anchor-chip style.
- _Findings_ take the severity color (`--danger`, `--warn`); nothing else in the console is chromatic.
- _Searches_ are `--text-dim` with the query itself in `--text` — the query is the work.
- _Worker lanes._ Parallel research workers tag their lines `[resale]`, `[part-out]`, `[srs cost]` — the tag renders first in `--text-faint`, then the line under its normal grammar. Interleaved lanes are the point: the reader watches four investigations run at once instead of one silent wall.
- _Plan lines_ read reason `→` topic, reason dim, topic in `--text`.
- _Degraded stages_ render exactly like every other degraded stage — one `meta` line in `--warn`, named stage, reason.

When the active stage changes, a divider renders: 1px `--border` rule with the stage name in `meta` set into it. Incoming events queue client-side and reveal one line at a time — 90ms cadence, tightening toward 40ms as the queue deepens, instant once the run is over — so bursts read as the agent talking, not the page lurching. Each reveal is the standard 120ms rise.

The last line while running is the **cursor line**: a `▍` block in `--accent` blinking at 1s steps (the one blinking element in the system; `prefers-reduced-motion` holds it solid), then the active stage and its elapsed seconds ticking in `meta` mono. The console never looks stuck: something on screen is always moving by exactly one character.

After the run it collapses to the **console summary bar**: one 40px row — `console` label, line count, total duration mono, `expand` affordance — expanding back to the full log in place (structural motion, below).

**Stage rail.** The run's spine, beside the console: one row per stage in execution order. Each row is an 8px state dot + stage name in `label` + elapsed time right-aligned in `meta` mono. States: pending = 1px `--border` ring, no fill; active = `--accent` dot, name in `--text`; ok = `--border-strong` fill, name back to `--text-dim`; degraded = `--warn` fill and the row keeps a one-line `meta` reason under it. A 1px `--border` vertical rule connects the dots. The rail is the answer to "is it thinking or stuck" — the amber dots ARE the stages working right now, and truly parallel stages (the VIN decode running beside triage) may hold two at once. On narrow screens the rail compresses to a single horizontal row of dots above the console.

**Run header.** Title in h1 (the listing's own title when there is one), then one `meta` line: run status (`running · 0:47` ticking, or `done · 3:12` fixed), provenance link, and — only when true — `runs are not persisted — database unreachable` in `--warn`. A `view trace` text link sits right-aligned once the run has spans.

**Trace waterfall.** The run's spans on a shared time axis, mono throughout. One row per span: name left in `spec`, right-aligned duration in `meta`, and between them a bar positioned proportionally on the axis — 8px tall, 2px radius, `--surface-raised` fill with 1px `--border-strong` for stage spans; model/fetch spans use a 1px `--accent-dim` border and no fill. Attrs (token counts, photo counts) render after the duration in `meta`. The axis ticks in `meta` at sensible round seconds. No colors beyond that; the shape of the waterfall is the information.

**Verdict banner.** `PASS` / `CAUTION` / `AVOID` in h1 mono, colored `--ok` / `--warn` / `--danger`, with a 2px left rule in the same color and no fill — the recall item's grammar at full size. No confidence percentage anywhere in the interface: the model's self-scored number reads as hedging, and the honest uncertainty already lives in the evidence (degraded-stage lines, "estimate" labels on bases, the watch items). The verdict word and its stated reasons carry the whole judgment.

**Numbers strip.** Directly under the verdict: the figures the reader came for, 3-up on `--surface`, 1px border, 4px radius. Each cell is a `label` over a 20px/600 mono value (salvage: `bid ceiling` / `break-even · the wall` / `rebuilt exit · low · typical`; the ceiling cell is the only accent). A missing number renders an en dash with its reason in `meta` under it — absence is information. One `meta` line sits under the strip carrying the context that is not a verdict input (the wreck market's range and count, the discipline share). The strip is the five-second answer; everything below it is the evidence.

**Verdict headline (salvage).** The banner word is the action: `BID TO $61,500` in `--ok`, or `NO BID` in `--danger`. Never a play name, never a grade. The summary under it is the money story in prose, one paragraph, numbers mono.

**Ceiling ladder.** The one graphic in the salvage report: a horizontal waterfall from the rebuilt exit down to the bid ceiling. One row per step, 20px tall: label left in `spec` (`--text-dim`), a track spanning the exit low, the value right-aligned mono. The exit row is a full bar in `--border-strong`; every cost step is a floating 8px bar (2px radius) in `--surface-raised` with a 1px `--border-strong` edge — the trace waterfall's grammar — positioned where that dollar leaves the running total; a step marked as a killer takes `--danger` fill and no edge; the ceiling row is a bar from zero in `--accent`, or, at $0, no bar and the value in `--danger`. Break-even is a 1px `--border-strong` vertical rule through the whole ladder with `break-even` in `meta` at its foot; the discipline margin is a step like any other, labeled with its share. Repair steps roll up per program (the program table itemizes them). Hovering a step shows its basis in the native title. Nothing else is chromatic; the shape is the information.

**Sensitivity rows.** Under the ladder, `what would change the answer`: one row per re-solve, `spec` label left, the ceiling under that assumption mono, the delta vs the headline mono with its sign (`+$20,500` / `−$14,500`), the assumption's numbers in `meta`. Positive rows are the yard visit's agenda; negative rows are the stress cases. No color on the numbers; the sign carries it.

**Zero ceiling.** When nothing clears, the report says what ate it and what would have to be true, in that order: the killers (the largest steps whose removal would turn the ceiling positive) are the `--danger` bars in the ladder and are named with their dollars in the summary; the unlocks (the required value of one input holding the rest at expected) render as `meta` clauses under the ladder, feasible ones first, infeasible ones marked so; when no single input rescues it, the best case (exit at typical, every repair at its low, contingency waived) is stated as the most a surprise-free rebuild could justify.

**Comps table.** The cars behind the exit, mono, one row per comp: a `·` in `--accent` for a used comp or nothing for a struck one, lane and outcome in `label`, the price the math ran on (the stated price in `--text-faint` beside it when an ask was haircut), model year, miles, date, title, variant/note truncated to one line, source host as a link (`--text-faint`, `--accent` on hover). Struck comps render `line-through` in `--text-faint` with the reason in `meta` on the row. Wreck comps follow in the same grammar under their own `label`. Beyond eight rows a lane collapses behind a count.

**Program table.** The build plan as programs: one block per program with the program name in `label`, its zones and photo anchors in `meta`, and its expected total mono right-aligned; under it one row per line: task in body, a `who` word (`you` / `pro`) in `meta`, low / expected / high mono tabular, and the evidence chip. The reason renders in `meta` under the task. Cited lines list their citation hosts as source links.

**Evidence chip.** A 2px-radius, 1px `--border` chip in `meta` mono naming where a number came from: `schedule`, `curated`, `override`, `cited`, `derived`. `cited` takes a 1px `--accent-dim` border. Never a fill.

**Recorded-example tag.** The evidence chip's grammar at the scale of a whole lot: `recorded example` in `meta` mono, 1px `--border`, 2px radius, no fill, never clickable. It sits beside a lot the product recorded from a real auction and ships as a demonstration — the `/salvage` lot list and the lot it selects, the showroom's featured lot, the recorded case in the assessment workspace, and the assessment header. A lot the buyer brought never carries it, and the showroom's featured lot pairs it with one `meta` accent link, `assess a lot like this`, which is the way from an example to a lot of your own.

**Legacy report note.** A report persisted by an earlier model renders its verdict banner and summary, then one `meta` line: `report generated by an earlier model; run the lot again for the ceiling`, and the sections whose data still holds (damage, what people miss, history). Nothing is re-derived.

**Report index.** Long reports carry a sticky index bar under the verdict area: `meta` links to each section, separated by `·`, sticky to the top on `--bg` with a 1px bottom rule while scrolling. The active section's link sits in `--text` with the amber underline from the header-nav grammar. No icons, no pills — it is a line of text that knows where you are. Index jumps glide (`scroll-behavior: smooth` on the root, `auto` under `prefers-reduced-motion`) and every section carries scroll-margin clearing the sticky bar, so a jump lands with the heading readable, never teleports, and never buries the target under the index itself.

**Collapsed evidence.** Sections that support the verdict rather than state it (the build plan, research findings, damage areas beyond the worst four) default to collapsed `details` rows whose summaries carry the numbers that matter (`build plan — 11 tasks · $9.5k–66k parts · 7 professional`). The reader traverses summaries and opens what they doubt. Verdict, numbers strip, dealbreakers, and what-people-miss never collapse.

**Finding row.** Severity dot (6px, severity color) + body description + location in `--text-dim`, then photo anchors: `photo 3` chips in `meta` mono, 1px `--border`, `2px` radius. Clicking an anchor highlights that filmstrip tile.

**Upload zone.** 1px dashed `--border`, 4px radius, one line of body in `--text-dim` ("Drop photos or click to choose"). On drag-over: border `--accent-dim`, fill `--accent-wash`. Accepted files render into the filmstrip immediately; there is no separate preview state.

**Market position.** A 1px `--border` horizontal rail spanning low → high of comparable asks, with the median ticked in `--border-strong` and the subject car's ask as a 2px `--accent` marker. All figures mono, tabular, right-aligned: low / median / high / ask, and repair exposure as a range. If comps are thin (< 4), say so in `meta` instead of pretending the rail means something.

**Action button.** One primary action per screen at most: 48px tall, 1px `--accent-dim` border, `--accent` text, transparent fill, 2px radius. Hover fills `--accent-wash` and strengthens the border to `--accent`. Disabled drops to `--border` and `--text-faint`. Secondary actions are text links in `--accent`, no border. No filled buttons — the accent budget doesn't cover them.

**Source citation.** Research findings cite their pages inline: `meta` mono links under the finding, hostname first (`m3forum.net — Rear subframe crack thread`), `--text-faint` at rest, `--accent` on hover, external-link semantics. A finding without a citation does not render — uncited claims don't exist.

**Empty and error.** One line of body text in `--text-dim`, no illustration, no emoji, no apology. "No vehicles match those constraints." When a stage fails, say which and why in `meta` under the results that did work. Degradation is visible, never silent.

**Loading.** While a stage streams in, one line of `meta` naming what is happening ("resolving", "pulling NHTSA data and listings"). No skeletons, no spinners.

## Motion

Two registers, nothing else. No bounce, no spring, no scale on hover. `prefers-reduced-motion` removes all of it (the cursor block holds solid).

**Micro** — 120ms `ease-out`, opacity and 2px translate only. Arriving console lines, findings, chips, hover color shifts. Nothing animates on first paint.

**Structural** — 240ms `cubic-bezier(0.2, 0, 0, 1)`, height/grid-template-rows plus opacity. Reserved for moments the layout legitimately reorganizes around what matters now: the console collapsing to its summary bar when the run finishes, the summary bar expanding back, and the report's arrival. The report choreography is the one authored sequence in the product: verdict banner rises first, then report sections stagger in at 60ms steps, total sequence under 600ms, after which nothing on the page moves again. A section arriving mid-scroll must not shift content the reader is already looking at — the console collapse and the report reveal happen in one coordinated pass, not piecemeal.

## Prohibited

Gradients. Glassmorphism and backdrop blur. Shadows other than the one popover shadow. Border radius above 4px. Purple, indigo, or violet anywhere. Emoji in the interface. Hero sections. Marketing copy. Centered single-column layouts with huge type. Skeleton loaders that pulse. Toast notifications. Icons that duplicate an adjacent word. Any second accent color.

**Em dashes in interface copy.** No `—` in any string a user sees: labels, console lines, report prose, seed data, error messages. Join clauses with `·`, `:`, `;`, or a comma instead. En dashes stay exactly where the range grammar requires them (`2019–2026`, `$2,500–4,000`) and as the missing-value glyph in number cells. Comments and model prompts are exempt; the interface is not.

## Accessibility

Body text meets 7:1 against `--bg`. `--text-dim` meets 4.5:1 and is never used for anything essential. Focus is always visible and is a 1px `--accent` ring, never removed. All interaction is reachable by keyboard: `/` search, arrows between results, `enter` to open, `esc` to clear.

Browser surfaces are themed, not defaulted: enabled buttons and `summary` show a pointer cursor, the text caret is `--accent`, selections are `--accent-wash`, and scrollbars are thin, `--border-strong` on `--bg`.
