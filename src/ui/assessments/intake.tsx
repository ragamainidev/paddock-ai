'use client';

/**
 * Intake: the form a hobbyist brings a lot through. Three things get pasted —
 * the listing text, the VIN, the photo addresses — and the server reads them
 * and fetches nothing (SPEC 61). Parsing is its own step so the reading can be
 * argued with before an assessment exists; the corrections ride the creation
 * request as the reader's own values.
 */
import { useRef, useState, type FormEvent } from 'react';
import type { Assumption, IntakeField } from '@/assessments/intake';
import { BuyerFields } from './buyer';
import { assessmentRequest, buttonClass, fieldClass } from './client';
import { IntakeChips } from './intake-chips';
import {
  createGateNote,
  intakeCreatePayload,
  intakeFingerprint,
  intakePreviewPayload,
  VIN_FIELD_MAX,
  type IntakeCreateRequest,
} from './intake-form';

type Reading = {
  fields: Record<string, unknown>;
  assumptions: Assumption[];
  blocked?: string;
  note?: string;
};

export function IntakeForm({
  busy,
  vin,
  liveEvidenceEnabled,
  onCreate,
}: {
  busy: boolean;
  // The VIN a showroom action carried in; the field's initial value and the
  // only thing this form is ever handed (SPEC 61).
  vin?: string;
  liveEvidenceEnabled?: boolean;
  onCreate: (payload: IntakeCreateRequest) => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [reading, setReading] = useState<Reading>();
  const [edits, setEdits] = useState<Partial<Record<IntakeField, string>>>({});
  const [error, setError] = useState('');
  const [parsing, setParsing] = useState(false);
  // What the last reading was read from, beside what the form says now: a
  // reading of text that has since changed is a reading of another lot.
  const [readFrom, setReadFrom] = useState<string>();
  const [current, setCurrent] = useState('');
  const gate = { reading, readFrom, current };
  const gateNote = createGateNote(gate);

  async function parse() {
    if (!form.current) return;
    // Corrections ride the re-read, so a reader who fixed the identity line
    // sees the whole reading follow from it.
    const values = new FormData(form.current);
    const payload = intakePreviewPayload(values, edits);
    setError('');
    if (!payload.ok) return setError(payload.error);
    // Captured before the request, so text typed while it is in flight leaves
    // the reading stale rather than passing for a reading of what is there.
    const readOf = intakeFingerprint(values);
    setParsing(true);
    try {
      setReading(
        await assessmentRequest<Reading>('/api/assessments/intake/preview', payload.payload),
      );
      setReadFrom(readOf);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the listing.');
    } finally {
      setParsing(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = intakeCreatePayload(new FormData(event.currentTarget), edits);
    setError('');
    if (!payload.ok) return setError(payload.error);
    onCreate(payload.payload);
  }

  return (
    <form
      ref={form}
      className="mt-4 max-w-3xl space-y-4"
      onSubmit={submit}
      onInput={(event) => setCurrent(intakeFingerprint(new FormData(event.currentTarget)))}
    >
      <p className="type-body text-dim">
        Copy the listing text, the VIN and the photo addresses from the auction page. Nothing here
        is fetched: the server reads only what you paste, and states every value it inferred.{' '}
        {liveEvidenceEnabled
          ? 'Live research is enabled and can incur provider charges.'
          : 'Live research is disabled. Your lot will be saved for later investigation.'}
      </p>
      <label className="block space-y-2">
        <span className="type-label">Listing text, pasted</span>
        <textarea
          name="listingText"
          rows={10}
          className={fieldClass}
          placeholder="2021 FERRARI SF90 STRADALE&#10;Lot # 63198496&#10;VIN: …"
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-2">
          <span className="type-label">VIN, if the text does not state it</span>
          <input name="vin" defaultValue={vin} maxLength={VIN_FIELD_MAX} className={fieldClass} />
        </label>
        <label className="block space-y-2">
          <span className="type-label">Listing link (kept as provenance, never fetched)</span>
          <input name="listingUrl" type="url" className={fieldClass} placeholder="https://…" />
        </label>
      </div>
      <label className="block space-y-2">
        <span className="type-label">Photo links, one per line (1 to 12)</span>
        <textarea name="photos" rows={4} className={fieldClass} placeholder="https://…" />
      </label>
      <label className="block space-y-2">
        <span className="type-label">Research allowance in USD (0 to 20)</span>
        <input
          name="researchAllowance"
          type="number"
          min={0}
          max={20}
          placeholder="0"
          className={fieldClass}
        />
      </label>

      <section className="space-y-3 border-t border-border pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="type-h2">What the listing says</h3>
          <button
            type="button"
            className="type-body min-h-10 text-accent underline underline-offset-4 disabled:cursor-not-allowed disabled:text-faint disabled:no-underline"
            disabled={parsing || busy}
            onClick={() => void parse()}
          >
            {parsing ? 'Reading…' : reading ? 'Read it again' : 'Parse listing'}
          </button>
        </div>
        {!reading && (
          <p className="type-body text-dim">
            Parse first to see each value and where it came from. You can correct any of them.
          </p>
        )}
        {reading?.note && <p className="type-meta text-dim">{reading.note}</p>}
        {reading?.blocked && (
          <p role="alert" className="type-body text-warn">
            {reading.blocked}
          </p>
        )}
        {reading && (
          <IntakeChips
            assumptions={reading.assumptions}
            edits={edits}
            onEdit={(field, value) => setEdits((typed) => ({ ...typed, [field]: value }))}
          />
        )}
      </section>

      <BuyerFields />
      <p className="type-body text-dim">
        Zero permits free sources only. Research consumes fixed allowances; provider bills may
        differ. Coordinator model calls have a separate limit.
      </p>
      {error && (
        <p role="alert" className="type-body text-warn">
          {error}
        </p>
      )}
      {/* DESIGN.md: creation follows a reading of the listing as it stands,
          and the note beside the button says which part is missing. */}
      <div className="flex flex-wrap items-center gap-4">
        <button className={buttonClass} disabled={busy || gateNote !== ''} type="submit">
          {busy ? 'Saving…' : 'Create assessment'}
        </button>
        {gateNote && <span className="type-meta text-dim">{gateNote}</span>}
      </div>
    </form>
  );
}
