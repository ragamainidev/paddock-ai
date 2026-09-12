/**
 * Request gate (SPEC 40). Thin by design: read the auth config, ask
 * `authorize` for a decision, translate it into a response. Every route
 * except the login surface and static assets is behind it. Misconfigured
 * auth fails closed with a plain 503 so a deployment can never be open by
 * accident. Runs in the Node runtime (Next 16 default for proxy).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { authorize } from '@/auth/authorize';
import { readAuthConfig } from '@/auth/config';
import { SESSION_COOKIE } from '@/auth/session';

export async function proxy(request: NextRequest) {
  const config = readAuthConfig(process.env);
  const decision = await authorize({
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    cookie: request.cookies.get(SESSION_COOKIE)?.value,
    config,
  });

  switch (decision.kind) {
    case 'allow':
      return NextResponse.next();
    case 'redirect':
      return NextResponse.redirect(new URL(decision.to, request.url));
    case 'deny':
      return NextResponse.json({ error: 'authentication required' }, { status: 401 });
    case 'misconfigured':
      console.warn(`auth misconfigured: ${decision.reason}`);
      return new NextResponse(
        `paddock: authentication is not configured on the server (${decision.reason}). See docs/auth.md.\n`,
        { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } },
      );
  }
}

export const config = {
  // Static assets and the co-hosted eve service are excluded here so a
  // redirect can never break CSS/JS or a server-to-server agent call; the
  // same list is mirrored in isPublicPath for the decision itself.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|eve/v1/).*)'],
};
