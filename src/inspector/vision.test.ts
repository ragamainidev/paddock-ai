import { describe, expect, test, vi } from 'vitest';
import { analyzePhotos, parseVisionOutput, photoContentBlocks } from './vision';
import type { PhotoSource } from './types';

const CONTEXT = { make: 'BMW', model: 'M3', year: 2004 };

const VALID_OUTPUT = {
  observations: [
    { photo: 0, note: 'Front three-quarter, straight panels' },
    { photo: 1, note: 'Rear wheel well shows bubbling paint' },
  ],
  overallCondition: 'fair',
  issues: [
    {
      type: 'rust',
      severity: 'medium',
      description: 'Bubbling at rear wheel arch lip',
      location: 'rear left wheel arch',
      photos: [1],
    },
  ],
  modifications: [],
  wear: [{ component: 'tires', level: 'moderate', description: 'Outer shoulder wear both fronts' }],
  confidence: 0.8,
};

describe('parseVisionOutput', () => {
  test('accepts valid structured output', () => {
    const analysis = parseVisionOutput(VALID_OUTPUT, 2);
    expect(analysis.issues).toHaveLength(1);
    expect(analysis.issues[0].photos).toEqual([1]);
    expect(analysis.observations).toHaveLength(2);
    expect(analysis.confidence).toBe(0.8);
  });

  test('drops photo anchors that do not exist, keeps the finding', () => {
    const raw = {
      ...VALID_OUTPUT,
      issues: [{ ...VALID_OUTPUT.issues[0], photos: [1, 7, -2] }],
      observations: [
        ...VALID_OUTPUT.observations,
        { photo: 99, note: 'hallucinated photo reference' },
      ],
    };
    const analysis = parseVisionOutput(raw, 2);
    expect(analysis.issues[0].photos).toEqual([1]);
    expect(analysis.observations).toHaveLength(2);
  });

  test('a finding that loses every anchor survives with none', () => {
    const raw = { ...VALID_OUTPUT, issues: [{ ...VALID_OUTPUT.issues[0], photos: [5, 6] }] };
    const analysis = parseVisionOutput(raw, 2);
    expect(analysis.issues[0].photos).toEqual([]);
    expect(analysis.issues[0].type).toBe('rust');
  });

  test('rejects malformed output loudly', () => {
    expect(() => parseVisionOutput({ overallCondition: 'shiny' }, 2)).toThrow(/validation/);
    expect(() => parseVisionOutput(null, 2)).toThrow(/validation/);
    expect(() => parseVisionOutput({ ...VALID_OUTPUT, confidence: 3 }, 2)).toThrow(/validation/);
  });

  test('a finding with a type outside the taxonomy is dropped, not fatal', () => {
    const raw = {
      ...VALID_OUTPUT,
      issues: [
        ...VALID_OUTPUT.issues,
        { type: 'bad_vibes', severity: 'high', description: 'x', photos: [0] },
      ],
      modifications: [
        {
          type: 'supercharger',
          description: 'Rotrex kit',
          quality: 'quality_aftermarket',
          photos: [0],
        },
      ],
    };
    const analysis = parseVisionOutput(raw, 2);
    expect(analysis.issues).toHaveLength(1); // the rust finding survives
    expect(analysis.issues[0].type).toBe('rust');
    expect(analysis.modifications).toEqual([]); // alien mod type dropped
  });
});

describe('photoContentBlocks', () => {
  test('builds url and base64 blocks with index labels', () => {
    const photos: PhotoSource[] = [
      { kind: 'url', url: 'https://i.ebayimg.com/images/g/abc/s-l1600.jpg' },
      { kind: 'upload', mediaType: 'image/jpeg', data: 'aGVsbG8=' },
    ];
    const blocks = photoContentBlocks(photos) as Array<Record<string, unknown>>;
    expect(blocks).toHaveLength(4); // label + image, twice
    expect(blocks[0]).toEqual({ type: 'text', text: 'Photo 0:' });
    expect(blocks[1]).toMatchObject({
      type: 'image',
      source: { type: 'url', url: photos[0].kind === 'url' ? photos[0].url : '' },
    });
    expect(blocks[3]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'aGVsbG8=' },
    });
  });
});

describe('analyzePhotos', () => {
  test('passes photos and context to the injected caller, never an SDK', async () => {
    const caller = vi.fn().mockResolvedValue(VALID_OUTPUT);
    const photos: PhotoSource[] = [
      { kind: 'url', url: 'https://example.com/a.jpg' },
      { kind: 'url', url: 'https://example.com/b.jpg' },
    ];
    const analysis = await analyzePhotos(photos, CONTEXT, caller);
    expect(caller).toHaveBeenCalledWith({ photos, context: CONTEXT });
    expect(analysis.overallCondition).toBe('fair');
  });

  test('refuses an empty photo set', async () => {
    const caller = vi.fn();
    await expect(analyzePhotos([], CONTEXT, caller)).rejects.toThrow(/no photos/);
    expect(caller).not.toHaveBeenCalled();
  });

  test('propagates caller failure for the orchestrator to surface', async () => {
    const caller = vi.fn().mockRejectedValue(new Error('rate limited'));
    await expect(
      analyzePhotos([{ kind: 'url', url: 'https://example.com/a.jpg' }], CONTEXT, caller),
    ).rejects.toThrow('rate limited');
  });
});
