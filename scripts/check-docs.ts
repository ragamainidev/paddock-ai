/**
 * Docs and SPEC integrity check (`pnpm docs:check`). Pure checkers over
 * file text, plus a main that walks the repo. Fails when:
 *   - a SPEC rule cites a path that does not exist, cites nothing, repeats
 *     a number, or leaves a gap in the numbering;
 *   - a SPEC rule quotes a test title its cited test file does not contain;
 *   - a docs file lacks a leading H1, has an unnumbered `##`/`###` heading,
 *     or numbers them out of sequence (`## N.` consecutive from 0 or 1;
 *     `### N.M` consecutive from 1 under `## N.`);
 *   - `docs/README.md` does not link a top-level docs file or subdirectory;
 *   - `DESIGN.md` lacks its H1, carries an empty heading, or repeats a
 *     section name (its headings are prose, not numbered like `docs/`);
 *   - any doc, `DESIGN.md`, CLAUDE.md, README.md, or source comment cites
 *     `SPEC N` for an N above the highest rule;
 *   - a directory path in CLAUDE.md's routing table does not exist;
 *   - a literal `process.env.<NAME>` read under `src/`, `scripts/`, `evals/`
 *     or `agent/` names a variable `.env.example` does not declare. A variable
 *     reached through an injected `env` parameter is not seen here; the tests
 *     of the module that injects it cover that instead.
 * `docs/archive/` is exempt from heading rules (kept verbatim, unmaintained).
 * The rule itself lives in `docs/workflows/spec-update.md`.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export type DocsProblem = { file: string; line?: number; message: string };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// -- SPEC.md -------------------------------------------------------------------

const RULE_START = /^(\d+)\. \*\*/;
// A backticked token is a repo path when it starts with a tracked top-level
// directory (URL routes start with `/`, env names have no directory) or is
// a root file with a known extension. Braces, globs, `%`, spaces, and colon
// schemes are never paths.
const PATH_TOKEN = /^[\w@.\-/[\]]+$/;
const PATH_EXT = /\.(ts|tsx|md|json|jsonl|sql|css|sh|mjs|yml|yaml|csv|svg|ico|example)$/;
const TOP_DIRS = [
  'src',
  'scripts',
  'evals',
  'agent',
  'db',
  'data',
  'docs',
  'fixtures',
  'public',
  '.husky',
  '.github',
];

function isDirectoryPath(t: string): boolean {
  return (
    PATH_TOKEN.test(t) && !t.includes(':') && t.includes('/') && TOP_DIRS.includes(t.split('/')[0])
  );
}

function isRepoPath(t: string): boolean {
  if (isDirectoryPath(t)) return true;
  if (!PATH_TOKEN.test(t) || t.includes(':') || t.includes('/')) return false;
  return PATH_EXT.test(t) && /^[.\w-]+$/.test(t);
}

export function pathTokens(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/`([^`]+)`/g)) {
    if (isRepoPath(m[1])) out.push(m[1]);
  }
  return out;
}

type Rule = { n: number; line: number; body: string[] };

function specRules(text: string): Rule[] {
  const rules: Rule[] = [];
  let current: Rule | null = null;
  text.split('\n').forEach((raw, i) => {
    const m = RULE_START.exec(raw);
    if (m) {
      current = { n: Number(m[1]), line: i + 1, body: [raw] };
      rules.push(current);
    } else if (raw.startsWith('#')) {
      current = null;
    } else if (current) {
      current.body.push(raw);
    }
  });
  return rules;
}

export function checkSpec(text: string, exists: (p: string) => boolean): DocsProblem[] {
  const problems: DocsProblem[] = [];
  const rules = specRules(text);

  // Prettier renumbers each markdown list from its first item, so rules
  // must ascend in file order and every `##` section's list must be
  // contiguous; a new section starts a new list. Descending order here
  // means a rule was appended where prettier will silently renumber it.
  const seen = new Set<number>();
  let prev = 0;
  for (const r of rules) {
    if (seen.has(r.n)) {
      problems.push({ file: 'SPEC.md', line: r.line, message: `rule number ${r.n} is repeated` });
    } else if (r.n < prev) {
      problems.push({
        file: 'SPEC.md',
        line: r.line,
        message: `rule ${r.n} appears after rule ${prev}; rules ascend in file order (start a new ## section for non-contiguous numbers)`,
      });
    }
    seen.add(r.n);
    prev = Math.max(prev, r.n);
  }
  const max = Math.max(0, ...seen);
  for (let n = 1; n <= max; n++) {
    if (!seen.has(n)) problems.push({ file: 'SPEC.md', message: `rule number ${n} is missing` });
  }

  for (const r of rules) {
    const cited = pathTokens(r.body.join('\n'));
    if (cited.length === 0) {
      problems.push({ file: 'SPEC.md', line: r.line, message: `rule ${r.n} cites no code path` });
      continue;
    }
    for (const p of cited) {
      if (!exists(p)) {
        problems.push({
          file: 'SPEC.md',
          line: r.line,
          message: `rule ${r.n} cites \`${p}\` which does not exist`,
        });
      }
    }
  }
  return problems;
}

