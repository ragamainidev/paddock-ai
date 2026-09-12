'use client';

import { useState, type FormEvent } from 'react';
import type {
  Assessment,
  EvidenceInput,
  InspectionSystem,
  PhysicalInspection,
} from '@/assessments/types';
import { actionLinkClass, fieldClass } from './client';

type EntryKind = 'inspection' | 'registration' | 'title' | 'repair_price' | 'comp';
const systems: { id: InspectionSystem; label: string }[] = [
  { id: 'structure', label: 'Structure / measurements' },
  { id: 'srs', label: 'Restraints / SRS' },
  { id: 'powertrain', label: 'Powertrain' },
  { id: 'hv', label: 'High-voltage system' },
  { id: 'water_fire', label: 'Water / fire exposure' },
];

export function EvidenceEntry({
  assessment,
  busy,
  save,
}: {
  assessment: Assessment;
  busy: boolean;
  save: (action: string, payload: Record<string, unknown>) => Promise<boolean>;
}) {
  const [kind, setKind] = useState<EntryKind>('inspection');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const v = (name: string) => String(data.get(name) ?? '').trim();
    const n = (name: string) => Number(v(name));
    const common = {
      subject: {
        vin: assessment.lot.vin,
        make: assessment.lot.make,
        model: assessment.lot.model,
        year: assessment.lot.year,
      },
      source: {
        url: v('sourceUrl'),
        label: v('sourceLabel'),
        capturedBy: 'user' as const,
        retrievedAt: new Date(v('observedAt')).toISOString(),
      },
    };
    let evidence: EvidenceInput;
    switch (kind) {
      case 'inspection':
        evidence = {
          ...common,
          kind,
          value: {
            inspector: v('inspector'),
            inspectedAt: new Date(v('inspectedAt')).toISOString(),
            method: 'physical',
            systems: systems.map(({ id }) => ({
              system: id,
              status: v(`${id}Status`) as PhysicalInspection['systems'][number]['status'],
              finding: v(`${id}Finding`),
            })),
            repairScopeConfirmed: data.has('repairScopeConfirmed'),
          },
        };
        break;
      case 'registration':
        evidence = {
          ...common,
          kind,
          value: {
            jurisdiction: `US-${v('jurisdiction').toUpperCase()}`,
            eligible: v('eligible') === 'yes',
            requirements: v('requirements')
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean),
            ...(v('expiresAt') ? { expiresAt: new Date(v('expiresAt')).toISOString() } : {}),
          },
        };
        break;
      case 'title':
        evidence = {
          ...common,
          kind,
          value: {
            titleBrand: v('titleBrand'),
            ...(v('resolution') ? { listingDiscrepancyResolution: v('resolution') } : {}),
          },
        };
        break;
      case 'repair_price':
        evidence = {
          ...common,
          kind,
          value: {
            line: v('line'),
            item: v('item'),
            kind: 'job_quote',
            low: n('low'),
            high: n('high'),
            url: v('sourceUrl'),
            source: v('sourceLabel'),
            note: v('note') || undefined,
          },
        };
        break;
      case 'comp':
        evidence = {
          ...common,
          kind,
          value: {
            vehicle: { make: v('compMake'), model: v('compModel'), year: n('year') },
            lane: v('lane') as 'clean' | 'rebuilt' | 'wreck',
            outcome: v('outcome') as 'sold' | 'ask' | 'bid_no_sale',
            price: n('price'),
            year: n('year'),
            title: v('title') as 'clean' | 'rebuilt' | 'salvage' | 'unknown',
            date: v('transactionDate'),
            variant: v('variant') || undefined,
            url: v('sourceUrl'),
            source: v('sourceLabel'),
            note: v('note') || undefined,
          },
        };
        break;
    }
    if (await save('evidence', { evidence: [evidence] })) form.reset();
  }
  return (
    <details className="border-t border-border pt-4">
      <summary className="type-body cursor-pointer text-accent">
        Add inspection, title or price evidence
      </summary>
      <form onSubmit={(event) => void submit(event)} className="mt-4 space-y-4">
        <p className="type-body max-w-3xl text-dim">
          Record findings from a source you can inspect. Saved findings remain unverified until you
          review the source and accept its applicability below. A physical inspection must describe
          work actually performed.
        </p>
        <label className="block space-y-2">
          <span className="type-label">Evidence type</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as EntryKind)}
            className={fieldClass}
          >
            <option value="inspection">Physical inspection</option>
            <option value="registration">Registration eligibility</option>
            <option value="title">Title document</option>
            <option value="repair_price">Repair quote</option>
            <option value="comp">Comparable vehicle</option>
          </select>
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input name="sourceUrl" label="Source URL" type="url" required />
          <Input name="sourceLabel" label="Document / source name" required />
          <Input name="observedAt" label="Source observed on" type="date" required />
        </div>
        {kind === 'inspection' && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input name="inspector" label="Inspector / workshop" required />
              <Input name="inspectedAt" label="Physical inspection date" type="date" required />
            </div>
            {systems.map(({ id, label }) => (
              <div key={id} className="grid gap-3 sm:grid-cols-[220px_1fr]">
                <label className="block space-y-2">
                  <span className="type-label">{label}</span>
                  <select name={`${id}Status`} className={fieldClass} defaultValue="unknown">
                    <option value="unknown">Unknown / not inspected</option>
                    <option value="clear">Inspected, clear</option>
                    <option value="repairable">Repairable, scope established</option>
                    <option value="unsafe">Unsafe / unrepairable</option>
                    <option value="not_applicable">Not applicable, explain why</option>
                  </select>
                </label>
                <Input name={`${id}Finding`} label={`${label}: finding and basis`} required />
              </div>
            ))}
            <label className="type-body flex items-center gap-2">
              <input type="checkbox" name="repairScopeConfirmed" />
              Inspector confirmed the scope of the repair plan
            </label>
          </>
        )}
        {kind === 'registration' && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Input name="jurisdiction" label="Registration state (US)" required maxLength={2} />
              <label className="block space-y-2">
                <span className="type-label">Eligibility established by source</span>
                <select name="eligible" className={fieldClass} defaultValue="no">
                  <option value="no">No</option>
                  <option value="yes">Yes, under stated requirements</option>
                </select>
              </label>
              <Input name="expiresAt" label="Eligibility expires (if stated)" type="date" />
            </div>
            <Area name="requirements" label="Requirements and conditions, one per line" required />
          </>
        )}
        {kind === 'title' && (
          <>
            <Input name="titleBrand" label="Exact title brand on document" required />
            <Area
              name="resolution"
              label="If this differs from the listing, explain the supporting evidence"
            />
          </>
        )}
        {kind === 'repair_price' && (
          <>
            <label className="block space-y-2">
              <span className="type-label">Repair covered by quote</span>
              <select name="line" className={fieldClass} required defaultValue="">
                <option value="" disabled>
                  Select a repair line
                </option>
                {assessment.decision.report?.plan.lines.map((line) => (
                  <option key={line.id} value={line.id}>
                    {line.task}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-4 sm:grid-cols-3">
              <Input name="item" label="Quoted work and inclusions" required />
              <Input name="low" label="Quote low ($)" type="number" required />
              <Input name="high" label="Quote high ($)" type="number" required />
            </div>
            <Area name="note" label="Exclusions, tax, labor and parts scope" />
          </>
        )}
        {kind === 'comp' && (
          <>
            <p className="type-body text-dim">
              Use a comparable {assessment.lot.make} {assessment.lot.model}; state the actual
              variant and year. The decision engine screens applicability.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Input name="compMake" label="Actual comparable make" required />
              <Input name="compModel" label="Actual comparable model" required />
              <Input name="year" label="Comparable year" type="number" required />
              <Input name="variant" label="Trim / package (optional)" />
              <Input name="price" label="Observed price ($)" type="number" required />
              <Input name="transactionDate" label="Price / transaction date" type="date" required />
              <label className="block space-y-2">
                <span className="type-label">Sale status</span>
                <select name="outcome" className={fieldClass}>
                  <option value="ask">Active asking price</option>
                  <option value="sold">Completed sale</option>
                  <option value="bid_no_sale">Bid, no sale</option>
                </select>
              </label>
              <label className="block space-y-2">
                <span className="type-label">Market lane</span>
                <select name="lane" className={fieldClass}>
                  <option value="clean">Clean vehicle market</option>
                  <option value="rebuilt">Rebuilt vehicle market</option>
                  <option value="wreck">Damaged vehicle market</option>
                </select>
              </label>
              <label className="block space-y-2">
                <span className="type-label">Documented title</span>
                <select name="title" className={fieldClass}>
                  <option value="unknown">Unknown</option>
                  <option value="clean">Clean</option>
                  <option value="rebuilt">Rebuilt</option>
                  <option value="salvage">Salvage</option>
                </select>
              </label>
            </div>
            <Area name="note" label="Mileage, condition and comparability notes" />
          </>
        )}
        <button className={actionLinkClass} disabled={busy} type="submit">
          Record evidence for review
        </button>
      </form>
    </details>
  );
}

function Input({
  label,
  ...props
}: {
  name: string;
  label: string;
  required?: boolean;
  type?: string;
  maxLength?: number;
}) {
  return (
    <label className="block space-y-2">
      <span className="type-label">{label}</span>
      <input
        {...props}
        className={fieldClass}
        min={props.type === 'number' ? 0 : undefined}
        step={props.type === 'number' ? 'any' : undefined}
      />
    </label>
  );
}
function Area({ name, label, required }: { name: string; label: string; required?: boolean }) {
  return (
    <label className="block space-y-2">
      <span className="type-label">{label}</span>
      <textarea name={name} required={required} className={fieldClass} rows={3} />
    </label>
  );
}
