/** The intake form's payloads and chip grammar, tested without a browser (SPEC 61). */
import { expect, it } from 'vitest';
import { DEFAULT_BUYER_PROFILE } from '@/assessments/buyer-profile';
import type { Assumption } from '@/assessments/intake';
import { COPART_COMPLETE } from '@/assessments/intake-fixtures/listings';
import {
  chipText,
  createGateNote,
  groupAssumptions,
  intakeCreatePayload,
  intakeFingerprint,
  intakePreviewPayload,
  photoLines,
  prefilledVin,
  unreadFields,
} from './intake-form';

function form(fields: [string, string][]): FormData {
  const values = new FormData();
  for (const [name, value] of fields) values.append(name, value);
  return values;
}

const buyerFields = Object.entries({
  jurisdiction: 'IL',
  access: DEFAULT_BUYER_PROFILE.access,
  exit: DEFAULT_BUYER_PROFILE.exit,
  discipline: String(DEFAULT_BUYER_PROFILE.discipline),
  laborRatePerHour: String(DEFAULT_BUYER_PROFILE.laborRatePerHour),
  availableDiyHours: String(DEFAULT_BUYER_PROFILE.availableDiyHours),
  holdingDays: String(DEFAULT_BUYER_PROFILE.holdingDays),
  holdingCostPerDay: String(DEFAULT_BUYER_PROFILE.holdingCostPerDay),
  maxAllIn: String(DEFAULT_BUYER_PROFILE.maxAllIn),
  minSurplus: String(DEFAULT_BUYER_PROFILE.minSurplus),
}) as [string, string][];

const intakeFields: [string, string][] = [
  ['listingText', COPART_COMPLETE],
  ['vin', ' zff95nla2m0263155 '],
  ['photos', 'https://cs.copart.com/a.jpg\n\nhttps://cs.copart.com/b.jpg\n'],
  ['listingUrl', 'https://example.test/lot/63198496'],
  ['researchAllowance', '2'],
  ...buyerFields,
];
const replacing = (fields: [string, string][], name: string, value: string) =>
  fields.filter(([field]) => field !== name).concat([[name, value]]);

it('builds the reading request from the block, the VIN and any correction made', () => {
  expect(intakePreviewPayload(form(intakeFields))).toEqual({
    ok: true,
    payload: { text: COPART_COMPLETE, vin: 'ZFF95NLA2M0263155' },
  });
  // A correction rides the re-read, so a hijacked identity line can be fixed
  // and the whole reading follows from the fix.
  expect(intakePreviewPayload(form(intakeFields), { make: 'Ferrari', model: '  ' })).toEqual({
    ok: true,
    payload: { text: COPART_COMPLETE, vin: 'ZFF95NLA2M0263155', edits: { make: 'Ferrari' } },
  });
});

