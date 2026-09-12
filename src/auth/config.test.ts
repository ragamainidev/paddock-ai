import { describe, expect, it } from 'vitest';
import { readAuthConfig } from './config';

const SECRET = 's'.repeat(32);
const USERS = 'alice:scrypt$16384$8$1$c2FsdA$aGFzaA';

describe('readAuthConfig', () => {
  it('is off locally when nothing is set', () => {
    expect(readAuthConfig({})).toMatchObject({ mode: 'off' });
  });

  it('is misconfigured on Vercel when nothing is set (fail closed)', () => {
    const c = readAuthConfig({ VERCEL_ENV: 'production' });
    expect(c.mode).toBe('misconfigured');
    expect(c.reason).toMatch(/AUTH_USERS/);
  });

  it('is on when both are set and valid', () => {
    const c = readAuthConfig({ AUTH_SECRET: SECRET, AUTH_USERS: USERS });
    expect(c.mode).toBe('on');
    expect(c.users.map((u) => u.user)).toEqual(['alice']);
    expect(c.sessionDays).toBe(30);
  });

  it('is misconfigured when only one is set, the secret is short, or no user parses', () => {
    expect(readAuthConfig({ AUTH_SECRET: SECRET }).mode).toBe('misconfigured');
    expect(readAuthConfig({ AUTH_USERS: USERS }).mode).toBe('misconfigured');
    expect(readAuthConfig({ AUTH_SECRET: 'short', AUTH_USERS: USERS }).mode).toBe('misconfigured');
    expect(readAuthConfig({ AUTH_SECRET: SECRET, AUTH_USERS: 'bad' }).mode).toBe('misconfigured');
  });

  it('reads AUTH_SESSION_DAYS within 1..365, else the default', () => {
    const base = { AUTH_SECRET: SECRET, AUTH_USERS: USERS };
    expect(readAuthConfig({ ...base, AUTH_SESSION_DAYS: '7' }).sessionDays).toBe(7);
    expect(readAuthConfig({ ...base, AUTH_SESSION_DAYS: '0' }).sessionDays).toBe(30);
    expect(readAuthConfig({ ...base, AUTH_SESSION_DAYS: 'x' }).sessionDays).toBe(30);
  });
});
