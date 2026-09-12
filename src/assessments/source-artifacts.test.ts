/** Captures preserve original provider content; hashes detect mutation, not truth. */
import { describe, expect, it } from 'vitest';
import { captureSourceArtifact, verifySourceArtifact } from './source-artifacts';

describe('source artifacts', () => {
  it('keeps original fields apart from a normalized extraction and takes an immutable snapshot', () => {
    const raw = {
      Results: [{ Make: 'FERRARI', Model: 'SF90', ModelYear: '2021', unparsed: 'retained' }],
    };
    const artifact = captureSourceArtifact('provider_response', raw);
    expect(artifact.content).toEqual(raw);
    raw.Results[0].ModelYear = '2024';
    expect(artifact.content).toMatchObject({ Results: [{ ModelYear: '2021' }] });
    expect(verifySourceArtifact(artifact)).toBe(true);
  });
  it('uses stable content hashes and detects later changes without claiming factual verification', () => {
    const a = captureSourceArtifact('listing_item', {
      title: 'Vehicle',
      price: { currency: 'USD', value: '30000' },
    });
    const b = captureSourceArtifact('listing_item', {
      price: { value: '30000', currency: 'USD' },
      title: 'Vehicle',
    });
    expect(a.sha256).toBe(b.sha256);
    expect(
      verifySourceArtifact({ ...a, content: { ...a.content, title: 'Another vehicle' } }),
    ).toBe(false);
  });
  it('rejects non-JSON and unbounded source bodies', () => {
    expect(() => captureSourceArtifact('provider_response', { invalid: Number.NaN })).toThrow();
    expect(() =>
      captureSourceArtifact('provider_response', { body: 'x'.repeat(524289) }),
    ).toThrow();
    expect(() => captureSourceArtifact('provider_response', ['not an object'])).toThrow();
  });
});
