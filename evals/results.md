# Eval results

- date: 2026-09-12 · git: 024347e · mode: offline

## Resolver suite

- pipeline: tokenize → source-aware catalog resolution (deterministic, no model call)
- score: **47/47**

| # | query | expectation | result |
|---|-------|-------------|--------|
| 1 | `e46 m3` | top-5: BMW M3; within years: 1999–2006 | ✅ |
| 2 | `f80 m3` | top-5: BMW M3; within years: 2014–2018 | ✅ |
| 3 | `996 turbo` | top-5: Porsche 911 Turbo evidence: trim Turbo; candidates: Porsche /^911 Carrera/ unresolved: trim Turbo; within years: 1999–2005; assumption /turbo trim\|turbo names a distinct model line/ | ✅ |
| 4 | `996 no turbo` | top-5: Porsche /^911 Carrera/; absent: Porsche /Turbo/; all unresolved: excluding trim.*Turbo; no match credit: excluding trim.*Turbo; within years: 1999–2005 | ✅ |
| 5 | `turbo miata` | top-5: Mazda MX-5 Miata evidence: aspiration: Turbo; candidates: Mazda /^MX-5/ unresolved: ^aspiration$ | ✅ |
| 6 | `miata na` | top-5: Mazda MX-5 Miata; within years: 1990–1997 | ✅ |
| 7 | `992 gt3 touring` | top-5: Porsche 911 GT3 Touring evidence: trim GT3, trim Touring; candidates: Porsche 911 GT3 unresolved: trim Touring; within years: 2019–2026 | ✅ |
| 8 | `992gt3` | top-5: Porsche 911 GT3 evidence: trim GT3; within years: 2019–2026 | ✅ |
| 9 | `gt3rs` | top-5: Porsche 911 GT3 RS evidence: trim GT3 RS | ✅ |
| 10 | `911 90s` | top-5: Porsche /^911(?: \|$)/; within years: 1990–1999 | ✅ |
| 11 | `e30` | top-5 contains: BMW M3, BMW /^325/; within years: 1982–1994 | ✅ |
| 12 | `ek9` | top-5: Honda Civic 1996–2000; assumption /jdm/ | ✅ |
| 13 | `mk4 supra` | top-5: Toyota Supra 1993–1998 | ✅ |
| 14 | `mk4 supra tt` | top-5: Toyota Supra unresolved: trim Turbo; no match credit: trim Turbo; within years: 1993–1998; assumption /turbo trim/ | ✅ |
| 15 | `audi tt` | top-8: Audi /^TT(?: \|$)/ | ✅ |
| 16 | `c7` | top-5 contains: Chevrolet Corvette, Audi /^A6/; fork: [Chevrolet, Audi] | ✅ |
| 17 | `c7 rs7` | top-5: Audi RS 7; absent: Chevrolet Corvette; within years: 2012–2018; fork: [Audi] | ✅ |
| 18 | `c7 z06` | top-5: Chevrolet Corvette unresolved: trim Z06; no match credit: trim Z06; within years: 2014–2019; fork: [Chevrolet] | ✅ |
| 19 | `mk4` | top-5 contains: Toyota Supra, Volkswagen Golf, Volkswagen Jetta; fork: [Toyota, Volkswagen, Volkswagen] | ✅ |
| 20 | `r32` | top-5 contains: Volkswagen R32; absent: Nissan /.*/; fork: [Nissan, Volkswagen] | ✅ |
| 21 | `c5` | top-5: Chevrolet Corvette 1997–2004 | ✅ |
| 22 | `2jz` | top-5 contains: Toyota Supra, Lexus IS 300, Lexus SC 300/SC 400; candidates: Lexus SC 300/SC 400 unresolved: engine fitment alternatives; all unresolved: 2jz.*exact engine, engine layout; no match credit: ships with, ^2jz$ | ✅ |
| 23 | `ls1` | top-5 contains: Chevrolet Corvette, Chevrolet Camaro; all unresolved: ls1.*exact engine, engine layout; no match credit: ships with, ^ls1$ | ✅ |
| 24 | `1jz` | nothing; assumption /jdm/ | ✅ |
| 25 | `rb26` | nothing; assumption /jdm/ | ✅ |
| 26 | `skyline` | nothing; assumption /never sold/ | ✅ |
| 27 | `v10` | top-10 contains: Dodge /^Viper(?: \|$)/, Audi /^R8(?: \|$)/; all unresolved: engine layout; no match credit: engine layout | ✅ |
| 28 | `type r` | top-5: Honda Civic 5Dr - Type R evidence: Type R; candidates: Acura Integra unresolved: engine fitment alternatives; absent: Subaru /.*/ | ✅ |
| 29 | `hellcat` | top-5 contains: Dodge Challenger, Dodge Charger; all unresolved: engine fitment alternatives; no match credit: Hellcat | ✅ |
| 30 | `sti` | top-5: Subaru /^WRX STI(?: \|$)/ evidence: trim STI; candidates: Subaru WRX unresolved: trim STI | ✅ |
| 31 | `evo` | top-5: Mitsubishi Lancer Evolution evidence: trim Evolution; candidates: Mitsubishi Lancer unresolved: trim Evolution | ✅ |
| 32 | `quadrifoglio` | top-5 contains: Alfa Romeo Giulia unresolved: trim Quadrifoglio; all unresolved: trim Quadrifoglio; no match credit: trim Quadrifoglio | ✅ |
| 33 | `zr1` | top-5 contains: Chevrolet Corvette unresolved: trim ZR1 or ZR-1; all unresolved: trim ZR1 or ZR-1; no match credit: trim ZR1 | ✅ |
| 34 | `raptor` | top-5: Ford /^F150 RAPTOR/ evidence: trim Raptor; candidates: Ford /^F150 Pickup/ unresolved: trim Raptor | ✅ |
| 35 | `amg gt` | top-15: Mercedes-Benz /^AMG GT(?: \|$)/ | ✅ |
| 36 | `naturally aspirated flat six manual coupe` | candidates: Porsche /^911(?: \|$)/ evidence: cylinders: 6; all unresolved: engine layout, aspiration, body Coupe, manual; no match credit: engine layout, ^aspiration, ^body; unfilterable: manual | ✅ |
| 37 | `brown wagon manual diesel` | top-10 contains: Volkswagen Jetta evidence: fuel: DIESEL; all unresolved: body Wagon, brown, manual; no match credit: ^body; unfilterable: brown, manual | ✅ |
| 38 | `awd wagon` | top-5 contains: Subaru Outback AWD evidence: drive: AWD; all unresolved: body Wagon; no match credit: ^body | ✅ |
| 39 | `911 no pdk` | top-5: Porsche /^911(?: \|$)/; all unresolved: pdk; no match credit: pdk; unfilterable: pdk | ✅ |
| 40 | `996 2010` | nothing | ✅ |
| 41 | `wrx 2019+` | top-5 contains: Subaru WRX | ✅ |
| 42 | `ae86` | top-5: Toyota Corolla 1984–1987 | ✅ |
| 43 | `s2000` | top-5: Honda S2000 2000–2009 | ✅ |
| 44 | `zzr9000 blorp` | nothing | ✅ |
| 45 | `991 gt3rs` | top-5: Porsche 911 GT3 RS evidence: trim GT3 RS; within years: 2016–2019; assumption /2016–2019/ | ✅ |
| 46 | `997 gt3 rs` | top-5: Porsche 911 GT3 RS evidence: trim GT3 RS; within years: 2007–2012; assumption /2007–2012/ | ✅ |
| 47 | `gen 1 facelift audi r8` | top-5 contains: Audi /^R8(?: \|$)/; all unresolved: generation boundaries are unavailable; assumption /no generation data\|boundaries are unavailable/ | ✅ |

