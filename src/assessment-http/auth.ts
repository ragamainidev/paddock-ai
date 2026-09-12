/** HTTP authority for saved assessments. Identity comes from the session (SPEC 49). */
import { AssessmentError } from '@/assessments/types';
import { readAuthConfig } from '@/auth/config';
import { SESSION_COOKIE, verifySession } from '@/auth/session';

export class AssessmentHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function assessmentOwner(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): Promise<string> {
  const config = readAuthConfig(env);
  if (config.mode === 'off') return 'local';
  if (config.mode !== 'on' || !config.secret) {
    throw new AssessmentHttpError(503, 'Authentication is not configured.');
  }
  const cookie = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  const session = await verifySession(cookie, config.secret);
  if (!session || !config.users.some((entry) => entry.user === session.user)) {
    throw new AssessmentHttpError(401, 'Sign in to open assessments.');
  }
  return session.user;
}

export function requireSameOrigin(request: Request): void {
  const reject = () =>
    new AssessmentHttpError(403, 'Assessment changes require a same-origin request.');
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw reject();
  const origin = request.headers.get('origin');
  if (origin === null) return;
  try {
    const requestUrl = new URL(request.url);
    const host = request.headers.get('host');
    if (host !== null && (!host || /[\s/\\@?#,%]/.test(host))) throw reject();
    // Next may reconstruct request.url using its bind hostname. The browser's
    // actual transport authority remains in Host. Forwarded headers are not
    // an authority here: accepting them would require a trusted proxy policy.
    const destination = host === null ? requestUrl : new URL(`${requestUrl.protocol}//${host}`);
    if (
      !['http:', 'https:'].includes(destination.protocol) ||
      destination.username ||
      destination.password ||
      (host !== null && (destination.pathname !== '/' || destination.search || destination.hash))
    )
      throw reject();
    const supplied = new URL(origin);
    // An Origin is a serialized origin, not a URL with a path or credentials.
    if (origin !== supplied.origin || supplied.origin !== destination.origin) throw reject();
  } catch {
    throw reject();
  }
}

export function assessmentErrorResponse(error: unknown): Response {
  if (error instanceof AssessmentHttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  // Domain errors expose a constrained status/code, never an upstream body.
  // The class, not a `code` field: a driver error carries one too
  // (`LibsqlError`, pg's `DatabaseError`), and duck-typing would return its
  // message — a connection string or a SQLSTATE — to the client.
  if (error instanceof AssessmentError) {
    const code = error.code;
    const status = /not_found/i.test(code)
      ? 404
      : /forbidden|unauthorized/i.test(code)
        ? 403
        : /conflict|revision|busy/i.test(code)
          ? 409
          : /budget|invalid|input|action|not_offered/i.test(code)
            ? 400
            : 503;
    return Response.json({ error: error.message, code }, { status });
  }
  // Nothing else may reach the client: the reader gets a fixed reason, so
  // the error object survives nowhere but the log (docs/logging.md §2.2).
  console.error('assessments: request failed:', error);
  return Response.json(
    { error: 'The assessment service is unavailable. Try again shortly.' },
    { status: 503 },
  );
}