// A backticked path or a quoted string, whichever comes first, so a rule's
// citations are read in the order they were written.
const CITATION = /`([^`]+)`|"((?:[^"\\]|\\.)*)"/g;
const FIRST_CITATION = new RegExp(CITATION.source);

const isTestFile = (t: string) => isRepoPath(t) && /\.tsx?$/.test(t);

/**
 * The clause that introduces test citations, or null when the rule never says
 * `tested`. It is the first `tested` whose next citation is a source file:
 * rules say "tested in", "tested with … in" and "tested through … in", while a
 * rule titled "is tested like code" names a file only later, after prose that
 * may itself quote something. When no occurrence cites a test file, the first
 * one stands, so a malformed clause is reported rather than skipped.
 */
function testedClause(body: string): string | null {
  let first: string | null = null;
  for (const m of body.matchAll(/\btested\b/g)) {
    const rest = body.slice(m.index);
    first ??= rest;
    const next = FIRST_CITATION.exec(rest);
    if (next && next[1] !== undefined && isTestFile(next[1])) return rest;
  }
  // A rule that says `tested` but names no test file is malformed, not exempt:
  // its first clause is returned so the titles in it are reported.
  return first;
}

/**
 * A quoted string in a rule's tested clause is a test title, and it belongs to
 * the last `.ts`/`.tsx` path cited before it. Both sides are compared with
 * whitespace collapsed, because a title long enough to wrap in SPEC.md is still
 * one line in the test file. `read` returns null for a path that is not a file;
 * `checkSpec` already reports that citation.
 */
export function checkSpecTestTitles(
  text: string,
  read: (p: string) => string | null,
): DocsProblem[] {
  const problems: DocsProblem[] = [];
  const flat = (s: string) => s.replace(/\s+/g, ' ');
  for (const rule of specRules(text)) {
    const clause = testedClause(flat(rule.body.join(' ')));
    if (clause === null) continue;
    let cited: string | null = null;
    for (const m of clause.matchAll(CITATION)) {
      if (m[1] !== undefined) {
        // A cited path that is not source code ends the run of titles that
        // belong to the previous one; prose in backticks changes nothing.
        if (isRepoPath(m[1])) cited = isTestFile(m[1]) ? m[1] : null;
        continue;
      }
      const title = m[2].replace(/\\(.)/g, '$1');
      if (cited === null) {
        problems.push({
          file: 'SPEC.md',
          line: rule.line,
          message: `rule ${rule.n} quotes "${title}" with no test file cited before it`,
        });
        continue;
      }
      const source = read(cited);
      if (source === null) continue;
      if (!flat(source).includes(title)) {
        problems.push({
          file: 'SPEC.md',
          line: rule.line,
          message: `rule ${rule.n} cites test "${title}" which is not in \`${cited}\``,
        });
      }
    }
  }
  return problems;
}

export function highestSpecRule(text: string): number {
  let max = 0;
  for (const line of text.split('\n')) {
    const m = RULE_START.exec(line);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

// -- docs/*.md headings ----------------------------------------------------------

export function checkDocHeadings(file: string, text: string): DocsProblem[] {
  const problems: DocsProblem[] = [];
  const lines = text.split('\n');
  const firstContent = lines.findIndex((l) => l.trim().length > 0);
  if (firstContent === -1 || !/^# \S/.test(lines[firstContent])) {
    problems.push({ file, line: 1, message: 'first line must be the H1 (`# <area>`)' });
  }

  let inFence = false;
  let h2: number | null = null;
  let h3 = 0;
  let h2Count = 0;
  lines.forEach((raw, i) => {
    if (/^\s*```/.test(raw)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const line = i + 1;
    const m2 = /^## (.*)$/.exec(raw);
    if (m2) {
      const num = /^(\d+)\. \S/.exec(m2[1]);
      if (!num) {
        problems.push({ file, line, message: `unnumbered H2 "${m2[1]}" (want \`## N. Title\`)` });
        return;
      }
      const n = Number(num[1]);
      const expected = h2 === null ? (n === 0 ? 0 : 1) : h2 + 1;
      if (n !== expected) {
        problems.push({ file, line, message: `H2 numbered ${n}, expected ${expected}` });
      }
      h2 = n;
      h3 = 0;
      h2Count++;
      return;
    }
    const m3 = /^### (.*)$/.exec(raw);
    if (m3) {
      const num = /^(\d+)\.(\d+) \S/.exec(m3[1]);
      if (!num) {
        problems.push({ file, line, message: `unnumbered H3 "${m3[1]}" (want \`### N.M Title\`)` });
        return;
      }
      const major = Number(num[1]);
      const minor = Number(num[2]);
      if (h2 === null || major !== h2) {
        problems.push({
          file,
          line,
          message: `H3 ${major}.${minor} does not sit under H2 ${h2 ?? '(none)'}`,
        });
      } else if (minor !== h3 + 1) {
        problems.push({ file, line, message: `H3 ${major}.${minor}: expected ${major}.${h3 + 1}` });
      }
      h3 = minor;
    }
  });
  void h2Count;
  return problems;
}

