# Public catalog data

## 1. Source and reproduction

`epa-sample.csv` is an independently downloaded DOE/EPA FuelEconomy.gov
sample. It is not derived from the former master CSV or eval subset.
The source describes US fuel-economy configurations from model year 1984
onward. Source row IDs, original field names, source ordering, blank cells
and configuration labels are retained. The provenance JSON records the
SHA-256 of the downloaded CSV and emitted sample, source references, row
counts, year coverage and exact selection rule.

Source: https://www.fueleconomy.gov/feg/epadata/vehicles.csv
Documentation: https://www.fueleconomy.gov/feg/ws/index.shtml
Federal catalog: https://catalog.data.gov/dataset/fuel-economy-label-and-cafe-data
License reference: https://edg.epa.gov/EPA_Data_License.html

Install the official catalog with `pnpm catalog:install`; use `pnpm
catalog:sample` for the checksum-verified offline fixture. A separately
supplied richer CSV uses `pnpm ingest:user --csv /path/to/catalog.csv
--db data/ymm.db` and does not inherit EPA provenance or license claims.

Regenerate explicitly from a downloaded official CSV:

```sh
pnpm exec tsx scripts/make-subset.ts --csv /path/to/official/vehicles.csv --out data/epa-sample.csv
```

The generator never downloads anything. It rejects non-EPA headers and
invalid or duplicate identities. It selects complete enthusiast model
families named in `scripts/subset-spec.ts`, plus a deterministic 1% sample
of other source IDs for distractors. Identical input produces identical
CSV and provenance bytes. A newer source snapshot can legitimately change
counts and checksums. Check source coverage tests when refreshing it.

## 2. Coverage and unknown fields

The initial snapshot has 9,277 of 50,242 rows. EPA configuration labels are
not exhaustive trim or fitment records. Unprovided body style, engine layout, engine code, trim and doors remain
unknown. EPA `tCharger = T` / `sCharger = S` provide positive turbo or
supercharger evidence; blank markers leave aspiration unknown. A blank
field does not mean a negative answer. No row is created to satisfy a
legacy evaluation expectation.

## 3. Independent family knowledge

`public-generations.json` replaces the unverified generated artifact.
Its eight family identities were independently selected from the public
EPA sample and cite actual source IDs. Every `generations` array is empty:
no manufacturer-backed US model-year generation or facelift boundaries
have yet been verified for this public artifact. The schema retains those
optional details for future cited research. Source coverage years must not
be substituted for production boundaries. Generation/facelift queries keep
the family identity and state that generation data is unavailable.
Curated chassis/engine/variant interpretation remains a separate assumption
layer; a successful family match cannot validate all of its technical facts.

`src/knowledge/knowledge.test.ts` records observed mapping/coverage gaps.
These include pre-1984 Corvette generations; exact `911` mappings against
EPA's suffixed configurations; and differences such as `SC300` versus
`SC 300`. Additional named model gaps include historical Datsuns and EPA
configuration spelling differences. These are gaps in the public sample or
identity mapping, never evidence that a real vehicle did not exist. The
integration coverage report should measure the production resolver's
matched/unknown semantics, not infer support from these raw-name tests.

## 4. Synthetic adapter fixture

`../fixtures/ingest-sample.csv` is a wholly synthetic five-row adapter test
fixture, written independently for normalization tests. Every make starts
with `Fixture`, identifiers start with `synthetic-`, and model names start
with `Example`. These rows exercise clean values, blanks, unknown markers,
commercial axle formatting, hybrid fuel and cc-to-liter fallback. They are
not production vehicle facts and must never be installed as the public
vehicle catalog.
