import { describe, expect, it, vi } from 'vitest';
import { AssessmentError } from '@/assessments/types';
import { signSession, SESSION_COOKIE } from '@/auth/session';
import { assessmentErrorResponse, assessmentOwner, requireSameOrigin } from './auth';

const secret = 'assessment-test-secret-that-is-long-enough';
const env = {
  AUTH_SECRET: secret,
  AUTH_USERS: 'owner:scrypt$16384$8$1$c2FsdA$aGFzaA',
};

describe('assessment HTTP authority', () => {
  it('resolves the signed owner and ignores identity supplied in headers', async () => {
    const token = await signSession(
      { user: 'owner', exp: Math.floor(Date.now() / 1000) + 60 },
      secret,
    );
    const request = new Request('http://localhost/api/assessments', {
      headers: { cookie: `${SESSION_COOKIE}=${token}`, 'x-owner-id': 'someone-else' },
    });
    expect(await assessmentOwner(request, env)).toBe('owner');
  });

  it('rejects a missing session and a signed user removed from configuration', async () => {
    await expect(assessmentOwner(new Request('http://localhost/'), env)).rejects.toMatchObject({
      status: 401,
    });
    const token = await signSession(
      { user: 'removed', exp: Math.floor(Date.now() / 1000) + 60 },
      secret,
    );
    await expect(
      assessmentOwner(
        new Request('http://localhost/', {
          headers: { cookie: `${SESSION_COOKIE}=${token}` },
        }),
        env,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('allows unconfigured local development but refuses unconfigured hosting', async () => {
    const request = new Request('http://localhost/');
    expect(await assessmentOwner(request, {})).toBe('local');
    await expect(assessmentOwner(request, { VERCEL_ENV: 'production' })).rejects.toMatchObject({
      status: 503,
    });
  });

  it('uses the transport Host when Next reconstructs a local request URL with another hostname', () => {
    expect(() =>
      requireSameOrigin(
        new Request('http://localhost:3317/api/assessments', {
          method: 'POST',
          headers: {
            host: '127.0.0.1:3317',
            origin: 'http://127.0.0.1:3317',
            'sec-fetch-site': 'same-origin',
          },
        }),
      ),
    ).not.toThrow();
  });

  it('ignores forwarded authority and rejects a different origin from the transport Host', () => {
    for (const origin of ['http://localhost:3317', 'https://unrelated.example']) {
      expect(() =>
        requireSameOrigin(
          new Request('http://localhost:3317/api/assessments', {
            method: 'POST',
            headers: {
              host: '127.0.0.1:3317',
              origin,
              'x-forwarded-host': new URL(origin).host,
              'x-forwarded-proto': new URL(origin).protocol.slice(0, -1),
            },
          }),
        ),
      ).toThrow('same-origin');
    }
  });

  it('retains cross-site rejection and rejects malformed authorities or non-origin values', () => {
    const cases: Record<string, string>[] = [
      { host: '127.0.0.1:3317', origin: 'http://127.0.0.1:3317', 'sec-fetch-site': 'cross-site' },
      { host: '127.0.0.1:3317', origin: 'http://127.0.0.1:3317/path' },
      { host: 'user@127.0.0.1:3317', origin: 'http://127.0.0.1:3317' },
      { host: '127.0.0.1:3317/path', origin: 'http://127.0.0.1:3317' },
      { host: '127.0.0.1:3317/', origin: 'http://127.0.0.1:3317' },
      { host: '127.0.0.1:3317', origin: 'null' },
    ];
    for (const headers of cases) {
      expect(() =>
        requireSameOrigin(
          new Request('http://localhost:3317/api/assessments', { method: 'POST', headers }),
        ),
      ).toThrow('same-origin');
    }
  });

  it('rejects cross-origin writes before any assessment operation', () => {
    expect(() =>
      requireSameOrigin(
        new Request('http://localhost/api/assessments', {
          method: 'POST',
          headers: { origin: 'https://unrelated.example' },
        }),
      ),
    ).toThrow('same-origin');
    expect(() =>
      requireSameOrigin(
        new Request('http://localhost/api/assessments', {
          method: 'POST',
          headers: { origin: 'http://localhost' },
        }),
      ),
    ).not.toThrow();
  });
});

describe('assessmentErrorResponse', () => {
  it('maps a domain error to its own status and code', async () => {
    const response = assessmentErrorResponse(
      new AssessmentError('not_found', 'Assessment not found'),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Assessment not found', code: 'not_found' });
  });

  it('never returns a driver error message, however closely it resembles one', async () => {
    // `LibsqlError` and pg's `DatabaseError` both carry a `code`, so
    // duck-typing on that field returned a connection string or a SQLSTATE
    // to the client. Only the domain class is answered by its message.
    const drivers = [
      Object.assign(new Error('SQLITE_UNKNOWN: libsql://paddock.turso.io refused the token'), {
        name: 'LibsqlError',
        code: 'SERVER_ERROR',
      }),
      Object.assign(new Error('password authentication failed for user "paddock"'), {
        name: 'DatabaseError',
        code: '28P01',
        severity: 'FATAL',
      }),
    ];
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      for (const error of drivers) {
        const response = assessmentErrorResponse(error);
        expect(response.status).toBe(503);
        const body = await response.json();
        expect(body).toEqual({
          error: 'The assessment service is unavailable. Try again shortly.',
        });
        expect(JSON.stringify(body)).not.toContain(error.message);
        // The reader gets a fixed reason, so the log is the only survivor.
        expect(logged).toHaveBeenCalledWith('assessments: request failed:', error);
      }
    } finally {
      logged.mockRestore();
    }
  });
});
