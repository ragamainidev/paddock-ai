/**
 * Auth configuration from the environment. Pure string parsing, no crypto,
 * so the proxy can import it. Three modes (SPEC 40):
 *   on            AUTH_SECRET (>= 32 chars) and AUTH_USERS (>= 1 valid line)
 *   off           neither set and not on Vercel (local dev)
 *   misconfigured anything else; on Vercel an unset auth is misconfigured,
 *                 never off, so a deployment can never be open by accident.
 */

export type UserRecord = { user: string; hash: string };

export type AuthMode = 'off' | 'on' | 'misconfigured';

export type AuthConfig = {
  mode: AuthMode;
  secret?: string;
  users: UserRecord[];
  sessionDays: number;
  reason?: string;
};

export const MIN_SECRET_LENGTH = 32;
const DEFAULT_SESSION_DAYS = 30;

const HASH_SHAPE = /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/;

// AUTH_USERS is `user:hash` entries separated by commas or newlines. Valid
// entries are kept even when others are malformed; the caller decides
// whether errors are fatal (they are, for mode resolution).
export function parseUsers(raw: string | undefined): { users: UserRecord[]; errors: string[] } {
  const users: UserRecord[] = [];
  const errors: string[] = [];
  if (!raw || raw.trim() === '') return { users, errors };
  const seen = new Set<string>();
  for (const entry of raw.split(/[,\n]/)) {
    const line = entry.trim();
    if (line === '') continue;
    const i = line.indexOf(':');
    if (i <= 0) {
      errors.push(`entry without "user:hash" shape`);
      continue;
    }
    const user = line.slice(0, i).trim();
    const hash = line.slice(i + 1).trim();
    if (!HASH_SHAPE.test(hash)) {
      errors.push(`user "${user}" has a hash that is not scrypt$N$r$p$salt$key`);
      continue;
    }
    if (seen.has(user)) {
      errors.push(`duplicate user "${user}"`);
      continue;
    }
    seen.add(user);
    users.push({ user, hash });
  }
  return { users, errors };
}

export function readAuthConfig(env: Record<string, string | undefined>): AuthConfig {
  const secret = env.AUTH_SECRET?.trim() || undefined;
  const rawUsers = env.AUTH_USERS;
  const onVercel = Boolean(env.VERCEL_ENV);
  const sessionDays = parseSessionDays(env.AUTH_SESSION_DAYS);

  if (!secret && !rawUsers?.trim()) {
    return onVercel
      ? {
          mode: 'misconfigured',
          users: [],
          sessionDays,
          reason: 'AUTH_USERS and AUTH_SECRET are not set',
        }
      : { mode: 'off', users: [], sessionDays };
  }

  const problems: string[] = [];
  if (!secret) problems.push('AUTH_SECRET is not set');
  else if (secret.length < MIN_SECRET_LENGTH) {
    problems.push(`AUTH_SECRET is shorter than ${MIN_SECRET_LENGTH} characters`);
  }
  const { users, errors } = parseUsers(rawUsers);
  if (!rawUsers?.trim()) problems.push('AUTH_USERS is not set');
  problems.push(...errors);
  if (rawUsers?.trim() && users.length === 0 && errors.length === 0) {
    problems.push('AUTH_USERS has no entries');
  }

  if (problems.length > 0) {
    return { mode: 'misconfigured', users, sessionDays, reason: problems.join('; ') };
  }
  return { mode: 'on', secret, users, sessionDays };
}

function parseSessionDays(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : DEFAULT_SESSION_DAYS;
}
