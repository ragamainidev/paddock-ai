import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { z } from 'zod';
import type {
  FamilyGeneration,
  GenerationCatalog,
  GenerationFamily,
} from '../src/knowledge/generation-catalog';

// Compile the generation catalog: for each family, hand the model the
// family's REAL year/trim/engine table from the database and have it — with
// live web search — segment those years into named generations and facelift
// phases, citing sources. Every window is then validated against the same
// rows before it lands in data/generation-candidate.json. Hand-typed enthusiast lore
// doesn't scale; compiled-and-verified lore does.
//
//   pnpm knowledge:compile             compile every configured family
//   pnpm knowledge:compile "Audi R8"   compile one (merges into the artifact)
//
// Needs ANTHROPIC_API_KEY (this is a build-time tool, never a runtime path).

const FAMILIES: { make: string; family: string; modelLike: string[]; modelTokens: string[] }[] = [
  { make: 'Audi', family: 'R8', modelLike: ['R8%'], modelTokens: ['r8'] },
  { make: 'Nissan', family: 'GT-R', modelLike: ['GT-R%'], modelTokens: ['gtr', 'gt-r'] },
  { make: 'Honda', family: 'S2000', modelLike: ['S2000%'], modelTokens: ['s2000', 's2k'] },
  { make: 'Dodge', family: 'Viper', modelLike: ['Viper%'], modelTokens: ['viper'] },
  { make: 'Acura', family: 'NSX', modelLike: ['NSX%'], modelTokens: ['nsx'] },
  { make: 'Ford', family: 'Mustang', modelLike: ['Mustang'], modelTokens: ['mustang', 'stang'] },
  { make: 'Chevrolet', family: 'Camaro', modelLike: ['Camaro'], modelTokens: ['camaro'] },
  { make: 'Volkswagen', family: 'GTI', modelLike: ['GTI'], modelTokens: ['gti'] },
];

const MODEL = 'claude-sonnet-5';
const TOOL_NAME = 'report_generations';

const REPORT_TOOL = {
  name: TOOL_NAME,
  description:
    'Report the generation segmentation for this vehicle family. Call exactly once, after verifying against the provided database rows and your searches.',
  strict: true,
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      generations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: {
              type: 'string',
              description: 'the enthusiast/platform name: "Type 42", "AP1", "S550", "R35"',
            },
            ordinal: { type: 'integer', description: '1 for the first generation, and so on' },
            aliases: {
              type: 'array',
              items: { type: 'string' },
              description:
                'lowercase terms enthusiasts use for THIS generation: platform codes, "mk2", nicknames. Do not include the bare model name.',
            },
            yearMin: { type: 'integer', description: 'first US model year IN THE PROVIDED ROWS' },
            yearMax: { type: 'integer', description: 'last US model year IN THE PROVIDED ROWS' },
            phases: {
              type: 'array',
              description:
                'facelift split within the generation, ONLY when the provided rows actually contain both phases; year windows must use years present in the rows',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  kind: { type: 'string', enum: ['pre-facelift', 'facelift'] },
                  yearMin: { type: 'integer' },
                  yearMax: { type: 'integer' },
                },
                required: ['kind', 'yearMin', 'yearMax'],
              },
            },
            citations: {
              type: 'array',
              items: { type: 'string' },
              description: 'http(s) URLs of the pages you used to verify this generation',
            },
          },
          required: ['name', 'ordinal', 'aliases', 'yearMin', 'yearMax', 'citations'],
        },
      },
    },
    required: ['generations'],
  },
};

const SYSTEM = `You segment a vehicle family's US-market model years into generations for a search engine, grounded in the exact database rows provided. Search the web to verify generation boundaries, platform names, and facelift years.
Rules:
- The provided rows are the ground truth for WHICH years exist; your job is to name and segment them. Never output a year that is not in the rows.
- Generations must not overlap and must be ordered by ordinal.
- ordinal is the COMMUNITY's generation number, not an index: if the rows skip an entire generation (e.g. no Mustang II years), leave a gap in the ordinals so "gen 3" still means what enthusiasts mean by it.
- Include facelift phases only where the rows contain both pre- and post-facelift years (US model years, not reveal dates).
- Aliases are what enthusiasts actually type: platform/chassis codes ("type 42", "ap2", "s550", "fk8"), "mk" forms, common nicknames. Lowercase everything. Never invent aliases.
- Cite the pages you actually used for every generation.`;

const genSchema = z.object({
  generations: z
    .array(
      z.object({
        name: z.string().min(1),
        ordinal: z.number().int().min(1),
        aliases: z.array(z.string()).default([]),
        yearMin: z.number().int(),
        yearMax: z.number().int(),
        phases: z
          .array(
            z.object({
              kind: z.enum(['pre-facelift', 'facelift']),
              yearMin: z.number().int(),
              yearMax: z.number().int(),
            }),
          )
          .optional(),
        citations: z.array(z.string()).default([]),
      }),
    )
    .min(1),
});

type Row = { year: number; model: string; trim: string; engine: string };

function dbPath(): string {
  for (const candidate of ['data/ymm.db', 'data/eval.db']) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('no database found — run pnpm catalog:install or pnpm catalog:sample');
}

async function familyRows(f: (typeof FAMILIES)[number]): Promise<Row[]> {
  const db = createClient({ url: `file:${dbPath()}` });
  try {
    const likes = f.modelLike.map(() => 'model LIKE ?').join(' OR ');
    const rs = await db.execute({
      sql: `SELECT year, model, trim, COALESCE(engine, COALESCE(displacement, '') || 'L ' || COALESCE(cylinders, '') || 'cyl') AS engine
            FROM vehicles WHERE make = ? AND (${likes})
            GROUP BY year, model, trim, engine ORDER BY year`,
      args: [f.make, ...f.modelLike],
    });
    return rs.rows as unknown as Row[];
  } finally {
    db.close();
  }
}

