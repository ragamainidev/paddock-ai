'use client';

/**
 * The reading, as chips grouped by who read it (DESIGN.md, Assessment
 * workspace). Every chip states `source · field = meaning` with its reason
 * beside it and, while the lot is still being read, an input that corrects it,
 * because an inference the reader cannot argue with is not an assumption
 * (SPEC 2). A last group names the fields no pass filled, which carry no chip
 * and would otherwise be correctable by nobody. A saved lot's chips are its
 * recorded provenance: the same rows without the inputs and without that
 * group, because the reading is over (SPEC 61).
 */
import type { Assumption, IntakeField } from '@/assessments/intake';
import { CHIP_SOURCE_LABELS, chipText, groupAssumptions, unreadFields } from './intake-form';
import { fieldClass } from './client';

type Edits = Partial<Record<IntakeField, string>>;
type OnEdit = (field: IntakeField, value: string) => void;

export function IntakeChips({
  assumptions,
  edits,
  onEdit,
}: {
  assumptions: Assumption[];
  // Both absent on a saved lot: its chips are read, not argued with.
  edits?: Edits;
  onEdit?: OnEdit;
}) {
  const absent = onEdit ? unreadFields(assumptions) : [];
  return (
    <div className="space-y-4">
      {groupAssumptions(assumptions).map((group) => (
        <section key={group.source} className="space-y-2">
          <h4 className="type-label">{CHIP_SOURCE_LABELS[group.source]}</h4>
          <ul className="space-y-2">
            {group.assumptions.map((assumption) => (
              <FieldRow
                key={assumption.field}
                field={assumption.field}
                chip={chipText(assumption)}
                border="border-warn"
                action="correct it"
                placeholder={assumption.meaning}
                reason={assumption.reason}
                edits={edits}
                onEdit={onEdit}
              />
            ))}
          </ul>
        </section>
      ))}
      {absent.length > 0 && (
        <section className="space-y-2">
          <h4 className="type-label">not stated on your listing</h4>
          <ul className="space-y-2">
            {absent.map((field) => (
              <FieldRow
                key={field}
                field={field}
                chip={field}
                // Nothing was inferred here, so nothing is an assumption: the
                // row carries the plain outline rather than the chip's warn one.
                border="border-border"
                action="state it"
                edits={edits}
                onEdit={onEdit}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** One field's row: what is known about it, and the input that states it. */
function FieldRow({
  field,
  chip,
  border,
  action,
  placeholder,
  reason,
  edits,
  onEdit,
}: {
  field: IntakeField;
  chip: string;
  border: string;
  action: string;
  placeholder?: string;
  reason?: string;
  edits?: Edits;
  onEdit?: OnEdit;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span
        className={`rounded-[2px] border ${border} px-2 py-1 font-mono text-[11px] leading-[14px] text-text`}
      >
        {chip}
      </span>
      {onEdit && (
        <label className="flex items-center gap-2">
          <span className="type-meta">{action}</span>
          <input
            className={`${fieldClass} w-48`}
            value={edits?.[field] ?? ''}
            placeholder={placeholder}
            onChange={(event) => onEdit(field, event.target.value)}
          />
        </label>
      )}
      {reason && <span className="type-meta basis-full text-dim">{reason}</span>}
    </li>
  );
}
