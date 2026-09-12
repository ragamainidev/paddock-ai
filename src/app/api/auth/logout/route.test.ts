import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '@/auth/credentials';
import { SESSION_COOKIE } from '@/auth/session';
import { POST as login } from '../login/route';
import { POST } from './route';

/**
 * Logging out is one thing: the session cookie is replaced with an empty,
 * already-expired one. A browser only treats that as a replacement when the
 * name, path and flags match the cookie login set, so the parity with the
 * login route is the test, not the individual attribute values (SPEC 41).
 */

const SECRET = 'a'.repeat(48);
const PASSWORD = 'correct horse battery staple';

type LimiterStore = typeof globalThis & { __paddockLoginLimits?: unknown };

const logout = (headers: Record<string, string> = {}) =>
  POST(
    new NextRequest('https://paddock.test/api/auth/logout', {
      method: 'POST',
      headers: { cookie: `${SESSION_COOKIE}=v1.b3duZXI.9999999999.sig`, ...headers },
    }),
  );

const signIn = () =>
  login(
    new NextRequest('https://paddock.test/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user: 'owner', password: PASSWORD }),
    }),
  );

type Cookie = { name: string; value: string; attrs: Map<string, string> };

function setCookie(response: Response): Cookie {
  const raw = response.headers.get('set-cookie') ?? '';
  const [pair, ...rest] = raw.split('; ');
  const eq = pair.indexOf('=');
  return {
    name: pair.slice(0, eq),
    value: pair.slice(eq + 1),
    attrs: new Map(
      rest.map((part) => {
        const i = part.indexOf('=');
        return i === -1
          ? ([part.toLowerCase(), ''] as const)
          : ([part.slice(0, i).toLowerCase(), part.slice(i + 1)] as const);
      }),
    ),
  };
}

// Lifetime is the one attribute that must differ: login dates the cookie
// forward, logout expires it. Everything else identifies the cookie.
const IDENTITY = (cookie: Cookie) =>
  [...cookie.attrs]
    .filter(([key]) => key !== 'max-age' && key !== 'expires')
    .map(([key, value]) => `${key}${value ? `=${value}` : ''}`)
    .sort();

describe('POST /api/auth/logout', () => {
  const saved = {
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_USERS: process.env.AUTH_USERS,
  };

  beforeEach(() => {
    process.env.AUTH_SECRET = SECRET;
    process.env.AUTH_USERS = `owner:${hashPassword(PASSWORD)}`;
    delete (globalThis as LimiterStore).__paddockLoginLimits;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete (globalThis as LimiterStore).__paddockLoginLimits;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('clears the session cookie with the attributes login set, in either environment', async () => {
    for (const environment of ['development', 'production'] as const) {
      vi.stubEnv('NODE_ENV', environment);
      delete (globalThis as LimiterStore).__paddockLoginLimits;

      const set = setCookie(await signIn());
      const cleared = setCookie(await logout());

      expect(cleared.name, environment).toBe(set.name);
      expect(IDENTITY(cleared), environment).toEqual(IDENTITY(set));
      // Secure tracks the environment on both, which is the flag that used
      // to differ between them.
      expect(cleared.attrs.has('secure'), environment).toBe(environment === 'production');
    }
  });

  it('the cookie it sets is empty and already expired', async () => {
    const cleared = setCookie(await logout());
    expect(cleared.value).toBe('');
    expect(cleared.attrs.get('max-age')).toBe('0');
    expect(cleared.attrs.get('path')).toBe('/');
    expect(cleared.attrs.has('httponly')).toBe(true);
    expect(cleared.attrs.get('samesite')?.toLowerCase()).toBe('lax');
  });

  it('sends a browser back to /login and answers an API caller in JSON', async () => {
    const redirect = await logout();
    expect(redirect.status).toBe(303);
    expect(new URL(redirect.headers.get('location') as string).pathname).toBe('/login');

    const json = await logout({ accept: 'application/json' });
    expect(json.status).toBe(200);
    await expect(json.json()).resolves.toEqual({ ok: true });
    expect(json.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
