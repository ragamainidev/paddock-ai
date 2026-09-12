'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import type { BuyerProfile } from '@/assessments/types';
import { BUYER_PRESETS, DEFAULT_BUYER_PROFILE } from '@/assessments/buyer-profile';
import {
  ACCESS_LABELS,
  BUYER_FIELD_LABELS,
  CAPABILITY_FIELDS,
  EXIT_LABELS,
  assumptionChips,
  divergedFromPreset,
  jurisdictionFrom,
  type BuyerFieldName,
} from './buyer-form';
import { fieldClass } from './client';

const presetLabels: Record<Exclude<BuyerProfile['preset'], 'custom'>, string> = {
  hobbyist: 'Hobbyist',
  shop: 'Independent shop',
  dealer: 'Dealer',
};
const presetNames = Object.keys(presetLabels) as (keyof typeof presetLabels)[];
const stateCode = (jurisdiction: string) =>
  jurisdiction === 'US-unspecified' ? '' : jurisdiction.replace('US-', '');

/**
 * Shared creation/edit form; server validation is authoritative. A preset fills
 * every field and each value still standing at that preset's says so as an
 * assumption chip; editing a field drops that field's chip alone (SPEC 2).
 */
export function BuyerFields({ buyer = DEFAULT_BUYER_PROFILE }: { buyer?: BuyerProfile }) {
  // The inputs stay uncontrolled and are re-seeded by remounting on `fill`, so
  // choosing a preset fills them without mirroring every keystroke in state.
  const [seed, setSeed] = useState(buyer);
  const [fill, setFill] = useState(0);
  const [edited, setEdited] = useState<ReadonlySet<BuyerFieldName>>(new Set());
  const diverged = divergedFromPreset(seed, edited);
  const chips = assumptionChips(seed, edited);

  function choose(preset: keyof typeof presetLabels) {
    // A jurisdiction the buyer typed is theirs, and no preset states one: the
    // registration gate would otherwise silently reopen on a preset click.
    const own = edited.has('jurisdiction');
    setSeed({
      ...BUYER_PRESETS[preset],
      ...(own ? { jurisdiction: seed.jurisdiction } : {}),
    });
    setEdited(own ? new Set<BuyerFieldName>(['jurisdiction']) : new Set());
    setFill((count) => count + 1);
  }
  function edit(event: FormEvent<HTMLFieldSetElement>) {
    const { name, value } = event.target as HTMLInputElement;
    if (!name || name === 'preset') return;
    const field = name as BuyerFieldName;
    // The typed state has to survive a later preset choice, so it is read here
    // rather than left in the DOM the remount replaces.
    if (field === 'jurisdiction')
      setSeed((current) => ({ ...current, jurisdiction: jurisdictionFrom(value) }));
    setEdited((previous) => (previous.has(field) ? previous : new Set(previous).add(field)));
  }

  return (
    <fieldset className="space-y-4" onChange={edit}>
      <legend className="type-h2 mb-2">Your rebuild constraints</legend>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {presetNames.map((preset) => (
          <label key={preset} className="type-body flex items-center gap-2">
            <input
              type="radio"
              name="preset"
              value={preset}
              checked={!diverged && seed.preset === preset}
              onChange={() => choose(preset)}
            />
            {presetLabels[preset]}
          </label>
        ))}
        {diverged && (
          <label className="type-body flex items-center gap-2">
            <input type="radio" name="preset" value="custom" checked onChange={() => undefined} />
            Custom
          </label>
        )}
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <span
              key={chip.field}
              className="rounded-[2px] border border-warn px-2 py-1 font-mono text-[11px] leading-[14px] text-text"
            >
              {chip.text}
            </span>
          ))}
        </div>
      )}
      <p className="type-body text-dim">
        A preset is a starting assumption about who is bidding, not a fact about you. Every value it
        filled is stated above until you change it. Lift access does not establish structural or
        high-voltage qualifications.
      </p>
      <div key={fill} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Choice name="access" value={seed.access} labels={ACCESS_LABELS} />
          <Choice name="exit" value={seed.exit} labels={EXIT_LABELS} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block space-y-2">
            <span className="type-label">{BUYER_FIELD_LABELS.jurisdiction}</span>
            <input
              className={fieldClass}
              name="jurisdiction"
              placeholder="NY"
              pattern="[A-Za-z]{2}"
              maxLength={2}
              defaultValue={stateCode(seed.jurisdiction)}
            />
          </label>
          <NumberField name="maxAllIn" value={seed.maxAllIn} />
          <NumberField name="minSurplus" value={seed.minSurplus} />
          <NumberField name="availableDiyHours" value={seed.availableDiyHours} />
          <NumberField name="laborRatePerHour" value={seed.laborRatePerHour} />
          <NumberField name="holdingDays" value={seed.holdingDays} />
          <NumberField name="holdingCostPerDay" value={seed.holdingCostPerDay} />
          <NumberField
            name="discipline"
            value={seed.discipline}
            min={0.5}
            max={0.9}
            step={0.01}
            help="0.75 = bid so all-in stays at 75% of the low exit"
          />
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {CAPABILITY_FIELDS.map((field) => (
            <label key={field} className="type-body flex items-center gap-2">
              <input type="checkbox" name={field} defaultChecked={seed.capabilities[field]} />
              {BUYER_FIELD_LABELS[field]}
            </label>
          ))}
        </div>
      </div>
    </fieldset>
  );
}

function Choice<T extends string>({
  name,
  value,
  labels,
}: {
  name: 'access' | 'exit';
  value: T;
  labels: Record<T, string>;
}): ReactNode {
  return (
    <label className="block space-y-2">
      <span className="type-label">{BUYER_FIELD_LABELS[name]}</span>
      <select className={fieldClass} name={name} defaultValue={value}>
        {(Object.keys(labels) as T[]).map((option) => (
          <option key={option} value={option}>
            {labels[option]}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberField({
  name,
  value,
  min = 0,
  max,
  step = 'any',
  help,
}: {
  name: BuyerFieldName;
  value: number;
  min?: number;
  max?: number;
  step?: number | 'any';
  help?: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="type-label">{BUYER_FIELD_LABELS[name]}</span>
      <input
        className={fieldClass}
        name={name}
        type="number"
        min={min}
        max={max}
        step={step}
        required
        defaultValue={value}
      />
      {/* An explanation is not metadata, so it stays sentence case (DESIGN.md). */}
      {help && <span className="type-spec block text-dim">{help}</span>}
    </label>
  );
}
