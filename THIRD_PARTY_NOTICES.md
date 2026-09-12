# Third-party data and materials

## DOE/EPA catalog

The catalog installer uses [FuelEconomy.gov vehicle data](https://www.fueleconomy.gov/feg/epadata/vehicles.csv).
The committed sample preserves original rows and records its source, selection
and SHA-256 digests in [data/epa-sample.provenance.json](data/epa-sample.provenance.json).
See the [data description](https://www.fueleconomy.gov/feg/ws/index.shtml),
[federal catalog entry](https://catalog.data.gov/dataset/fuel-economy-label-and-cafe-data)
and [EPA data license](https://edg.epa.gov/EPA_Data_License.html).
EPA describes its own data as public domain domestically unless otherwise
specified. Its metadata, limitations and absence of warranty still matter.
Paddock's code-rights notice does not claim ownership of EPA data.

## Recorded automotive examples

Small historical auction examples in `src/inspector/seed-listings.ts` and
`src/salvage/seed-lots.ts` retain their public source URLs and collection dates.
Vehicle identities, sale observations and listing claims are recorded facts or
claims from those sources, not warranties by Paddock. Descriptions are short
project-authored summaries. A listing's claimed condition is not an inspection,
and a VIN decode is not a title or accident-history report.

The repository stores links to auction photographs, not photograph files.
Those photographs remain the property of their respective rights holders.
Their presence as links grants no right to redistribute the images; accessing
external media and provider services remains subject to the source's terms.
No affiliation with or endorsement by any auction or marketplace is implied.

[NHTSA](https://www.nhtsa.gov/nhtsa-datasets-and-apis) recall/model fixtures preserve source facts. The eight complaint summary
fields in `src/enrich/fixtures/complaints-m3-coupe-2003.json` are project-authored
paraphrases for offline testing, with the original record IDs and component
labels retained. They are not verbatim consumer statements. Recorded model
outputs in the salvage evaluations remain labeled as model output, rather than
captured source pages or validated real-world outcomes.

## Software and other assets

Dependencies are identified in `package.json` and pinned by `pnpm-lock.yaml`.
Each dependency remains subject to its own license; installing it does not make
it subject to Paddock's copyright notice. The small Next.js/Vercel scaffold SVGs
retain their original provenance and trademarks. User-supplied datasets and
live-provider responses are not relicensed by this repository.

## Code visibility

The author's original code is publicly readable with rights reserved. GitHub
explains the distinction between public visibility and an open-source license
in [Licensing a repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository).
See [COPYRIGHT](COPYRIGHT) for this project's notice.
