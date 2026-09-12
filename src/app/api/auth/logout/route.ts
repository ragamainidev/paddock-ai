import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/auth/session';

// POST /api/auth/logout — clear the session cookie and return to /login.
// The clearing cookie carries the attributes the login route set (SPEC 41):
// a browser matches a replacement on name, path and flags, so a mismatch is
// how a session survives being logged out.
export async function POST(request: NextRequest) {
  const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');
  const response = wantsJson
    ? NextResponse.json({ ok: true })
    : NextResponse.redirect(new URL('/login', request.url), 303);
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return response;
}
