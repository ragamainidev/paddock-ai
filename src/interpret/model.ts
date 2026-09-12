import { z } from 'zod';
import { failureReason } from '@/lib/failure';
import type { Branch, Interpretation } from '@/lib/types';

// Model fallback for the interpret stage. The deterministic tokenizer runs
// first and is authoritative; the model only sees what it left behind —
// unparsed tokens, or a query with no reading at all. Its output is a set of
// per-token constraint patches, validated with zod and merged with a strict
// deterministic-wins rule. Any failure (network, malformed output) degrades
// softly to the deterministic interpretation.

// The caller returns the raw tool input the model produced. Injected in tests
// so the whole merge path runs offline; the default hits the Anthropic API.
export type ModelCaller = (input: {
  query: string;
  unparsed: string[];
  deterministic: Interpretation;
}) => Promise<unknown>;

export type ModelInterpretation = {
  interpretation: Interpretation;
  status: { called: boolean; ok: boolean; detail?: string };
};

const PatchSchema = z
  .object({
    make: z.string().min(1),
    models: z.array(z.string().min(1)).min(1),
    yearMin: z.number().int(),
    yearMax: z.number().int(),
    trimContains: z.array(z.string().min(1)).min(1), // one OR-group
    cylinders: z.number().int(),
    blockType: z.enum(['L', 'V', 'H', 'W', 'R']),
    aspiration: z.enum(['NA', 'Turbo', 'Supercharged', 'Twincharged']),
    drive: z.enum(['RWD', 'FWD', 'AWD', '4WD']),
    body: z.string().min(1),
    doors: z.number().int(),
    fuel: z.enum(['GAS', 'DIESEL', 'FLEX', 'HYBRID', 'ELECTRIC']),
    unfilterable: z.object({ reason: z.string().min(1), forwarded: z.boolean() }),
  })
  .partial();

const MappingSchema = z.object({
  token: z.string().min(1),
  meaning: z.string().min(1),
  reason: z.string().min(1),
  patch: PatchSchema,
});

const OutputSchema = z.object({ mappings: z.array(MappingSchema) });

type Mapping = z.infer<typeof MappingSchema>;

// Scalar constraint fields the model may fill but never overwrite.
const SCALAR_FIELDS = [
  'make',
  'yearMin',
  'yearMax',
  'cylinders',
  'blockType',
  'aspiration',
  'drive',
  'body',
  'doors',
  'fuel',
] as const;

// Applies one patch to one branch. Deterministic wins: a field the tokenizer
// already set is never overwritten. Returns whether anything changed.
function applyPatch(branch: Branch, mapping: Mapping): boolean {
  const c = branch.constraint;
  const p = mapping.patch;
  let applied = false;

  for (const field of SCALAR_FIELDS) {
    if (p[field] !== undefined && c[field] === undefined) {
      (c as Record<string, unknown>)[field] = p[field];
      applied = true;
    }
  }
  if (p.models !== undefined && c.models === undefined) {
    c.models = [...p.models];
    applied = true;
  }
  if (p.trimContains !== undefined) {
    c.trimContains = [...(c.trimContains ?? []), [...p.trimContains]];
    applied = true;
  }
  if (p.unfilterable !== undefined) {
    c.unfilterable = [
      ...(c.unfilterable ?? []),
      {
        term: mapping.token,
        reason: p.unfilterable.reason,
        forwardedToListings: p.unfilterable.forwarded,
      },
    ];
    applied = true;
  }

  if (applied) {
    branch.assumptions.push({
      source: 'llm',
      input: mapping.token,
      meaning: mapping.meaning,
      reason: mapping.reason,
    });
  }
  return applied;
}

function merge(deterministic: Interpretation, mappings: Mapping[]): Interpretation {
  const next = structuredClone(deterministic);
  const unparsedSet = new Set(next.unparsed);
  // Only tokens the tokenizer actually gave up on are negotiable; anything
  // else in the model's output is discarded so it can never contradict a
  // deterministic reading.
  const usable = mappings.filter((m) => unparsedSet.has(m.token));

  if (next.branches.length === 0 && usable.length > 0) {
    next.branches.push({ label: next.unparsed.join(' '), constraint: {}, assumptions: [] });
  }

  for (const mapping of usable) {
    let appliedSomewhere = false;
    for (const branch of next.branches) {
      if (applyPatch(branch, mapping)) appliedSomewhere = true;
    }
    // A patch that conflicted everywhere stays honest: the token remains
    // unparsed rather than carrying an assumption that changed nothing.
    if (appliedSomewhere) unparsedSet.delete(mapping.token);
  }

  next.unparsed = next.unparsed.filter((t) => unparsedSet.has(t));
  return next;
}

const TOOL_NAME = 'map_tokens';

