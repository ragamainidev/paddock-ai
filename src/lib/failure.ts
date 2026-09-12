/**
 * One vocabulary for "this stage failed" as the user reads it. A thrown
 * error's own message is written for an engineer and by a library: SDK
 * errors carry request ids and endpoints, driver errors carry connection
 * strings and SQLSTATE, and `fetch` carries whatever the host said. None of
 * that belongs on a run's event stream, in a persisted `runs.error`, or in a
 * stage note — it says nothing the reader can act on and leaks the shape of
 * the deployment.
 *
 * So the stream carries a fixed reason per kind and the server log carries
 * the error object (`docs/logging.md §2.2`). Degradation stays visible
 * (SPEC 10, 11, 24); only its wording stops varying with the library.
 */

export type FailureKind = 'model' | 'database' | 'upstream' | 'timeout' | 'unknown';

// -- Stated failures -----------------------------------------------------------

// Not every throw is a library's. Model output that fails our own schema,
// a lot with no photos: those messages are written for the reader and name
// something a generic reason would erase (SPEC 24, 25). They carry a marker
// so the reason keeps their wording.
const STATED = Symbol.for('paddock.stated-failure');

export function statedFailure(message: string): Error {
  return Object.assign(new Error(message), { [STATED]: true });
}

function isStatedFailure(err: unknown): err is Error {
  return (
    typeof err === 'object' && err !== null && (err as Record<symbol, unknown>)[STATED] === true
  );
}

const REASONS: Record<FailureKind, string> = {
  model: 'the model call failed',
  database: 'the database was unreachable',
  upstream: 'an upstream service did not answer',
  timeout: 'the step ran out of time',
  unknown: 'the step failed',
};

export function userFacingReason(kind: FailureKind): string {
  return REASONS[kind];
}

// -- Classification ------------------------------------------------------------

// The SDK and driver classes are imported lazily at their call sites, so
// this classifies by shape rather than by `instanceof`.
function fields(err: unknown): Record<string, unknown> | null {
  return typeof err === 'object' && err !== null ? (err as Record<string, unknown>) : null;
}

function name(err: unknown): string {
  const f = fields(err);
  const own = typeof f?.name === 'string' ? f.name : '';
  return own || (f?.constructor as { name?: string } | undefined)?.name || '';
}

function message(err: unknown): string {
  const f = fields(err);
  return typeof f?.message === 'string' ? f.message.toLowerCase() : '';
}

// `@anthropic-ai/sdk` throws one of these subclasses of `AnthropicError`.
const MODEL_ERRORS = new Set([
  'AnthropicError',
  'APIError',
  'APIConnectionError',
  'APIConnectionTimeoutError',
  'APIUserAbortError',
  'AuthenticationError',
  'BadRequestError',
  'ConflictError',
  'InternalServerError',
  'NotFoundError',
  'PermissionDeniedError',
  'RateLimitError',
  'UnprocessableEntityError',
]);

const DATABASE_ERRORS = new Set(['LibsqlError', 'DatabaseError', 'PostgresError']);

// PostgreSQL answers errors with a five-character SQLSTATE; `pg` attaches it
// as `code` alongside the server's `severity`/`routine` fields.
function isPostgresError(f: Record<string, unknown>): boolean {
  return (
    typeof f.code === 'string' &&
    /^[0-9A-Z]{5}$/.test(f.code) &&
    ('severity' in f || 'routine' in f)
  );
}

function isTimeout(err: unknown): boolean {
  const n = name(err);
  if (n === 'AbortError' || n === 'TimeoutError') return true;
  const m = message(err);
  return m.includes('timed out') || m.includes('timeout') || m.includes('aborted');
}

// `fetch` rejects with a TypeError whose cause carries the socket-level
// code; our own fetchers throw plain errors naming the endpoint.
const UPSTREAM_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_SOCKET',
]);

function isUpstream(err: unknown): boolean {
  const f = fields(err);
  if (!f) return false;
  if (message(err).includes('fetch failed')) return true;
  const codes = [f.code, fields(f.cause)?.code];
  return codes.some((c) => typeof c === 'string' && UPSTREAM_CODES.has(c));
}

export function classifyError(err: unknown): FailureKind {
  const f = fields(err);
  if (!f) return 'unknown';
  const n = name(err);
  if (MODEL_ERRORS.has(n) || message(err).includes('anthropic')) return 'model';
  if (DATABASE_ERRORS.has(n) || isPostgresError(f)) return 'database';
  if (isTimeout(err)) return 'timeout';
  if (isUpstream(err)) return 'upstream';
  return 'unknown';
}

// The one call both halves of a failure make: the user reads this, the log
// gets the error itself.
export function failureReason(err: unknown): string {
  if (isStatedFailure(err)) return err.message;
  return userFacingReason(classifyError(err));
}