## Inspector suite

- pipeline: full agent orchestration over recorded fixtures (vision, research, NHTSA, vPIC, sweep) — offline, frozen clock
- cases: **10/10** · checks: **28/28** (invariant 13/13 · behavior 10/10 · honesty 5/5)

| case | check | class | spec | result |
|------|-------|-------|------|--------|
| clean car, full pipeline | the report is the final event of a successful run | invariant | SPEC 25 | ✅ |
| clean car, full pipeline | clean car earns a pass verdict | behavior |  | ✅ |
| clean car, full pipeline | every stage announces begin before its status lands (stage rail contract) | invariant |  | ✅ |
| clean car, full pipeline | model and fetch calls stream trace spans with timings | invariant |  | ✅ |
| clean car, full pipeline | the subject listing never appears in its own comp set | invariant | SPEC 27 | ✅ |
| clean car, full pipeline | the federal decode fills model/body/plant and finds no mismatch | behavior |  | ✅ |
| clean car, full pipeline | the VIN section never prints a history verdict — it links the services that do check | honesty | SPEC 26 | ✅ |
| rust changes the research path | two cars with different photos produce different research paths | behavior | SPEC 23 | ✅ |
| rust changes the research path | every research topic states the reason it was chosen | invariant | SPEC 23 | ✅ |
| rust changes the research path | high-severity rust pulls the verdict to caution | behavior |  | ✅ |
| rust changes the research path | cited repair costs surface in the report for the money panel | behavior |  | ✅ |
| uncited claims do not survive | findings without a valid http(s) source are discarded during validation | invariant | SPEC 22 | ✅ |
| uncited claims do not survive | the cited critical finding survives and becomes a red flag | behavior |  | ✅ |
| photo anchors are validated | out-of-range anchors are dropped, the finding keeps none | invariant | SPEC 21 | ✅ |
| photo anchors are validated | the de-anchored finding still reaches the report | behavior |  | ✅ |
| federal identity mismatch forces avoid | the mismatch cites the federal database | behavior |  | ✅ |
| federal identity mismatch forces avoid | an identity mismatch is an automatic avoid | behavior |  | ✅ |
| missing key refuses honestly | no key means an honest fatal, not a mocked inspection | honesty | SPEC 24 | ✅ |
| missing key refuses honestly | the vision stage reports its failure before the fatal | honesty | SPEC 24 | ✅ |
| stage isolation under dead upstreams | NHTSA failure yields a named degraded status, not a crash | invariant | SPEC 24 | ✅ |
| stage isolation under dead upstreams | no comps means a visibly degraded market stage, not a guess | invariant | SPEC 27 | ✅ |
| stage isolation under dead upstreams | independent failures never kill the run | invariant | SPEC 24 | ✅ |
| stage isolation under dead upstreams | the report carries the degraded stages for the UI to show | honesty |  | ✅ |
| malformed vision output is fatal, not papered over | unparseable vision output ends the run with a validation error | honesty |  | ✅ |
| VIN provenance is citation-gated | uncited sightings are discarded; the subject listing is excluded | invariant | SPEC 22 | ✅ |
| VIN provenance is citation-gated | date and price ride along verbatim | behavior |  | ✅ |
| determinism under a frozen clock | two runs over identical fixtures produce identical reports | invariant |  | ✅ |
| determinism under a frozen clock | generatedAt comes from the injected clock | invariant |  | ✅ |

