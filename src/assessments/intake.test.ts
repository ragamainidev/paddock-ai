/** Intake reads what the user pasted, never fetches it, and states every inference (SPEC 61). */
import { describe, expect, it, vi } from 'vitest';
import {
  MALFORMED_VIN,
  MISSING_IDENTITY,
  coerceField,
  NOT_STATED,
  USER_LOT_SOURCE,
  buildUserLot,
  completeIntake,
  decodeIntakeVin,
  parseListingText,
  runIntake,
  screenIntakePhotos,
  type Assumption,
  type IntakeCaller,
} from './intake';
import { createIntakeCaller } from './intake-caller';
import { COPART_COMPLETE, COPART_MINIMAL, IAA_SPARSE } from './intake-fixtures/listings';
import { SALVAGE_LOTS } from '@/salvage/seed-lots';
import { AssessmentError } from './types';

const AT = '2026-09-11T00:00:00.000Z';
const photos = ['https://cs.copart.com/a.jpg', 'https://cs.copart.com/b.jpg'];
const vpic = (row: Record<string, unknown>) => async () => ({ Results: [row] });
const meaningOf = (assumptions: Assumption[], field: string) =>
  assumptions.find((a) => a.field === field)?.meaning;
const sourceOf = (assumptions: Assumption[], field: string) =>
  assumptions.find((a) => a.field === field)?.source;

describe('the deterministic pass over a pasted listing', () => {
  it('reads every labeled field a complete Copart block states', () => {
    const { fields, assumptions } = parseListingText(COPART_COMPLETE);
    expect(fields).toEqual({
      vin: SALVAGE_LOTS[0].vin,
      year: 2021,
      make: 'FERRARI',
      model: 'SF90 STRADALE',
      lotNumber: '63198496',
      saleDate: '2026-09-22',
      odometer: 3004,
      odometerNote: 'listed as ACTUAL',
      primaryDamage: 'FRONT END',
      secondaryDamage: 'UNDERCARRIAGE',
      titleBrand: 'IL CERTIFICATE OF TITLE-SALVAGE',
      location: 'IL',
      currentBid: 128_000,
      estRetailValue: 412_500,
    });
    // Every value is a chip quoting the line it came from (SPEC 2).
    expect(assumptions).toHaveLength(14);
    expect(assumptions.every((a) => a.source === 'intake')).toBe(true);
    expect(assumptions.find((a) => a.field === 'odometer')!.input).toBe(
      'Odometer: 3,004 mi (ACTUAL)',
    );
  });

  it('leaves the fields an IAA block labels differently absent rather than guessed', () => {
    const { fields } = parseListingText(IAA_SPARSE);
    expect(fields.vin).toBe(SALVAGE_LOTS[1].vin);
    expect(fields.odometer).toBe(6412);
    expect(fields.odometerNote).toBe('listed as NOT ACTUAL');
    // A stock number is not a lot number, a branch is not a state, and a cash
    // value names neither a bid nor retail.
    expect(fields.lotNumber).toBeUndefined();
    expect(fields.location).toBeUndefined();
    expect(fields.estRetailValue).toBeUndefined();
    expect(fields.titleBrand).toBeUndefined();
    // "Secondary Damage: NONE" states that there is nothing to state.
    expect(fields.secondaryDamage).toBeUndefined();
  });

  it('reads a thin block and states no odometer when the listing says Unknown', () => {
    const { fields } = parseListingText(COPART_MINIMAL);
    expect(fields.vin).toBe(SALVAGE_LOTS[4].vin);
    expect(fields.lotNumber).toBe('62848556');
    expect(fields.saleDate).toBe('2026-08-13');
    expect(fields.currentBid).toBe(2800);
    expect(fields.odometer).toBeUndefined();
    expect(fields.odometerNote).toBeUndefined();
    expect(fields.estRetailValue).toBeUndefined();
  });

  it('reads a title label as a label, never as the brand', () => {
    // `Title Status:` and `Title History:` used to read their own label as the
    // title brand; the colon is now required after every label variant.
    expect(parseListingText('Title Status: IL SALVAGE').fields.titleBrand).toBe('IL SALVAGE');
    expect(parseListingText('Title Code: IL SALVAGE').fields.titleBrand).toBe('IL SALVAGE');
    expect(parseListingText('Title: CA SALVAGE CERTIFICATE').fields.titleBrand).toBe(
      'CA SALVAGE CERTIFICATE',
    );
    expect(
      parseListingText('Title brand unrecorded on this block').fields.titleBrand,
    ).toBeUndefined();
  });

  it('refuses a capture long enough to be a paste fragment rather than a value', () => {
    const paragraph = 'A'.repeat(400);
    // `model` is interpolated into research topics and comps queries, so an
    // over-long capture is refused rather than carried.
    expect(parseListingText(`2021 FERRARI ${paragraph}`).fields.model).toBeUndefined();
    expect(parseListingText(`Primary Damage: ${paragraph}`).fields.primaryDamage).toBeUndefined();
    expect(coerceField('model', paragraph)).toBeUndefined();
    expect(coerceField('model', 'SF90 Stradale Assetto Fiorano')).toBe(
      'SF90 Stradale Assetto Fiorano',
    );
  });

  it('accepts a VIN whose check digit verifies and refuses seventeen invalid characters', () => {
    const valid = parseListingText('VIN: ZFF95NLA2M0263155');
    expect(valid.fields.vin).toBe('ZFF95NLA2M0263155');
    expect(valid.assumptions[0].reason).toMatch(/check digit verifies/);
    // I, O and Q are never in a VIN, so this seventeen-character run is not one.
    expect(parseListingText('VIN: ZFFIOQLA2M0263155').fields.vin).toBeUndefined();
    // Shape without a verifying check digit is still a VIN outside North
    // America, and the chip says which of the two it is.
    const unverified = parseListingText('VIN: ZFF95NLA2M0263156');
    expect(unverified.fields.vin).toBe('ZFF95NLA2M0263156');
    expect(unverified.assumptions[0].reason).toMatch(/does not verify/);
  });
});

