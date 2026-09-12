# Salvage-rebuild economics: the sourced decision model

The salvage assessor's constants are not invented. They encode how
practitioners price a rebuild bid, researched 2026-08-15 and re-verified
2026-08-17. Every constant in `src/salvage/tiers.ts`, `src/salvage/fees.ts`,
and `src/salvage/ceiling.ts` points here. Where the public record is thin
the section says so and the constant is a stated prior, not a measurement.

## 1. The decision the report answers

One question: the highest bid a disciplined rebuilder can place on this lot.
The verdict is `build` (bid to the ceiling) or `walk` (no bid, with the
reason). Part-out and parts-car lanes are gone: the buyer this product
serves rebuilds and sells; dismantlers and exporters are the competition,
shown as context (SPEC 45).

**Ceiling discipline: all-in ≤ 75% of the low exit** (`DISCIPLINE_SHARE`).
The practitioner ceiling is total project cost at 50–70% of After-Repair
Value; the margin absorbs hidden structural damage, module/crash-data
work, capital, and time. This model applies 75% to the LOW end of the exit
band (roughly 65% of the typical exit), which is the same discipline
stated against the floor instead of the middle. Sources:
[AutoBidMaster rule-of-thumb](https://blog.autobidmaster.com/2026/02/a-rule-of-thumb-for-buying-salvage-vehicles-at-auction/),
[Salvagebid final-cost math](https://blog.salvagebid.com/how-to-calculate-the-final-cost-of-a-salvage-vehicle/),
[A Better Bid 2026 guide](https://abetter.bid/blog/is-it-worth-buying-a-car-with-a-salvage-title-full-guide).

**Break-even** is the same solve at 100% of the low exit; **stress**
reprices every repair line at its high (SPEC 39).

## 2. The exit: rebuilt-title retention vs clean sold money

`VehicleProfile.rebuiltDiscount` per tier, as a fraction of clean sold:

| Tier       | Retention | Confidence | Basis                                                                                                                                                                                                                                                                                   |
| ---------- | --------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| exotic     | 0.50–0.65 | low        | No public dataset pairs rebuilt-title retail sales of Ferraris/Lamborghinis with clean comps (BaT, Cars & Bids, Classic.com expose no branded-title filter). Inferred from the general 20–40% rule widened for a thin buyer pool, no financing, and collector aversion to branded VINs. |
| premium    | 0.60–0.72 | medium     | Porsche 911: 25–40% resale discount in owner-forum and specialist data.                                                                                                                                                                                                                 |
| mainstream | 0.70–0.80 | high       | KBB / AppraisalEngine / TitlePull: 20–30% for an inspected rebuilt title.                                                                                                                                                                                                               |

Sources: [AppraisalEngine](https://appraisalengine.com/company/salvage-title-vs-rebuilt-title-vehicle-value/),
[TitlePull](https://titlepull.com/blog/how-much-does-a-salvage-title-lower-value),
[U-Pull-It regional variance](https://u-pull-it.com/guides/salvage-title-value),
[StuttCars 911 guide](https://www.stuttcars.com/a-practical-guide-to-buying-a-damaged-porsche-911-and-rebuilding-it-properly/),
[Rennlist salvage 911 thread](https://rennlist.com/forums/997-forum/997875-salvage-title-porsche-value.html).

**Asks are haircut to transacted money** (`askHaircut`: exotic 10%, premium
7%, mainstream 5%). No source publishes an ask-to-sold spread directly; the
triangulation is that dealer asks fell 9% while median sold fell 20% between
2023 and mid-2025, that 68% of collector lots bid below their low estimate,
and that Classic.com blends dealer asks into its benchmarks. Sources:
[Hagerty: buyers aren't paying what sellers ask](https://www.hagerty.com/media/market-trends/hagerty-insider/data-driven/charted-buyers-arent-willing-to-pay-what-sellers-are-asking/),
[Hagerty: the slow retreat](https://www.hagerty.com/media/market-trends/hagerty-insider/the-collector-car-market-continues-its-slow-retreat/),
[Classic.com 2025 half-time report](https://www.classic.com/insights/2025-half-time-report/),
[Classic.com methodology](https://www.classic.com/markets).

**Selection rules** (`src/salvage/exit.ts`, SPEC 38): model year ±2,
off-spec variants struck (Spider, GTS, Assetto Fiorano, Performante…),
sales older than 24 months struck, MAD outliers struck at three robust
sigmas with a 2.5× / 0.4× hard bound, quartiles clamped to ±35% of the
median, and fewer than three sold comps admits haircut asks to the pool.
Rebuilt-title sold comps anchor directly when at least two exist, capped at
85% of clean money. Lanes are what the evidence is: a listing from a
salvage-auction host (autoastat, bid.cars, bidfax, Copart, IAAI, salvagebid,
poctra, carsfromwest…), a comp with a damage type, or one whose note names
a Copart/IAAI lot is wreck evidence whatever lane the worker filed it under
(`src/salvage/variants.ts`).

Cited repair prices are screened the same way before they narrow a line:
off-spec variants (XX, Challenge, Assetto Fiorano…), aftermarket
(Novitec, Mansory…), comparison figures from other models, warranty and
service-contract prices, structure parts filed under a panels line, and
duplicates are set aside with their reason and kept as citations; a cited
parts sum lifts a line's expected value to at most 1.5× its curated high
(`screenPriceEvidence`, `applyPriceEvidence`).

## 3. Selling costs

`VehicleProfile.selling` as a share of the low exit:

| Channel                                          | Seller cost | Basis                                                                                                                                                                                          |
| ------------------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Online enthusiast auction (BaT, C&B, PCARMARKET) | 1–2.5%      | Listing $99–$429 (BaT), $0 (C&B), $99 (PCARMARKET); the 5% buyer premium is capped at $7,500 and paid by the buyer; plus PPI ~$500, photography $200–1,000, transport to the buyer $900–3,100. |
| Specialist consignment                           | 5.5–11.5%   | 5–10% typical (Motorcar Classics 5%/$3,000 min; Motorcars International "as little as 7% less expenses"); consignor pays insurance/storage.                                                    |
| Private sale                                     | 0.8–2.5%    | Listing, detail, paperwork, PPI, escrow.                                                                                                                                                       |

Whether an auction house lists a rebuilt-title exotic is not guaranteed by
any fee page, so the exotic expectation (4%) sits between the online and
consignment cases; premium 3%; mainstream 2%. Sources:
[Bring a Trailer FAQ](https://bringatrailer.com/faq/),
[Autoblog: Cars & Bids fee change](https://www.autoblog.com/news/cars-bids-raises-buyer-fees-after-layoffs),
[PCARMARKET terms](https://www.pcarmarket.com/terms-and-conditions/),
[Collecting Cars FAQ](https://collectingcars.com/faqs),
[Motorcar Classics consignment](https://www.motorcarclassics.com/classic-car-consignment.htm),
[Motorcars International](https://www.motorcars-intl.com/consign-your-exotic-car).

Holding costs (storage, insurance, capital) are deliberately not a cost
line: too variable per builder. They are named as a watch item.

## 4. Repair programs: tier tables and model overrides

`src/salvage/tiers.ts` holds low/expected/high per part and per program at
three tiers; the model overrides sharpen the seeded lots from
secondary-market OEM list prices (2026-08):

| Model         | Sourced points                                                                                                                                                                                                                                                                                                                                                                                                | Source                                                                                                                                                                                                                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SF90 Stradale | front bumper $14,999 (parts4usa) / $20,375–38,175 new, $10,003 used (Eurospares); hood $10,000; fenders $4,999 each; headlamps $7,999 the pair; A/C condenser $499; **front frame complete $25,000**; CF wheel set $38,000–54,000; HV pack ≈ £16,000 (owner forum). Front e-axle: no public price.                                                                                                            | [parts4usa](https://parts4usa.com/products/ferrari-sf90-stradale-front-frame-complete-oem), [Eurospares](https://www.eurospares.com/Ferrari/SF90/SF90_Stradale/PartDiagrams/0141/FRONT_BUMPER), [PistonHeads](https://www.pistonheads.com/gassing/topic.asp?h=0&f=235&t=1973753)                                                                                                 |
| 296 GTB       | front bumper $9,999; hood $5,999; headlamps $4,999 each (EU spec); front lip $3,499; CF wheels $36,000. No public price for the front structure, radiators, or the HV pack. Ferrari cut off parts supply to a branded-title 296 rebuild mid-project.                                                                                                                                                          | [parts4usa](https://parts4usa.com/products/ferrari-296gtb-front-bumper-complete-oem-part-number), [Supercar Blondie](https://supercarblondie.com/mat-armstrong-ferrari-296-parts-fix/), [Autoblog](https://www.autoblog.com/news/youtuber-claims-ferrari-is-blocking-his-296-gtb-rebuild)                                                                                        |
| 458 Italia    | headlamp $3,109–4,051 new; rear bumper $8,923–15,279 new / $5,500 used; carbon rear diffuser $16,353 new / $8,000 used; tail lamp $1,472 new / $899 used; rear subframe $13,050 new; used F136 V8 $24,250; complete DCT quote-only. Clean 2011–2014 coupes at 23–43k miles sold $201,000–$293,000 in the last twelve months; an undamaged 23k-mile car cleared $118,000 at Copart.                            | [Scuderia Car Parts](https://www.scuderiacarparts.com/part-finder/ferrari/458/oe/22/2543/48697), [parts4usa](https://parts4usa.com/products/ferrari-458-italia-spider-rear-bumper-complete-part-number-83104810), [VAZ Auto](https://vazautosolutions.com/ferrari-f136-engine-for-sale/), [Classic.com](https://www.classic.com/m/ferrari/458/coupe/)                            |
| Huracán EVO   | used OEM front bumper $5,500, hood $5,999, fenders $4,899 each, headlamp pair $13,800, radiators $349–699, front bumper reinforcement $1,799; bolt-on front-frame structure parts $102–4,102 new; complete front frame assembly $4,400–13,700 used. A Michigan scrap certificate cancels the VIN: parts or scrap metal only (MCL 257.217c).                                                                   | [parts4usa](https://parts4usa.com/products/lamborghini-huracan-lp610-front-bumper-oem-part-number-4t0807103c), [Scuderia Car Parts](https://www.scuderiacarparts.com/part-finder/lamborghini/huracan/oe/426/3955/69935), [Michigan SOS dealer manual ch. 5](https://www.michigan.gov/-/media/Project/Websites/sos/01preston/Dealer_Manual_Chapter_5.pdf)                         |
| Artura        | McLaren: the 7.4 kWh pack is $6–7k to replace and its modules are serviceable; infotainment ECU $3,150–6,308 new; front bumper assemblies $989–1,619; radiators ~$400–450; carbon panel work $5–15k typical, £16k factory for a 600LT set; the MonoCell is replaced rather than repaired when in doubt. Vandalism Arturas hammer $76,500–98,000 against $173,000–180,000 clean; no rebuilt-title sale exists. | [McLarenLife](https://www.mclarenlife.com/threads/artura-battery-longevity-and-replacement-costs.105408/), [Exotic Auto Parts](https://exoticautoparts.co/products/mclaren-infotainment-ecu-23ma490cp), [CompositesWorld](https://www.compositesworld.com/articles/automotive-cfrp-repair-or-replace), [Carbonwurks](https://carbonwurks.com/mclaren-600lt-carbon-fibre-repair/) |

Body-shop labor 2026: US posted averages body $86 / refinish $85 / frame
$117 / mechanical $163 per hour; a published tiered sheet runs exotic body
$193 and carbon/structural aluminum $233 against non-luxury $86, a ~2.2×
exotic-to-mainstream ratio that is the durable default. Airbag modules
run ~$1,000–1,500 each used OEM on exotics against $700–900 new on
mainstream cars; the exotic SRS penalty is labor and trim, not the bags.
Sources: [Autobody News labor rate index](https://www.autobodynews.com/regional/midwest-regional-news/labor-rate-index-national-data-shows-mechanical-labor-rates-rising-faster-than-body-refinish),
[Formula First Collision rate sheet](https://formulafirstcollision.com/pricing/),
[parts4usa Huracán airbags](https://parts4usa.com/products/lamborghini-huracan-airbag-steering-wheel-oem-part-part-number-4t0880201).

The one end-to-end private exotic rebuild with a published P&L: a 2019
McLaren 720S bought at $79,000 and rebuilt for ~$150,000 ($229,000
all-in) that then drew low offers everywhere because of the salvage
title. Source: [Supercar Blondie](https://supercarblondie.com/washington-youtuber-mclaren-720s-carmax-valuation/).

Structural rates by chassis type, paint per zone (a heavy front hit is a
four-panel refinish with blend, $6,000–12,000 on an exotic; the exotic
labor multiplier over a premium car is ~2.8×; clear must cover whole
panels), ADAS calibration (independent $700–1,500 radar + camera; dealer
$1,000–2,500; CCC average $500 per calibrated repair; exotic marque dealer
unsourced, $1,500–3,000 placeholder), SRS, HV, and mechanical corners are
curated bands labeled as estimates. Sources:
[Ferraris-online on the $7,000 paint job](https://ferraris-online.com/the-7000-paint-job/),
[PistonHeads special finishes](https://www.pistonheads.com/gassing/topic.asp?h=0&f=236&t=1949153),
[Ecostify paint repair costs](https://www.ecostify.com/blog/car-paint-repair-cost),
[Autobody News: calibrations past 35% of repairs](https://www.autobodynews.com/news/calibrations-surge-past-35-of-repairs-as-total-losses-head-toward-second-straight-record),
[ADAS Depot pricing benchmarks](https://adasdepot.com/blog/are-you-charging-enough-adas-calibration-pricing-benchmarks-revealed/),
[Glass and Auto ADAS cost guide](https://www.glassandauto.com/cost-guides/adas-calibration-cost).

Cited price evidence raises a line's low and, when it prices the whole
line (a job quote or a full set of parts), its expected value; nothing
lowers a curated number (`applyPriceEvidence`).

### 4.1 Shop labor rates, and what a DIY line costs bought

A DIY line's range is parts and materials. The builder's hours are counted
(`RepairPlan.diyHoursTotal`) and priced at $0, which is why the same task
bought from a shop needs its own number: every line carries `pro`, the same
parts plus `diyHours × SHOP_RATE[tier]`. A line that is already `who: 'pro'`
prices at its own range — its labor is inside the tier table already, and
charging it twice would be double counting.

`SHOP_RATE` (`src/salvage/tiers.ts`) is the posted body/refinish rate, because
DIY lines are panel fit, lamps, cooling, interior and bolt-on mechanicals:

| Tier       | $/h | Basis                                                                                                                                                                      |
| ---------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| mainstream | 86  | US national average posted body rate, June 2026 ($86 body, $85 refinish, $117 frame, $163 mechanical); a tiered shop sheet posts non-luxury body/refinish at the same $86. |
| premium    | 110 | The same sheet's luxury tier: body/refinish $110, frame and aluminum $182, mechanical $173.                                                                                |
| exotic     | 193 | The same sheet's exotic tier: body/refinish $193, mechanical $228, carbon fiber and structural aluminum $233 — a 2.2× exotic-to-mainstream ratio consistent with §4 above. |

Sources: [Autobody News labor rate index (NABR posted rates, June 2026)](https://www.autobodynews.com/regional/midwest-regional-news/labor-rate-index-national-data-shows-mechanical-labor-rates-rising-faster-than-body-refinish),
[Formula First Collision posted rate sheet, effective 2026-04-13](https://formulafirstcollision.com/pricing/).

Two honest limits. The mechanical rate runs 35–65% above the body rate, so
`pro` on a drivetrain line (a used engine or gearbox swap) is a floor, not a
quote. And a single posted sheet is one shop's prices; it is used because it
publishes the segment split that the national index does not, and both agree
on the mainstream anchor.

Each line also names the equipment its task cannot be done without —
`requires: ('structural' | 'paint' | 'alignment' | 'hv')[]`, empty when hand
tools and a driveway suffice. Structural lines need a frame rack or factory
jig, the paint program needs a booth, suspension-corner and four-wheel-geometry
lines need an alignment rack, and every high-voltage line needs isolation
tooling and the training that goes with it. The bidder layer reads this to
decide which DIY lines a particular buyer has to buy instead.

## 5. Auction-side fees

`src/salvage/fees.ts`, public (non-licensed) buyer, non-clean title,
secured funds. Copart's own fee page is bot-blocked; the schedule is
reproduced from a licensed broker's help center and cross-checked against
an independently maintained calculator (rates verified 2026-07-15):

- Buyer fee: bracket table to $14,999.99 ($1,000 at $10,000–14,999.99),
  then **7.5% of the hammer, uncapped** (7.25% clean title; 12.25–12.5%
  unsecured).
- Virtual bid fee (live): $50 → $160 above $8,000. Gate $95 (non-clean),
  environmental $15, title mailing $20, Copart broker charge $100.
- **Broker fee for non-dealers is a percentage with a floor**:
  AutoBidMaster premium greater of $150 or 4%, SalvageBid VIP 3–4%; a
  flat-fee broker (~$350) is the low case and a sensitivity row. On a
  $300k lot the difference is five figures.
- Bidding power: a deposit of about 10% of the maximum bid must be on
  file; non-payment penalties run 10% of the sale price ($600 minimum).

Sources: [A Better Bid: Copart U.S. auction fees](https://help.abetter.bid/en/articles/5395529-copart-u-s-auction-fees),
[net-proceeds Copart fee calculator](https://www.net-proceeds.com/copart-fee-calculator/),
[Copart deposits and upgrades](https://www.copart.com/content/us/en/buyer/payments/deposits-and-upgrades),
[AutoBidMaster rules and policies](https://helpcenter.autobidmaster.com/hc/en-us/articles/360031300711-Rules-and-Policies),
[SalvageBid payment FAQ](https://www.salvagebid.com/faq/paying-for-vehicles).

## 6. Hidden-damage contingency

`contingencyRate`: 15% base, +10% heavy structural, +5% high-voltage
involved, +5% photo-triage confidence under 0.6, +5% odometer unknown,
capped at 40%, never below the tier dollar floor ($5,000 exotic, $2,500
premium, $1,000 mainstream) for module resets, fasteners, and fluids.

The anchor is Mitchell's estimating data: supplements over the first
appraisal average 52.9–60% when the estimate was written from photographs
against 30.5–34.5% for an in-person estimate — and a Copart bid is a
photo-based estimate. Rebuilder rules of thumb sit at 20–50%. The plan's
expected values already sit above their lows, which is why the base here
is 15% rather than 45%; the sensitivity rows show the ceiling with the
contingency waived after a yard visit. Sources:
[Repairer Driven News on Mitchell photo-estimating supplements](https://www.repairerdrivennews.com/2018/09/12/mitchell-photo-estimating-supplements-average-more-than-50-cost-of-original-appraisal/),
[Mitchell Q2 2018 industry data](https://mitchell.com/insights/auto-physical-damage/article/mitchell-collision-repair-industry-data-q2-2018),
[Partsmax salvage contingency](https://partsmax.co/blogs/news/salvage-title-vehicles-parts-availability-and-repair-considerations),
[TravelGumbo salvage math](https://www.travelgumbo.com/how-to-calculate-if-a-salvage-car-repair-is-actually-worth-the-money/).

## 7. Transport and the title process

Enclosed transport for a non-running exotic: $900–1,400 at 500 miles,
$1,450–2,000 at 1,000, $1,900–2,600 at 2,000, $2,200–3,100 coast to coast
for a true supercar, plus a $100–300 inoperable surcharge; forklift-only
loads are unquoted. Carrier cargo insurance typically covers $250,000,
below the value of the car. Sources:
[Montway enclosed transport](https://www.montway.com/enclosed-auto-transport),
[Mercury Auto Transport](https://mercuryautotransport.com/how-much-does-enclosed-auto-transport-cost/),
[SAKAEM exotic transport 2026](https://sakaemlogistics.com/exotic-car-transport-cost/),
[Tempus Logix inoperable transport](https://tempuslogix.com/inoperable-vehicle-transport/).

Rebuilt-title process: IL $75–94 inspection + $150 title, licensed
rebuilder required and a second Secretary of State police inspection on
cars eight model years or newer; WA $65 WSP inspection; PA enhanced
inspection at an unpublished, station-set price; MI $100 (again on
failure); CA $50 revival inspection plus the salvage certificate. Modeled
$130–600 all-in; registration and use tax are separate and larger.
Sources: [Ill. Admin. Code 92 §1020.80](https://www.law.cornell.edu/regulations/illinois/Ill-Admin-Code-tit-92-SS-1020.80),
[RCW 46.12.560](https://app.leg.wa.gov/rcw/default.aspx?cite=46.12.560),
[PennDOT reconstructed vehicle inspection](https://www.pa.gov/agencies/dmv/vehicle-services/inspection-and-safety-requirements/specially-constructed-reconstructed-modified-vehicle-inspection),
[Michigan TR-13A](https://www.michigan.gov/sos/-/media/Project/Websites/sos/Vehicle/Salvage-Vehicle/tr13a.pdf),
[CA DMV revived salvage](https://www.dmv.ca.gov/portal/handbook/vehicle-industry-registration-procedures-manual-2/salvage-nonrepairable-junk-vehicles/revived-salvage-california-record/).

## 8. Who wins these auctions, and what that means for the verdict

Exporters with regulatory arbitrage into markets with lower repair
standards, shops with in-house labor whose cost curve differs from the
insurer's total-loss math, and dismantlers with parts channels. The wreck
market they make is shown beside the ceiling: when its median sits above
the ceiling, the report says to expect to lose the room; it never turns
the verdict, because a market that outbids the math is a fact about the
competition, not about the car. Sources:
[WC Shipping international-buyer guide](https://www.wcshipping.com/blog/top-salvage-car-auctions-for-international-buyers-in-2025),
[Copart buyer-segment analysis](https://aiinstitute.hbs.edu/platform-digit/submission/copart-the-monopoly-youve-never-heard-of/),
[Autoblog on the 812 rebuild](https://www.autoblog.com/news/rebuilding-a-wrecked-ferrari-812-shows-why-cheap-supercars-are-a-myth).

`MARKET_PERSONA` in `src/assessments/buyer-profile.ts` stands in for that
bidder in the arithmetic: the shop preset's equipment and rates (§11), a direct
licensed account so no broker charge applies (§5), a retail exit (§12) and the
kernel's own 0.75 discipline (§1). The constant states `US-unspecified`,
because the persona describes resources and an exit rather than a residence,
but the priced persona registers the car where the buyer does: `buyerLedger`
solves it through the buyer's own title process (§13), so a state's fees move
both ceilings together and the title process is never an edge. It carries no
cash line:
the room's price is set by capitalized shops and dismantlers whose limit is
margin per bay-hour rather than a budget, so its `maxAllIn` is the schema's
maximum and the cash arm never binds. Priced through the same `buyerLedger`
over the same plan and the same exit evidence, it answers what a professional
can pay for this lot, and the difference between that and the buyer's own
ceiling is the edge (SPEC 60). A bidder below it would have to bid above their
own ceiling to win, which is the walk the report states; a bidder above it
genuinely pays less than the room — a licensed account, a car that is never
sold — and the ledger names the lines that did it. The persona is an
assumption, not a measurement: it is one cost structure standing for a
distribution of them, and the wreck-market median beside the ceiling remains
the observed evidence of what the room actually paid.

## 9. What the public record could not answer (2026-08-17)

- No transacted rebuilt-title SF90 or 296 GTB exists anywhere public; the
  exotic retention band is a prior.
- Copart's own fee page, A Better Bid's own service-fee tiers, a forklift
  surcharge, PA's inspection price, marque-dealer ADAS calibration, an
  itemized US exotic paint invoice, the SF90 front e-axle and either
  model's HV pack at a real dealer price.
- Current (2024–2026) Mitchell/CCC supplement percentages; the figures used
  are 2017–2018 vintage and likely understate today.

## 10. Market observations from eBay Browse

`src/salvage/comps.ts` turns Browse `itemSummaries` into the typed comps the
exit kernel prices against (SPEC 38, 53). Every observation is an active ask,
never a sold price. Four screens decide whether a Browse result is a
whole-vehicle ask at all; model-year window, make/model identity, off-spec
variants and duplicate listings are then screened as everywhere else (§2).

**Fixed price only.** An item becomes an ask only when its `buyingOptions`
array contains `FIXED_PRICE`. An auction's `price.value` is the current bid —
a different price basis, and one that moves — and a summary that declares no
buying option states no ask at all, so an absent field excludes the item
rather than admitting it. The screen fails closed by design: an ask the
adapter cannot confirm is not evidence.

**Category.** The search is restricted to Cars & Trucks (`EBAY_CATEGORY_CARS`,
6001), which keeps most parts listings out of the result set before any title
is read.

**Not a whole vehicle.** A closed list of title words removes what remains:
deposits, down payments, monthly payments, reservation fees, shipping-only
charges, brochures, posters, diecast, scale models, toys, and standalone parts
written as `<part> only` or `<part> assembly`. The list is closed and reads
titles, never prices, so it cannot quietly grow into a heuristic.

**The whole-vehicle floor.** Exotic and premium lots (`tierFor`, §4) carry a
floor over their ask lanes, set by `wholeVehicleFloor(tier, year, now)`. A
four-figure ask under an applicable exotic title is parts money — a spoiler, a
wheel set, a seat — that the word list does not name, and an even-spread
sample puts it straight into the quartiles that set the exit low, and
therefore the ceiling. Mainstream lots carry no floor: a cheap mainstream
whole car is still a car, and a floor would delete real comps.

The floor is scoped to the clean and rebuilt lanes. A listing whose title
carries damage language is wreck evidence, and a wrecked premium or exotic car
under $10,000 is exactly what the wreck lane exists to record — the hammer
money the competition pays, shown beside the ceiling and never summed into it
(§8, SPEC 39). Applying a whole-car floor there would delete the observation
and leave the wreck band thinner than the market.

The floor itself is a judgment, not a sourced market figure. It is the
constant the module already applied to every marque, kept only where it is
safe; the category restriction and the word list do the bulk of the screening,
and the floor is the last pass for parts money nothing else names.

**The age bands.** A flat $10,000 is right for the catalog's exotics and wrong
for a premium marque's back catalogue. A twenty-year-old BMW or Lexus is a
clean-titled whole car under $10,000, and a flat floor over the ask lanes
struck it — deleting the only market that lot has, which matters as soon as an
owner brings a car of their own rather than picking one off the showroom.
`wholeVehicleFloor` therefore reads the lot's age off the collection date
(never the wall clock, so a replay screens the way the live run did) and bands
the premium tier: $10,000 through twelve model years, where the car still
sells as a late-model premium car; $4,000 from thirteen to twenty, where a
whole car is four figures but a wheel set or a seat is not; and no floor past
twenty, where a running car and its parts overlap in price and only the word
list separates them. An exotic keeps $10,000 at every age — a Diablo and a
Diablo's spoiler never converge — and a mainstream lot still carries none.
Each band names itself in the progress note (`premium, 13–20 model years:
whole cars list from $4,000`), so the screen a run applied is readable beside
what it dropped. The bands are planning assumptions, like the floor they
replace: no published source sets them, and an ask that a band strikes is
gone from the pool with no way to appeal it, which is why the loosest band is
no floor at all rather than a small one.

**The screens count what they drop.** The comps stage's closing note carries
the three counted screens beside what survived them —
`3 dropped: 2 no fixed price, 1 under the whole-vehicle floor, 0 outside this
lot's market`. A Browse schema change that stopped populating `buyingOptions`
would otherwise read as a market with no asks in it; counted, it reads as a
fetch that lost everything for one nameable reason (SPEC 10–11, 53).

The counts are per screen, and they read in the order the screens run.
`no fixed price` is tested first, over every item the search returned.
`under the whole-vehicle floor` is tested next, over every priced listing the
word list did not strike — and applicability runs after the floor, so a
sub-floor listing for the wrong model, the wrong year or the wrong variant is
counted there too. That figure therefore reads as _sub-floor asks this search
turned up_, not _cars for this lot struck as parts money_.
`outside this lot's market` is tested last, over what cleared the floor: the
model-year window, the make/model identity and the off-spec variants, which is
what a Cars & Trucks search for `<make> <model>` mostly returns. The three
counts and the eligible pool close against the number of item summaries the
search returned, less three kinds of item that raise no count: the ones the
word list struck; the ones Browse returned malformed — no title, no item URL,
a currency that is not USD, or a price that is not a positive number — because
a summary that states no ask is not an observation this lot lost; and a
repeat of a listing already held, which is folded into it rather than dropped
from the pool.

Survivors are sampled evenly across the eligible price distribution, at most
12 per lane. A top-price slice would call the expensive tail a market sample;
the even spread keeps both tails, which is what SPEC 53 requires. Browse
search is not itself a random sample of vehicle transactions, and what comes
out is asks — haircut to transacted money before they anchor anything (§2).

## 11. Buyer presets

The ceiling is a property of (lot, bidder), not of the lot: the same wreck has
a defensible ceiling for a hobbyist, another for an independent shop and a
third for a franchise dealer, because access, exit, equipment and the value of
an hour differ. `src/assessments/buyer-profile.ts` carries three presets as
starting assumptions and `custom` for what a buyer's own edits produce
(SPEC 50). Every value a buyer has not changed renders as an assumption chip on
the form; none of these is an industry average. Each has a ledger effect
through `buyerLedger` (SPEC 59), and a preset names resources and an exit
rather than a residence, so a stated jurisdiction never renames it. Equipment
moves the ledger one way only: a DIY line whose rack, booth, jig or tooling the
buyer does not own is bought at the tier's shop rate, while owning any of them
never lowers a line the kernel already priced professional (SPEC 35's one-way
ratchet), which is why a fully equipped shop still reads a ceiling no lower
than the plan's own professional prices. The market
persona of §8 is not among them: it is the reference the edge is measured
against, never a profile a buyer selects.

| Field                           | hobbyist                | shop                 | dealer                  |
| ------------------------------- | ----------------------- | -------------------- | ----------------------- |
| preset                          | hobbyist                | shop                 | dealer                  |
| jurisdiction                    | US-unspecified          | US-unspecified       | US-unspecified          |
| access                          | broker                  | direct               | direct                  |
| exit                            | private_party           | wholesale            | retail                  |
| discipline                      | 0.75                    | 0.75                 | 0.75                    |
| tools / workspace               | true / true             | true / true          | false / false           |
| lift                            | false                   | true                 | false                   |
| diagnostics                     | false                   | true                 | false                   |
| specialistAccess                | true                    | true                 | true                    |
| structural/paint/alignment/hv   | false/false/false/false | true/true/true/false | false/false/false/false |
| laborRatePerHour                | 25                      | 75                   | 0                       |
| availableDiyHours               | 200                     | 300                  | 0                       |
| holdingDays / holdingCostPerDay | 90 / 10                 | 45 / 25              | 30 / 40                 |
| maxAllIn                        | 40000                   | 150000               | 250000                  |
| minSurplus                      | 5000                    | 15000                | 20000                   |

**Hobbyist.** The wedge, and therefore the product default. A non-dealer cannot
hold a Copart or IAA account, so `access` is `broker` and the fee is the
percentage-with-a-floor of §5 (AutoBidMaster greater of $150 or 4%, SalvageBid
VIP 3–4%, a flat-fee broker around $350 as the low case). The exit is a private
sale, which pays the steepest rebuilt-title discount of the four channels (§2).
Tools, a workspace and a phone number for a specialist are assumed; a lift,
scan tools, a frame rack, a booth, an alignment rack and high-voltage tooling
are not, and structural work on carbon or aluminum stays professional for
everyone regardless (SPEC 35). The remaining numbers — $25/hour for weekend
time, 200 available hours, 90 days at $10/day for insurance, registration and
a garage, a $40,000 cash limit and $5,000 of required surplus — are assumption,
no source: they describe an enthusiast who can afford one project, not a
measured population.

**Independent shop.** A business license buys a direct account, so the broker
percentage disappears and the licensed-buyer schedule applies (§5). The exit is
wholesale to a dealer: faster and thinner than retail, which is what a shop
whose scarce resource is bay-hours actually wants. The equipment list is what
separates a shop from an enthusiast — lift, scan tools, frame rack, booth and
alignment rack — while high-voltage training is left false because it is a
separate certification a general shop does not automatically hold. The
$75/hour is the shop's internal cost of a bay-hour, not its door rate: the
national average posted labor rate is $132/hour across more than 10,000 shops,
spanning $85 to $197 by state ([Tekmetric, average auto repair labor rates by
state](https://www.tekmetric.com/post/average-auto-repair-labor-rates-by-state)),
and the internal figure sits below it because the door rate carries overhead
and margin the shop is not paying itself. The split between the two is
assumption, no source. 45 holding days sits between the 40-day average turn a
floor-plan lender's worked example assumes and the 60-day point at which it
calls a unit frozen capital ([Cox Automotive, three floor plan finance
formulas](https://www.coxautoinc.com/insights/three-floor-plan-finance-formulas-every-dealer-know/));
$25/day, 300 bay-hours, $150,000 of cash and $15,000 of required surplus are
assumption, no source.

**Dealer.** A dealer license and inventory capital, and no hands: the work is
subcontracted, so every capability except specialist access is false and there
are no DIY hours to price, which is why `laborRatePerHour` is 0 rather than a
rate nobody pays. The exit is retail on the lot, the channel that pays the most
and demands the most reconditioning and the most turn discipline. 30 days is
the turn that a floor-plan lender calls twelve turns a year and the threshold
below which curtailment pressure disappears ([Kinetic Advantage, the true cost
of aged inventory](https://www.kineticadvantage.com/true-cost-aged-inventory/));
$40/day is inside every published loaded figure — a worked dealer example
divides total monthly holding expense to $44.63 per unit per day (Cox
Automotive, above), and the same lender puts units past 60 days at $40–75/day
once depreciation and opportunity cost are included, while direct costs alone
run $12–20/day. The $250,000 cash limit and $20,000 of required surplus are
assumption, no source; both stand for a portfolio bidder rather than a person.

**Discipline.** 0.75 for all three presets. It is the kernel's existing
discipline share (§1), which describes the marginal professional rebuilder, and
no calibration evidence yet says a hobbyist should hold a tighter one or a
dealer a looser one. The field exists so a buyer can tighten it and so that
calibration (§4.4 of the bidding-desk initiative) has somewhere to land; until
outcomes support a per-segment value, moving it per preset would be inventing
precision.

**Jurisdiction.** `US-unspecified` for all three. An unspecified jurisdiction
cannot pass the registration-eligibility gate (SPEC 50), so the preset states
the absence rather than guessing a state, and the buyer supplies it.

## 12. Exit channels

`EXIT_CHANNELS` (`src/salvage/exit-channels.ts`, re-exported by `tiers.ts`)
says what each way of leaving the car costs to sell and where it transacts
against the private-party money the exit lanes estimate (§2). The tier's own
`selling` band stays the vehicle-relative default; the channel band is what
the bidder layer applies when a buyer states one.

| Channel         | Selling cost (share of exit) | Exit factor | Basis                                                                                                                                          |
| --------------- | ---------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `private_party` | 0.8–2.5%, expected 2%        | 1.00        | Listing, detailing, photography, paperwork, PPI (§3). The exit lanes already estimate private-party money, so nothing shifts.                  |
| `wholesale`     | 3–5%, expected 4%            | 0.80–0.90   | Dealer-auction run, simulcast, condition-report and post-sale-inspection charges, plus transport to the lane and arbitration exposure.         |
| `retail`        | 6–10%, expected 8%           | 1.00–1.05   | Reconditioning to frontline, the dealer pack that absorbs lot overhead, floorplan interest, and F&I income booked net of a chargeback reserve. |
| `keep`          | 0%                           | 1.00        | No sale is planned; the car is valued at the private-party typical as money retained. Holding costs belong to the buyer profile, not here.     |

Every percentage is an estimate. Auction and lot costs are flat per unit in
the real world, so a share of the exit overstates them on an expensive car and
understates them on a cheap one, and each `basis` string says so.

**Wholesale.** Neither Manheim nor ADESA publishes a percentage seller fee —
the charges are flat tiers negotiated by volume, and industry guidance budgets
roughly $400–700 a unit across both sides, so 3–5% is an estimate covering the
fees plus transport and arbitration exposure. The 0.80–0.90 exit factor comes
from the 25–40% dealer markup between auction acquisition and retail asking
price, shaded conservative because a branded title thins the dealer bid too.
Sources: [Manheim terms and conditions](https://site.manheim.com/en/marketplace-policies/us-policies/manheim-terms-and-conditions.html),
[wholesale-to-retail gap, 2026](https://otdcheck.com/blog/wholesale-vs-retail-car-price-gap-2026).

**Retail.** Reconditioning runs $500–1,500 a unit ($1,112 is a commonly cited
national figure), the pack that absorbs advertising and lot expense $800–1,200,
floorplan interest about $150–220 a month per unit, and F&I revenue is
recognized net of an estimated chargeback reserve. On a mid-five-figure sale
that is 6–10%. The 1.00–1.05 exit factor is deliberately thin: a reconditioned,
warrantied car on a lot asks a little more than a private seller, but a rebuilt
title is where retail financing dries up, which caps what the counter can add.
Sources: [NIADA reconditioning best practices](https://niada.com/dashboard/auto-reconditioning-best-practices/),
[independent used-car dealer bookkeeping: floorplan, pack, F&I chargeback reserve](https://beancount.io/blog/2026/05/26/independent-used-car-dealer-bookkeeping-floorplan-financing-curtailment-fi-reserve-holdback-chargeback-recon-wip-form-8300-ftc-used-car-rule-bhph-repossession-loss-reserve-guide).

**Keep.** Zero selling cost is not a modeling convenience: nothing is sold, so
nothing is paid to sell it. Reporting the exit at the private-party typical
states what is retained, and the report has to say no sale is planned rather
than implying one.

## 13. Title process by state

The tier default (§7) is a national band — $130–600 on the mainstream tier,
$150–600 on premium and exotic. `titleProcessFor`
(`src/salvage/title-process.ts`) replaces it with the issuing state's own fees
when the buyer states a jurisdiction; anything else — an untabulated state,
`US-unspecified` — keeps the tier band and appends "state not tabulated" to its
basis rather than borrowing a neighbor's fee. Registration and use tax are
separate and larger, and are outside every number here, exactly as in §7.

Each band is the published fee at its low and the published fee plus the
add-ons a rebuild actually meets — a re-inspection, a private inspection
station's own charge, a safety certificate — at its high.

| State   | Band     | What it covers                                                                                                                                                                                                                                                       | Source                                                                                                                                                                                                |
| ------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `US-CA` | $375–700 | $50 DMV salvage/dismantled inspection plus the Vehicle Safety Systems Inspection that replaced the brake-and-lamp certificate in September 2024 (BAR stations quote $295–500), plus title and VIN verification. The most expensive tabulated state.                  | [CA DMV VIRP 19.065 Revived Salvage](https://www.dmv.ca.gov/portal/handbook/vehicle-industry-registration-procedures-manual-2/salvage-nonrepairable-junk-vehicles/revived-salvage-california-record/) |
| `US-TX` | $140–300 | $65 rebuilt salvage fee, $28–33 title application, $8 salvage title application, ~$40 anti-theft inspection.                                                                                                                                                         | [43 Tex. Admin. Code §217.89](https://www.law.cornell.edu/regulations/texas/43-Tex-Admin-Code-SS-217-89)                                                                                              |
| `US-FL` | $130–300 | $40 FLHSMV rebuilt inspection, $20 per re-inspection; private Pilot Rebuilt Vehicle Inspection Program stations post $110–130 instead.                                                                                                                               | [FLHSMV procedure TL-37](https://flrules.org/gateway/readRefFile.asp?refId=15232&filename=TL-37.pdf)                                                                                                  |
| `US-NY` | $250–400 | $200 with an MV-907A salvage certificate ($150 anti-theft examination + $50 title), $205 with other proof of ownership; a missed appointment costs another $150.                                                                                                     | [NY DMV salvage vehicle examination](https://dmv.ny.gov/salvage/the-salvage-vehicle-examination)                                                                                                      |
| `US-PA` | $150–600 | Enhanced reconstructed-vehicle inspection at a station-set price PennDOT does not publish, plus the title fee. The price itself is assumption, no source.                                                                                                            | [PennDOT reconstructed vehicle inspection](https://www.pa.gov/agencies/dmv/vehicle-services/inspection-and-safety-requirements/specially-constructed-reconstructed-modified-vehicle-inspection)       |
| `US-IL` | $225–400 | $75–94 Secretary of State inspection + $150 title; a licensed rebuilder and a second police inspection on cars eight model years or newer.                                                                                                                           | [Ill. Admin. Code 92 §1020.80](https://www.law.cornell.edu/regulations/illinois/Ill-Admin-Code-tit-92-SS-1020.80)                                                                                     |
| `US-OH` | $70–150  | $50 State Highway Patrol salvage inspection (forfeited on a missed appointment) + $4 salvage title, both set by the statute; the ~$15 rebuilt-salvage title is an assumption, no source. The cheapest tabulated state.                                               | [ORC §4505.11](https://codes.ohio.gov/ohio-revised-code/section-4505.11)                                                                                                                              |
| `US-GA` | $120–250 | $100 statutory inspection: $118 to the Department of Revenue with the $18 title fee when a state inspector does it, or $18 plus the station's own ~$100–125 for a private inspection; $100 again on a re-inspection.                                                 | [Georgia DOR: titles for rebuilt or restored vehicles](https://dor.georgia.gov/titles-rebuilt-or-restored-vehicles)                                                                                   |
| `US-NC` | $60–200  | State Highway Patrol Investigative Services Unit anti-theft inspection on vehicles six model years old or newer, plus the title fee. NCDMV publishes neither amount, so the band is an assumption around the ~$50 inspection and ~$56 title secondary guides report. | [NCDMV vehicle title special cases](https://www.ncdot.gov/dmv/title-registration/special-cases/pages/default.aspx)                                                                                    |
| `US-MI` | $100–250 | $100 salvage vehicle inspection, charged again on a failure, plus the title fee. A scrap certificate cancels the VIN outright and no title follows (§4).                                                                                                             | [Michigan SOS TR-13A](https://www.michigan.gov/sos/-/media/Project/Websites/sos/Vehicle/Salvage-Vehicle/tr13a.pdf)                                                                                    |
| `US-WA` | $100–250 | $65 Washington State Patrol inspection plus title and inspection-related fees.                                                                                                                                                                                       | [RCW 46.12.560](https://app.leg.wa.gov/rcw/default.aspx?cite=46.12.560)                                                                                                                               |
| `US-AZ` | $55–150  | $50 Level III ADOT inspection (+$5 when an Arizona VIN is assigned) + $4 title fee.                                                                                                                                                                                  | [ADOT: how do I apply for a restored salvage title](https://azdot.gov/faq/how-do-i-apply-restored-salvage-title)                                                                                      |

Twelve states are tabulated because they are where the seeded lots and the
largest salvage markets are; the fallback is not a gap but the honest answer
for the other thirty-eight states, the District of Columbia and the
territories. The spread that matters is real: the same rebuild
that owes $70 in Ohio owes $375 in California before a plate is issued.

## 14. Revising a constant from outcomes

Every constant above is a sourced prior, not a fitted parameter. Recorded
outcomes can argue with one, and the calibration view on the workspace is where
that argument is read: `summarizeOutcomes` in
`src/assessment-reporting/outcomes.ts` compares each forecast with the outcomes
observed after it and states the denominator it read each statistic over
(SPEC 63). The view never changes a constant. A change is a decision a person
makes, and all three of these hold before a tier table in `src/salvage/tiers.ts`
or `src/salvage/fees.ts`, or the discipline default `DISCIPLINE_SHARE` in
`src/salvage/ceiling.ts`, moves:

1. **Twenty distinct lots in the relevant statistic for that tier.** Use the
   statistic row's own denominator (its `over N …` basis line), counting one
   matched observation per assessment, not the disclosure summary's count of
   outcome records. Each observation must follow the decision revision it is
   read against, on a live assessment, with the figure and its forecast
   counterpart both present; fixtures and unmatched observations do not count.
   Repeated reports of one lot cannot increase this sample. Twenty is the count
   for the tier whose constant would move. The view reports the desk as a whole,
   so select that tier's observations from the assessments' own lots (`tierFor`)
   by hand and recompute the residual's quartiles over that same sample until
   the view itself segments; a desk-wide sample of twenty carrying three exotic
   lots argues for nothing exotic.
2. **The residual's sign is consistent across the interquartile range.** Both
   quartiles of that same per-tier sample are on the same side of zero. A median away
   from zero whose quartiles straddle it is spread rather than bias: the
   constant is not wrong, the lots differ, and a constant moved on that reading
   would chase noise. The repair residual argues about a tier's repair tables,
   the exit residual about its exit bands net of the channel's selling line,
   and the hammer against both ceilings about what the room will pay rather
   than about a cost at all. The exit residual is actual net sale proceeds minus
   the compared revision's typical exit net of its expected selling costs; a
   revision without that selling line is excluded from this statistic alone.
3. **The change is recorded in the constant's own basis string**, with the ids
   of the outcomes that argued for it and the date, beside the published source
   the prior came from. The basis is what the report shows a reader, so a figure
   that stopped being the published number must stop claiming to be it. A
   constant with no basis string of its own gets one in the same change.

Nothing retrains. No model proposes a constant, no schedule fits one, and an
owner's note is not a measurement on its own. The change is a commit like any
other: the constant, its basis, the evaluation artifacts re-run and committed,
and the decision cohort re-read, because a constant that moves moves every
verdict solved from it.
