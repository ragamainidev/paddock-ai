/**
 * Session tokens: `v1.<user-b64url>.<exp-unix-seconds>.<hmac-b64url>` where
 * the HMAC-SHA256 over `v1.<user>.<exp>` is keyed by AUTH_SECRET. WebCrypto
 * only, so the same code verifies in the proxy and in route handlers, and
 * verification is constant-time (`subtle.verify`). No server-side session
 * state: the cookie is the session; rotating AUTH_SECRET signs everyone out.
 * SPEC 41.
 */

export const SESSION_COOKIE = 'paddock_session';

export type Session = { user: string; exp: number };

const VERSION = 'v1';
const encoder = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  try {
    const bin = atob(padded);
    const out = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages,
  );
}

export async function signSession(session: Session, secret: string): Promise<string> {
  const user = b64url(encoder.encode(session.user));
  const payload = `${VERSION}.${user}.${session.exp}`;
  const key = await hmacKey(secret, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

// Returns the session when the token is well-formed, signed by `secret`, and
// not expired at `now` (ms); null otherwise. Never throws.
export async function verifySession(
  token: string | undefined,
  secret: string,
  now: number = Date.now(),
): Promise<Session | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const [, userB64, expStr, sigB64] = parts;
  if (!/^\d{1,12}$/.test(expStr)) return null;
  const sig = fromB64url(sigB64);
  const userBytes = fromB64url(userB64);
  if (!sig || !userBytes) return null;
  const payload = `${VERSION}.${userB64}.${expStr}`;
  try {
    const key = await hmacKey(secret, ['verify']);
    const ok = await crypto.subtle.verify('HMAC', key, sig, encoder.encode(payload));
    if (!ok) return null;
  } catch {
    return null;
  }
  const exp = Number(expStr);
  if (exp * 1000 <= now) return null;
  return { user: new TextDecoder().decode(userBytes), exp };
}