## Salvage money-model suite

- pipeline: recorded live traces (triage + cited research) replayed through the current money model, graded per check
- cases: **8/8** · checks: **131/131** (invariant 50/50 · realism 39/39 · honesty 22/22 · behavior 20/20)

| case | check | class | spec | result |
|------|-------|-------|------|--------|
| huracan-dead-title | the verdict is bid or no bid | invariant | SPEC 45 | ✅ |
| huracan-dead-title | a damage program carries at most one structural line | invariant | SPEC 43 | ✅ |
| huracan-dead-title | every cost line carries a basis and an evidence chip | invariant | SPEC 36 | ✅ |
| huracan-dead-title | every comp behind the exit has a positive price and an http(s) source | invariant | SPEC 44 | ✅ |
| huracan-dead-title | the ceiling is the highest $500 step whose all-in stays at or under discipline | invariant | SPEC 39 | ✅ |
| huracan-dead-title | a zero ceiling names its killers and its unlocks | invariant | SPEC 39 | ✅ |
| huracan-dead-title | a dealbreaker forces no bid regardless of the money | invariant | SPEC 36 | ✅ |
| huracan-dead-title | the exit is a band: low ≤ typical ≤ high, high under 2.6× low (a 1.4/0.7 comp spread times the 0.65/0.5 discount band) | realism |  | ✅ |
| huracan-dead-title | a derived exit sits below the clean money it derives from | realism |  | ✅ |
| huracan-dead-title | the wreck market is a plausible band: no pocket change, high under 4× low | realism |  | ✅ |
| huracan-dead-title | no wreck comp used sits at clean money | realism |  | ✅ |
| huracan-dead-title | stress ≤ ceiling ≤ break-even | realism |  | ✅ |
| huracan-dead-title | the hidden-damage contingency never sits below the tier floor | realism |  | ✅ |
| huracan-dead-title | a no-bid verdict never carries "Bid to" copy | honesty |  | ✅ |
| huracan-dead-title | the exit basis names its hosts or confesses a derivation | honesty |  | ✅ |
| huracan-dead-title | a dead rebuild lane states its veto in the summary | honesty |  | ✅ |
| huracan-dead-title | verdict is walk | behavior |  | ✅ |
| huracan-dead-title | a dealbreaker is stated | behavior |  | ✅ |
| huracan-dead-title | the verdict does not flip on the wreck market | behavior | SPEC 45 | ✅ |
| sf90-clean-anchor-strong | the verdict is bid or no bid | invariant | SPEC 45 | ✅ |
| sf90-clean-anchor-strong | a damage program carries at most one structural line | invariant | SPEC 43 | ✅ |
| sf90-clean-anchor-strong | every cost line carries a basis and an evidence chip | invariant | SPEC 36 | ✅ |
| sf90-clean-anchor-strong | every comp behind the exit has a positive price and an http(s) source | invariant | SPEC 44 | ✅ |
| sf90-clean-anchor-strong | the ceiling is the highest $500 step whose all-in stays at or under discipline | invariant | SPEC 39 | ✅ |
| sf90-clean-anchor-strong | a zero ceiling names its killers and its unlocks | invariant | SPEC 39 | ✅ |
| sf90-clean-anchor-strong | the exit is a band: low ≤ typical ≤ high, high under 2.6× low (a 1.4/0.7 comp spread times the 0.65/0.5 discount band) | realism |  | ✅ |
| sf90-clean-anchor-strong | a derived exit sits below the clean money it derives from | realism |  | ✅ |
| sf90-clean-anchor-strong | stress ≤ ceiling ≤ break-even | realism |  | ✅ |
| sf90-clean-anchor-strong | the hidden-damage contingency never sits below the tier floor | realism |  | ✅ |
| sf90-clean-anchor-strong | a no-bid verdict never carries "Bid to" copy | honesty |  | ✅ |
| sf90-clean-anchor-strong | a zero ceiling says what ate it and what would have to be true | honesty |  | ✅ |
| sf90-clean-anchor-strong | the exit basis names its hosts or confesses a derivation | honesty |  | ✅ |
| sf90-clean-anchor-strong | exit lane is clean_sold_derived | behavior |  | ✅ |
| sf90-clean-anchor-strong | the verdict does not flip on the wreck market | behavior | SPEC 45 | ✅ |
| sf90-ebay-screening | the verdict is bid or no bid | invariant | SPEC 45 | ✅ |
| sf90-ebay-screening | a damage program carries at most one structural line | invariant | SPEC 43 | ✅ |
| sf90-ebay-screening | every cost line carries a basis and an evidence chip | invariant | SPEC 36 | ✅ |
| sf90-ebay-screening | every comp behind the exit has a positive price and an http(s) source | invariant | SPEC 44 | ✅ |
| sf90-ebay-screening | no eBay comp comes from a listing that does not declare a fixed price | invariant | SPEC 53 | ✅ |
| sf90-ebay-screening | no eBay ask comp on an exotic or premium lot is priced below $10,000 | invariant | SPEC 53 | ✅ |
| sf90-ebay-screening | the comps progress note states what the screens dropped | invariant | SPEC 53 | ✅ |
| sf90-ebay-screening | the ceiling is the highest $500 step whose all-in stays at or under discipline | invariant | SPEC 39 | ✅ |
| sf90-ebay-screening | a zero ceiling names its killers and its unlocks | invariant | SPEC 39 | ✅ |
| sf90-ebay-screening | the exit is a band: low ≤ typical ≤ high, high under 2.6× low (a 1.4/0.7 comp spread times the 0.65/0.5 discount band) | realism |  | ✅ |
| sf90-ebay-screening | a derived exit sits below the clean money it derives from | realism |  | ✅ |
| sf90-ebay-screening | stress ≤ ceiling ≤ break-even | realism |  | ✅ |
| sf90-ebay-screening | the hidden-damage contingency never sits below the tier floor | realism |  | ✅ |
| sf90-ebay-screening | a no-bid verdict never carries "Bid to" copy | honesty |  | ✅ |
| sf90-ebay-screening | a zero ceiling says what ate it and what would have to be true | honesty |  | ✅ |
| sf90-ebay-screening | the exit basis names its hosts or confesses a derivation | honesty |  | ✅ |
| sf90-ebay-screening | exit lane is clean_sold_derived | behavior |  | ✅ |
| sf90-ebay-screening | the verdict does not flip on the wreck market | behavior | SPEC 45 | ✅ |
| sf90-hammer-bleed | the verdict is bid or no bid | invariant | SPEC 45 | ✅ |
| sf90-hammer-bleed | a damage program carries at most one structural line | invariant | SPEC 43 | ✅ |
| sf90-hammer-bleed | every cost line carries a basis and an evidence chip | invariant | SPEC 36 | ✅ |
| sf90-hammer-bleed | every comp behind the exit has a positive price and an http(s) source | invariant | SPEC 44 | ✅ |
| sf90-hammer-bleed | the ceiling is the highest $500 step whose all-in stays at or under discipline | invariant | SPEC 39 | ✅ |
| sf90-hammer-bleed | a zero ceiling names its killers and its unlocks | invariant | SPEC 39 | ✅ |
| sf90-hammer-bleed | the exit is a band: low ≤ typical ≤ high, high under 2.6× low (a 1.4/0.7 comp spread times the 0.65/0.5 discount band) | realism |  | ✅ |
| sf90-hammer-bleed | a derived exit sits below the clean money it derives from | realism |  | ✅ |
| sf90-hammer-bleed | the wreck market is a plausible band: no pocket change, high under 4× low | realism |  | ✅ |
| sf90-hammer-bleed | no wreck comp used sits at clean money | realism |  | ✅ |
| sf90-hammer-bleed | stress ≤ ceiling ≤ break-even | realism |  | ✅ |
| sf90-hammer-bleed | the hidden-damage contingency never sits below the tier floor | realism |  | ✅ |
| sf90-hammer-bleed | a no-bid verdict never carries "Bid to" copy | honesty |  | ✅ |
| sf90-hammer-bleed | a zero ceiling says what ate it and what would have to be true | honesty |  | ✅ |
| sf90-hammer-bleed | the exit basis names its hosts or confesses a derivation | honesty |  | ✅ |
| sf90-hammer-bleed | no wreck comp used above $300,000 (a retail figure cannot bleed into the hammer band) | behavior | SPEC 44 | ✅ |
| sf90-hammer-bleed | three heavy structural front zones price as one front program with one structural line | behavior | SPEC 43 | ✅ |
| sf90-hammer-bleed | the verdict does not flip on the wreck market | behavior | SPEC 45 | ✅ |
| sf90-hammer-point | the verdict is bid or no bid | invariant | SPEC 45 | ✅ |
| sf90-hammer-point | a damage program carries at most one structural line | invariant | SPEC 43 | ✅ |
| sf90-hammer-point | every cost line carries a basis and an evidence chip | invariant | SPEC 36 | ✅ |
| sf90-hammer-point | every comp behind the exit has a positive price and an http(s) source | invariant | SPEC 44 | ✅ |
| sf90-hammer-point | the ceiling is the highest $500 step whose all-in stays at or under discipline | invariant | SPEC 39 | ✅ |
| sf90-hammer-point | a zero ceiling names its killers and its unlocks | invariant | SPEC 39 | ✅ |
| sf90-hammer-point | the exit is a band: low ≤ typical ≤ high, high under 2.6× low (a 1.4/0.7 comp spread times the 0.65/0.5 discount band) | realism |  | ✅ |
| sf90-hammer-point | a derived exit sits below the clean money it derives from | realism |  | ✅ |
| sf90-hammer-point | the wreck market is a plausible band: no pocket change, high under 4× low | realism |  | ✅ |
| sf90-hammer-point | no wreck comp used sits at clean money | realism |  | ✅ |
| sf90-hammer-point | stress ≤ ceiling ≤ break-even | realism |  | ✅ |
| sf90-hammer-point | the hidden-damage contingency never sits below the tier floor | realism |  | ✅ |
| sf90-hammer-point | a no-bid verdict never carries "Bid to" copy | honesty |  | ✅ |
| sf90-hammer-point | a zero ceiling says what ate it and what would have to be true | honesty |  | ✅ |
| sf90-hammer-point | the exit basis names its hosts or confesses a derivation | honesty |  | ✅ |
| sf90-hammer-point | the verdict does not flip on the wreck market | behavior | SPEC 45 | ✅ |
| sf90-live-2026-08-18 | the verdict is bid or no bid | invariant | SPEC 45 | ✅ |
| sf90-live-2026-08-18 | a damage program carries at most one structural line | invariant | SPEC 43 | ✅ |
| sf90-live-2026-08-18 | every cost line carries a basis and an evidence chip | invariant | SPEC 36 | ✅ |
| sf90-live-2026-08-18 | every comp behind the exit has a positive price and an http(s) source | invariant | SPEC 44 | ✅ |
| sf90-live-2026-08-18 | the ceiling is the highest $500 step whose all-in stays at or under discipline | invariant | SPEC 39 | ✅ |
| sf90-live-2026-08-18 | a zero ceiling names its killers and its unlocks | invariant | SPEC 39 | ✅ |
| sf90-live-2026-08-18 | the exit is a band: low ≤ typical ≤ high, high under 2.6× low (a 1.4/0.7 comp spread times the 0.65/0.5 discount band) | realism |  | ✅ |
| sf90-live-2026-08-18 | a derived exit sits below the clean money it derives from | realism |  | ✅ |
| sf90-live-2026-08-18 | the wreck market is a plausible band: no pocket change, high under 4× low | realism |  | ✅ |
| sf90-live-2026-08-18 | no wreck comp used sits at clean money | realism |  | ✅ |
| sf90-live-2026-08-18 | stress ≤ ceiling ≤ break-even | realism |  | ✅ |
| sf90-live-2026-08-18 | the hidden-damage contingency never sits below the tier floor | realism |  | ✅ |
| sf90-live-2026-08-18 | a no-bid verdict never carries "Bid to" copy | honesty |  | ✅ |
| sf90-live-2026-08-18 | a zero ceiling says what ate it and what would have to be true | honesty |  | ✅ |
| sf90-live-2026-08-18 | the exit basis names its hosts or confesses a derivation | honesty |  | ✅ |
| sf90-live-2026-08-18 | verdict is walk | behavior |  | ✅ |
| sf90-live-2026-08-18 | at least 3 wreck comps survive relaning (salvage-auction listings are wreck evidence whatever lane the worker used) | behavior | SPEC 44 | ✅ |
| sf90-live-2026-08-18 | off-spec, aftermarket, and structure items never inflate the front panels line past $60,000 | behavior | SPEC 44 | ✅ |
| sf90-live-2026-08-18 | the verdict does not flip on the wreck market | behavior | SPEC 45 | ✅ |
| sf90-research-empty | the verdict is bid or no bid | invariant | SPEC 45 | ✅ |
| sf90-research-empty | a damage program carries at most one structural line | invariant | SPEC 43 | ✅ |
| sf90-research-empty | every cost line carries a basis and an evidence chip | invariant | SPEC 36 | ✅ |
| sf90-research-empty | every comp behind the exit has a positive price and an http(s) source | invariant | SPEC 44 | ✅ |
| sf90-research-empty | the hidden-damage contingency never sits below the tier floor | realism |  | ✅ |
| sf90-research-empty | a no-bid verdict never carries "Bid to" copy | honesty |  | ✅ |
| sf90-research-empty | verdict is walk | behavior |  | ✅ |
| sf90-research-empty | no exit and no ceiling; the cost side still itemized | behavior |  | ✅ |
| sf90-research-empty | the verdict does not flip on the wreck market | behavior | SPEC 45 | ✅ |
| sf90-wreck-market-rich | the verdict is bid or no bid | invariant | SPEC 45 | ✅ |
| sf90-wreck-market-rich | a damage program carries at most one structural line | invariant | SPEC 43 | ✅ |
| sf90-wreck-market-rich | every cost line carries a basis and an evidence chip | invariant | SPEC 36 | ✅ |
| sf90-wreck-market-rich | every comp behind the exit has a positive price and an http(s) source | invariant | SPEC 44 | ✅ |
| sf90-wreck-market-rich | the ceiling is the highest $500 step whose all-in stays at or under discipline | invariant | SPEC 39 | ✅ |
| sf90-wreck-market-rich | a zero ceiling names its killers and its unlocks | invariant | SPEC 39 | ✅ |
| sf90-wreck-market-rich | the exit is a band: low ≤ typical ≤ high, high under 2.6× low (a 1.4/0.7 comp spread times the 0.65/0.5 discount band) | realism |  | ✅ |
| sf90-wreck-market-rich | a derived exit sits below the clean money it derives from | realism |  | ✅ |
| sf90-wreck-market-rich | the wreck market is a plausible band: no pocket change, high under 4× low | realism |  | ✅ |
| sf90-wreck-market-rich | no wreck comp used sits at clean money | realism |  | ✅ |
| sf90-wreck-market-rich | stress ≤ ceiling ≤ break-even | realism |  | ✅ |
| sf90-wreck-market-rich | the hidden-damage contingency never sits below the tier floor | realism |  | ✅ |
| sf90-wreck-market-rich | a no-bid verdict never carries "Bid to" copy | honesty |  | ✅ |
| sf90-wreck-market-rich | a zero ceiling says what ate it and what would have to be true | honesty |  | ✅ |
| sf90-wreck-market-rich | the exit basis names its hosts or confesses a derivation | honesty |  | ✅ |
| sf90-wreck-market-rich | no wreck comp used above $300,000 (a retail figure cannot bleed into the hammer band) | behavior | SPEC 44 | ✅ |
| sf90-wreck-market-rich | the verdict does not flip on the wreck market | behavior | SPEC 45 | ✅ |
