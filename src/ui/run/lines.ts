import type { InspectEvent, InspectorReport, InspectStage } from '@/inspector/types';
import type { SalvageEvent, SalvageReport } from '@/salvage/types';
import type { RunMetaEvent, StoredEvent } from '@/runs/types';
import type { Span } from '@/trace/tracer';
import { dollars, hostOf, inspectStageLabel, positionLabel } from '../inspect-format';

// Pure projection of a run's event stream into everything the run page
// renders: console lines (with the DESIGN.md line grammar), the stage rail,
// trace spans, and the finished report. The reducer is pure so the whole
// live-streaming UI tests offline; pacing and animation are presentation.
// Inspect and salvage runs share the grammar; kind-specific payloads
// (analysis vs triage, market vs ledger) map onto the same line kinds.

export type AnyRunEvent = InspectEvent | SalvageEvent;

const SALVAGE_STAGE_LABELS: Record<string, string> = {
  triage: 'damage triage',
  research: 'parts & value',
  ledger: 'ledger',
};

export function stageLabel(stage: string): string {
  return SALVAGE_STAGE_LABELS[stage] ?? inspectStageLabel(stage as InspectStage) ?? stage;
}

function stageNote(status: { stage: string; ok: boolean; detail?: string }): string {
  const base = `${stageLabel(status.stage)} unavailable`;
  return status.detail ? `${base}: ${status.detail}` : base;
}

export type LineKind =
  | 'thought' // narration, dim
  | 'evidence' // facts: photo observations, decoded values, counts
  | 'finding-warn'
  | 'finding-danger'
  | 'search' // live web search; the query is the work
  | 'plan' // reason → topic
  | 'degraded' // one meta line per degraded stage
  | 'verdict-pass'
  | 'verdict-warn'
  | 'verdict-danger';

export type ConsoleLine = {
  key: string;
  stage: string; // gutter label
  kind: LineKind;
  text: string;
  photo?: number; // renders as a `photo N` chip before the text
  detail?: string; // dim tail (plan topics, source hosts)
  lane?: string; // parallel-worker tag ('resale', 'part-out'), rendered dim before the text
};

export type RailState = 'pending' | 'active' | 'ok' | 'degraded';

export type RailStage = {
  stage: InspectStage | string;
  label: string;
  state: RailState;
  detail?: string; // one meta line under a degraded row
  beginAt?: string; // envelope timestamp when the stage went active
  ms?: number; // settled duration, from envelope timestamps
};

export type RunProjection = {
  meta?: RunMetaEvent;
  lines: ConsoleLine[];
  rail: RailStage[];
  spans: Span[];
  report?: InspectorReport;
  salvageReport?: SalvageReport;
  fatal?: string;
  activeStage?: string;
  firstAt?: string;
  lastAt?: string;
  lastSeq: number;
};

export const emptyProjection = (): RunProjection => ({
  lines: [],
  rail: [],
  spans: [],
  lastSeq: 0,
});

const sevKind = (severity: string): LineKind =>
  severity === 'critical' || severity === 'high' ? 'finding-danger' : 'finding-warn';

