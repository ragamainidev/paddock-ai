# public release

## 1. Distribution boundary

The existing private repository retains its development history. A public
distribution starts from an explicitly reviewed commit and a separate snapshot.
Deleting data at the current tip does not remove it from older Git objects.
Do not change this repository's visibility to publish only the new source tree.

The original master and derived subset are not public inputs. The EPA source,
sample and provenance are documented in `docs/catalog.md` and `data/README.md`.
The public sample is usable offline; the full public source is installable
without a model or private account. Optional user catalogs are never bundled.

## 2. Prepare and verify

Run tests, the offline resolver/decision evaluations, Next and Eve builds, and
`pnpm eval:agent`. The Eve fixture evaluation executes the actual runtime with
isolated state and zero provider calls; it establishes orchestration behavior,
not real-world appraisal accuracy. Public catalog coverage is reported with
`pnpm catalog:check`. Preserve missing-detail cases as explicit limitations.

Review the exact source snapshot, third-party notices and data provenance, and
record the author's reuse choice before publication. This release is publicly
readable with rights reserved, as documented in `COPYRIGHT`; it does not grant
an open-source license. The exporter is
not a legal ownership assessment or comprehensive secret scanner. Its tracked
file checks complement a dedicated secret scan of the intended release.

## 3. Export

After committing the reviewed changes:

```sh
pnpm release:export --out release/paddock
```

Use `--ref <commit>` for a specific committed snapshot. Uncommitted working
files are excluded; `release-manifest.json` records the source commit and each
file's SHA-256. The output must not already exist. The exporter validates the
whole tree first, isolates child Git commands from hook-local repository
variables, refuses tracked environment secrets, private-key/provider-key
patterns, symlinks/submodules, runtime databases and unreviewed top-level data
assets, and creates no Git history, remote, GitHub repository or deployment.

Install and verify the exported directory independently before publication.
That new directory can later receive its own initial commit and public remote.
Never merge the original private history into that repository. Preserve original
attribution; snapshot distribution does not change authorship or ownership.

## 4. Ongoing gates

Public-source refreshes use the same provenance and coverage checks. The real
Eve fixture job is no longer allowed to fail silently in CI; source/data work
must preserve durable assessment behavior. Repository rulesets can require its
named status separately; this code change does not change GitHub settings.
All provider-paid commands retain their explicit opt-in. Publishing a snapshot
is separate from pushing a private development branch and requires an explicit
owner instruction. SPEC 66.

## 5. Public distribution

The owner authorized a fresh public repository at
https://github.com/ragamainidev/paddock-ai, with the original code publicly
readable and rights reserved. The private development repository retains its
history. Public Git starts with a new root commit; it is not a fork or mirror
of private Git objects. No hosted app or provider credentials are included.

The release removes the old private deployment journal and unrelated company
references, uses reader-owned deployment examples, and includes original short
summaries in place of consumer narratives. Sourced auction facts and external
photo links retain their provenance; `THIRD_PARTY_NOTICES.md` records their
boundary. Review and scan the exact exported tree again for each publication.
