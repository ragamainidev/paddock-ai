import { describe, expect, it } from 'vitest';
import { authorize, isPublicPath, safeNext } from './authorize';
import type { AuthConfig } from './config';
import { signSession } from './session';

const SECRET = 's'.repeat(32);
const NOW = Date.parse('2026-08-15T00:00:00Z');
const on: AuthConfig = { mode: 'on', secret: SECRET, users: [], sessionDays: 30 };
const off: AuthConfig = { mode: 'off', users: [], sessionDays: 30 };
const bad: AuthConfig = {
  mode: 'misconfigured',
  users: [],
  sessionDays: 30,
  reason: 'AUTH_USERS unset',
};

describe('authorize', () => {
  it('allows everything when auth is off', async () => {
    expect(await authorize({ pathname: '/inspect', search: '', config: off })).toEqual({
      kind: 'allow',
    });
  });

  it('fails closed with a reason when misconfigured, even for /login', async () => {
    expect(await authorize({ pathname: '/login', search: '', config: bad })).toEqual({
      kind: 'misconfigured',
      reason: 'AUTH_USERS unset',
    });
  });

  it('allows public paths without a cookie', async () => {
    for (const p of [
      '/login',
      '/api/auth/login',
      '/api/auth/session',
      '/favicon.ico',
      '/icon.svg',
      '/eve/v1/session',
      '/eve/v1/health',
    ]) {
      expect((await authorize({ pathname: p, search: '', config: on })).kind).toBe('allow');
    }
  });

  it('redirects pages to /login with a same-origin next, denies api routes', async () => {
    expect(await authorize({ pathname: '/inspect/abc', search: '?x=1', config: on })).toEqual({
      kind: 'redirect',
      to: '/login?next=%2Finspect%2Fabc%3Fx%3D1',
    });
    expect(await authorize({ pathname: '/api/runs', search: '', config: on })).toEqual({
      kind: 'deny',
    });
  });

  it('allows a valid session and names the user; rejects an expired one', async () => {
    const good = await signSession({ user: 'alice', exp: Math.floor(NOW / 1000) + 60 }, SECRET);
    expect(
      await authorize({ pathname: '/search', search: '', cookie: good, config: on, now: NOW }),
    ).toEqual({
      kind: 'allow',
      user: 'alice',
    });
    const stale = await signSession({ user: 'alice', exp: Math.floor(NOW / 1000) - 60 }, SECRET);
    expect(
      (await authorize({ pathname: '/search', search: '', cookie: stale, config: on, now: NOW }))
        .kind,
    ).toBe('redirect');
  });
});

describe('safeNext', () => {
  it('accepts same-origin paths only', () => {
    expect(safeNext('/inspect/1?x=1')).toBe('/inspect/1?x=1');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext('/\\evil')).toBe('/');
    expect(safeNext(undefined)).toBe('/');
    expect(safeNext('/login')).toBe('/');
  });
});

describe('isPublicPath', () => {
  it('matches the login surface, static assets and the eve service only', () => {
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/api/auth/logout')).toBe(true);
    expect(isPublicPath('/_next/static/x.js')).toBe(true);
    expect(isPublicPath('/eve/v1/session/wrun_1/cancel')).toBe(true);
    expect(isPublicPath('/api/inspect')).toBe(false);
    expect(isPublicPath('/loginx')).toBe(false);
    expect(isPublicPath('/eve')).toBe(false);
  });

  it('agrees with every exclusion in the proxy matcher (docs/auth.md §2)', async () => {
    const { config } = await import('@/proxy');
    const excluded = /\(\?!([^)]+)\)/.exec(config.matcher[0])?.[1].split('|');
    expect(excluded).toEqual(['_next/static', '_next/image', 'favicon.ico', 'icon.svg', 'eve/v1/']);
    for (const path of excluded!) expect(isPublicPath(`/${path}`)).toBe(true);
  });
});
