import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Link from 'next/link';
import type { EvalArtifact, HistoryEntry } from '@/../evals/artifact';

/**
 * Renders the last committed eval run from evals/results.json plus the
 * per-commit history from evals/history.jsonl. The page is a viewer, not a
 * runner; `pnpm eval` is the only writer (SPEC 20). Three suites: the
 * deterministic resolver eval, the inspector agent graded per check over
 * recorded fixtures, and the salvage money model replayed over recorded
 * live traces.
 */

export default async function EvalsPage(props: PageProps<'/evals'>) {
  const sp = await props.searchParams;
  const sort = sp.sort === 'status' ? 'status' : undefined;

  const artifact = await readFile(join(process.cwd(), 'evals', 'results.json'), 'utf8')
    .then((raw) => JSON.parse(raw) as EvalArtifact)
    .catch(() => null);
  const history = await readFile(join(process.cwd(), 'evals', 'history.jsonl'), 'utf8')
    .then((raw) =>
      raw
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as HistoryEntry),
    )
    .catch(() => [] as HistoryEntry[]);

  if (!artifact) {
    return <p className="type-body text-dim">No committed eval run found.</p>;
  }

  const { resolver, inspector, salvage } = artifact.suites;
  const rows = sort
    ? [...resolver.rows].sort((a, b) => Number(a.pass) - Number(b.pass) || a.n - b.n)
    : resolver.rows;

  return (
    <div className="font-mono">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <h1 className="type-h1 font-mono">
          {resolver.passed}/{resolver.total}
          <span className="font-normal text-dim"> resolver</span>
          <span className="text-faint"> · </span>
          {inspector.checksPassed}/{inspector.checksTotal}
          <span className="font-normal text-dim"> inspector</span>
          {salvage && (
            <>
              <span className="text-faint"> · </span>
              {salvage.checksPassed}/{salvage.checksTotal}
              <span className="font-normal text-dim"> salvage</span>
            </>
          )}
        </h1>
        <span className="type-meta">{artifact.date}</span>
        <span className="type-meta">git {artifact.gitSha}</span>
        <span className="type-meta">{artifact.mode}</span>
      </div>
      <p className="type-body mt-2 max-w-[72ch] font-sans text-dim">
        Three deterministic suites, all run offline by <span className="font-mono">pnpm eval</span>{' '}
        and gated on every push. The resolver suite pins query understanding against the committed
        vehicle subset; the inspector suite orchestrates the full agent over recorded fixtures; the
        salvage suite replays recorded live traces through the current money model. Checks are
        graded per class: invariants cite the SPEC rule they defend, realism checks assert numbers a
        practitioner could falsify against the market, honesty checks prove the report never argues
        against its own verdict, behavior checks pin the play to the evidence. Every run appends to
        a committed per-commit history, so regressions are visible run over run.
      </p>

      {history.length > 1 && (
        <section className="mt-6">
          <h2 className="type-label mb-2">History</h2>
          <table className="w-full max-w-[560px] border-collapse text-[12px] leading-[18px]">
            <tbody>
              {history.slice(-8).map((h) => (
                <tr key={h.gitSha} className="border-t border-border">
                  <td className="type-meta py-1 pr-4">{h.date}</td>
                  <td className="py-1 pr-4">git {h.gitSha}</td>
                  <td className="py-1 pr-4 text-dim">
                    resolver {h.resolver.passed}/{h.resolver.total}
                  </td>
                  <td className="py-1 pr-4 text-dim">
                    inspector {h.inspector.checksPassed}/{h.inspector.checksTotal}
                  </td>
                  <td className="py-1 text-dim">
                    {h.salvage ? `salvage ${h.salvage.checksPassed}/${h.salvage.checksTotal}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* -- Inspector suite ------------------------------------------------- */}
      <section className="mt-8">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 className="type-h2 font-sans">Inspector agent</h2>
          <span className="type-meta">
            {inspector.casesPassed}/{inspector.casesTotal} cases
          </span>
          {Object.entries(inspector.byClass).map(([cls, s]) => (
            <span
              key={cls}
              className={`type-meta rounded-[2px] border px-1.5 ${
                s.passed === s.total ? 'border-border text-dim' : 'border-danger text-danger'
              }`}
            >
              {cls} {s.passed}/{s.total}
            </span>
          ))}
        </div>
        <p className="type-meta mt-1">{inspector.pipeline}</p>

        <div className="mt-4 flex flex-col">
          {inspector.cases.map((c) => (
            <details key={c.name} className="group border-t border-border last:border-b">
              <summary className="flex cursor-pointer list-none items-baseline gap-4 py-2.5 [&::-webkit-details-marker]:hidden">
                <span className={`type-meta w-10 shrink-0 ${c.pass ? 'text-ok' : 'text-danger'}`}>
                  {c.pass ? 'PASS' : 'FAIL'}
                </span>
                <span className="type-body min-w-0 font-sans">{c.name}</span>
                <span className="type-meta ml-auto shrink-0">
                  {c.checks.filter((x) => x.pass).length}/{c.checks.length} checks
                </span>
              </summary>
              <div className="pb-3 pl-14">
                <p className="type-body mb-2 max-w-[68ch] font-sans text-dim">{c.description}</p>
                <table className="w-full border-collapse text-[12px] leading-[18px]">
                  <tbody>
                    {c.checks.map((check) => (
                      <tr
                        key={check.id}
                        className={`border-t border-border align-top ${check.pass ? '' : 'bg-accent-wash'}`}
                      >
                        <td
                          className={`type-meta w-10 py-1.5 pr-3 ${check.pass ? 'text-ok' : 'text-danger'}`}
                        >
                          {check.pass ? 'PASS' : 'FAIL'}
                        </td>
                        <td className="py-1.5 pr-3 font-sans text-[13px]">{check.desc}</td>
                        <td className="type-meta w-20 py-1.5 pr-3">{check.class}</td>
                        <td className="type-meta w-20 py-1.5 text-right">{check.spec ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {c.checks.some((x) => !x.pass && x.detail) && (
                  <p className="type-meta mt-1 text-danger">
                    {c.checks
                      .filter((x) => !x.pass && x.detail)
                      .map((x) => `${x.id}: ${x.detail}`)
                      .join(' · ')}
                  </p>
                )}
              </div>
            </details>
          ))}
        </div>
      </section>

      {/* -- Salvage money-model suite ---------------------------------------- */}
      {salvage && (
        <section className="mt-10">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 className="type-h2 font-sans">Salvage money model</h2>
            <span className="type-meta">
              {salvage.casesPassed}/{salvage.casesTotal} cases
            </span>
            {Object.entries(salvage.byClass).map(([cls, s]) => (
              <span
                key={cls}
                className={`type-meta rounded-[2px] border px-1.5 ${
                  s.passed === s.total ? 'border-border text-dim' : 'border-danger text-danger'
                }`}
              >
                {cls} {s.passed}/{s.total}
              </span>
            ))}
          </div>
          <p className="type-meta mt-1">{salvage.pipeline}</p>
          <div className="mt-4 flex flex-col">
            {salvage.cases.map((c) => (
              <details key={c.name} className="group border-t border-border last:border-b">
                <summary className="flex cursor-pointer list-none items-baseline gap-4 py-2.5 [&::-webkit-details-marker]:hidden">
                  <span className={`type-meta w-10 shrink-0 ${c.pass ? 'text-ok' : 'text-danger'}`}>
                    {c.pass ? 'PASS' : 'FAIL'}
                  </span>
                  <span className="type-body min-w-0 font-sans">{c.name}</span>
                  <span className="type-meta ml-auto shrink-0">
                    {c.checks.filter((x) => x.pass).length}/{c.checks.length} checks
                  </span>
                </summary>
                <div className="pb-3 pl-14">
                  <p className="type-body mb-2 max-w-[68ch] font-sans text-dim">{c.description}</p>
                  <table className="w-full border-collapse text-[12px] leading-[18px]">
                    <tbody>
                      {c.checks.map((check) => (
                        <tr
                          key={check.id}
                          className={`border-t border-border align-top ${check.pass ? '' : 'bg-accent-wash'}`}
                        >
                          <td
                            className={`type-meta w-10 py-1.5 pr-3 ${check.pass ? 'text-ok' : 'text-danger'}`}
                          >
                            {check.pass ? 'PASS' : 'FAIL'}
                          </td>
                          <td className="py-1.5 pr-3 font-sans text-[13px]">{check.desc}</td>
                          <td className="type-meta w-20 py-1.5 pr-3">{check.class}</td>
                          <td className="type-meta w-20 py-1.5 text-right">{check.spec ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
          </div>
        </section>
      )}

      {/* -- Resolver suite -------------------------------------------------- */}
      <section className="mt-10">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 className="type-h2 font-sans">Resolver</h2>
          <span className="type-meta">
            {resolver.passed}/{resolver.total}
          </span>
          <span className="type-meta">{resolver.pipeline}</span>
        </div>

        <div className="mt-3 flex items-baseline gap-4">
          <span className="type-label">sort</span>
          <SortLink href="/evals" active={!sort}>
            case order
          </SortLink>
          <SortLink href="/evals?sort=status" active={sort === 'status'}>
            failures first
          </SortLink>
        </div>

        <table className="mt-4 w-full border-collapse text-[12px] leading-[18px]">
          <thead>
            <tr className="border-b border-border-strong text-left">
              <th className="type-label py-2 pr-4 font-normal"></th>
              <th className="type-label py-2 pr-4 font-normal">#</th>
              <th className="type-label py-2 pr-4 font-normal">query</th>
              <th className="type-label py-2 font-normal">expectation</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.n}
                className={`border-b border-border align-top ${r.pass ? '' : 'bg-accent-wash'}`}
              >
                <td className={`type-meta py-2 pr-4 ${r.pass ? 'text-ok' : 'text-danger'}`}>
                  {r.pass ? 'PASS' : 'FAIL'}
                </td>
                <td className="py-2 pr-4 text-dim">{r.n}</td>
                <td className="whitespace-nowrap py-2 pr-4">{r.query}</td>
                <td className="py-2 text-dim">
                  {r.expectation}
                  {r.detail && <div className="mt-1 text-danger">{r.detail}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function SortLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  if (active) {
    return <span className="type-meta text-text">{children}</span>;
  }
  return (
    <Link
      href={href}
      data-nav
      className="type-meta transition-colors duration-[120ms] ease-out hover:text-text"
    >
      {children}
    </Link>
  );
}
