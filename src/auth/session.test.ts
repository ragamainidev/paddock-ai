import { describe, expect, it } from 'vitest';
import { signSession, verifySession } from './session';

const SECRET = 'x'.repeat(48);
const NOW = Date.parse('2026-08-15T00:00:00Z');

describe('session tokens', () => {
  it('round-trips user and expiry', async () => {
    const token = await signSession({ user: 'alice', exp: 1_800_000_000 }, SECRET);
    expect(token.startsWith('v1.')).toBe(true);
    expect(await verifySession(token, SECRET, NOW)).toEqual({ user: 'alice', exp: 1_800_000_000 });
  });

  it('rejects a tampered signature, user, or expiry', async () => {
    const token = await signSession({ user: 'alice', exp: 1_800_000_000 }, SECRET);
    const [v, u, e, s] = token.split('.');
    expect(await verifySession(`${v}.${u}.${e}.${s.slice(0, -2)}AA`, SECRET, NOW)).toBeNull();
    const bob = Buffer.from('bob').toString('base64url');
    expect(await verifySession(`${v}.${bob}.${e}.${s}`, SECRET, NOW)).toBeNull();
    expect(await verifySession(`${v}.${u}.${Number(e) + 1}.${s}`, SECRET, NOW)).toBeNull();
  });

  it('rejects the wrong secret, expired tokens, and garbage', async () => {
    const token = await signSession({ user: 'alice', exp: 1_800_000_000 }, SECRET);
    expect(await verifySession(token, 'y'.repeat(48), NOW)).toBeNull();
    const expired = await signSession({ user: 'alice', exp: Math.floor(NOW / 1000) - 1 }, SECRET);
    expect(await verifySession(expired, SECRET, NOW)).toBeNull();
    expect(await verifySession(undefined, SECRET, NOW)).toBeNull();
    expect(await verifySession('', SECRET, NOW)).toBeNull();
    expect(await verifySession('v1.a.b', SECRET, NOW)).toBeNull();
    expect(await verifySession('v0.YWxpY2U.1800000000.sig', SECRET, NOW)).toBeNull();
  });

  it('keeps usernames with dots and unicode intact', async () => {
    const token = await signSession({ user: 'a.b@ex.ample ✓', exp: 1_800_000_000 }, SECRET);
    expect((await verifySession(token, SECRET, NOW))?.user).toBe('a.b@ex.ample ✓');
  });
});
