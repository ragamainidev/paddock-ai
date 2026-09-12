/**
 * One address for the assessments database. The store, the dispatch queue and
 * the activity reader are three separate connections to the same file or
 * server, so they resolve it here rather than each repeating a default: a
 * hosted deployment refuses a container-local file (docs/database.md §6.3) and
 * everything else falls back to the repo-local file.
 */
import { resolve } from 'node:path';
import { AssessmentError } from './types';

export const HOSTED_REFUSAL = 'Hosted assessments require a durable ASSESSMENTS_DATABASE_URL';

/**
 * The libSQL URL every assessments connection opens. Throws `unavailable`,
 * which the routes answer as 503, when a hosted deployment names no durable
 * database: a `file:` URL there is per-instance disk the agent never sees.
 */
export function resolveAssessmentsUrl(env: Record<string, string | undefined>): string {
  const configured = env.ASSESSMENTS_DATABASE_URL?.trim();
  if (env.VERCEL && (!configured || configured.startsWith('file:')))
    throw new AssessmentError('unavailable', HOSTED_REFUSAL);
  // An absolute path keeps three connections on one file whatever each
  // process's working directory is.
  return configured || `file:${resolve('data/assessments.db')}`;
}
