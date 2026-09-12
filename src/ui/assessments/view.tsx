'use client';

/**
 * The saved assessment: this module loads the record, keeps it current, and
 * composes the sections that render it. Every section reads the same record
 * and writes through the same seam, so a failed write leaves the page honest.
 */
import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import type { AgentActivity } from '@/assessment-http/agent';
import { assessmentRequest, type AssessmentDetail } from './client';
import { runNotice, type ResearchAction } from './format';
import { useBoundedPoll, type PollStatus } from './polling';
import { ActivityLog } from './activity';
import { AssessmentHeader } from './header';
import { BuyerEconomics } from './buyer-economics';
import { DecisionHeadline } from './decision-headline';
import { EvidenceEntry } from './evidence-entry';
import { EvidenceList } from './evidence-list';
import { IntakeChips } from './intake-chips';
import { History } from './history';
import { OutcomeForm } from './outcome-form';
import { Requirements } from './requirements';
import { WatchForm } from './watch-form';

export function AssessmentView({ id }: { id: string }) {
  const [data, setData] = useState<AssessmentDetail>();
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [activity, setActivity] = useState<AgentActivity[]>([]);
  const [activityUnavailable, setActivityUnavailable] = useState(false);
  // A manual action can make a stopped assessment worth reading again.
  const [pollEpoch, setPollEpoch] = useState(0);
  const status = useRef<PollStatus>('active');
  const revision = useRef(-1);
  // Zero until a revision is seen: the schedule reads that as freshly changed.
  const revisionChangedAt = useRef(0);

  const load = useCallback(async () => {
    const next = await assessmentRequest<AssessmentDetail>(`/api/assessments/${id}`);
    setData(next);
    // The schedule reads what the response carried, not what a render has
    // caught up with, so a stopped assessment stops being polled at once.
    status.current = next.assessment.status;
    if (next.assessment.revision !== revision.current) {
      revision.current = next.assessment.revision;
      revisionChangedAt.current = Date.now();
    }
  }, [id]);

  const pollRecord = useCallback(async () => {
    try {
      await load();
      setPollError('');
    } catch (err) {
      setPollError(err instanceof Error ? err.message : 'The request failed. Try again.');
    }
  }, [load]);

  const pollActivity = useCallback(async () => {
    try {
      const result = await assessmentRequest<{ events: AgentActivity[] }>(
        `/api/assessments/${id}/activity`,
      );
      setActivity(result.events);
      setActivityUnavailable(false);
    } catch {
      // The record poll owns the banner; a failed activity read degrades to one
      // meta line in the section it belongs to.
      setActivityUnavailable(true);
    }
  }, [id]);

  useBoundedPoll(pollRecord, status, revisionChangedAt, pollEpoch);
  useBoundedPoll(pollActivity, status, revisionChangedAt, pollEpoch);

  async function act(action: ResearchAction) {
    if (!data) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await assessmentRequest<{
        // `accepted` is the run route's alone: a session started. Every other
        // route answers `saved`, meaning the intent is committed (SPEC 57).
        research?: { accepted?: boolean; saved?: boolean; message?: string; reason?: string };
      }>(`/api/assessments/${id}/${action}`, {
        expectedRevision: data.assessment.revision,
        idempotencyKey: crypto.randomUUID(),
      });
      await load();
      if (result.research?.message) throw new Error(result.research.message);
      setNotice(runNotice(action, result.research));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the assessment.');
    } finally {
      setBusy(false);
      setPollEpoch((n) => n + 1);
    }
  }

  async function save(action: string, payload: Record<string, unknown>): Promise<boolean> {
    if (!data) return false;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await assessmentRequest(`/api/assessments/${id}/${action}`, {
        ...payload,
        expectedRevision: data.assessment.revision,
        idempotencyKey: crypto.randomUUID(),
      });
      await load();
      setNotice(
        action === 'review'
          ? 'Your evidence review is recorded and the decision has been recomputed.'
          : 'Saved. The decision reflects the current evidence and buyer constraints.',
      );
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the change.');
      await load().catch(() => undefined);
      return false;
    } finally {
      setBusy(false);
      setPollEpoch((n) => n + 1);
    }
  }

  if (!data)
    return (
      <div className="space-y-4">
        <Link href="/assessments" className="type-body text-accent">
          All assessments
        </Link>
        <p role={error || pollError ? 'alert' : 'status'} className="type-body text-dim">
          {error || pollError || 'Opening assessment…'}
        </p>
      </div>
    );
  const a = data.assessment;
  const sections = { data, busy, save };

  return (
    <div className="space-y-8 pb-8">
      <AssessmentHeader
        data={data}
        busy={busy}
        failure={error || pollError}
        notice={notice}
        act={act}
      />

      {/* A lot the buyer brought carries the chips behind every field it
          states; saved, they are its provenance and are read rather than
          corrected (SPEC 61). A catalog lot has none and shows nothing. */}
      {a.lotAssumptions && a.lotAssumptions.length > 0 && (
        <details className="border-b border-border pb-3">
          <summary className="type-body cursor-pointer text-dim">
            How this lot was read — {a.lotAssumptions.length} value
            {a.lotAssumptions.length === 1 ? '' : 's'} from your listing
          </summary>
          <div className="mt-3">
            <IntakeChips assumptions={a.lotAssumptions} />
          </div>
        </details>
      )}

      <DecisionHeadline data={data} />
      <BuyerEconomics {...sections} />
      <Requirements data={data} />
      <EvidenceEntry assessment={a} busy={busy} save={save} />
      <WatchForm {...sections} />
      <EvidenceList {...sections} />
      <OutcomeForm {...sections} />
      <ActivityLog events={activity} unavailable={activityUnavailable} />
      <History data={data} />
    </div>
  );
}
