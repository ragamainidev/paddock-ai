/** Read the trusted session's persisted assessment and currently offered investigations. */
import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { readOwnedAssessment } from '../lib/domain';
export default defineTool({
  description:
    'Read the owned assessment, current revision, decision and offered investigations. Always read at the start of a turn.',
  inputSchema: z.object({}).strict(),
  execute: async (_input, ctx) => readOwnedAssessment(ctx),
});