// The DESIGN.md console grammar, one event at a time. Keys are seq-scoped so
// React identity survives replays.
export function linesForEvent(event: AnyRunEvent, seq: number): ConsoleLine[] {
  const key = (i: number) => `${seq}.${i}`;
  switch (event.type) {
    case 'thought': {
      const stage = stageLabel(event.stage);
      // Parallel research workers tag their lines: '[resale] searching: …'.
      const laneMatch = /^\[([^\]]{1,24})\]\s+(.*)$/.exec(event.text);
      const lane = laneMatch?.[1];
      const text = laneMatch?.[2] ?? event.text;
      if (text.startsWith('searching: ')) {
        return [
          { key: key(0), stage, kind: 'search', text: text.slice('searching: '.length), lane },
        ];
      }
      return [{ key: key(0), stage, kind: 'thought', text, lane }];
    }
    case 'photo':
      return [
        { key: key(0), stage: 'photos', kind: 'evidence', text: event.note, photo: event.index },
      ];
    case 'triage': {
      const t = event.triage;
      const lines: ConsoleLine[] = t.areas.map((area, i) => ({
        key: key(i),
        stage: 'damage triage',
        kind:
          area.kind === 'structural'
            ? ('finding-danger' as const)
            : area.severity === 'heavy'
              ? ('finding-warn' as const)
              : ('evidence' as const),
        text: `${area.severity} ${area.kind}: ${area.area} · ${area.description}`,
        photo: area.photos[0],
      }));
      let n = lines.length;
      if (t.airbagsDeployed === 'yes') {
        lines.push({
          key: key(n++),
          stage: 'damage triage',
          kind: 'finding-danger',
          text: 'airbags deployed',
        });
      }
      if (t.floodEvidence) {
        lines.push({
          key: key(n++),
          stage: 'damage triage',
          kind: 'finding-danger',
          text: 'flood evidence in the photos',
        });
      }
      if (t.fireEvidence) {
        lines.push({
          key: key(n++),
          stage: 'damage triage',
          kind: 'finding-danger',
          text: 'fire evidence in the photos',
        });
      }
      lines.push({
        key: key(n++),
        stage: 'damage triage',
        kind: 'evidence',
        text: `drivetrain: ${t.drivetrainRisk}`,
      });
      return lines;
    }
    case 'repair-plan': {
      const p = event.plan;
      const diy = p.lines.filter((l) => l.who === 'diy').length;
      return [
        {
          key: key(0),
          stage: 'plan',
          kind: 'evidence',
          text: `${p.programs.length} program${p.programs.length === 1 ? '' : 's'}, ${p.lines.length} lines: ${dollars(p.low)}–${dollars(p.high)}, expected ${dollars(p.expected)} · ${diy} DIY (${p.diyHoursTotal}h of your labor), ${p.lines.length - diy} professional`,
        },
      ];
    }
    case 'comps': {
      const lanes = ['clean', 'rebuilt', 'wreck'] as const;
      return lanes.flatMap((lane, i) => {
        const mine = event.comps.filter((c) => c.lane === lane);
        if (mine.length === 0) return [];
        const sold = mine.filter((c) => c.outcome === 'sold').length;
        const asks = mine.filter((c) => c.outcome === 'ask').length;
        const bids = mine.length - sold - asks;
        const prices = mine.map((c) => c.price);
        const parts = [
          sold ? `${sold} sold` : '',
          asks ? `${asks} ask${asks === 1 ? '' : 's'}` : '',
          bids ? `${bids} no-sale bid${bids === 1 ? '' : 's'}` : '',
        ].filter(Boolean);
        return [
          {
            key: key(i),
            stage: 'parts & value',
            kind: 'evidence' as const,
            text: `${lane} comps: ${parts.join(', ')} · ${dollars(Math.min(...prices))}–${dollars(Math.max(...prices))}`,
            detail: [...new Set(mine.map((c) => c.source))].join(' · '),
          },
        ];
      });
    }
    case 'prices': {
      const byLine = new Map<string, number>();
      for (const p of event.prices) byLine.set(p.line, (byLine.get(p.line) ?? 0) + 1);
      return [
        {
          key: key(0),
          stage: 'parts & value',
          kind: 'evidence',
          text: `${event.prices.length} cited price${event.prices.length === 1 ? '' : 's'}: ${[...byLine.entries()].map(([line, n]) => `${line} ×${n}`).join(', ')}`,
          detail: [...new Set(event.prices.map((p) => p.source))].join(' · '),
        },
      ];
    }
    case 'ledger': {
      const l = event.ledger;
      const lines: ConsoleLine[] = [];
      if (l.exit) {
        lines.push({
          key: key(0),
          stage: 'ledger',
          kind: 'evidence',
          text: `rebuilt exit ${dollars(l.exit.low)} low · ${dollars(l.exit.typical)} typical · ${dollars(l.exit.high)} high (${l.exit.n} comp${l.exit.n === 1 ? '' : 's'}, ${l.exit.lane.replace(/_/g, ' ')})`,
        });
      }
      lines.push({
        key: key(1),
        stage: 'ledger',
        kind: l.ceiling === null ? 'finding-warn' : l.ceiling > 0 ? 'evidence' : 'finding-danger',
        text:
          l.ceiling === null
            ? 'no exit anchor: nothing to solve the ceiling against'
            : l.ceiling > 0
              ? `bid ceiling ${dollars(l.ceiling)} · break-even ${dollars(l.breakEven ?? 0)} · stress ${dollars(l.stress ?? 0)}`
              : `bid ceiling $0: ${l.killers
                  .slice(0, 2)
                  .map((k) => k.label.toLowerCase())
                  .join(' and ')} eat the exit`,
      });
      return lines;
    }
    case 'sightings':
      return event.sightings.length === 0
        ? []
        : event.sightings.map((s, i) => ({
            key: key(i),
            stage: 'VIN',
            kind: 'evidence' as const,
            text: `${s.title}${s.date ? ` (${s.date})` : ''}${s.note ? ` · ${s.note}` : ''}`,
            detail: s.source,
          }));
    case 'analysis': {
      const lines: ConsoleLine[] = event.analysis.issues.map((issue, i) => ({
        key: key(i),
        stage: 'vision',
        kind: sevKind(issue.severity),
        text: `${issue.severity}: ${issue.description}`,
        photo: issue.photos[0],
      }));
      const offset = lines.length;
      event.analysis.modifications.forEach((mod, i) => {
        lines.push({
          key: key(offset + i),
          stage: 'vision',
          kind: mod.quality === 'budget_aftermarket' ? 'finding-warn' : 'evidence',
          text: `modification: ${mod.description} (${mod.quality.replace(/_/g, ' ')})`,
          photo: mod.photos[0],
        });
      });
      return lines;
    }
    case 'plan':
      return event.topics.map((topic, i) => ({
        key: key(i),
        stage: 'research plan',
        kind: 'plan' as const,
        text: topic.reason,
        detail: topic.topic,
      }));
    case 'web':
      return [
        {
          key: key(0),
          stage: 'web research',
          kind: event.finding.severity === 'critical' ? 'finding-danger' : 'evidence',
          text: event.finding.summary,
          detail: event.finding.sources.map((s) => hostOf(s.url)).join(' · '),
        },
      ];
    case 'nhtsa':
      return [
        {
          key: key(0),
          stage: 'NHTSA',
          kind: 'evidence',
          text: `${event.research.complaintsTotal} federal complaint(s), ${event.research.recalls.length} recall(s) on file`,
        },
      ];
    case 'reliability':
      return event.report.modelConcerns.length > 0
        ? [
            {
              key: key(0),
              stage: 'known failures',
              kind: 'evidence',
              text: `${event.report.modelConcerns.length} known weak point(s): ${event.report.modelConcerns
                .map((c) => c.component)
                .join(', ')}`,
            },
          ]
        : [];
    case 'vin': {
      if (event.check.mismatches.length > 0) {
        return event.check.mismatches.map((m, i) => ({
          key: key(i),
          stage: 'VIN',
          kind: 'finding-danger' as const,
          text: m,
        }));
      }
      const d = event.check.decoded;
      const facts = d
        ? [d.make, d.model, d.year, d.bodyClass, d.engine, d.plant].filter(Boolean).join(' · ')
        : 'no decode';
      return [{ key: key(0), stage: 'VIN', kind: 'evidence', text: `decodes clean: ${facts}` }];
    }
    case 'market':
      return [
        {
          key: key(0),
          stage: 'market',
          kind: 'evidence',
          text: `${event.market.sampleSize} comps: ${dollars(event.market.low)}–${dollars(event.market.high)}, median ${dollars(event.market.median)}${positionLabel(event.market) ? ` · ${positionLabel(event.market)}` : ''}`,
        },
      ];
    case 'stage':
      return event.status.ok
        ? []
        : [
            {
              key: key(0),
              stage: stageLabel(event.status.stage),
              kind: 'degraded',
              text: stageNote(event.status),
            },
          ];
    case 'report': {
      const verdict = event.report.assessment.verdict;
      const good = verdict === 'pass' || verdict === 'build' || verdict === 'part_out';
      const bad = verdict === 'avoid' || verdict === 'walk';
      const label =
        verdict === 'build'
          ? 'BID'
          : verdict === 'walk'
            ? 'NO BID'
            : verdict.replace('_', ' ').toUpperCase();
      return [
        {
          key: key(0),
          stage: 'synthesis',
          kind: good ? 'verdict-pass' : bad ? 'verdict-danger' : 'verdict-warn',
          text: `verdict: ${label} · ${event.report.assessment.summary}`,
        },
      ];
    }
    default:
      return [];
  }
}