describe('the model completion', () => {
  const iaa = parseListingText(IAA_SPARSE).fields;

  it('fills only the fields the text left absent and quotes the line it read', async () => {
    const caller: IntakeCaller = async ({ missing }) => {
      expect(missing).toContain('location');
      expect(missing).not.toContain('vin');
      return {
        fields: [
          {
            field: 'location',
            value: 'IN',
            quote: 'Branch: Fort Wayne',
            reason: 'IAA Fort Wayne is the Indiana branch',
          },
          {
            field: 'estRetailValue',
            value: '$268,900',
            quote: 'Actual Cash Value: $268,900',
            reason: 'The stated cash value is the insurer’s valuation',
          },
        ],
      };
    };
    const completed = await completeIntake(iaa, IAA_SPARSE, caller);
    expect(completed.fields.location).toBe('IN');
    expect(completed.fields.estRetailValue).toBe(268_900);
    expect(completed.assumptions.map((a) => a.source)).toEqual(['llm', 'llm']);
    expect(completed.status).toEqual({ called: true, ok: true });
  });

  it('never overwrites a field the deterministic pass already read (SPEC 5)', async () => {
    const caller: IntakeCaller = async () => ({
      fields: [
        {
          field: 'primaryDamage',
          value: 'REAR END',
          quote: 'Primary Damage: FRONT END',
          reason: 'A contradicting reading',
        },
      ],
    });
    const completed = await completeIntake(iaa, IAA_SPARSE, caller);
    expect(completed.fields.primaryDamage).toBe('FRONT END');
    expect(completed.assumptions).toEqual([]);
  });

  it('discards a proposal whose quote is not in the pasted text', async () => {
    const caller: IntakeCaller = async () => ({
      fields: [
        {
          field: 'titleBrand',
          value: 'IN REBUILT',
          quote: 'Title: IN REBUILT',
          reason: 'Invented support',
        },
      ],
    });
    const completed = await completeIntake(iaa, IAA_SPARSE, caller);
    expect(completed.fields.titleBrand).toBeUndefined();
    expect(completed.assumptions).toEqual([]);
  });

  it('degrades with a visible note when the step is skipped or malformed', async () => {
    const skipped = await completeIntake(iaa, IAA_SPARSE, async () => ({ skipped: 'no key' }));
    expect(skipped.status).toEqual({
      called: false,
      ok: true,
      detail: 'model completion skipped: no key',
    });
    expect(skipped.assumptions).toEqual([]);
    const malformed = await completeIntake(iaa, IAA_SPARSE, async () => ({ fields: 'nope' }));
    expect(malformed.status.ok).toBe(false);
    const failed = await completeIntake(iaa, IAA_SPARSE, async () => {
      throw new Error('sdk exploded with a key in the message');
    });
    expect(failed.status.detail).toBe('the model completion step was unavailable');
  });

  it('reports skipped rather than building a client when no key is configured', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    await expect(
      createIntakeCaller()({ text: IAA_SPARSE, missing: ['location'] }),
    ).resolves.toEqual({ skipped: 'no key' });
    vi.unstubAllEnvs();
  });
});

