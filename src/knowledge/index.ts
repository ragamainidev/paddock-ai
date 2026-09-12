import { CHASSIS } from './chassis';
import { ENGINES } from './engines';
import { MAKE_WORDS, MODEL_WORDS } from './models';
import type { ChassisEntry, EngineEntry, ModelWord, VariantEntry } from './types';
import { VARIANTS } from './variants';

function norm(token: string): string {
  return token.trim().toLowerCase();
}

// Multiple entries can share a code (C7, Mk4, R32). Returning all of them is
// the point: the interpreter turns multi-hit lookups into an ambiguity fork.
export function lookupChassis(token: string): ChassisEntry[] {
  const t = norm(token);
  return CHASSIS.filter((c) => c.code.toLowerCase() === t || (c.aliases ?? []).includes(t));
}

export function lookupEngine(token: string): EngineEntry | undefined {
  const t = norm(token);
  return ENGINES.find((e) => e.code.toLowerCase() === t || (e.aliases ?? []).includes(t));
}

export function lookupVariant(token: string): VariantEntry | undefined {
  const t = norm(token);
  return VARIANTS.find((v) => v.term.toLowerCase() === t || (v.aliases ?? []).includes(t));
}

export function lookupModelWord(token: string): ModelWord | undefined {
  const t = norm(token);
  return MODEL_WORDS.find((m) => m.token === t || (m.aliases ?? []).includes(t));
}

export function lookupMake(token: string): string | undefined {
  return MAKE_WORDS[norm(token)];
}

export { CHASSIS, ENGINES, MAKE_WORDS, MODEL_WORDS, VARIANTS };
export type { ChassisEntry, EngineEntry, ModelWord, VariantEntry };
