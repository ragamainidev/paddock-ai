/** Record why the coordinator stops; the model cannot supply a verdict or bid ceiling. */
import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { finishOwnedAssessment } from '../lib/domain';
export default defineTool({
  description:
    'Finish research only when the domain offers no useful work. Save the reason; this is not an owner cancellation. Never invent a verdict or bid ceiling.',
  inputSchema: z
    .object({
      expectedRevision: z.number().int().nonnegative(),
      reason: z.string().min(1).max(400),
    })
    .strict(),
  execute: finishOwnedAssessment,
});
