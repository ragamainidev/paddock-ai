# catalog

## 1. Public source and scope

The default catalog is the DOE/EPA FuelEconomy.gov vehicle configuration table:

- Source: https://www.fueleconomy.gov/feg/epadata/vehicles.csv
- Description: https://www.fueleconomy.gov/feg/ws/index.shtml
- Federal catalog: https://catalog.data.gov/dataset/fuel-economy-label-and-cafe-data
- License reference: https://edg.epa.gov/EPA_Data_License.html

The initial verified source has 50,242 configurations spanning 1984–2027.
The committed sample contains 9,277 source rows and its own SHA-256 provenance
record. Configurations are not exhaustive trims, factory option lists or parts
fitment evidence. A missing field remains unknown. Manufacturer/carline naming
can differ from enthusiast naming; EPA-only aliases retain the original label.

## 2. Installation

`pnpm catalog:install` downloads the official CSV and imports `data/ymm.db`.
`pnpm ingest` is the same public-source command. Neither invokes a model.

To reproduce a known source, retain its downloaded bytes and checksum:

```sh
pnpm catalog:install --csv /path/to/vehicles.csv --sha256 <sha256> --db data/ymm.db
```

An explicit local CSV is labeled user-supplied even when its checksum matches;
only the official downloader records trusted EPA-source provenance.

The installer validates schema, identities, duplicate IDs, row count and any
provided checksum before replacing the catalog. Vehicles and catalog metadata
are replaced in one transaction; unrelated run and assessment tables are not
dropped. Invalid source data preserves the last working database. Installation
is an explicit maintenance operation, not a request-time fetch.

`pnpm catalog:sample` installs the committed EPA sample at `data/eval.db` for
offline development. Use `DATABASE_URL=file:data/eval.db pnpm dev` with it.
`scripts/ensure-eval-db.ts` checks the sample provenance and builds that database
for tests. Test setup does not download a catalog or call a model.

## 3. Supplied catalogs

`pnpm ingest:user --csv /path/to/catalog.csv --db data/ymm.db` imports the
documented original column format, with explicit source selection. No default
home-directory path exists. The importer records this as user data with rights
unspecified; it does not turn supplied data into redistributable public data.
Source files and generated databases stay ignored. Original source identifiers
are preserved when provided; a missing ID receives only a local row identifier.

## 4. Search evidence

`resolveVehicles` is shared by application search and offline evaluations.
Each constraint is matched, contradicted, or unresolved. A contradiction cannot
become a candidate, and an unresolved condition earns no score or match reason.
Rows with different evidence states do not lend each other verified facts.
Results list their observed catalog years and unresolved filters; absent years
do not prove a production interruption. EPA combined labels can remain identity
candidates without validating a particular constituent model.

Curated chassis/engine shorthand is an interpretation assumption, not new source
data. Known engine displacement, cylinder and layout contradictions are excluded;
exact engine codes remain unresolved even when model/year fitment is plausible. The generation catalog currently offers independently sourced family
discovery, with generation and facelift research unavailable. The optional paid
compiler writes `data/generation-candidate.json` for independent review. It
does not publish its output or overwrite the reviewed artifact.

## 5. Verification and maintenance

`pnpm catalog:check` reports representative queries against `data/ymm.db`; use
`--db data/eval.db` for the public sample. It reports returned and candidates with all parsed query constraints verified, unresolved conditions, and catalog provenance separately. An expected
coverage gap is not a successful verification of the requested vehicle fact.

Update sources intentionally: download, validate checksum and schema, regenerate
the sample and provenance with `scripts/make-subset.ts`, inspect coverage changes,
then run the offline gates. Compare facts and source IDs rather than raw row
counts. Do not generate rows from the expectations or fill absent fields with
model guesses to improve evaluation scores. SPEC 64–65.
