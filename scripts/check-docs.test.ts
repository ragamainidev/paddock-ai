import { describe, expect, it } from 'vitest';
import {
  checkDesignHeadings,
  checkDocHeadings,
  checkEnvExample,
  checkIndex,
  checkRoutingTable,
  checkSpec,
  checkSpecReferences,
  checkSpecTestTitles,
  envReads,
} from './check-docs';

const exists = (paths: string[]) => (p: string) => paths.includes(p.replace(/\/$/, ''));

describe('checkSpec', () => {
  const good = `# SPEC

## A

1. **Rule one.** Body. — \`src/a.ts\` (\`fn\`); tested in \`src/a.test.ts\`.

2. **Rule two.** — \`src/b/\`; tested in \`src/b/x.test.ts\` ("case").
`;

  it('accepts a spec whose rules are unique, gapless, and cite real paths', () => {
    const problems = checkSpec(
      good,
      exists(['src/a.ts', 'src/a.test.ts', 'src/b', 'src/b/x.test.ts']),
    );
    expect(problems).toEqual([]);
  });

  it('flags a citation that points at nothing', () => {
    const problems = checkSpec(good, exists(['src/a.ts', 'src/a.test.ts', 'src/b']));
    expect(problems.map((p) => p.message)).toEqual([expect.stringContaining('src/b/x.test.ts')]);
  });

  it('flags repeated and missing rule numbers', () => {
    const dup = good.replace('2. **Rule two.**', '1. **Rule two.**');
    expect(checkSpec(dup, () => true).map((p) => p.message)).toEqual([
      expect.stringContaining('repeated'),
    ]);
    const gap = good.replace('2. **Rule two.**', '3. **Rule two.**');
    expect(checkSpec(gap, () => true).map((p) => p.message)).toEqual([
      expect.stringContaining('missing'),
    ]);
  });

  it('flags rules that descend in file order (prettier would renumber them)', () => {
    const text = `## A\n\n2. **B.** — \`src/a.ts\`.\n\n## B\n\n1. **A.** — \`src/a.ts\`.\n`;
    expect(checkSpec(text, () => true).map((p) => p.message)).toEqual([
      expect.stringContaining('ascend'),
    ]);
  });

  it('flags a rule that cites no path at all', () => {
    const uncited = good.replace(
      '2. **Rule two.** — `src/b/`; tested in `src/b/x.test.ts` ("case").',
      '2. **Rule two.** Nothing cited.',
    );
    expect(checkSpec(uncited, () => true).map((p) => p.message)).toEqual([
      expect.stringContaining('cites no'),
    ]);
  });

  it('ignores backticked things that are not paths', () => {
    const text = `1. **R.** \`NEXT_PUBLIC_\`, \`{source, input}\`, \`Skyline%\`, \`file:data/ymm.db\`, \`EBAY_CLIENT_ID/SECRET\`, \`/api/runs/[id]/stream\` — \`src/a.ts\`.`;
    expect(checkSpec(text, exists(['src/a.ts']))).toEqual([]);
  });

  it('checks root files with a known extension', () => {
    const text = '1. **R.** — `.env.example`, `next.config.ts`, `src/a.ts`.';
    expect(checkSpec(text, exists(['src/a.ts', 'next.config.ts'])).map((p) => p.message)).toEqual([
      expect.stringContaining('.env.example'),
    ]);
  });
});

describe('checkDocHeadings', () => {
  it('accepts numbered, consecutive headings and code fences', () => {
    const text = `# area

intro

## 1. First

### 1.1 One

\`\`\`
## not a heading
\`\`\`

### 1.2 Two

## 2. Second
`;
    expect(checkDocHeadings('docs/area.md', text)).toEqual([]);
  });

  it('allows an initiative to start at 0', () => {
    const text = `# init\n\n## 0. Resume\n\n## 1. Goals\n`;
    expect(checkDocHeadings('docs/initiatives/x.md', text)).toEqual([]);
  });

  it('flags unnumbered, out-of-order, and mis-prefixed headings', () => {
    const text = `# area\n\n## 1. First\n\n### 2.1 Wrong prefix\n\n## Unnumbered\n\n## 4. Skipped\n`;
    const messages = checkDocHeadings('docs/area.md', text).map((p) => p.message);
    expect(messages.some((m) => m.includes('2.1'))).toBe(true);
    expect(messages.some((m) => m.includes('Unnumbered'))).toBe(true);
    expect(messages.some((m) => m.includes('expected 2'))).toBe(true);
  });

  it('requires a single H1 as the first line', () => {
    expect(checkDocHeadings('docs/area.md', 'intro\n\n## 1. A\n').map((p) => p.message)).toEqual([
      expect.stringContaining('H1'),
    ]);
  });
});

