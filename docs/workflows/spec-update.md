# workflow: spec-update

The protocol for keeping `SPEC.md` and `docs/` true as the code changes.
It is enforced by `pnpm docs:check` (pre-commit and CI); this file is the
human half — when to write what.

## 1. Decide what the change needs

| The change…                                                        | Needs                                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Adds or alters behavior a test can pin (a guarantee to the user)   | A SPEC rule (new number, or amend the existing rule's text)        |
| Adds a recurring function, pattern, component, or operational step | A `docs/<area>.md` section (new `### N.M`, or amend)               |
| Both of the above                                                  | Both, in the same commit                                           |
| Pure refactor, no behavior or pattern change                       | Nothing, unless a citation in SPEC/docs now points at a moved file |
| A decision that will look arbitrary in six months                  | One line in the relevant doc stating the reason                    |

The reviewer's question is "where is this written down?" — never
answered by "in the code".

## 2. Writing a SPEC rule

1. Append at the end of `SPEC.md` using the next unused number, under a
   `##` section whose rules are contiguous with it — start a new section
   if the last section's numbers are not. Prettier renumbers each markdown
   list from its first item, so a rule appended out of sequence is silently
   renumbered on commit; `docs:check` rejects descending order so this
   cannot slip through. Never renumber existing rules; never reuse a number.
2. Shape: `N. **One-sentence guarantee.** Two or three sentences of what
holds and what happens on failure. — \`path/to/impl.ts\` (\`symbol\`);
   tested in \`path/to/impl.test.ts\` ("test name").` Every rule cites
   the code and the test that would fail if it broke.
3. Cite the number from the code (`// SPEC 12`) and from suite checks
   (`spec: 'SPEC 12'`) where the invariant is enforced.
4. If the rule replaces an old guarantee, amend the old rule's text to say
   what holds now (keep its number).

## 3. Writing a docs section

1. Pick the file from `docs/README.md §1.2`; if none fits, add a file and
   an index row.
2. Append `### N.M Title` under the right `## N.`, or a new `## N.` at the
   end. Numbers are stable references — append, never renumber.
3. Cite code as `path/file.ts` (`symbol`) and rules as `SPEC N`.
4. Retiring: keep the heading, replace the body with one line
   "retired: <reason, date>".

## 4. Run the check

```sh
pnpm docs:check
```

It fails on: SPEC citations that point nowhere, rules with no citation,
repeated or missing rule numbers, unnumbered or out-of-order docs
headings, docs files missing from the index, and `SPEC N` references
above the highest rule (in docs, CLAUDE.md, README.md, and source
comments). Fix the doc or the code, not the check.

## 5. Commit shape

One commit carries the code, its tests, its SPEC rule, its docs section,
and (if resolver behavior changed) the regenerated `evals/results.*`.
Commit body names the rule: `Adds SPEC 12; documents in docs/auth.md §3`.

## 6. Multi-session efforts

Anything spanning sessions gets `docs/initiatives/YYYY-MM-DD-<slug>.md`
(`docs/README.md §1.5`) and updates that file's task table and log as it
goes; the SPEC/docs updates for each task land with the task's commit,
not at the end.