// Fold one stored envelope into the projection. Stage rail rows appear on
// `begin` and settle on their stage status; durations come from envelope
// timestamps so replays show the true timings.
export function reduceRun(state: RunProjection, stored: StoredEvent): RunProjection {
  if (stored.seq <= state.lastSeq) return state; // replay overlap guard
  const event = stored.event as InspectEvent | RunMetaEvent;
  const next: RunProjection = {
    ...state,
    lines: state.lines,
    rail: state.rail,
    spans: state.spans,
    lastSeq: stored.seq,
    firstAt: state.firstAt ?? stored.at,
    lastAt: stored.at,
  };

  if (event.type === 'run-meta') {
    next.meta = event;
    return next;
  }

  const runEvent = event as AnyRunEvent;
  const produced = linesForEvent(runEvent, stored.seq);
  if (produced.length > 0) next.lines = [...state.lines, ...produced];

  switch (runEvent.type) {
    case 'begin': {
      const label = stageLabel(runEvent.stage);
      const existing = state.rail.find((r) => r.stage === runEvent.stage);
      next.rail = existing
        ? state.rail.map((r) =>
            r.stage === runEvent.stage ? { ...r, state: 'active' as const, beginAt: stored.at } : r,
          )
        : [
            ...state.rail,
            {
              stage: runEvent.stage,
              label,
              state: 'active' as const,
              beginAt: stored.at,
            },
          ];
      next.activeStage = label;
      break;
    }
    case 'stage': {
      const status = runEvent.status as { stage: string; ok: boolean; detail?: string };
      next.rail = state.rail.map((r) =>
        r.stage === status.stage
          ? {
              ...r,
              state: status.ok ? ('ok' as const) : ('degraded' as const),
              detail: status.ok ? undefined : status.detail,
              ms: r.beginAt ? Date.parse(stored.at) - Date.parse(r.beginAt) : undefined,
            }
          : r,
      );
      if (next.activeStage === stageLabel(status.stage)) next.activeStage = undefined;
      break;
    }
    case 'span':
      next.spans = [...state.spans, runEvent.span];
      break;
    case 'report':
      // Persisted reports are historical data: runs written by older code
      // lack fields added since (sightings, vinCheck.links,
      // confidenceFactors). Normalize here — the single boundary where
      // stored reports enter the UI — so no component ever reads a
      // new-field on an old report and dies.
      if ('lot' in runEvent.report) next.salvageReport = normalizeSalvageReport(runEvent.report);
      else next.report = normalizeInspectorReport(runEvent.report);
      next.activeStage = undefined;
      break;
    case 'fatal':
      next.fatal = runEvent.message;
      next.activeStage = undefined;
      break;
  }
  return next;
}

