# docs — the knowledge base

Everything permanent about how paddock is built and run lives here, one
file per area. `SPEC.md` (repo root) says _what must hold_ — numbered
invariants, each citing its test. These files say _how and why_: the
patterns, the recurring functions, the operational details, the decisions.
When code and a doc disagree, fix whichever is wrong and say so in the
commit; when a doc and SPEC.md disagree, SPEC.md wins.

## 1. Conventions

### 1.1 Numbered headings

Every file is `# <area>` followed by `## N. Title` and `### N.M Title`.
Numbers are stable references (`docs/llm-patterns.md §2.3`): append new
sections at the end of their level; never renumber. Retired sections keep
their number and a one-line "retired: <reason>" body.

### 1.2 One file per area

| File                                         | Covers                                                                                   |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [patterns.md](patterns.md)                   | Architectural patterns every module follows (injected callers, stage status, streams, …) |
| [code-organization.md](code-organization.md) | Module map, file headers, where a new thing goes, size signals                           |
| [llm-patterns.md](llm-patterns.md)           | Structured output, prompt management, experimentation, fallback, confidence, cost        |
| [database.md](database.md)                   | libSQL vehicle DB, Postgres runs DB, libSQL assessments DB, migrations, degradation      |
| [catalog.md](catalog.md)                     | Public EPA installation, supplied catalogs, provenance and coverage                      |
| [public-release.md](public-release.md)       | Reviewed snapshot distribution, release gates and preservation of private history        |
| [frontend.md](frontend.md)                   | Design contract, data loading, URL state, streaming, patterns and anti-patterns          |
| [logging.md](logging.md)                     | What is logged, how, redaction, where to read it                                         |
| [testing-and-evals.md](testing-and-evals.md) | Unit / contract / eval layers, data tested like code, hooks                              |
| [auth.md](auth.md)                           | Session cookies, credentials, enforcement modes, runbooks                                |
| [deployment.md](deployment.md)               | Vercel strategy, env matrix, build gating, runs on serverless                            |
| [operations.md](operations.md)               | Runbooks: missing keys, Postgres down, rollback, rotate credentials, costs               |
| [git-workflow.md](git-workflow.md)           | Branches, commits, hooks, CI, protection, minimizing action minutes                      |
| [multi-agent.md](multi-agent.md)             | Concurrent agents: worktrees, ownership, merge-last files, integration lock              |
| [salvage-economics.md](salvage-economics.md) | Sourced constants behind the salvage money model                                         |
| [agent-assessments.md](agent-assessments.md) | Durable assessments, Eve authority, evidence, low-cost runtime evals and operation       |
| [workflows/](workflows/)                     | Short step lists for recurring procedures (feature, integrate-and-deploy, incident)      |
| [initiatives/](initiatives/)                 | Multi-task efforts: design, execution table, log — written to survive context resets     |
| [archive/](archive/)                         | Superseded documents kept for history; not maintained                                    |

### 1.3 The growth rule

Any recurring function, permanent or critical architectural pattern,
component, or operational detail gets documented in the matching file in
the same change that introduces it. "Recurring" means a second call site
exists or is obviously coming. If no file fits, add one and a row above.
The reviewer's question is "where is this written down?" — the answer is
never "in the code" alone.

### 1.4 Style

- Present tense, declarative, second person for procedures.
- Cite code as `path/to/file.ts` (`symbol`) and invariants as `SPEC 12`.
- Prefer a table to prose when there are three or more parallel facts.
- No war stories or session narration; provenance lives in commits.
- Prettier formats these files (`pnpm format`); the pre-commit hook runs it.

### 1.5 Initiatives

A change that spans more than one working session gets
`docs/initiatives/YYYY-MM-DD-<slug>.md` with: a resume protocol, goals and
non-goals, survey findings, design decisions, an execution table (task,
files, verify, status), a manual-actions list, and an append-only log.
Public-catalog preparation is recorded in
[2026-09-13-public-catalog.md](initiatives/2026-09-13-public-catalog.md).
The assessment initiative is
[2026-09-06-bidding-desk.md](initiatives/2026-09-06-bidding-desk.md); read it
first after a context reset. Closed:
[2026-09-06-agent-assessments.md](initiatives/2026-09-06-agent-assessments.md),
whose branch the bidding desk adopted as its foundation;
[2026-08-17-rebuild-ceiling.md](initiatives/2026-08-17-rebuild-ceiling.md).
