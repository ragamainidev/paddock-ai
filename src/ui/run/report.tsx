'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { InspectorReport } from '@/inspector/types';
import { dollars, hostOf, inspectStageNote, positionLabel, railPercent } from '../inspect-format';

// The finished inspection, organized by what the buyer does next: verdict,
// then the money, then the evidence behind it. Every dollar figure on this
// page is traceable — comps link to real sales with a collection date,
// repair estimates cite the research that produced them, and the sources
// footer lists every page a number came from.
//
// Choreography (DESIGN.md structural register): when a run finishes in
// view, the verdict rises first and sections stagger in at 60ms steps; a
// revisited run renders statically.

export function ReportView({
  report,
  choreograph,
  onAnchor,
}: {
  report: InspectorReport;
  choreograph: boolean;
  onAnchor: (indices: number[]) => void;
}) {
  const { assessment, analysis, market, web, nhtsa, reliability, vinCheck, stages } = report;
  const degraded = stages.filter((s) => !s.ok);

  let sectionIndex = 0;
  const reveal = (): CSSProperties & Record<'--reveal-delay', string> => ({
    ['--reveal-delay']: `${sectionIndex++ * 60}ms`,
  });

  return (
    <div className={`flex flex-col gap-8 ${choreograph ? 'choreograph' : ''}`}>
      <VerdictBanner
        verdict={assessment.verdict}
        summary={assessment.summary}
        className="reveal"
        style={reveal()}
      />

      {(market || web.some((f) => f.costEstimate)) && (
        <section className="reveal flex flex-col gap-3" style={reveal()}>
          <h3 className="type-h2">The money</h3>
          <MoneyPanel report={report} />
        </section>
      )}

      {(analysis.issues.length > 0 || analysis.modifications.length > 0) && (
        <section className="reveal flex flex-col gap-3" style={reveal()}>
          <h3 className="type-h2">What the photos show</h3>
          {analysis.issues.map((issue, i) => (
            <FindingRow
              key={`i${i}`}
              dotClass={
                issue.severity === 'critical' || issue.severity === 'high'
                  ? 'bg-danger'
                  : issue.severity === 'medium'
                    ? 'bg-warn'
                    : 'bg-faint'
              }
              title={`${issue.severity} ${issue.type.replace(/_/g, ' ')}`}
              body={issue.description}
              detail={issue.location}
              photos={issue.photos}
              onAnchor={onAnchor}
            />
          ))}
          {analysis.modifications.map((mod, i) => (
            <FindingRow
              key={`m${i}`}
              dotClass={mod.quality === 'budget_aftermarket' ? 'bg-warn' : 'bg-border-strong'}
              title={`${mod.type.replace(/_/g, ' ')} · ${mod.quality.replace(/_/g, ' ')}`}
              body={mod.description}
              photos={mod.photos}
              onAnchor={onAnchor}
            />
          ))}
        </section>
      )}

      {vinCheck && (
        <section className="reveal flex flex-col gap-3" style={reveal()}>
          <h3 className="type-h2">History &amp; provenance</h3>
          <HistoryPanel report={report} />
        </section>
      )}

      {web.length > 0 && (
        <section className="reveal flex flex-col gap-3" style={reveal()}>
          <h3 className="type-h2">Research</h3>
          {web.map((finding, i) => (
            <div key={i} className="flex flex-col gap-1">
              <div className="flex items-start gap-2">
                <span
                  className={`mt-[7px] h-[6px] w-[6px] shrink-0 rounded-full ${
                    finding.severity === 'critical'
                      ? 'bg-danger'
                      : finding.severity === 'concern'
                        ? 'bg-warn'
                        : 'bg-border-strong'
                  }`}
                />
                <p className="type-body">
                  {finding.summary}
                  {finding.costEstimate && (
                    <span className="ml-2 font-mono text-[13px] text-dim">
                      {finding.costEstimate}
                    </span>
                  )}
                </p>
              </div>
              <div className="ml-4 flex flex-wrap gap-x-4 gap-y-1">
                {finding.sources.map((s) => (
                  <SourceLink key={s.url} url={s.url} title={s.title} />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {nhtsa &&
        (nhtsa.matchedIssues.length > 0 ||
          nhtsa.recalls.length > 0 ||
          nhtsa.complaintsTotal > 0) && (
          <section className="reveal flex flex-col gap-3" style={reveal()}>
            <h3 className="type-h2">Federal data</h3>
            <p className="type-meta">
              {nhtsa.complaintsTotal} complaints on file
              {nhtsa.topComponents.length > 0 && (
                <>
                  {' · '}
                  {nhtsa.topComponents
                    .map((c) => `${c.component.toLowerCase()} ${c.count}`)
                    .join(' · ')}
                </>
              )}
            </p>
            {nhtsa.matchedIssues.map((match, i) => (
              <p key={i} className="type-body text-warn">
                Photos show {match.issueType.replace(/_/g, ' ')} and NHTSA logs {match.count}{' '}
                {match.component.toLowerCase()} complaint(s) for this vehicle.
              </p>
            ))}
            {nhtsa.recalls.map((recall) => (
              <div key={recall.campaign} className="border-l-2 border-danger pl-3">
                <div className="type-label">{recall.component}</div>
                <p className="type-body mt-1">{recall.summary}</p>
                <div className="type-meta mt-1 font-mono">{recall.campaign}</div>
              </div>
            ))}
          </section>
        )}

      {reliability.modelConcerns.length > 0 && (
        <section className="reveal flex flex-col gap-3" style={reveal()}>
          <h3 className="type-h2">Known weak points</h3>
          {reliability.modelConcerns.map((concern) => (
            <div key={concern.component} className="border-l-2 border-warn pl-3">
              <div className="type-label">
                {concern.component}{' '}
                <span className="normal-case text-faint">
                  · {concern.frequency.replace(/_/g, ' ')}
                </span>
              </div>
              <p className="type-body mt-1">{concern.description}</p>
            </div>
          ))}
        </section>
      )}

      {assessment.recommendedChecks.length > 0 && (
        <section className="reveal flex flex-col gap-2" style={reveal()}>
          <h3 className="type-h2">Before you buy</h3>
          <ul className="flex flex-col gap-1">
            {assessment.recommendedChecks.map((check, i) => (
              <li key={i} className="type-body flex gap-2">
                <span className="text-faint">·</span>
                <span>{check}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {degraded.length > 0 && (
        <section
          className="reveal flex flex-col gap-1 border-t border-border pt-3"
          style={reveal()}
        >
          {degraded.map((status, i) => (
            <p key={i} className="type-meta">
              {inspectStageNote(status)}
            </p>
          ))}
        </section>
      )}
    </div>
  );
}

export function VerdictBanner({
  verdict,
  label,
  summary,
  className = '',
  style,
}: {
  verdict: 'pass' | 'caution' | 'avoid';
  label?: string; // override headline (salvage plays: BUY & BUILD, DON'T BID…)
  summary: string;
  className?: string;
  style?: CSSProperties;
}) {
  const color = {
    pass: ['text-ok', 'border-ok'],
    caution: ['text-warn', 'border-warn'],
    avoid: ['text-danger', 'border-danger'],
  }[verdict];
  return (
    <div className={`border-l-2 pl-4 ${color[1]} ${className}`} style={style}>
      <span className={`type-h1 font-mono ${color[0]}`}>{label ?? verdict.toUpperCase()}</span>
      <p className="type-body mt-2">{summary}</p>
    </div>
  );
}

function SourceLink({ url, title }: { url: string; title?: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="type-meta font-mono text-faint transition-colors duration-[120ms] ease-out hover:text-accent"
    >
      {hostOf(url)}
      {title ? ` · ${title}` : ''}
    </a>
  );
}

// -- The money ------------------------------------------------------------------

// Every figure traceable: the rail from real sold comps (source + collection
// date in the provenance line), exposure split into the findings that drive
// it, cited repair budgets from research, and one footer listing every page
// a number came from.
function MoneyPanel({ report }: { report: InspectorReport }) {
  const { market, web, askingPrice } = report;
  const citedCosts = web.filter((f) => f.costEstimate);
  const exposure = market?.repairExposure;

  const sourceUrls = new Map<string, string>(); // url → label
  if (market) for (const comp of market.comps) sourceUrls.set(comp.url, comp.title);
  for (const f of citedCosts) for (const s of f.sources) sourceUrls.set(s.url, s.title);

  return (
    <div className="flex flex-col gap-4">
      {market && (
        <div>
          <div className="pt-4">
            <div className="relative h-px w-full bg-border">
              <span
                className="absolute top-[-5px] h-[11px] w-px bg-border-strong"
                style={{ left: `${railPercent(market.median, market)}%` }}
              />
              {askingPrice !== undefined && (
                <span
                  className="absolute top-[-7px] h-[15px] w-[2px] bg-accent"
                  style={{ left: `${railPercent(askingPrice, market)}%` }}
                />
              )}
            </div>
            <div className="mt-2 flex justify-between font-mono text-[13px]">
              <span className="text-dim">{dollars(market.low)}</span>
              <span>{dollars(market.median)} median</span>
              <span className="text-dim">{dollars(market.high)}</span>
            </div>
          </div>
          <p className="type-meta mt-2">{market.query}</p>
          {market.sampleSize < 4 && (
            <p className="type-meta mt-1 text-warn">
              only {market.sampleSize} comps: read the rail loosely
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-x-8 gap-y-1 font-mono text-[13px] sm:grid-cols-2">
        {askingPrice !== undefined && (
          <Row label="asking">
            <span className="text-accent">{dollars(askingPrice)}</span>
            {market && positionLabel(market) && (
              <span className="ml-2 text-dim">({positionLabel(market)})</span>
            )}
          </Row>
        )}
        {market && (
          <Row label="sold comps">
            {dollars(market.low)}–{dollars(market.high)}
          </Row>
        )}
        {exposure && (
          <Row label="repair exposure">
            {exposure.high > 0 ? `${dollars(exposure.low)}–${dollars(exposure.high)}` : 'none seen'}
          </Row>
        )}
        {market && askingPrice !== undefined && exposure && exposure.high > 0 && (
          <Row label="all-in worst case">
            {dollars(askingPrice + exposure.high)}
            <span className="ml-2 text-dim">(ask + repairs)</span>
          </Row>
        )}
      </div>

      {exposure && exposure.drivers.length > 0 && (
        <p className="type-meta">exposure drivers: {exposure.drivers.join(' · ')} · estimates</p>
      )}

      {citedCosts.length > 0 && (
        <div className="flex flex-col gap-1">
          {citedCosts.map((f, i) => (
            <div key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="font-mono text-[13px]">{f.costEstimate}</span>
              <span className="type-body text-dim">{f.topic}</span>
              <span className="type-meta font-mono">
                {f.sources.map((s) => hostOf(s.url)).join(' · ')}
              </span>
            </div>
          ))}
        </div>
      )}

      {market && (
        <details className="group">
          <summary className="type-meta cursor-pointer list-none transition-colors duration-[120ms] ease-out hover:text-dim [&::-webkit-details-marker]:hidden">
            {market.sampleSize} comps · expand
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {market.comps.map((comp) => (
              <li key={comp.url} className="flex items-baseline justify-between gap-4">
                <a
                  href={comp.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="type-body min-w-0 truncate text-dim transition-colors duration-[120ms] ease-out hover:text-accent"
                >
                  {comp.title}
                </a>
                <span className="shrink-0 font-mono text-[13px]">{dollars(comp.price)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {sourceUrls.size > 0 && (
        <div className="flex flex-col gap-1 border-t border-border pt-2">
          <span className="type-meta">every figure above traces to:</span>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {[...sourceUrls.entries()].slice(0, 14).map(([url, title]) => (
              <SourceLink key={url} url={url} title={title} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-dim">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

// -- History & provenance ---------------------------------------------------------

function HistoryPanel({ report }: { report: InspectorReport }) {
  const { vinCheck, sightings } = report;
  if (!vinCheck) return null;
  const d = vinCheck.decoded;
  const facts: [string, string][] = [];
  if (d?.make) facts.push(['make', d.make]);
  if (d?.model) facts.push(['model', d.model]);
  if (d?.year) facts.push(['model year', String(d.year)]);
  if (d?.bodyClass) facts.push(['body', d.bodyClass]);
  if (d?.engine) facts.push(['engine', d.engine]);
  if (d?.plant) facts.push(['built in', d.plant]);
  if (d?.serial) facts.push(['serial', d.serial]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="font-mono text-[13px]">{vinCheck.vin}</p>
        {facts.length > 0 && (
          <div className="mt-2 grid grid-cols-2 gap-x-8 gap-y-1 sm:grid-cols-3">
            {facts.map(([label, value]) => (
              <div key={label}>
                <div className="type-meta">{label}</div>
                <div className="font-mono text-[13px]">{value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {vinCheck.mismatches.map((m, i) => (
        <p key={i} className="type-body border-l-2 border-danger pl-3 text-danger">
          {m}
        </p>
      ))}

      {sightings.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="type-label">Where this VIN has appeared</span>
          <ol className="flex flex-col gap-2">
            {sightings.map((s) => (
              <li key={s.url} className="border-l-2 border-border-strong pl-3">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="type-body transition-colors duration-[120ms] ease-out hover:text-accent"
                  >
                    {s.title}
                  </a>
                  <span className="type-meta font-mono">
                    {s.source}
                    {s.date ? ` · ${s.date}` : ''}
                  </span>
                </div>
                {s.note && <p className="type-body mt-0.5 text-dim">{s.note}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <p className="type-meta">{vinCheck.note}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {vinCheck.links.map((link) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="type-meta font-mono text-faint transition-colors duration-[120ms] ease-out hover:text-accent"
            >
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

// DESIGN.md finding row: severity dot, description, photo anchor chips.
function FindingRow({
  dotClass,
  title,
  body,
  detail,
  photos,
  onAnchor,
}: {
  dotClass: string;
  title: string;
  body: string;
  detail?: string;
  photos: number[];
  onAnchor: (indices: number[]) => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className={`mt-[7px] h-[6px] w-[6px] shrink-0 rounded-full ${dotClass}`} />
      <div className="min-w-0">
        <p className="type-body">
          <span className="font-medium capitalize">{title}</span>
          <span className="text-dim"> · {body}</span>
          {detail && <span className="text-faint"> ({detail})</span>}
        </p>
        {photos.length > 0 && (
          <div className="mt-1 flex gap-2">
            {photos.map((index) => (
              <button
                key={index}
                onClick={() => onAnchor(photos)}
                className="type-meta rounded-[2px] border border-border px-1.5 font-mono transition-colors duration-[120ms] ease-out hover:border-accent-dim hover:text-accent"
              >
                photo {index}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