const SYSTEM_PROMPT = `You are the fallback interpreter for an enthusiast car search engine.
A deterministic tokenizer already parsed everything it recognizes (chassis codes, engine codes, variants, makes, models, years, specs). You only see its leftovers.

Map each leftover token you genuinely recognize to a constraint patch. Rules:
- Never invent vehicles. If a token means nothing automotive, omit it entirely.
- If a token names something the vehicle data cannot filter on (color, transmission, condition, modifications, wheels), use the "unfilterable" patch with forwarded=true when it would help a live listing search.
- models entries are SQL LIKE patterns against the model column (e.g. "Skyline%").
- trimContains is one OR-group of substrings matched against trim names.
- Give a concrete meaning and reason for every mapping; they are shown to the user as explicit assumptions.
- If a vehicle was never sold in the US market, still map it, and say so in the reason.`;

const MAP_TOKENS_TOOL = {
  name: TOOL_NAME,
  description: 'Report the constraint patches for the leftover tokens.',
  input_schema: {
    type: 'object' as const,
    properties: {
      mappings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            token: { type: 'string', description: 'exactly one leftover token, verbatim' },
            meaning: { type: 'string', description: 'what the token refers to' },
            reason: { type: 'string', description: 'why this reading is right' },
            patch: {
              type: 'object',
              properties: {
                make: { type: 'string' },
                models: { type: 'array', items: { type: 'string' } },
                yearMin: { type: 'integer' },
                yearMax: { type: 'integer' },
                trimContains: { type: 'array', items: { type: 'string' } },
                cylinders: { type: 'integer' },
                blockType: { type: 'string', enum: ['L', 'V', 'H', 'W', 'R'] },
                aspiration: {
                  type: 'string',
                  enum: ['NA', 'Turbo', 'Supercharged', 'Twincharged'],
                },
                drive: { type: 'string', enum: ['RWD', 'FWD', 'AWD', '4WD'] },
                body: { type: 'string' },
                doors: { type: 'integer' },
                fuel: { type: 'string', enum: ['GAS', 'DIESEL', 'FLEX', 'HYBRID', 'ELECTRIC'] },
                unfilterable: {
                  type: 'object',
                  properties: {
                    reason: { type: 'string' },
                    forwarded: { type: 'boolean' },
                  },
                  required: ['reason', 'forwarded'],
                },
              },
            },
          },
          required: ['token', 'meaning', 'reason', 'patch'],
        },
      },
    },
    required: ['mappings'],
  },
};

// Sonnet, not Haiku: this stage carries the "never invent vehicles" invariant
// for the long tail of enthusiast slang, where a wrong-but-plausible mapping
// is worse than none. See README for the full model-choice table.
const INTERPRET_MODEL = 'claude-sonnet-5';

const defaultCaller: ModelCaller = async ({ query, unparsed, deterministic }) => {
  // Lazy import keeps the SDK out of every bundle that only runs offline.
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ timeout: 60_000, maxRetries: 1 }); // reads ANTHROPIC_API_KEY server-side
  const branchSummary = deterministic.branches.map((b) => ({
    label: b.label,
    constraint: b.constraint,
  }));
  const response = await client.messages.create({
    model: INTERPRET_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [MAP_TOKENS_TOOL],
    tool_choice: { type: 'tool', name: TOOL_NAME, disable_parallel_tool_use: true },
    messages: [
      {
        role: 'user',
        content: [
          `Full query: ${JSON.stringify(query)}`,
          `Leftover tokens: ${JSON.stringify(unparsed)}`,
          `Deterministic readings so far: ${JSON.stringify(branchSummary)}`,
        ].join('\n'),
      },
    ],
  });
  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) throw new Error('model returned no tool_use block');
  return toolUse.input;
};

export async function interpretWithModel(
  query: string,
  deterministic: Interpretation,
  caller: ModelCaller = defaultCaller,
): Promise<ModelInterpretation> {
  const needsModel = deterministic.unparsed.length > 0 || deterministic.branches.length === 0;
  if (!needsModel) {
    return {
      interpretation: deterministic,
      status: { called: false, ok: true, detail: 'deterministic interpretation was complete' },
    };
  }

  let raw: unknown;
  try {
    raw = await caller({ query, unparsed: deterministic.unparsed, deterministic });
  } catch (err) {
    console.error('search interpret: model fallback failed:', err);
    return {
      interpretation: deterministic,
      status: { called: true, ok: false, detail: failureReason(err) },
    };
  }

  const parsed = OutputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      interpretation: deterministic,
      status: { called: true, ok: false, detail: 'model output failed validation' },
    };
  }

  return {
    interpretation: merge(deterministic, parsed.data.mappings),
    status: { called: true, ok: true },
  };
}
