/** Preserve the complete creation request across an ambiguous network failure. */
import type { CreateAssessmentInput } from '@/assessments/types';

export type CreationIntent = { signature: string; input: CreateAssessmentInput };
export function retainCreationIntent(
  previous: CreationIntent | null,
  input: CreateAssessmentInput,
): CreationIntent {
  const signature = JSON.stringify({
    ...input,
    lot: input.lot ? { ...input.lot, id: undefined, collectedOn: undefined } : undefined,
  });
  return previous?.signature === signature
    ? previous
    : { signature, input: { ...input, idempotencyKey: crypto.randomUUID() } };
}