// -- docs/README.md index --------------------------------------------------------

export function checkIndex(readme: string, docFiles: string[], subdirs: string[]): DocsProblem[] {
  const problems: DocsProblem[] = [];
  for (const f of docFiles) {
    if (!readme.includes(`](${f})`)) {
      problems.push({ file: 'docs/README.md', message: `index does not link ${f}` });
    }
  }
  for (const d of subdirs) {
    if (!readme.includes(`](${d}/)`)) {
      problems.push({ file: 'docs/README.md', message: `index does not link ${d}/` });
    }
  }
  return problems;
}

// -- SPEC references -------------------------------------------------------------

export function checkSpecReferences(file: string, text: string, max: number): DocsProblem[] {
  const problems: DocsProblem[] = [];
  const lines = text.split('\n');
  lines.forEach((raw, i) => {
    for (const m of raw.matchAll(/SPEC (\d+)(?:[–-](\d+))?/g)) {
      const a = Number(m[1]);
      const b = m[2] ? Number(m[2]) : a;
      const bad = a > max ? a : b > max ? b : null;
      if (bad !== null) {
        problems.push({
          file,
          line: i + 1,
          message: `cites SPEC ${bad} but the highest rule is ${max}`,
        });
      }
    }
  });
  return problems;
}

// -- DESIGN.md -------------------------------------------------------------------

/**
 * DESIGN.md is a contract read by section name, not by number, so the heading
 * rules for `docs/` do not apply to it. What must hold is that it opens with its
 * H1, no heading is empty, and no two sections at the same level share a name —
 * a duplicate makes "DESIGN.md §Color" ambiguous.
 */