// Migration-on-read for reports persisted by older code. Every field added
// to a report type AFTER runs started persisting gets a default here, and
// the regression tests feed genuine old-shaped payloads through reduceRun.
export function normalizeInspectorReport(raw: InspectorReport): InspectorReport {
  return {
    ...raw,
    sightings: raw.sightings ?? [],
    vinCheck: raw.vinCheck ? { ...raw.vinCheck, links: raw.vinCheck.links ?? [] } : raw.vinCheck,
  };
}

// A report persisted by the pre-ceiling model carries a task-list plan and a
// bid-scenario ledger; neither renders in the ceiling grammar. It is marked
// legacy and reduced to what still holds: the verdict, its summary, the
// triage, and the provenance. The plan and ledger are emptied rather than
// re-derived: the evidence that would re-derive them was never typed.
export function normalizeSalvageReport(raw: SalvageReport): SalvageReport {
  const legacy = !('programs' in (raw.plan ?? {})) || !raw.evidence;
  const base: SalvageReport = {
    ...raw,
    sightings: raw.sightings ?? [],
    vinCheck: raw.vinCheck ? { ...raw.vinCheck, links: raw.vinCheck.links ?? [] } : raw.vinCheck,
    evidence: raw.evidence ?? { comps: [], prices: [] },
    research: raw.research ?? [],
    assessment: {
      ...raw.assessment,
      confidenceFactors: raw.assessment.confidenceFactors ?? [],
    },
  };
  if (!legacy) return base;
  const missed = (raw.plan as unknown as { missed?: string[] } | undefined)?.missed ?? [];
  return {
    ...base,
    legacy: true,
    plan: {
      programs: [],
      lines: [],
      diyHoursTotal: 0,
      low: 0,
      expected: 0,
      high: 0,
      tier: 'exotic',
      tierLabel: 'legacy report',
      missed,
    },
    ledger: undefined,
  };
}

// mm:ss for run durations; s.t for stage durations under a minute.
export function clockFormat(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function stageDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return clockFormat(ms);
}
