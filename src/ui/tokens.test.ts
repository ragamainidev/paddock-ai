import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The token contract (SPEC 18). Tailwind's palette is wiped in
 * `globals.css`, so an off-palette color class compiles to nothing and fails
 * silently in the browser — `bg-surface-raised` looks right in a diff and
 * paints no background. This walks every `.tsx` under `src/ui` and `src/app`
 * and asserts that each `bg-`/`text-`/`border-` class resolves to a token the
 * theme defines or to one of the structural utilities listed below.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Utilities on the same prefixes that set no color: border width and side,
// text alignment, table borders. Tailwind also keeps `transparent` and
// `current` as built-in keywords, outside the theme palette.
const NON_COLOR_UTILITIES = new Set([
  'bg-transparent',
  'border-b',
  'border-collapse',
  'border-dashed',
  'border-l',
  'border-l-2',
  'border-r',
  'border-t',
  'border-t-0',
  'border-transparent',
  'border-y',
  'text-center',
  'text-left',
  'text-right',
]);

// A class name, not a fragment of a longer one: `border-border-strong` must
// match once, at its start, never again at its inner hyphen.
const COLOR_CLASS = /(?<![\w-])(bg|text|border)-[a-z0-9-]+/g;
// Arbitrary values carry raw CSS (`[transition-property:border-color]`) and
// are exempt from the palette by construction.
const ARBITRARY = /\[[^\]]*\]/g;
// Classes only ever live in string or template literals; prose in a comment
// may name a token without using it.
const LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

function classText(source: string): string {
  return (source.match(LITERAL) ?? []).join(' ').replace(ARBITRARY, ' ');
}

function themeTokens(): Set<string> {
  const css = readFileSync(join(ROOT, 'src/app/globals.css'), 'utf8');
  const names = new Set<string>();
  for (const m of css.matchAll(/--color-([a-z0-9-]+):/g)) names.add(m[1]);
  return names;
}

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...tsxFiles(rel));
    else if (entry.name.endsWith('.tsx')) out.push(rel);
  }
  return out;
}

describe('DESIGN.md token contract', () => {
  const tokens = themeTokens();

  it('the theme defines the palette DESIGN.md names', () => {
    expect(tokens.has('surface')).toBe(true);
    expect(tokens.has('raised')).toBe(true);
    // The wipe (`--color-*: initial`) is not a token name.
    expect(tokens.has('*')).toBe(false);
  });

  it('every color class in src/ui and src/app resolves to a token', () => {
    const files = [...tsxFiles('src/ui'), ...tsxFiles('src/app')];
    expect(files.length).toBeGreaterThan(20);

    const unresolved: string[] = [];
    for (const file of files) {
      for (const m of classText(readFileSync(join(ROOT, file), 'utf8')).matchAll(COLOR_CLASS)) {
        const cls = m[0];
        const name = cls.slice(cls.indexOf('-') + 1);
        if (tokens.has(name) || NON_COLOR_UTILITIES.has(cls)) continue;
        unresolved.push(`${file}: ${cls}`);
      }
    }
    expect(unresolved).toEqual([]);
  });

  it('catches a class the palette does not define', () => {
    const source = '<div className="bg-surface-raised" />';
    const found = [...classText(source).matchAll(COLOR_CLASS)].map((m) => m[0]);
    expect(found).toEqual(['bg-surface-raised']);
    expect(tokens.has('surface-raised')).toBe(false);
  });
});