it('builds the creation request with the photo links, the listing link and the corrections', () => {
  const result = intakeCreatePayload(form(intakeFields), {
    titleBrand: 'IL salvage',
    location: '',
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.payload.intake).toEqual({
    text: COPART_COMPLETE,
    vin: 'ZFF95NLA2M0263155',
    edits: { titleBrand: 'IL salvage' },
    photoUrls: ['https://cs.copart.com/a.jpg', 'https://cs.copart.com/b.jpg'],
    listingUrl: 'https://example.test/lot/63198496',
  });
  expect(result.payload.mode).toBe('live');
  expect(result.payload.budget).toEqual({ maxInvestigations: 6, maxCostCents: 200 });
  expect(result.payload.buyer.jurisdiction).toBe('US-IL');
});

it('refuses input the server would refuse, before the request is spent', () => {
  expect(intakePreviewPayload(form(replacing(intakeFields, 'listingText', '  ')))).toEqual({
    ok: false,
    error: 'Paste the listing text before parsing it.',
  });
  expect(intakeCreatePayload(form(replacing(intakeFields, 'photos', '')))).toEqual({
    ok: false,
    error: 'Paste at least one photo link, one per line.',
  });
  expect(
    intakeCreatePayload(
      form(replacing(intakeFields, 'photos', 'https://a.test/1.jpg\nhttp://a.test/2.jpg')),
    ),
  ).toEqual({ ok: false, error: 'Photo link 2 is not an https address.' });
  expect(
    intakeCreatePayload(form(replacing(intakeFields, 'listingUrl', 'http://example.test/lot'))),
  ).toEqual({ ok: false, error: 'The listing link is not an https address.' });
  expect(
    intakeCreatePayload(
      form(
        replacing(
          intakeFields,
          'photos',
          Array.from({ length: 13 }, (_, i) => `https://a.test/${i}.jpg`).join('\n'),
        ),
      ),
    ),
  ).toEqual({ ok: false, error: 'Paste at most 12 photo links.' });
});

it('reads a block of photo links however it was pasted', () => {
  expect(photoLines(' https://a.test/1.jpg \n\n https://a.test/2.jpg\t')).toEqual([
    'https://a.test/1.jpg',
    'https://a.test/2.jpg',
  ]);
  expect(photoLines('   ')).toEqual([]);
});

it('states a chip as source, field and meaning, grouped by who read it', () => {
  const assumptions: Assumption[] = [
    { source: 'llm', field: 'location', input: 'Branch: Fort Wayne', meaning: 'IN', reason: 'a' },
    { source: 'intake', field: 'make', input: '2021 FERRARI', meaning: 'FERRARI', reason: 'b' },
    { source: 'intake', field: 'year', input: '2021 FERRARI', meaning: '2021', reason: 'c' },
  ];
  expect(chipText(assumptions[0])).toBe('llm · location = IN');
  expect(groupAssumptions(assumptions)).toEqual([
    { source: 'intake', assumptions: [assumptions[1], assumptions[2]] },
    { source: 'llm', assumptions: [assumptions[0]] },
  ]);
});

it('lists every field the reading left absent, so a value nobody read can still be stated', () => {
  // A field no pass filled carries no chip, and a chip is the only thing the
  // reading offers to correct; without this list it could be corrected by
  // nobody, though `runIntake` accepts an edit for any field (SPEC 61).
  const assumptions: Assumption[] = [
    { source: 'intake', field: 'year', input: '2021 FERRARI', meaning: '2021', reason: 'a' },
    { source: 'intake', field: 'make', input: '2021 FERRARI', meaning: 'FERRARI', reason: 'b' },
    { source: 'user', field: 'model', input: 'SF90', meaning: 'SF90', reason: 'c' },
  ];
  const absent = unreadFields(assumptions);
  expect(absent).not.toContain('year');
  expect(absent).not.toContain('make');
  expect(absent).not.toContain('model');
  expect(absent).toContain('primaryDamage');
  expect(absent).toContain('titleBrand');
  expect(absent).toContain('location');
  expect(absent).toHaveLength(12);
  expect(unreadFields([])).toHaveLength(15);
});

it('carries a correction to a field no pass filled into the request it was typed for', () => {
  // The chip list omits an absent field; the payload does not, because the
  // domain applies an edit for any field it knows.
  expect(intakePreviewPayload(form(intakeFields), { primaryDamage: 'FRONT END' })).toEqual({
    ok: true,
    payload: {
      text: COPART_COMPLETE,
      vin: 'ZFF95NLA2M0263155',
      edits: { primaryDamage: 'FRONT END' },
    },
  });
  const created = intakeCreatePayload(form(intakeFields), { location: 'IL', engine: '  ' });
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  expect(created.payload.intake.edits).toEqual({ location: 'IL' });
});

it('fingerprints what a reading was read from, so a later edit makes it stale', () => {
  const read = intakeFingerprint(form(intakeFields));
  expect(intakeFingerprint(form(intakeFields))).toBe(read);
  // The research allowance and the buyer constraints are not what was read.
  expect(intakeFingerprint(form(replacing(intakeFields, 'researchAllowance', '9')))).toBe(read);
  // The three things the reading is of are.
  expect(intakeFingerprint(form(replacing(intakeFields, 'listingText', 'other')))).not.toBe(read);
  expect(intakeFingerprint(form(replacing(intakeFields, 'vin', '')))).not.toBe(read);
  expect(
    intakeFingerprint(form(replacing(intakeFields, 'photos', 'https://a.test/9.jpg'))),
  ).not.toBe(read);
});

it('opens creation only on a reading of the listing as it stands', () => {
  const read = intakeFingerprint(form(intakeFields));
  const reading = {};
  expect(createGateNote({ current: read })).toBe('read the listing first');
  // A stale reading is not a reading: the block, the VIN or the photo links
  // moved after it was read.
  expect(createGateNote({ reading, readFrom: 'earlier', current: read })).toBe(
    'read the listing again',
  );
  expect(
    createGateNote({
      reading: { blocked: 'VIN decodes to 2020 PORSCHE' },
      readFrom: read,
      current: read,
    }),
  ).toBe('correct the reading first');
  expect(createGateNote({ reading, readFrom: read, current: read })).toBe('');
});

it('seeds the VIN field from the query parameter the showroom action carries', () => {
  // `/assessments?vin=…` is the showroom's `assess a lot like this`; the field
  // takes what it carried, in the form the VIN reader expects.
  expect(prefilledVin(' zff95nla2m0263155 ')).toBe('ZFF95NLA2M0263155');
  // Nothing is prefilled unless the reader chose that action, and a parameter
  // that is not one readable VIN is not a choice.
  expect(prefilledVin(undefined)).toBeUndefined();
  expect(prefilledVin('  ')).toBeUndefined();
  expect(prefilledVin(['ZFF95NLA2M0263155', 'WP0AB2A88CS721234'])).toBeUndefined();
  expect(prefilledVin('Z'.repeat(21))).toBeUndefined();
});