describe('checkIndex', () => {
  it('requires every top-level doc and subdirectory to be linked from the index', () => {
    const readme = `| [a.md](a.md) | | [workflows/](workflows/) |`;
    const problems = checkIndex(readme, ['a.md', 'b.md'], ['workflows', 'initiatives']);
    expect(problems.map((p) => p.message)).toEqual([
      expect.stringContaining('b.md'),
      expect.stringContaining('initiatives/'),
    ]);
  });
});

describe('checkSpecReferences', () => {
  it('flags SPEC numbers above the highest rule, including ranges', () => {
    const problems = checkSpecReferences('docs/x.md', 'see SPEC 3, SPEC 5–7 and SPEC 12', 10);
    expect(problems.map((p) => p.message)).toEqual([expect.stringContaining('SPEC 12')]);
  });

  it('accepts in-range references', () => {
    expect(checkSpecReferences('docs/x.md', 'SPEC 1, SPEC 9–10', 10)).toEqual([]);
  });
});

describe('checkSpecTestTitles', () => {
  const files: Record<string, string> = {
    'src/a.test.ts': `it('holds the line', () => {});\nit('wraps a very long title across two source lines', () => {});\nit('filed as "rebuilt sold" is wreck evidence', () => {});`,
    'src/b.test.ts': `it('other case', () => {});`,
  };
  const read = (p: string) => files[p] ?? null;

  it('accepts titles that exist in the file cited before them', () => {
    const text = `1. **R.** — \`src/a.ts\`; tested in \`src/a.test.ts\` ("holds the line") and \`src/b.test.ts\` ("other case").`;
    expect(checkSpecTestTitles(text, read)).toEqual([]);
  });

  it('matches a title SPEC.md wrapped onto two lines', () => {
    const text = `1. **R.** — \`src/a.ts\`; tested in \`src/a.test.ts\` ("wraps a very long\n   title across two source lines").`;
    expect(checkSpecTestTitles(text, read)).toEqual([]);
  });

  it('unescapes a title that quotes something itself', () => {
    const text = `1. **R.** — \`src/a.ts\`; tested in \`src/a.test.ts\` ("filed as \\"rebuilt sold\\" is wreck evidence").`;
    expect(checkSpecTestTitles(text, read)).toEqual([]);
  });

  it('flags a title the cited file does not contain', () => {
    const text = `1. **R.** — \`src/a.ts\`; tested in \`src/a.test.ts\` ("holds the line", "invented case").`;
    expect(checkSpecTestTitles(text, read).map((p) => p.message)).toEqual([
      expect.stringContaining('"invented case"'),
    ]);
  });

  it('attributes each title to the file cited immediately before it', () => {
    const text = `1. **R.** — \`src/a.ts\`; tested in \`src/a.test.ts\` ("holds the line"), \`src/b.test.ts\` ("holds the line").`;
    expect(checkSpecTestTitles(text, read).map((p) => p.message)).toEqual([
      expect.stringContaining('src/b.test.ts'),
    ]);
  });

  it('flags a title that follows a directory rather than a test file', () => {
    const text = `1. **R.** — \`src/a.ts\`; tested in \`src/a.test.ts\` and \`evals/agent/\` ("holds the line").`;
    expect(checkSpecTestTitles(text, read).map((p) => p.message)).toEqual([
      expect.stringContaining('no test file cited before it'),
    ]);
  });

  it('ignores quotes in the rule body before the tested clause', () => {
    const text = `1. **R.** History is never "clean". — \`src/a.ts\`; tested in \`src/a.test.ts\` ("holds the line").`;
    expect(checkSpecTestTitles(text, read)).toEqual([]);
  });

  it('does not anchor on a rule whose own title says tested', () => {
    const text = `1. **The catalog is tested like code.** A seed that says "clean" is not evidence. — \`src/a.ts\`; tested in \`src/a.test.ts\` ("holds the line").`;
    expect(checkSpecTestTitles(text, read)).toEqual([]);
  });

  it('reads the clause however it names its files', () => {
    const wrong = '"invented case"';
    for (const clause of ['tested in', 'tested with stale work in', 'tested at the boundary in']) {
      const text = `1. **R.** — \`src/a.ts\`; ${clause} \`src/a.test.ts\` (${wrong}).`;
      expect(checkSpecTestTitles(text, read).map((p) => p.message)).toEqual([
        expect.stringContaining('"invented case"'),
      ]);
    }
  });

  it('reports a tested clause that cites no test file at all', () => {
    const text = `1. **R.** — \`src/a.ts\`; tested in \`evals/agent/\` ("holds the line").`;
    expect(checkSpecTestTitles(text, read).map((p) => p.message)).toEqual([
      expect.stringContaining('no test file cited before it'),
    ]);
  });

  it('says nothing about a rule with no tested clause, or a file that is missing', () => {
    expect(checkSpecTestTitles('1. **R.** — `src/a.ts`.', read)).toEqual([]);
    const gone = `1. **R.** — \`src/a.ts\`; tested in \`src/gone.test.ts\` ("holds the line").`;
    expect(checkSpecTestTitles(gone, read)).toEqual([]);
  });
});