describe('the federal decode', () => {
  it('fills identity nobody typed and states that vPIC filled it', async () => {
    const decoded = await decodeIntakeVin(
      { vin: SALVAGE_LOTS[0].vin },
      vpic({ Make: 'FERRARI', Model: 'SF90 Stradale', ModelYear: '2021', DisplacementL: '4.0' }),
    );
    expect(decoded.fields.make).toBe('Ferrari');
    expect(decoded.fields.year).toBe(2021);
    expect(decoded.assumptions.map((a) => a.source)).toEqual(['vpic', 'vpic', 'vpic', 'vpic']);
    expect(decoded.blocked).toBeUndefined();
  });

  it('blocks a lot whose stated identity the VIN contradicts', async () => {
    const decoded = await decodeIntakeVin(
      { vin: SALVAGE_LOTS[0].vin, year: 2019, make: 'Lamborghini' },
      vpic({ Make: 'FERRARI', ModelYear: '2021' }),
    );
    expect(decoded.blocked).toBe('VIN decodes to 2021 Ferrari; the listing says 2019 Lamborghini');
    expect(decoded.assumptions).toEqual([]);
  });

  it('agrees where the listing and vPIC spell one make differently', async () => {
    const decoded = await decodeIntakeVin(
      { vin: SALVAGE_LOTS[0].vin, year: 2021, make: 'FERRARI' },
      vpic({ Make: 'Ferrari', ModelYear: '2021', Model: 'SF90 Stradale' }),
    );
    expect(decoded.blocked).toBeUndefined();
    expect(decoded.fields.model).toBe('SF90 Stradale');
  });

  it('keeps the identity as typed and opens no second chip when vPIC is unreachable', async () => {
    const decoded = await decodeIntakeVin(
      { vin: SALVAGE_LOTS[0].vin, year: 2021, make: 'FERRARI' },
      async () => {
        throw new Error('fetch failed: ECONNREFUSED 127.0.0.1:443');
      },
    );
    expect(decoded.blocked).toBeUndefined();
    // A field carries one chip (DESIGN.md): the unavailability rides the VIN
    // reading's own chip rather than opening a second one.
    expect(decoded.assumptions).toEqual([]);
    expect(decoded.unavailable).toBe(true);
    const reading = await runIntake(
      { text: COPART_COMPLETE },
      {
        caller: null,
        vpicFetcher: async () => {
          throw new Error('fetch failed');
        },
      },
    );
    const vin = reading.assumptions.filter((a) => a.field === 'vin');
    expect(vin).toHaveLength(1);
    expect(vin[0].reason).toMatch(/vPIC unavailable$/);
    expect(reading.note).toBe('vPIC unavailable; the identity stands as stated');
  });
});

describe('the photo screen', () => {
  it('refuses the first link the probe will not dereference, by position', async () => {
    const probe = async (url: string) => url !== photos[1];
    expect(await screenIntakePhotos(photos, probe)).toEqual({
      blocked: 'photo link 2 is not a public https address',
    });
    expect(await screenIntakePhotos(photos, async () => true)).toEqual({});
  });

  it('treats a probe that throws as a refusal rather than a crash', async () => {
    const probe = async () => {
      throw new Error('dns exploded');
    };
    expect(await screenIntakePhotos([photos[0]], probe)).toEqual({
      blocked: 'photo link 1 is not a public https address',
    });
  });
});

describe('the lot a reading becomes', () => {
  it('names the user as its source, keeps the listing URL as provenance, and records which pass filled what', async () => {
    const reading = await runIntake({ text: COPART_COMPLETE }, { caller: null, vpicFetcher: null });
    const lot = buildUserLot(reading.fields, photos, AT, {
      assumptions: reading.assumptions,
      listingUrl: 'https://example.test/lot/63198496',
      id: 'lot-1',
    });
    expect(lot.source).toBe(USER_LOT_SOURCE);
    expect(lot.url).toBe('https://example.test/lot/63198496');
    expect(lot.collectedOn).toBe(AT);
    expect(lot.title).toBe('2021 FERRARI SF90 STRADALE');
    expect(lot.lotNumber).toBe('63198496');
    expect(lot.photos).toEqual(photos);
    expect(lot.notes).toContain('no auction or broker page was fetched');
    expect(lot.notes).toContain('read from the pasted listing: vin, year, make');
  });

  it('leaves the URL absent and states the fields nobody read', () => {
    const lot = buildUserLot({ year: 2021, make: 'Ferrari', model: 'SF90' }, photos, AT, {
      id: 'lot-2',
    });
    expect(lot.url).toBeUndefined();
    expect(lot.titleBrand).toBe(NOT_STATED);
    expect(lot.lotNumber).toBe(NOT_STATED);
    expect(lot.engine).toBe(NOT_STATED);
    expect(lot.location).toBe(NOT_STATED);
    expect(lot.damage).toEqual({ primary: NOT_STATED });
    expect(lot.odometer).toBeUndefined();
  });
});

