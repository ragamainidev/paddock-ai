import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './credentials';
import { parseUsers } from './config';

describe('password hashing', () => {
  it('produces a self-describing scrypt hash that verifies', () => {
    const hash = hashPassword('correct horse');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(hash.split('$')).toHaveLength(6);
    expect(verifyPassword('correct horse', hash)).toBe(true);
    expect(verifyPassword('correct horsf', hash)).toBe(false);
    expect(verifyPassword('', hash)).toBe(false);
  });

  it('salts: two hashes of one password differ, both verify', () => {
    const a = hashPassword('pw');
    const b = hashPassword('pw');
    expect(a).not.toBe(b);
    expect(verifyPassword('pw', a) && verifyPassword('pw', b)).toBe(true);
  });

  it('never throws on malformed stored hashes', () => {
    for (const bad of ['', 'plain', 'scrypt$x', 'scrypt$16384$8$1$notb64$$', 'bcrypt$...']) {
      expect(verifyPassword('pw', bad)).toBe(false);
    }
  });
});

describe('parseUsers', () => {
  const h = 'scrypt$16384$8$1$c2FsdA$aGFzaA';
  it('parses "user:hash" pairs separated by commas or newlines', () => {
    expect(parseUsers(`alice:${h},bob:${h}\n carol:${h} `)).toEqual({
      users: [
        { user: 'alice', hash: h },
        { user: 'bob', hash: h },
        { user: 'carol', hash: h },
      ],
      errors: [],
    });
  });

  it('reports malformed entries without dropping valid ones', () => {
    const { users, errors } = parseUsers(`alice:${h},nohash,:${h},dave:plaintext`);
    expect(users.map((u) => u.user)).toEqual(['alice']);
    expect(errors).toHaveLength(3);
  });

  it('rejects duplicate usernames', () => {
    const { users, errors } = parseUsers(`alice:${h},alice:${h}`);
    expect(users).toHaveLength(1);
    expect(errors[0]).toContain('duplicate');
  });

  it('is empty for undefined or blank', () => {
    expect(parseUsers(undefined)).toEqual({ users: [], errors: [] });
    expect(parseUsers('  ')).toEqual({ users: [], errors: [] });
  });
});