describe('checkDesignHeadings', () => {
  it('accepts prose headings that are unique, and code fences', () => {
    const text = `# DESIGN.md\n\n## Color\n\n\`\`\`\n## not a heading\n\`\`\`\n\n## Type\n\n### Scale\n`;
    expect(checkDesignHeadings('DESIGN.md', text)).toEqual([]);
  });

  it('requires the H1 and flags an empty heading', () => {
    expect(checkDesignHeadings('DESIGN.md', 'intro\n\n## Color\n').map((p) => p.message)).toEqual([
      expect.stringContaining('H1'),
    ]);
    expect(checkDesignHeadings('DESIGN.md', '# D\n\n##\n').map((p) => p.message)).toEqual([
      expect.stringContaining('empty'),
    ]);
  });

  it('flags a repeated section name at the same level, not across levels', () => {
    const dup = `# D\n\n## Color\n\n## color\n`;
    expect(checkDesignHeadings('DESIGN.md', dup).map((p) => p.message)).toEqual([
      expect.stringContaining('repeats line 3'),
    ]);
    expect(checkDesignHeadings('DESIGN.md', `# D\n\n## Color\n\n### Color\n`)).toEqual([]);
  });
});

describe('checkRoutingTable', () => {
  const table = `# notes\n\n## Routing table\n\n| To change… | Touch |\n| ---------- | ----- |\n| Parsing    | \`src/interpret/tokenize.ts\` (\`tokenize.test.ts\`) |\n| Eve        | \`agent/\`, installed \`node_modules/eve/docs/\` |\n\n## Commands\n\n| x | \`src/gone.ts\` |\n`;

  it('follows directory paths in the last column and ignores bare file names', () => {
    const exists = (p: string) => p === 'agent/';
    expect(checkRoutingTable('CLAUDE.md', table, exists).map((p) => p.message)).toEqual([
      expect.stringContaining('src/interpret/tokenize.ts'),
    ]);
  });

  it('stops at the next heading', () => {
    // `src/gone.ts` sits in a table under the heading that follows the routing
    // table, so it is never followed; a row inside the table still is.
    expect(checkRoutingTable('CLAUDE.md', table, (p) => p !== 'src/gone.ts')).toEqual([]);
    expect(
      checkRoutingTable('CLAUDE.md', table, (p) => p !== 'agent/').map((p) => p.message),
    ).toEqual([expect.stringContaining('`agent/`')]);
  });
});

describe('checkEnvExample', () => {
  const example = '# comment\nDATABASE_URL=file:data/ymm.db\n# PADDOCK_DEBUG=\n';

  // Every name here is one .env.example declares: this file is itself walked
  // by the check, so an invented one would be reported against the repo.
  it('finds process.env reads with their file and line', () => {
    const reads = envReads(
      'src/a.ts',
      'const a = process.env.DATABASE_URL;\nif (process.env.PADDOCK_DEBUG) a;\n',
    );
    expect(reads).toEqual([
      { name: 'DATABASE_URL', file: 'src/a.ts', line: 1 },
      { name: 'PADDOCK_DEBUG', file: 'src/a.ts', line: 2 },
    ]);
  });

  it('accepts a declared variable and a commented declaration', () => {
    expect(
      checkEnvExample(example, [
        { name: 'DATABASE_URL', file: 'src/a.ts', line: 1 },
        { name: 'PADDOCK_DEBUG', file: 'src/b.ts', line: 2 },
      ]),
    ).toEqual([]);
  });

  it('flags an undeclared variable once, naming where it is read', () => {
    const problems = checkEnvExample(example, [
      { name: 'NEW_KEY', file: 'src/a.ts', line: 4 },
      { name: 'NEW_KEY', file: 'src/b.ts', line: 9 },
    ]);
    expect(problems.map((p) => p.message)).toEqual([expect.stringContaining('src/a.ts:4')]);
  });

  it('exempts variables the platform sets', () => {
    expect(
      checkEnvExample(example, [
        { name: 'NODE_ENV', file: 'src/a.ts', line: 1 },
        { name: 'VERCEL_URL', file: 'src/a.ts', line: 2 },
      ]),
    ).toEqual([]);
  });
});
