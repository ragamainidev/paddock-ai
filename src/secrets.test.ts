import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * SPEC 17: secrets are server-side only. `pnpm docs:check` already proves
 * every literal environment read under `src/` names a variable declared in
 * `.env.example`; what it cannot see is WHERE the read happens. Next inlines a `NEXT_PUBLIC_`
 * variable into the browser bundle, and a `'use client'` module ships to
 * the browser whatever it reads — so this walks `src/` and asserts that no
 * such name exists and that every declared variable is read from server
 * code alone.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SRC, '..');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith('.test.ts')) return [];
    return [path];
  });
}

// A hit inside a comment is prose about the rule, not a use of it. Line
// comments and the continuation lines of a block comment cover every form
// this codebase writes.
function codeLines(source: string): string[] {
  return source.split('\n').map((line) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return '';
    const comment = line.indexOf('//');
    return comment === -1 ? line : line.slice(0, comment);
  });
}

const ENV_READ = /process\.env(?:\.([A-Z][A-Z0-9_]*)|\[['"]([A-Z][A-Z0-9_]*)['"]\])/g;

function envReads(source: string): Set<string> {
  const names = new Set<string>();
  for (const line of codeLines(source)) {
    for (const match of line.matchAll(ENV_READ)) names.add((match[1] ?? match[2]) as string);
  }
  return names;
}

// A module that ships to the browser: the directive, or anything under
// src/ui, which exists to be imported by one.
function isClientModule(path: string, source: string): boolean {
  if (relative(SRC, path).startsWith(`ui${sep}`)) return true;
  return /^\s*['"]use client['"]/.test(source);
}

function declaredVariables(): string[] {
  const raw = readFileSync(join(ROOT, '.env.example'), 'utf8');
  return [...raw.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
}

const files = sources(SRC).map((path) => ({
  path,
  rel: relative(ROOT, path),
  source: readFileSync(path, 'utf8'),
}));

describe('secrets are server-side only', () => {
  it('walks the whole of src', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('no NEXT_PUBLIC_ name exists outside a comment', () => {
    const offenders = files
      .filter((file) => codeLines(file.source).some((line) => line.includes('NEXT_PUBLIC_')))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('every variable in .env.example is read from server code alone', () => {
    const declared = new Set(declaredVariables());
    expect(declared.size).toBeGreaterThan(10);

    const leaks: string[] = [];
    for (const file of files) {
      if (!isClientModule(file.path, file.source)) continue;
      for (const name of envReads(file.source)) {
        if (declared.has(name)) leaks.push(`${file.rel} reads ${name}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it('no client module reaches for process.env at all', () => {
    // Stricter than the rule above on purpose: an undeclared read in a
    // client module is a leak waiting for a name.
    const readers = files
      .filter((file) => isClientModule(file.path, file.source) && envReads(file.source).size > 0)
      .map((file) => file.rel);
    expect(readers).toEqual([]);
  });

  it('catches a client component that reads a secret', () => {
    const client = `'use client';\nconst key = process.env.ANTHROPIC_API_KEY;\n`;
    expect(isClientModule(join(SRC, 'app', 'made-up.tsx'), client)).toBe(true);
    expect(envReads(client).has('ANTHROPIC_API_KEY')).toBe(true);
    // …and does not count the same name written in prose.
    expect(envReads('// process.env.ANTHROPIC_API_KEY is read on the server\n').size).toBe(0);
  });
});
