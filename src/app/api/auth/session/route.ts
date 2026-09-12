import { NextRequest, NextResponse } from 'next/server';
import { readAuthConfig } from '@/auth/config';
import { SESSION_COOKIE, verifySession } from '@/auth/session';

// GET /api/auth/session — who is signed in, for the header control. Public
// path; answers {user: null} rather than 401 so static pages stay static.
export async function GET(request: NextRequest) {
  const config = readAuthConfig(process.env);
  if (config.mode !== 'on') {
    return NextResponse.json(
      { mode: config.mode, user: null },
      { headers: { 'cache-control': 'no-store' } },
    );
  }
  const session = await verifySession(
    request.cookies.get(SESSION_COOKIE)?.value,
    config.secret as string,
  );
  return NextResponse.json(
    { mode: 'on', user: session?.user ?? null },
    { headers: { 'cache-control': 'no-store' } },
  );
}