describe('the whole intake pass', () => {
  it('orders the passes so what you typed wins, the text beats the model, and vPIC fills the rest', async () => {
    const caller: IntakeCaller = async ({ missing }) => {
      expect(missing).toContain('engine');
      return {
        fields: [
          {
            field: 'engine',
            value: '4.0L V8 twin-turbo hybrid',
            quote: 'Engine: 4.0L V8 Twin Turbo Hybrid',
            reason: 'The engine line states it',
          },
          {
            field: 'location',
            value: 'XX',
            quote: 'Location: IL - Chicago North',
            reason: 'A contradicting reading',
          },
        ],
      };
    };
    const reading = await runIntake(
      { text: COPART_COMPLETE, edits: { titleBrand: 'IL salvage' } },
      {
        caller,
        vpicFetcher: vpic({ Make: 'FERRARI', ModelYear: '2021', Trim: 'Assetto Fiorano' }),
      },
    );
    expect(reading.blocked).toBeUndefined();
    expect(meaningOf(reading.assumptions, 'titleBrand')).toBe('IL salvage');
    expect(sourceOf(reading.assumptions, 'titleBrand')).toBe('user');
    // One chip per field: the pass the user overrode no longer speaks for it.
    expect(reading.assumptions.filter((a) => a.field === 'titleBrand')).toHaveLength(1);
    expect(sourceOf(reading.assumptions, 'engine')).toBe('llm');
    expect(reading.fields.location).toBe('IL');
    expect(sourceOf(reading.assumptions, 'location')).toBe('intake');
  });

  it('applies a correction to a field no pass filled, as a chip of your own', async () => {
    // A field no rule matched is left absent rather than guessed, so it
    // carries no chip; the buyer can still state it, and what they state is
    // theirs (SPEC 2).
    const unread = await runIntake({ text: COPART_MINIMAL }, { caller: null, vpicFetcher: null });
    expect(unread.fields.secondaryDamage).toBeUndefined();
    expect(sourceOf(unread.assumptions, 'secondaryDamage')).toBeUndefined();

    const reading = await runIntake(
      { text: COPART_MINIMAL, edits: { secondaryDamage: 'REAR END' } },
      { caller: null, vpicFetcher: null },
    );
    expect(reading.blocked).toBeUndefined();
    expect(reading.fields.secondaryDamage).toBe('REAR END');
    expect(sourceOf(reading.assumptions, 'secondaryDamage')).toBe('user');
    expect(meaningOf(reading.assumptions, 'secondaryDamage')).toBe('REAR END');
    expect(reading.assumptions.filter((a) => a.field === 'secondaryDamage')).toHaveLength(1);
  });

  it('refuses a VIN a chip correction or the model made malformed', async () => {
    const edited = await runIntake(
      { text: COPART_COMPLETE, edits: { vin: 'ZFF95NLA2M02631' } },
      { caller: null, vpicFetcher: null },
    );
    expect(edited.blocked).toBe('The value you typed for vin is not usable');
    const proposed = await completeIntake({}, 'VIN on file', async () => ({
      fields: [
        { field: 'vin', value: 'NOT-A-REAL-VIN-17', quote: 'VIN on file', reason: 'guessed' },
      ],
    }));
    expect(proposed.fields.vin).toBeUndefined();
  });

  it('refuses a VIN you typed that is not seventeen valid characters', async () => {
    const reading = await runIntake(
      { text: COPART_COMPLETE, vin: 'ZFF95NLA2M02631' },
      { caller: null, vpicFetcher: null },
    );
    expect(reading.blocked).toBe(MALFORMED_VIN);
  });

  it('blocks a reading that never establishes a year, make and model', async () => {
    const reading = await runIntake(
      { text: 'Primary Damage: FRONT END\nLocation: IL - Chicago North' },
      { caller: null, vpicFetcher: null },
    );
    expect(reading.blocked).toBe(MISSING_IDENTITY);
  });

  it('carries the model completion note so a skipped step is visible', async () => {
    const reading = await runIntake(
      { text: COPART_MINIMAL },
      { caller: async () => ({ skipped: 'no key' }), vpicFetcher: null },
    );
    expect(reading.note).toBe('model completion skipped: no key');
  });
});

it('refuses to build a lot from a reading with no identity, as a typed refusal', () => {
  // A typed refusal, so the HTTP boundary answers 400 rather than 500.
  const build = () => buildUserLot({ year: 2021, make: 'Ferrari' }, photos, AT);
  expect(build).toThrow(AssessmentError);
  expect(build).toThrow(MISSING_IDENTITY);
  try {
    build();
  } catch (error) {
    expect((error as AssessmentError).code).toBe('invalid_input');
  }
});
