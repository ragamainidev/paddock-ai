import { NextRequest, NextResponse } from 'next/server';
import { safeNext } from '@/auth/authorize';
import { readAuthConfig } from '@/auth/config';
import { verifyPassword } from '@/auth/credentials';
import { createRateLimiter, type RateLimiter } from '@/auth/rate-limit';
import { SESSION_COOKIE, signSession } from '@/auth/session';

/**
 * POST /api/auth/login — form (user, password, next) or JSON. On success:
 * set the session cookie and 303 to `next` (form) or 200 JSON. On failure:
 * one generic message, a fixed delay, and a per-ip + per-user rate limit
 * (SPEC 42). Passwords and hashes never reach a log line.
 */

const FAIL_DELAY_MS = 300;
const LIMIT = { max: 10, windowMs: 15 * 60 * 1000 };

type Limiters = { ip: RateLimiter; user: RateLimiter };
const store = globalThis as typeof globalThis & { __paddockLoginLimits?: Limiters };
function limiters(): Limiters {
  store.__paddockLoginLimits ??= { ip: createRateLimiter(LIMIT), user: createRateLimiter(LIMIT) };
  return store.__paddockLoginLimits;
}

// The limiter key has to be an address the caller cannot choose. Vercel
// overwrites `x-vercel-forwarded-for` at the edge, so it is that address;
// `x-forwarded-for` is not, because Next only fills it from the socket when
// the request did not already carry one. This Next version exposes no
// connection address to a route handler, so off-Vercel every attempt shares
// one bucket rather than trusting a header (docs/auth.md §5).
export function clientIp(request: NextRequest): string {
  const platform = request.headers.get('x-vercel-forwarded-for');
  if (!platform) return 'unknown';
  return platform.split(',')[0].trim().slice(0, 64) || 'unknown';
}

// Usernames are user input; keep log lines single-line and short.
function logSafe(user: string): string {
  return user.replace(/[^\x20-\x7e]/g, '?').slice(0, 64) || '?';
}

async function readBody(request: NextRequest): Promise<{
  user: string;
  password: string;
  next: string;
  wantsJson: boolean;
}> {
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      user: String(body.user ?? ''),
      password: String(body.password ?? ''),
      next: String(body.next ?? ''),
      wantsJson: true,
    };
  }
  const form = await request.formData().catch(() => new FormData());
  return {
    user: String(form.get('user') ?? ''),
    password: String(form.get('password') ?? ''),
    next: String(form.get('next') ?? ''),
    wantsJson: false,
  };
}

function failure(wantsJson: boolean, next: string, request: NextRequest, retryAfterMs = 0) {
  const status = retryAfterMs > 0 ? 429 : 401;
  if (wantsJson) {
    return NextResponse.json(
      { error: retryAfterMs > 0 ? 'too many attempts' : 'invalid username or password' },
      {
        status,
        headers: retryAfterMs > 0 ? { 'retry-after': String(Math.ceil(retryAfterMs / 1000)) } : {},
      },
    );
  }
  const url = new URL('/login', request.url);
  url.searchParams.set('error', retryAfterMs > 0 ? 'rate' : 'bad');
  if (next) url.searchParams.set('next', next);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
  const config = readAuthConfig(process.env);
  if (config.mode !== 'on') {
    return NextResponse.json(
      {
        error: config.mode === 'off' ? 'authentication is off' : 'authentication is not configured',
      },
      { status: config.mode === 'off' ? 404 : 503 },
    );
  }

  const { user, password, next: rawNext, wantsJson } = await readBody(request);
  const next = safeNext(rawNext);
  const ip = clientIp(request);
  const trimmed = user.trim().slice(0, 64);

  const byIp = limiters().ip.hit(ip);
  const byUser = trimmed ? limiters().user.hit(trimmed) : { allowed: true, retryAfterMs: 0 };
  if (!byIp.allowed || !byUser.allowed) {
    console.warn(`auth login failed user=${logSafe(trimmed)} ip=${ip} reason=rate-limited`);
    return failure(wantsJson, rawNext, request, Math.max(byIp.retryAfterMs, byUser.retryAfterMs));
  }

  const record = config.users.find((u) => u.user === trimmed);
  const ok = record !== undefined && password.length > 0 && verifyPassword(password, record.hash);
  if (!ok) {
    await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
    console.warn(`auth login failed user=${logSafe(trimmed)} ip=${ip} reason=bad-credentials`);
    return failure(wantsJson, rawNext, request);
  }

  limiters().ip.reset(ip);
  limiters().user.reset(trimmed);
  const maxAge = config.sessionDays * 86_400;
  const exp = Math.floor(Date.now() / 1000) + maxAge;
  const token = await signSession({ user: trimmed, exp }, config.secret as string);
  console.log(`auth login ok user=${logSafe(trimmed)}`);

  const response = wantsJson
    ? NextResponse.json({ ok: true, user: trimmed, next })
    : NextResponse.redirect(new URL(next, request.url), 303);
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  });
  return response;
}
