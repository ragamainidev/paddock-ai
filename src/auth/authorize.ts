/**
 * The authorization decision, pure and tested: given a path, the session
 * cookie, and the auth config, say allow / redirect / deny / misconfigured.
 * `src/proxy.ts` only translates the decision into a response. SPEC 40.
 */

import type { AuthConfig } from './config';
import { verifySession } from './session';

export type Decision =
  | { kind: 'allow'; user?: string }
  | { kind: 'redirect'; to: string }
  | { kind: 'deny' }
  | { kind: 'misconfigured'; reason: string };

// The login surface, static assets, and the co-hosted eve service. Everything
// else needs a session. `/eve/v1/` carries its own fail-closed auth walk
// (`bridgeAuth` in agent/lib/auth.ts), so this gate would only add a second,
// cookie-shaped rejection to a server-to-server call.
const PUBLIC_EXACT = new Set(['/login', '/favicon.ico', '/icon.svg', '/robots.txt']);
const PUBLIC_PREFIXES = ['/api/auth/', '/_next/', '/eve/v1/'];

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

// A post-login destination must be a same-origin path: leading slash, not
// protocol-relative, no backslashes, and never the login page itself.
export function safeNext(raw: string | undefined | null): string {
  if (!raw) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/';
  if (raw === '/login' || raw.startsWith('/login?')) return '/';
  return raw;
}

export async function authorize(input: {
  pathname: string;
  search: string;
  cookie?: string;
  config: AuthConfig;
  now?: number;
}): Promise<Decision> {
  const { pathname, search, cookie, config } = input;
  if (config.mode === 'off') return { kind: 'allow' };
  if (config.mode === 'misconfigured') {
    return { kind: 'misconfigured', reason: config.reason ?? 'auth is misconfigured' };
  }
  if (isPublicPath(pathname)) return { kind: 'allow' };

  const session = await verifySession(cookie, config.secret as string, input.now);
  if (session) return { kind: 'allow', user: session.user };

  if (pathname.startsWith('/api/')) return { kind: 'deny' };
  const next = encodeURIComponent(`${pathname}${search}`);
  return { kind: 'redirect', to: `/login?next=${next}` };
}
