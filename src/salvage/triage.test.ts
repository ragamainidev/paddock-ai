import { describe, expect, test } from 'vitest';
import { failureReason, userFacingReason } from '@/lib/failure';
import { parseTriageOutput } from './triage';

// The triage parser is the money model's first boundary: everything after
// it — programs, lines, the ceiling — is derived from what it lets through.
// So it is tested the way the other parsers are (docs/llm-patterns.md §2.4):
// malformed, adversarial, and empty output, with no model in the loop.

const RAW = {
  observations: [{ photo: 0, note: 'front clip crushed back to the strut towers' }],
  overall: 'borderline',
  areas: [
    {
      area: 'front structure',
      kind: 'structural',
      severity: 'heavy',
      description: 'both rails deformed',
      photos: [0],
    },
  ],
  airbagsDeployed: 'yes',
  floodEvidence: false,
  fireEvidence: false,
  drivetrainRisk: 'engine sits behind the firewall, no visible contact',
  confidence: 0.6,
};

describe('parseTriageOutput — a triage is typed or it is nothing', () => {
  test('a well-formed report survives with its areas and observations', () => {
    const triage = parseTriageOutput(RAW, 4);
    expect(triage.overall).toBe('borderline');
    expect(triage.areas).toHaveLength(1);
    expect(triage.areas[0]).toMatchObject({ area: 'front structure', severity: 'heavy' });
    expect(triage.observations).toHaveLength(1);
    expect(triage.airbagsDeployed).toBe('yes');
  });

  test('malformed output states its own failure for the stage to degrade on', () => {
    for (const raw of ['nonsense', null, {}, { ...RAW, overall: 'probably fine' }]) {
      expect(() => parseTriageOutput(raw, 4)).toThrow(/failed validation/);
    }
  });

  test('the failure keeps its own wording instead of a fixed reason', () => {
    try {
      parseTriageOutput({ ...RAW, confidence: 7 }, 4);
      expect.unreachable('the parser accepted an out-of-range confidence');
    } catch (error) {
      expect(failureReason(error)).toMatch(/triage output failed validation/);
      expect(failureReason(error)).not.toBe(userFacingReason('unknown'));
    }
  });

  test('a car with nothing wrong parses to an empty, honest triage', () => {
    const triage = parseTriageOutput(
      { ...RAW, observations: [], areas: [], airbagsDeployed: 'no' },
      4,
    );
    expect(triage.areas).toEqual([]);
    expect(triage.observations).toEqual([]);
  });

  test('duplicate zones the rubric forbids collapse to one at the worst severity', () => {
    const triage = parseTriageOutput(
      {
        ...RAW,
        areas: [
          { ...RAW.areas[0], severity: 'moderate', photos: [0] },
          { ...RAW.areas[0], area: 'Front Structure ', severity: 'heavy', photos: [1, 0] },
        ],
      },
      4,
    );
    // One damage event, one area: a doubled zone doubles the repair money.
    expect(triage.areas).toHaveLength(1);
    expect(triage.areas[0].severity).toBe('heavy');
    expect(triage.areas[0].photos).toEqual([0, 1]);
  });

  test('a zone of a different kind is a different zone, not a duplicate', () => {
    const triage = parseTriageOutput(
      {
        ...RAW,
        areas: [RAW.areas[0], { ...RAW.areas[0], kind: 'cosmetic' }],
      },
      4,
    );
    expect(triage.areas).toHaveLength(2);
  });

  test('photo anchors outside the strip are dropped, never clamped to a real photo', () => {
    const triage = parseTriageOutput(
      {
        ...RAW,
        observations: [
          { photo: 0, note: 'real' },
          { photo: 9, note: 'a photo that was never sent' },
          { photo: -1, note: 'negative' },
        ],
        areas: [{ ...RAW.areas[0], photos: [0, 9, -2] }],
      },
      2,
    );
    expect(triage.areas[0].photos).toEqual([0]);
    expect(triage.observations.map((o) => o.note)).toEqual(['real']);
  });
});
