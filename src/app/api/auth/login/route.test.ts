import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '@/auth/credentials';
import { SESSION_COOKIE, verifySession } from '@/auth/session';
import { clientIp, POST } from './route';

/**
 * The login limiter is only a limiter if its key is an address the caller
 * cannot choose (SPEC 42). These run the real route with auth configured;
 * the rest pin what a session cookie is allowed to look like (SPEC 41) and
 * what the route says when auth is off or broken (SPEC 40).
 */

const SECRET = 'a'.repeat(48);
const PASSWORD = 'correct horse battery staple';

type LimiterStore = typeof globalThis & { __paddockLoginLimits?: unknown };

function attempt(headers: Record<string, string>, body: Record<string, string>): Promise<Response> {
  const request = new NextRequest('https://paddock.test/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return POST(request);
}

function login(headers: Record<string, string>, user: string): Promise<Response> {
  return attempt(headers, { user, password: 'wrong' });
}

// Cookie attributes are the security surface; parse them rather than
// asserting on one long string.
function setCookie(response: Response): { value: string; attrs: Map<string, string> } {
  const raw = response.headers.get('set-cookie') ?? '';
  const [pair, ...rest] = raw.split('; ');
  const attrs = new Map(
    rest.map((part) => {
      const i = part.indexOf('=');
      return i === -1
        ? ([part.toLowerCase(), ''] as const)
        : ([part.slice(0, i).toLowerCase(), part.slice(i + 1)] as const);
    }),
  );
  return { value: pair.slice(pair.indexOf('=') + 1), attrs };
}

describe('clientIp', () => {
  const ipOf = (headers: Record<string, string>) =>
    clientIp(new NextRequest('https://paddock.test/api/auth/login', { headers }));

  it('reads the platform header and ignores the caller-supplied one', () => {
    expect(ipOf({ 'x-vercel-forwarded-for': '203.0.113.7' })).toBe('203.0.113.7');
    expect(
      ipOf({ 'x-vercel-forwarded-for': '203.0.113.7', 'x-forwarded-for': '198.51.100.1' }),
    ).toBe('203.0.113.7');
    expect(ipOf({ 'x-forwarded-for': '198.51.100.1' })).toBe('unknown');
    expect(ipOf({ 'x-real-ip': '198.51.100.1' })).toBe('unknown');
    expect(ipOf({})).toBe('unknown');
  });

  it('takes the client end of a chain and bounds the key length', () => {
    expect(ipOf({ 'x-vercel-forwarded-for': '203.0.113.7, 10.0.0.1' })).toBe('203.0.113.7');
    expect(ipOf({ 'x-vercel-forwarded-for': 'x'.repeat(200) })).toHaveLength(64);
  });
});

type SavedEnv = { AUTH_SECRET?: string; AUTH_USERS?: string; AUTH_SESSION_DAYS?: string };

const snapshotEnv = (): SavedEnv => ({
  AUTH_SECRET: process.env.AUTH_SECRET,
  AUTH_USERS: process.env.AUTH_USERS,
  AUTH_SESSION_DAYS: process.env.AUTH_SESSION_DAYS,
});

// Assigning an undefined value would leave the literal string "undefined"
// behind, which reads as a (far too short) secret.
function restoreEnv(saved: SavedEnv): void {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('login rate limiting', () => {
  const env = snapshotEnv();

  beforeEach(() => {
    process.env.AUTH_SECRET = SECRET;
    process.env.AUTH_USERS = `owner:${hashPassword(PASSWORD)}`;
    delete (globalThis as LimiterStore).__paddockLoginLimits;
    // The route audits every attempt; the assertions are the record here.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    restoreEnv(env);
    delete (globalThis as LimiterStore).__paddockLoginLimits;
    vi.restoreAllMocks();
  });

  it('a spoofed x-forwarded-for does not reset the counter', { timeout: 30_000 }, async () => {
    // A distinct username per attempt, so only the ip limiter can trip, and
    // a distinct forged address per attempt, which used to buy a fresh key.
    let last: Response | undefined;
    for (let i = 0; i <= 10; i++) {
      last = await login({ 'x-forwarded-for': `198.51.100.${i}` }, `nobody-${i}`);
    }
    expect(last?.status).toBe(429);
    expect(last?.headers.get('retry-after')).toBeTruthy();
    await expect(last?.json()).resolves.toEqual({ error: 'too many attempts' });
  });

  it('a wrong password is a generic 401 until the limit', async () => {
    const response = await login({ 'x-vercel-forwarded-for': '203.0.113.7' }, 'owner');
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'invalid username or password' });
  });
});

