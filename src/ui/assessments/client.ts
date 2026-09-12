/** Typed HTTP responses from the app's assessment endpoints, and the shape every section of the detail view is handed. */
import type { Assessment } from '@/assessments/types';

/** The `/api/assessments/:id` response: the record plus what this deployment can do with it. */
export type AssessmentDetail = {
  assessment: Assessment;
  // When the deployment's schedule last asked what happened to this lot; absent
  // until a sale is over, or when the activity log could not be read (SPEC 62).
  outcomePromptedAt?: string;
  agent: {
    configured: boolean;
    liveEvidenceEnabled: boolean;
    modelMode?: 'fixture' | 'live-coordinator';
  };
  research?: { status: string; attempts: number; availableAt: string; lastError?: string } | null;
  watch?: {
    status: string;
    refreshes: number;
    nextAt: string;
    lastError?: string;
    policy: { actionKinds: string[]; intervalMs: number; until: string; maxRefreshes: number };
  } | null;
};

/** Resolves false when the write was refused; the caller keeps what the reader typed. */
export type SaveAction = (action: string, payload: Record<string, unknown>) => Promise<boolean>;

/** Every section of the detail view reads the same record and writes through the same seam. */
export type SectionProps = { data: AssessmentDetail; busy: boolean; save: SaveAction };

export async function assessmentRequest<T>(url: string, input?: unknown): Promise<T> {
  const response = await fetch(
    url,
    input === undefined
      ? { cache: 'no-store' }
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        },
  );
  // A proxy, a deployment gate or an auth redirect answers HTML. Parsing that
  // would put a parser's message where an interface sentence belongs.
  const json: unknown = (response.headers.get('content-type') ?? '').includes('json')
    ? await response.json().catch(() => null)
    : null;
  if (!response.ok) {
    const stated = (json as { error?: unknown } | null)?.error;
    throw new Error(typeof stated === 'string' ? stated : FAILED);
  }
  if (json === null) throw new Error(FAILED);
  return json as T;
}

const FAILED = 'The request failed. Try again.';

export const fieldClass =
  'type-spec w-full rounded-[2px] border border-border bg-surface px-3 py-2 text-text outline-offset-2 focus:border-accent-dim';
// DESIGN.md action button: one primary action per screen, 48px, accent text
// on a transparent fill. Every other action on the page is a text link.
export const buttonClass =
  'type-label min-h-12 rounded-[2px] border border-accent-dim px-4 py-2 text-accent transition-colors duration-[120ms] ease-out hover:border-accent hover:bg-accent-wash disabled:cursor-not-allowed disabled:border-border disabled:text-faint disabled:hover:bg-transparent';
export const actionLinkClass =
  'type-body min-h-10 text-accent underline underline-offset-4 transition-colors duration-[120ms] ease-out disabled:cursor-not-allowed disabled:text-faint disabled:no-underline';
