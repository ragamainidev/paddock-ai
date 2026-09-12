import { likeToRegex } from '@/lib/like';
import type { Constraint } from '@/lib/types';

// Explicit spelling/family aliases observed in DOE/EPA vehicles.csv. These
// operate on identity only: source model strings remain unchanged, suffixes
// do not imply trim/engine fitment, and a space boundary keeps M3 from M340i.
// Apply only to EPA-format catalogs, including user-supplied EPA files.
// Wildcard aliases are explicit curated spellings, not general prefix expansion.
const FAMILIES: Record<string, Record<string, string[]>> = {
  porsche: {
    '911': ['911', 'New 911', 'Turbo 2 911', 'Turbo 4 911', 'Carrera 2 911'],
    '928': ['928'],
  },
  bmw: Object.fromEntries(
    ['M3', 'M4', 'M5', 'M6', 'M8', 'Z3', 'Z4'].map((name) => [name.toLowerCase(), [name]]),
  ),
  audi: {
    r8: ['R8'],
    rs5: ['RS 5'],
    'rs5%': ['RS 5'],
    rs7: ['RS 7'],
    'rs7%': ['RS 7'],
    tts: ['TTS'],
  },
  lexus: { sc300: ['SC 300'], sc400: ['SC 400'], is300: ['IS 300'] },
  toyota: { gr86: ['GR 86'] },
  infiniti: { fx35: ['FX35'] },
  ford: { 'f-150': ['F150', 'F-150'], f150: ['F150', 'F-150'] },
  honda: { crx: ['Civic CRX'] },
  mitsubishi: { '3000gt': ['3000 GT'] },
  volkswagen: { passat: ['Passat'], beetle: ['Beetle'] },
  kia: { stinger: ['Stinger'] },
  lamborghini: { gallardo: ['Gallardo'] },
};
const COMBINED: Record<string, string[]> = {
  sc300: ['SC 300/SC 400', 'SC 300/SC 430'],
  sc400: ['SC 300/SC 400'],
};
function aliases(
  make: string | undefined,
  pattern: string,
): { matched: string[]; unknown: string[] } {
  const maker = make?.toLowerCase() ?? '';
  const canonical = pattern.toLowerCase();
  const family = Object.hasOwn(FAMILIES, maker) ? FAMILIES[maker] : undefined;
  const names = family && Object.hasOwn(family, canonical) ? family[canonical] : [];
  return {
    matched: names.flatMap((name) => [name, `${name} %`]),
    unknown: maker === 'lexus' && Object.hasOwn(COMBINED, canonical) ? COMBINED[canonical] : [],
  };
}
export function catalogModelState(
  make: string,
  model: string,
  patterns: string[],
): 'matched' | 'unknown' | 'contradicted' {
  if (patterns.some((pattern) => likeToRegex(pattern).test(model))) return 'matched';
  const expanded = patterns.map((pattern) => aliases(make, pattern));
  if (expanded.some((alias) => alias.matched.some((pattern) => likeToRegex(pattern).test(model))))
    return 'matched';
  if (expanded.some((alias) => alias.unknown.some((pattern) => likeToRegex(pattern).test(model))))
    return 'unknown';
  return 'contradicted';
}
function expand(make: string | undefined, patterns: string[] | undefined): string[] | undefined {
  return (
    patterns && [
      ...new Set(
        patterns.flatMap((pattern) => {
          const alias = aliases(make, pattern);
          return [pattern, ...alias.matched, ...alias.unknown];
        }),
      ),
    ]
  );
}
export function withCatalogModelAliases(c: Constraint): Constraint {
  return {
    ...c,
    models: expand(c.make, c.models),
    anyOf: c.anyOf?.map((f) => ({ ...f, models: expand(f.make ?? c.make, f.models) })),
  };
}
