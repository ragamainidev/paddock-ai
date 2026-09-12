import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '@/auth/credentials';
import { SESSION_COOKIE, signSession } from '@/auth/session';
import { GET } from './route';

/**
 * Who is signed in, for the header control. It answers a name or null —
 * never the token itself, which is HttpOnly precisely so no script sees it.
 */

const SECRET = 'a'.repeat(48);
const USERS = `owner:${hashPassword('correct horse battery staple')}`;

const session = (cookie?: string) =>
  GET(
    new NextRequest('https://paddock.test/api/auth/session', {
      headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {},
    }),
  );

const validToken = () =>
  signSession({ user: 'owner', exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);

describe('GET /api/auth/session', () => {
  const saved = {
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_USERS: process.env.AUTH_USERS,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };

  beforeEach(() => {
    delete process.env.AUTH_SECRET;
    delete process.env.AUTH_USERS;
    delete process.env.VERCEL_ENV;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('names the signed-in user and never the token', async () => {
    process.env.AUTH_SECRET = SECRET;
    process.env.AUTH_USERS = USERS;
    const token = await validToken();
    const response = await session(token);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ mode: 'on', user: 'owner' });
    expect(body).not.toContain(token);
  });

  it('answers user: null rather than 401, so a public page stays static', async () => {
    process.env.AUTH_SECRET = SECRET;
    process.env.AUTH_USERS = USERS;
    for (const cookie of [undefined, '', 'garbage', 'v1.b3duZXI.9999999999.wrongsig']) {
      const response = await session(cookie);
      expect(response.status, String(cookie)).toBe(200);
      await expect(response.json()).resolves.toEqual({ mode: 'on', user: null });
    }
  });

  it('an expired session is nobody', async () => {
    process.env.AUTH_SECRET = SECRET;
    process.env.AUTH_USERS = USERS;
    const expired = await signSession(
      { user: 'owner', exp: Math.floor(Date.now() / 1000) - 1 },
      SECRET,
    );
    await expect((await session(expired)).json()).resolves.toEqual({ mode: 'on', user: null });
  });

  it('reports the mode when auth is off or broken', async () => {
    await expect((await session()).json()).resolves.toEqual({ mode: 'off', user: null });

    process.env.AUTH_USERS = USERS;
    await expect((await session()).json()).resolves.toEqual({
      mode: 'misconfigured',
      user: null,
    });
  });

  it('is never cached: the answer changes with the cookie', async () => {
    expect((await session()).headers.get('cache-control')).toBe('no-store');
  });
});
