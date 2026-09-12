import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '@/auth/credentials';
import { SESSION_COOKIE, signSession } from '@/auth/session';
import { config, proxy } from './proxy';

/**
 * The gate itself (SPEC 40, 42): every authorize decision has exactly one
 * response shape, and the matcher decides which requests reach it at all.
 * `authorize` is tested separately; what is pinned here is the translation
 * and the exclusion list, because a wrong matcher makes the gate silent.
 */

const SECRET = 'a'.repeat(48);
const USERS = `owner:${hashPassword('correct horse battery staple')}`;

const request = (path: string, cookie?: string) =>
  new NextRequest(`https://paddock.test${path}`, {
    headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {},
  });

describe('proxy decisions', () => {
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
    vi.restoreAllMocks();
  });

  it('allow passes the request through untouched', async () => {
    // Auth off (nothing set, not on Vercel) is the local-dev mode.
    const response = await proxy(request('/search?q=e46'));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('location')).toBeNull();
  });

  it('a valid session on a guarded path also allows', async () => {
    process.env.AUTH_SECRET = SECRET;
    process.env.AUTH_USERS = USERS;
    const token = await signSession(
      { user: 'owner', exp: Math.floor(Date.now() / 1000) + 3600 },
      SECRET,
    );
    const response = await proxy(request('/assessments/abc', token));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('redirect sends a page request to /login with the destination preserved', async () => {
    process.env.AUTH_SECRET = SECRET;
    process.env.AUTH_USERS = USERS;
    const response = await proxy(request('/search?q=e46%20m3&v=0.1'));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location') as string);
    expect(location.pathname).toBe('/login');
    // The whole original path AND query survive as one encoded parameter,
    // the query's own escaping intact.
    expect(location.searchParams.get('next')).toBe('/search?q=e46%20m3&v=0.1');
  });

  it('deny answers an API request with 401 JSON, never a redirect', async () => {
    process.env.AUTH_SECRET = SECRET;
    process.env.AUTH_USERS = USERS;
    const response = await proxy(request('/api/runs'));
    expect(response.status).toBe(401);
    expect(response.headers.get('location')).toBeNull();
    await expect(response.json()).resolves.toEqual({ error: 'authentication required' });
  });

  it('a session signed with another secret is denied, not allowed', async () => {
    process.env.AUTH_SECRET = SECRET;
    process.env.AUTH_USERS = USERS;
    const token = await signSession(
      { user: 'owner', exp: Math.floor(Date.now() / 1000) + 3600 },
      'b'.repeat(48),
    );
    expect((await proxy(request('/api/runs', token))).status).toBe(401);
  });

  it('misconfigured fails closed with a plain-text 503 that names the reason', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Users without a secret: unusable auth, so nothing is served.
    process.env.AUTH_USERS = USERS;
    const response = await proxy(request('/search'));
    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    const body = await response.text();
    expect(body).toContain('AUTH_SECRET is not set');
    expect(body).toContain('docs/auth.md');
    expect(warn).toHaveBeenCalled();
  });

  it('misconfigured wins over the public paths, so nothing leaks while auth is broken', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.AUTH_SECRET = 'too-short';
    process.env.AUTH_USERS = USERS;
    expect((await proxy(request('/login'))).status).toBe(503);
  });
});

describe('proxy matcher', () => {
  // The matcher is a Next path pattern; the exclusions are what keep a
  // redirect from breaking assets or the co-hosted agent (docs/auth.md).
  const matches = (path: string) => new RegExp(`^${config.matcher[0]}$`).test(path);

  it('excludes static assets and the co-hosted eve service', () => {
    expect(matches('/_next/static/x')).toBe(false);
    expect(matches('/_next/image')).toBe(false);
    expect(matches('/_next/image?u=1')).toBe(false);
    expect(matches('/favicon.ico')).toBe(false);
    expect(matches('/icon.svg')).toBe(false);
    expect(matches('/eve/v1/health')).toBe(false);
  });

  it('matches every application path', () => {
    expect(matches('/')).toBe(true);
    expect(matches('/api/runs')).toBe(true);
    expect(matches('/search')).toBe(true);
    expect(matches('/assessments/abc')).toBe(true);
    // Only the exact `/eve/v1/` prefix is excluded; the pages are not.
    expect(matches('/eve')).toBe(true);
    expect(matches('/eve/v2/health')).toBe(true);
  });
});
