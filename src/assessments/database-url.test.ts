/** The one address three assessments connections open, and the refusal it owns. */
import { describe, expect, it } from 'vitest';
import { resolveAssessmentsUrl } from './database-url';

describe('resolveAssessmentsUrl', () => {
  it('refuses a hosted deployment without a durable database', () => {
    expect(() => resolveAssessmentsUrl({ VERCEL: '1' })).toThrow(
      'Hosted assessments require a durable ASSESSMENTS_DATABASE_URL',
    );
    expect(() =>
      resolveAssessmentsUrl({ VERCEL: '1', ASSESSMENTS_DATABASE_URL: 'file:data/assessments.db' }),
    ).toThrow('durable');
    expect(() => resolveAssessmentsUrl({ VERCEL: '1' })).toThrowError(
      expect.objectContaining({ code: 'unavailable' }),
    );
    expect(
      resolveAssessmentsUrl({ VERCEL: '1', ASSESSMENTS_DATABASE_URL: 'libsql://paddock.turso.io' }),
    ).toBe('libsql://paddock.turso.io');
  });

  it('defaults to one absolute local file off a deployment', () => {
    expect(resolveAssessmentsUrl({})).toBe(resolveAssessmentsUrl({ ASSESSMENTS_DATABASE_URL: '' }));
    expect(resolveAssessmentsUrl({})).toMatch(/^file:\/.*\/data\/assessments\.db$/);
    expect(resolveAssessmentsUrl({ ASSESSMENTS_DATABASE_URL: ' file:/tmp/a.db ' })).toBe(
      'file:/tmp/a.db',
    );
  });
});