async function compileFamily(f: (typeof FAMILIES)[number]): Promise<GenerationFamily> {
  const rows = await familyRows(f);
  if (rows.length === 0) throw new Error(`${f.make} ${f.family}: no rows in the database`);
  const years = [...new Set(rows.map((r) => Number(r.year)))].sort((a, b) => a - b);

  const table = rows.map((r) => `${r.year} | ${r.model} | ${r.trim} | ${r.engine}`).join('\n');
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ timeout: 240_000, maxRetries: 1 });

  // Same agent-loop discipline as the research callers: long server-tool
  // turns pause (`pause_turn`) and must be handed back; a model that stops
  // without reporting gets one nudge per turn, bounded.
  type Msg = { role: 'user' | 'assistant'; content: unknown };
  let messages: Msg[] = [
    {
      role: 'user',
      content: `Family: ${f.make} ${f.family} (US market).\nDatabase rows (year | model | trim | engine):\n${table}\n\nSegment these years into generations.`,
    },
  ];
  let reportInput: unknown;
  const MAX_TURNS = 5;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      tools: [{ type: 'web_search_20260318', name: 'web_search', max_uses: 5 }, REPORT_TOOL],
      messages: messages as never,
    });
    stream.on('contentBlock', (block) => {
      if (block.type === 'server_tool_use' && block.name === 'web_search') {
        const q = (block.input as { query?: string } | null)?.query;
        if (q) process.stdout.write(`    searching: ${q}\n`);
      }
    });
    const response = await stream.finalMessage();
    const report = response.content.find((b) => b.type === 'tool_use' && b.name === TOOL_NAME);
    if (report && report.type === 'tool_use') {
      reportInput = report.input;
      break;
    }
    if (response.stop_reason === 'pause_turn') {
      messages = [...messages, { role: 'assistant', content: response.content }];
      continue;
    }
    messages = [
      ...messages,
      { role: 'assistant', content: response.content },
      { role: 'user', content: `Call ${TOOL_NAME} now with the segmentation.` },
    ];
  }
  if (reportInput === undefined) {
    throw new Error(`${f.family}: compiler model never called ${TOOL_NAME}`);
  }
  const parsed = genSchema.parse(reportInput);

  // Validation against the rows the model was given — the artifact may not
  // claim a year the database cannot show.
  const yearSet = new Set(years);
  const generations: FamilyGeneration[] = parsed.generations
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((g) => ({
      ...g,
      aliases: g.aliases.map((a) => a.toLowerCase().trim()).filter(Boolean),
      citations: g.citations.filter((c) => /^https?:\/\//.test(c)),
    }));

  for (const g of generations) {
    if (!yearSet.has(g.yearMin) || !yearSet.has(g.yearMax)) {
      throw new Error(
        `${f.family} ${g.name}: window ${g.yearMin}–${g.yearMax} uses years absent from the DB (${years.join(', ')})`,
      );
    }
    if (g.citations.length === 0) {
      throw new Error(`${f.family} ${g.name}: no citations — uncited segmentation is discarded`);
    }
    for (const p of g.phases ?? []) {
      if (p.yearMin < g.yearMin || p.yearMax > g.yearMax) {
        throw new Error(`${f.family} ${g.name}: phase ${p.kind} escapes the generation window`);
      }
      if (!yearSet.has(p.yearMin) || !yearSet.has(p.yearMax)) {
        throw new Error(`${f.family} ${g.name}: phase ${p.kind} uses years absent from the DB`);
      }
    }
  }
  for (let i = 1; i < generations.length; i++) {
    if (generations[i].yearMin <= generations[i - 1].yearMax) {
      throw new Error(
        `${f.family}: generations ${generations[i - 1].name} and ${generations[i].name} overlap`,
      );
    }
  }

  return {
    make: f.make,
    family: f.family,
    modelLike: f.modelLike,
    modelTokens: f.modelTokens,
    generations,
    compiledOn: new Date().toISOString().slice(0, 10),
  };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('knowledge:compile needs ANTHROPIC_API_KEY (build-time tool)');
    process.exit(1);
  }
  const filter = process.argv[2]?.toLowerCase();
  const targets = filter
    ? FAMILIES.filter((f) => `${f.make} ${f.family}`.toLowerCase().includes(filter))
    : FAMILIES;
  if (targets.length === 0) {
    console.error(`no configured family matches "${process.argv[2]}"`);
    process.exit(1);
  }

  const artifactPath = join('data', 'generation-candidate.json');
  const existing: GenerationCatalog = existsSync(artifactPath)
    ? (JSON.parse(readFileSync(artifactPath, 'utf8')) as GenerationCatalog)
    : { families: [] };

  for (const f of targets) {
    console.log(`compiling ${f.make} ${f.family}…`);
    try {
      const family = await compileFamily(f);
      const idx = existing.families.findIndex(
        (x) => x.make === family.make && x.family === family.family,
      );
      if (idx >= 0) existing.families[idx] = family;
      else existing.families.push(family);
      console.log(
        `  ok: ${family.generations.map((g) => `${g.name} ${g.yearMin}–${g.yearMax}${g.phases ? ` (${g.phases.length} phases)` : ''}`).join(' · ')}`,
      );
    } catch (err) {
      console.error(`  FAILED: ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
  }

  existing.families.sort((a, b) => `${a.make} ${a.family}`.localeCompare(`${b.make} ${b.family}`));
  writeFileSync(artifactPath, `${JSON.stringify(existing, null, 1)}\n`);
  console.log(`→ ${artifactPath} (${existing.families.length} families)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
