'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { Assessment, CreateAssessmentInput } from '@/assessments/types';
import { dollars } from '@/ui/inspect-format';
import { actionLinkClass, assessmentRequest, buttonClass } from './client';
import { OUTCOME_DUE_TAG, provenanceLabel } from './format';
import { retainCreationIntent, type CreationIntent } from './creation';
import { Calibration } from './calibration';
import { IntakeForm } from './intake';
import { RecordedExampleTag } from './lot-provenance';
import { DEFAULT_BUYER_PROFILE } from '@/assessments/buyer-profile';
import type { OutcomeReport } from '@/assessment-reporting/outcomes';

// `outcomeDue` is the collection endpoint's own flag: the desk has asked what
// happened to this lot and nobody has answered yet (SPEC 62).
type SavedAssessment = Assessment & { outcomeDue?: boolean };
type Collection = {
  assessments: SavedAssessment[];
  agent: {
    configured: boolean;
    liveEvidenceEnabled: boolean;
    modelMode?: 'fixture' | 'live-coordinator';
  };
  seeds: { id: string; title: string }[];
  outcomeReport: OutcomeReport;
};

export function AssessmentWorkspace({ vin }: { vin?: string }) {
  const router = useRouter();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [savedId, setSavedId] = useState<string>();
  // A VIN carried in from the showroom is a reader who already chose intake,
  // so the form opens with it; without one nothing is open and nothing filled.
  const [manual, setManual] = useState(Boolean(vin));
  const pendingCreation = useRef<CreationIntent | null>(null);

  useEffect(() => {
    let alive = true;
    assessmentRequest<Collection>('/api/assessments')
      .then((data) => {
        if (alive) setCollection(data);
      })
      .catch((err: Error) => {
        if (alive) setError(err.message);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function start(input: CreateAssessmentInput) {
    setStarting(true);
    setError('');
    setSavedId(undefined);
    try {
      // A lost response can follow a successful save. Retrying unchanged input keeps
      // the entire creation intent, including its lot ID, timestamp and operation key.
      pendingCreation.current = retainCreationIntent(pendingCreation.current, input);
      const { assessment } = await assessmentRequest<{ assessment: Assessment }>(
        '/api/assessments',
        pendingCreation.current.input,
      );
      setSavedId(assessment.id);
      pendingCreation.current = null;
      router.push(`/assessments/${assessment.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the assessment.');
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="space-y-8">
      <header className="max-w-3xl space-y-2">
        <h1 className="type-display">Assessments</h1>
        <p className="type-body text-dim">
          A decision that stays with the car. The agent investigates what matters next, records its
          evidence, and updates the rebuild ceiling.
        </p>
      </header>

      {error && (
        <p role="alert" className="type-body text-warn">
          {error}{' '}
          {savedId && (
            <Link className="underline underline-offset-4" href={`/assessments/${savedId}`}>
              Open saved assessment
            </Link>
          )}
        </p>
      )}

      <section className="border-y border-border py-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-2xl space-y-2">
            {/* The catalog lots are examples the product recorded, not lots
                on offer; the reader's own lot comes through intake. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="type-h2">Watch an investigation</h2>
              <RecordedExampleTag />
            </div>
            <p className="type-body text-dim">
              Replay a recorded Ferrari SF90 case through the research agent.{' '}
              {/* An unreachable agent reports no model mode, so the copy states
                  what is actually running rather than assuming a coordinator. */}
              {collection &&
                (!collection.agent.configured
                  ? 'Recorded evidence; the research agent is not connected.'
                  : collection.agent.modelMode === 'live-coordinator'
                    ? 'Recorded evidence with a live coordinator; model calls incur charges.'
                    : 'Local evidence and a fixture model; no paid API calls.')}
            </p>
          </div>
          <button
            type="button"
            className={buttonClass}
            disabled={starting}
            onClick={() =>
              void start({
                seedLotId: 'sf90-front-il',
                mode: 'fixture',
                fixtureCaseId: 'sf90-live-2026-08-18',
              })
            }
          >
            {starting ? 'Starting…' : 'Run recorded case'}
          </button>
        </div>
        <div className="mt-4 max-w-3xl space-y-2">
          <p className="type-body text-dim">
            A separate synthetic case demonstrates a complete decision with invented inspection
            records and prices. Review its evidence to see the final gates close.
          </p>
          <button
            type="button"
            className={actionLinkClass}
            disabled={starting}
            onClick={() =>
              void start({
                seedLotId: 'sf90-front-il',
                mode: 'fixture',
                fixtureCaseId: 'ready-candidate',
                buyer: {
                  ...DEFAULT_BUYER_PROFILE,
                  // Edited hobbyist assumptions, so the profile no longer
                  // carries a preset's name.
                  preset: 'custom',
                  jurisdiction: 'US-CA',
                  maxAllIn: 200000,
                  availableDiyHours: 1000,
                },
                budget: { maxInvestigations: 12, maxCostCents: 0 },
              })
            }
          >
            Run synthetic decision case
          </button>
        </div>
        {collection && !collection.agent.configured && (
          <p className="type-body mt-3 text-warn">
            The research agent is not connected. You can save an assessment and continue when it is
            available.
          </p>
        )}
      </section>

      <section>
        <button
          type="button"
          className="type-body text-accent underline underline-offset-4"
          aria-expanded={manual}
          onClick={() => setManual(!manual)}
        >
          Bring your own lot
        </button>
        {manual && (
          <IntakeForm
            busy={starting}
            vin={vin}
            liveEvidenceEnabled={collection?.agent.liveEvidenceEnabled}
            onCreate={(payload) => void start(payload)}
          />
        )}
      </section>

      <section>
        <h2 className="type-h2 border-b border-border pb-3">Saved decisions</h2>
        {!collection && !error && (
          <p className="type-body py-6 text-dim" role="status">
            Loading assessments…
          </p>
        )}
        {collection?.assessments.length === 0 && (
          <p className="type-body py-6 text-dim">
            No assessments yet. Start with the recorded case or add a listing.
          </p>
        )}
        <ul className="divide-y divide-border">
          {collection?.assessments.map((assessment) => (
            <li key={assessment.id}>
              <Link
                href={`/assessments/${assessment.id}`}
                className="flex flex-wrap items-baseline justify-between gap-2 py-4 hover:text-accent"
              >
                <div className="min-w-0">
                  <p className="type-h2 break-words">{assessment.lot.title}</p>
                  <p className="type-meta mt-1">
                    {provenanceLabel(assessment)} · revision {assessment.revision} ·{' '}
                    {assessment.status}
                    {assessment.outcomeDue ? ` · ${OUTCOME_DUE_TAG}` : ''}
                  </p>
                </div>
                <p className="type-spec">
                  {assessment.decision.economicDominance
                    ? 'Pass under current economics'
                    : assessment.decision.readiness === 'needs_evidence'
                      ? 'Needs evidence'
                      : assessment.decision.verdict === 'walk'
                        ? 'No bid'
                        : assessment.decision.ceiling === null
                          ? 'Ceiling –'
                          : `Ceiling ${dollars(assessment.decision.ceiling)}`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {collection && <Calibration report={collection.outcomeReport} />}
    </div>
  );
}
