/** Execute only domain-offered work; domain revision, budget and idempotency guards apply. */
import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { investigateOwnedAssessment } from '../lib/domain';
export default defineTool({
  description:
    'Investigate one action returned by read_assessment. Use its exact actionId and current expectedRevision. Do not retry unavailable work.',
  inputSchema: z
    .object({
      actionId: z.string().min(1).max(160),
      expectedRevision: z.number().int().nonnegative(),
    })
    .strict(),
  execute: investigateOwnedAssessment,
});
