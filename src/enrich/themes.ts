import { z } from 'zod';
import { failureReason } from '@/lib/failure';
import type { StageStatus } from '@/lib/types';
import { summarizeComponents, type ComplaintRecord } from './nhtsa';

// Turns raw NHTSA complaints into enthusiast-readable failure themes.
// Counts and ordering are computed here from the data; the model only names
// what each component group is about ("Rod bearing failures", not "ENGINE
// AND ENGINE COOLING"). If the model is unavailable or answers badly, the
// section degrades to raw component counts — it never disappears.

export type ComplaintTheme = {
  component: string; // the NHTSA component the theme is grounded in
  count: number; // deterministic complaint count, never model-written
  title: string; // model-written name, or the raw component on fallback
  detail: string; // one sentence on the failure mode, '' on fallback
};

export type ThemeCaller = (input: {
  vehicleLabel: string;
  groups: { component: string; count: number; samples: string[] }[];
}) => Promise<unknown>;

const MAX_GROUPS = 6;
const MAX_SAMPLES = 3;
const MAX_SAMPLE_CHARS = 300;

const OutputSchema = z.object({
  themes: z.array(
    z.object({
      component: z.string().min(1),
      title: z.string().min(1),
      detail: z.string(),
    }),
  ),
});

const TOOL_NAME = 'report_themes';

const REPORT_THEMES_TOOL = {
  name: TOOL_NAME,
  description: 'Name the failure theme behind each complaint component group.',
  input_schema: {
    type: 'object' as const,
    properties: {
      themes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            component: {
              type: 'string',
              description: 'one of the given component names, verbatim',
            },
            title: {
              type: 'string',
              description: 'short enthusiast-readable failure name, e.g. "Rod bearing failures"',
            },
            detail: { type: 'string', description: 'one sentence on the failure mode' },
          },
          required: ['component', 'title', 'detail'],
        },
      },
    },
    required: ['themes'],
  },
};

const SYSTEM_PROMPT = `You summarize NHTSA complaint groups for one vehicle into failure themes an enthusiast would recognize.
For each component group, read the sample narratives and name the dominant real failure mode. Rules:
- Return the component names verbatim; never invent components or counts.
- Titles are short and specific ("Rear subframe cracking", not "Powertrain issues").
- If the samples for a group don't show a coherent theme, use the component name itself as the title.`;

// Haiku, not Sonnet: this is constrained summarization over supplied text —
// the counts and grouping are already computed, so a small model suffices.
// See README for the full model-choice table.
const THEMES_MODEL = 'claude-haiku-4-5-20251001';

const defaultCaller: ThemeCaller = async ({ vehicleLabel, groups }) => {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ timeout: 60_000, maxRetries: 1 }); // reads ANTHROPIC_API_KEY server-side
  const response = await client.messages.create({
    model: THEMES_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [REPORT_THEMES_TOOL],
    tool_choice: { type: 'tool', name: TOOL_NAME, disable_parallel_tool_use: true },
    messages: [
      {
        role: 'user',
        content: `Vehicle: ${vehicleLabel}\nComplaint groups: ${JSON.stringify(groups)}`,
      },
    ],
  });
  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) throw new Error('model returned no tool_use block');
  return toolUse.input;
};

function buildGroups(complaints: ComplaintRecord[]) {
  return summarizeComponents(complaints)
    .slice(0, MAX_GROUPS)
    .map(({ component, count }) => ({
      component,
      count,
      samples: complaints
        .filter((c) => c.components.split(',').some((p) => p.trim() === component))
        .slice(0, MAX_SAMPLES)
        .map((c) => c.summary.slice(0, MAX_SAMPLE_CHARS)),
    }));
}

function fallbackThemes(groups: { component: string; count: number }[]): ComplaintTheme[] {
  return groups.map((g) => ({
    component: g.component,
    count: g.count,
    title: g.component,
    detail: '',
  }));
}

export async function themeComplaints(
  vehicleLabel: string,
  complaints: ComplaintRecord[],
  caller: ThemeCaller = defaultCaller,
): Promise<{ themes: ComplaintTheme[]; status: StageStatus }> {
  if (complaints.length === 0) {
    return { themes: [], status: { stage: 'themes', ok: true, detail: 'no complaints to theme' } };
  }

  const groups = buildGroups(complaints);

  // Same guard the interpret stage has: no key means a clean skip with raw
  // component counts, not an SDK auth error leaking into the UI.
  if (caller === defaultCaller && !process.env.ANTHROPIC_API_KEY) {
    return {
      themes: fallbackThemes(groups),
      status: {
        stage: 'themes',
        ok: false,
        detail: 'themes skipped (no ANTHROPIC_API_KEY); raw component counts shown',
      },
    };
  }

  let raw: unknown;
  try {
    raw = await caller({ vehicleLabel, groups });
  } catch (err) {
    console.error('themes: naming failed:', err);
    return {
      themes: fallbackThemes(groups),
      status: { stage: 'themes', ok: false, detail: failureReason(err) },
    };
  }

  const parsed = OutputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      themes: fallbackThemes(groups),
      status: { stage: 'themes', ok: false, detail: 'model output failed validation' },
    };
  }

  // Grounding rule: themes exist only for components the data actually has;
  // anything else the model returned is discarded.
  const byComponent = new Map(parsed.data.themes.map((t) => [t.component, t]));
  const themes = groups.map(({ component, count }) => {
    const t = byComponent.get(component);
    return {
      component,
      count,
      title: t?.title ?? component,
      detail: t?.detail ?? '',
    };
  });
  return { themes, status: { stage: 'themes', ok: true } };
}