export function checkDesignHeadings(file: string, text: string): DocsProblem[] {
  const problems: DocsProblem[] = [];
  const lines = text.split('\n');
  const firstContent = lines.findIndex((l) => l.trim().length > 0);
  if (firstContent === -1 || !/^# \S/.test(lines[firstContent])) {
    problems.push({ file, line: 1, message: 'first line must be the H1' });
  }
  let inFence = false;
  const seen = new Map<string, number>();
  lines.forEach((raw, i) => {
    if (/^\s*```/.test(raw)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const m = /^(#{2,6})(.*)$/.exec(raw);
    if (!m) return;
    const title = m[2].trim();
    if (title === '') {
      problems.push({
        file,
        line: i + 1,
        message: `empty ${m[1].length === 2 ? 'H2' : 'heading'}`,
      });
      return;
    }
    const key = `${m[1].length}:${title.toLowerCase()}`;
    const first = seen.get(key);
    if (first !== undefined) {
      problems.push({ file, line: i + 1, message: `heading "${title}" repeats line ${first}` });
    } else {
      seen.set(key, i + 1);
    }
  });
  return problems;
}

// -- CLAUDE.md routing table -----------------------------------------------------

/**
 * The routing table sends an agent to a file, so every directory path in its
 * right-hand column must resolve. Bare file names (`lines.ts`) and package
 * paths are prose there, so only tokens naming a tracked directory are followed.
 */
export function checkRoutingTable(
  file: string,
  text: string,
  exists: (p: string) => boolean,
): DocsProblem[] {
  const problems: DocsProblem[] = [];
  let inTable = false;
  text.split('\n').forEach((raw, i) => {
    if (/^#{1,6} /.test(raw)) {
      inTable = /routing table/i.test(raw);
      return;
    }
    if (!inTable || !raw.trimStart().startsWith('|')) return;
    const cells = raw.split('|').slice(1, -1);
    if (cells.length < 2) return;
    for (const m of cells[cells.length - 1].matchAll(/`([^`]+)`/g)) {
      if (isDirectoryPath(m[1]) && !exists(m[1])) {
        problems.push({
          file,
          line: i + 1,
          message: `routing table cites \`${m[1]}\` which does not exist`,
        });
      }
    }
  });
  return problems;
}

// -- .env.example ----------------------------------------------------------------

export type EnvRead = { name: string; file: string; line: number };

// Supplied by the runtime or the host, never copied into .env.example.
const PLATFORM_ENV = new Set([
  'CI',
  'HOME',
  'NODE_ENV',
  'PATH',
  'VERCEL',
  'VERCEL_ENV',
  'VERCEL_URL',
]);

export function envReads(file: string, text: string): EnvRead[] {
  const out: EnvRead[] = [];
  text.split('\n').forEach((raw, i) => {
    for (const m of raw.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      out.push({ name: m[1], file, line: i + 1 });
    }
  });
  return out;
}

/**
 * `.env.example` is the list of variables this repository reads (SPEC 17), so a
 * variable read in code and missing there is undocumented configuration. A
 * commented `# NAME=` line counts: it declares the variable and leaves it unset.
 */
export function checkEnvExample(example: string, reads: EnvRead[]): DocsProblem[] {
  const declared = new Set<string>();
  for (const raw of example.split('\n')) {
    const m = /^#?\s*([A-Z][A-Z0-9_]*)=/.exec(raw.trim());
    if (m) declared.add(m[1]);
  }
  const problems: DocsProblem[] = [];
  const reported = new Set<string>();
  for (const read of reads) {
    if (PLATFORM_ENV.has(read.name) || declared.has(read.name) || reported.has(read.name)) continue;
    reported.add(read.name);
    problems.push({
      file: '.env.example',
      message: `${read.name} is read in ${read.file}:${read.line} but is not declared here`,
    });
  }
  return problems;
}

// -- main ------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

export function runChecks(root: string = ROOT): DocsProblem[] {
  const problems: DocsProblem[] = [];
  const exists = (p: string) => existsSync(join(root, p));

  const readFile = (p: string) => {
    const abs = join(root, p);
    return existsSync(abs) && statSync(abs).isFile() ? readFileSync(abs, 'utf8') : null;
  };

  const specText = readFileSync(join(root, 'SPEC.md'), 'utf8');
  problems.push(...checkSpec(specText, exists));
  problems.push(...checkSpecTestTitles(specText, readFile));
  const max = highestSpecRule(specText);

  const docsDir = join(root, 'docs');
  const docFiles = readdirSync(docsDir).filter((f) => f.endsWith('.md') && f !== 'README.md');
  const subdirs = readdirSync(docsDir).filter(
    (f) => statSync(join(docsDir, f)).isDirectory() && f !== 'superpowers',
  );
  problems.push(...checkIndex(readFileSync(join(docsDir, 'README.md'), 'utf8'), docFiles, subdirs));

  for (const abs of walk(docsDir)) {
    const rel = relative(root, abs);
    if (!rel.endsWith('.md')) continue;
    if (rel.startsWith('docs/archive/') || rel.startsWith('docs/superpowers/')) continue;
    const text = readFileSync(abs, 'utf8');
    problems.push(...checkDocHeadings(rel, text));
    problems.push(...checkSpecReferences(rel, text, max));
  }

  for (const rel of ['CLAUDE.md', 'README.md', 'DESIGN.md']) {
    problems.push(...checkSpecReferences(rel, readFileSync(join(root, rel), 'utf8'), max));
  }
  problems.push(
    ...checkDesignHeadings('DESIGN.md', readFileSync(join(root, 'DESIGN.md'), 'utf8')),
    ...checkRoutingTable('CLAUDE.md', readFileSync(join(root, 'CLAUDE.md'), 'utf8'), exists),
  );

  const reads: EnvRead[] = [];
  for (const dir of ['src', 'evals', 'scripts', 'agent']) {
    for (const abs of walk(join(root, dir))) {
      if (!/\.(ts|tsx)$/.test(abs)) continue;
      const rel = relative(root, abs);
      const text = readFileSync(abs, 'utf8');
      problems.push(...checkSpecReferences(rel, text, max));
      reads.push(...envReads(rel, text));
    }
  }
  problems.push(...checkEnvExample(readFileSync(join(root, '.env.example'), 'utf8'), reads));
  return problems;
}

const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  /check-docs\.(ts|js|mjs)$/.test(process.argv[1]);

if (invokedDirectly) {
  const problems = runChecks();
  if (problems.length === 0) {
    console.log('docs:check ok');
  } else {
    for (const p of problems) {
      console.error(`${p.file}${p.line ? `:${p.line}` : ''}: ${p.message}`);
    }
    console.error(`docs:check found ${problems.length} problem(s)`);
    process.exit(1);
  }
}
