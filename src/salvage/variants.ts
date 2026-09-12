/**
 * Shared "is this the same car" rules for evidence hygiene: body/spec words
 * that make a comp or a part a different car from a base coupe, the
 * salvage-auction hosts whose listings are wreck-market evidence whatever
 * lane a worker filed them under, and the words that mark a price as not a
 * price for this repair (aftermarket, comparison figures, warranties).
 */

import type { Comp, CompLane, SalvageLot } from './types';

// A comp or part carrying one of these is struck unless the lot itself
// carries it.
export const OFF_SPEC =
  /\b(spider|spyder|gts|aperta|roadster|convertible|cabrio(?:let)?|assetto\s*fiorano|performante|sto|tecnica|speciale|pista|competizione|xx|gt3|gt2|turbo\s*s|black\s*series|challenge|gt4)\b/i;

// "SF90XX" carries no word boundary before the XX; the special-series
// suffix is checked on its own.
const XX_SUFFIX = /\d\s*(xx)\b/i;

export function offSpec(text: string, lot: SalvageLot): boolean {
  const hit = OFF_SPEC.exec(text)?.[0] ?? XX_SUFFIX.exec(text)?.[1];
  if (!hit) return false;
  const lotText = `${lot.model} ${lot.title}`;
  return !new RegExp(`(\\b|\\d)${hit.replace(/\s+/g, '\\s*')}\\b`, 'i').test(lotText);
}

// Salvage-auction results and their aggregators: a listing from one of
// these is what wrecks trade for, never a finished car's exit.
export const SALVAGE_HOSTS =
  /(^|\.)(autoastat\.com|bid\.cars|bidfax\.info|copart\.com|iaai\.com|salvagebid\.com|poctra\.com|carsfromwest\.com|autobidmaster\.com|abetter\.bid|sca\.auction|erepairables\.com|carfast\.express|salvagereseller\.com|salvageautosauction\.com|ridesafely\.com|stat\.vin|a-better-bid\.com)$/i;

const SALVAGE_WORDS =
  /\b(copart|iaai|salvage[- ]auction|lot\s*#?\d{6,}|certificate of destruction)\b/i;

// The lane the evidence belongs to, whatever the worker echoed: a
// salvage-auction listing is wreck evidence. (A branded title in the clean
// lane is handled by the exit selection, which strikes it with a reason.)
export function effectiveLane(comp: Comp): CompLane {
  if (comp.lane === 'wreck') return 'wreck';
  if (
    SALVAGE_HOSTS.test(comp.source) ||
    SALVAGE_WORDS.test(comp.note ?? '') ||
    comp.title === 'salvage' ||
    Boolean(comp.damage)
  ) {
    return 'wreck';
  }
  return comp.lane;
}

// A cited price that is not a price for this repair on this car.
export const NOT_THIS_REPAIR =
  /\b(aftermarket|novitec|mansory|capristo|vorsteiner|comparison|for reference|reference only|warranty|service contract|extended coverage|maintenance plan|subscription)\b/i;