describe('login outcomes', () => {
  const env = snapshotEnv();
  const HASH = hashPassword(PASSWORD);

  beforeEach(() => {
    process.env.AUTH_SECRET = SECRET;
    process.env.AUTH_USERS = `owner:${HASH}`;
    delete process.env.AUTH_SESSION_DAYS;
    delete (globalThis as LimiterStore).__paddockLoginLimits;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    restoreEnv(env);
    delete (globalThis as LimiterStore).__paddockLoginLimits;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('sets a signed HttpOnly, SameSite=Lax session cookie scoped to the site', async () => {
    process.env.AUTH_SESSION_DAYS = '7';
    const response = await attempt({}, { user: 'owner', password: PASSWORD });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, user: 'owner', next: '/' });

    const { value, attrs } = setCookie(response);
    expect(response.headers.get('set-cookie')).toContain(`${SESSION_COOKIE}=`);
    expect(attrs.has('httponly')).toBe(true);
    expect(attrs.get('samesite')?.toLowerCase()).toBe('lax');
    expect(attrs.get('path')).toBe('/');
    expect(attrs.get('max-age')).toBe(String(7 * 86_400));
    // The cookie is a session for this user, not the password coming back.
    await expect(verifySession(decodeURIComponent(value), SECRET)).resolves.toMatchObject({
      user: 'owner',
    });
    expect(response.headers.get('set-cookie')).not.toContain(PASSWORD);
  });

  it('marks the cookie Secure only where the site is served over https', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(
      setCookie(await attempt({}, { user: 'owner', password: PASSWORD })).attrs.has('secure'),
    ).toBe(false);

    delete (globalThis as LimiterStore).__paddockLoginLimits;
    vi.stubEnv('NODE_ENV', 'production');
    expect(
      setCookie(await attempt({}, { user: 'owner', password: PASSWORD })).attrs.has('secure'),
    ).toBe(true);
  });

  it('a form post lands on the requested page; a bad one returns to /login', async () => {
    const form = (body: Record<string, string>) =>
      POST(
        new NextRequest('https://paddock.test/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(body).toString(),
        }),
      );

    const ok = await form({ user: 'owner', password: PASSWORD, next: '/assessments' });
    expect(ok.status).toBe(303);
    expect(new URL(ok.headers.get('location') as string).pathname).toBe('/assessments');

    const bad = await form({ user: 'owner', password: 'nope', next: '/assessments' });
    expect(bad.status).toBe(303);
    const back = new URL(bad.headers.get('location') as string);
    expect(back.pathname).toBe('/login');
    expect(back.searchParams.get('error')).toBe('bad');
    expect(back.searchParams.get('next')).toBe('/assessments');
  });

  it('an off-site destination is refused, not followed', async () => {
    const response = await attempt(
      {},
      {
        user: 'owner',
        password: PASSWORD,
        next: 'https://evil.test/steal',
      },
    );
    await expect(response.json()).resolves.toMatchObject({ next: '/' });
  });

  it('tells an unknown user and a wrong password apart from nothing at all', async () => {
    const unknown = await attempt({}, { user: 'nobody', password: PASSWORD });
    const wrong = await attempt({}, { user: 'owner', password: 'nope' });
    const empty = await attempt({}, { user: 'owner', password: '' });
    for (const response of [unknown, wrong, empty]) {
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'invalid username or password' });
      expect(response.headers.get('set-cookie')).toBeNull();
    }
  });

  it(
    'the per-user limiter trips even when every attempt comes from a new address',
    {
      timeout: 30_000,
    },
    async () => {
      // Each attempt claims a different address, so only the user's own
      // window can be what runs out. The allowance is spent concurrently:
      // the route's fixed failure delay is paid once, not ten times.
      const spent = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          login({ 'x-vercel-forwarded-for': `203.0.113.${i}` }, 'owner'),
        ),
      );
      expect(spent.map((r) => r.status)).toEqual(Array(10).fill(401));

      const last = await login({ 'x-vercel-forwarded-for': '203.0.113.99' }, 'owner');
      expect(last.status).toBe(429);
      expect(Number(last.headers.get('retry-after'))).toBeGreaterThan(0);
      await expect(last.json()).resolves.toEqual({ error: 'too many attempts' });
    },
  );

  it(
    'a success clears both counters, so a typo streak is not a lockout',
    {
      timeout: 30_000,
    },
    async () => {
      const ip = { 'x-vercel-forwarded-for': '203.0.113.42' };
      // The window counts attempts, not failures: nine typos plus the
      // success below is the whole allowance for this address and user.
      const typos = await Promise.all(Array.from({ length: 9 }, () => login(ip, 'owner')));
      expect(typos.map((r) => r.status)).toEqual(Array(9).fill(401));

      expect((await attempt(ip, { user: 'owner', password: PASSWORD })).status).toBe(200);
      // Without the reset these would be the eleventh and twelfth attempts.
      expect((await login(ip, 'owner')).status).toBe(401);
      expect((await login(ip, 'owner')).status).toBe(401);
    },
  );
});

describe('login when auth is not on', () => {
  const env = snapshotEnv();
  const savedVercel = process.env.VERCEL_ENV;

  beforeEach(() => {
    delete process.env.AUTH_SECRET;
    delete process.env.AUTH_USERS;
    delete process.env.VERCEL_ENV;
    delete (globalThis as LimiterStore).__paddockLoginLimits;
  });

  afterEach(() => {
    restoreEnv(env);
    if (savedVercel === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = savedVercel;
    delete (globalThis as LimiterStore).__paddockLoginLimits;
  });

  it('auth off has no login to offer: 404', async () => {
    const response = await attempt({}, { user: 'owner', password: PASSWORD });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'authentication is off' });
  });

  it('half-configured auth fails closed with 503 rather than letting anyone in', async () => {
    process.env.AUTH_USERS = `owner:${hashPassword(PASSWORD)}`;
    const response = await attempt({}, { user: 'owner', password: PASSWORD });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'authentication is not configured',
    });
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
