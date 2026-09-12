/**
 * The default intake completion caller: the one place intake imports an SDK.
 *
 * It owns the prompt, the tool schema and the budget of the single call
 * intake is allowed — one forced tool, thirty seconds, no SDK retries. The
 * merge rules and the zod validation of what comes back belong to
 * `intake.ts`, which never learns that a model exists beyond the injected
 * `IntakeCaller`; this module never decides what a proposal means.
 *
 * Absent `ANTHROPIC_API_KEY` it reports `skipped` rather than failing, so
 * intake degrades to the deterministic reading with a visible note and no SDK
 * string can reach the workspace (SPEC 6, 17, 61).
 */
import { INTAKE_FIELDS, type IntakeCaller } from './intake';

const TOOL_NAME = 'report_listing_fields';
// Haiku, not Sonnet: this reads labeled fields out of a block the
// deterministic pass already mined, and every value it returns is a chip the
// user corrects before anything is saved.
const INTAKE_MODEL = 'claude-haiku-4-5-20251001';
const INTAKE_TIMEOUT_MS = 30_000;
const INTAKE_MAX_TOKENS = 1024;

const SYSTEM_PROMPT = `You read one salvage-auction listing block a user pasted, for the fields a deterministic parser could not match.

Rules:
- Only report fields in the requested list. A field the parser already read is not requested.
- Every field you report must carry a verbatim quote from the block that supports it. If no text supports a field, omit it.
- Never invent a value. An absent field is a correct answer.
- year, odometer, currentBid and estRetailValue are numbers. location is a two-letter US state code. saleDate is YYYY-MM-DD.
- Give a one-line reason for each field; the user sees it beside the value and corrects it.`;

const REPORT_FIELDS_TOOL = {
  name: TOOL_NAME,
  description: 'Report the listing fields the deterministic parser could not read.',
  input_schema: {
    type: 'object' as const,
    properties: {
      fields: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string', enum: [...INTAKE_FIELDS] },
            value: { type: ['string', 'number'] },
            quote: { type: 'string', description: 'verbatim text from the block supporting it' },
            reason: { type: 'string', description: 'one line, shown to the user' },
          },
          required: ['field', 'value', 'quote', 'reason'],
        },
      },
    },
    required: ['fields'],
  },
};

/**
 * The default completion caller. It reports `skipped` rather than failing
 * when no key is configured, so intake degrades to the deterministic reading
 * with a visible note and never leaks an SDK error into the workspace.
 */
export function createIntakeCaller(): IntakeCaller {
  return async ({ text, missing }) => {
    if (!process.env.ANTHROPIC_API_KEY) return { skipped: 'no key' };
    // Lazy import keeps the SDK out of every bundle that only runs offline.
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ timeout: INTAKE_TIMEOUT_MS, maxRetries: 0 });
    const response = await client.messages.create({
      model: INTAKE_MODEL,
      max_tokens: INTAKE_MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [REPORT_FIELDS_TOOL],
      tool_choice: { type: 'tool', name: TOOL_NAME, disable_parallel_tool_use: true },
      messages: [
        {
          role: 'user',
          content: [
            `Fields still missing: ${JSON.stringify(missing)}`,
            `Listing block:\n${text}`,
          ].join('\n\n'),
        },
      ],
    });
    const toolUse = response.content.find((block) => block.type === 'tool_use');
    if (!toolUse) throw new Error('model returned no tool_use block');
    return toolUse.input;
  };
}
