/**
 * Evidence narrowing: what a cited price is allowed to do to a curated
 * repair line (SPEC 44). Screening comes first — an off-spec variant's
 * part, an aftermarket piece, a comparison figure, a warranty, a structure
 * part filed under a panels line, or a duplicate is set aside with its
 * reason and kept as a citation, never summed. What survives raises a
 * line's floor and, when it prices the whole line, its expected value.
 * Nothing here lowers a curated number, and a parts sum cannot lift a line
 * past 1.5x its curated high.
 */

import { usd } from '@/lib/money';
import { add } from './programs';
import type { PriceEvidence, RepairLine, RepairPlan, SalvageLot } from './types';
import { NOT_THIS_REPAIR, offSpec } from './variants';

// A cited price that cannot narrow this line on this car: an off-spec
// variant's part, an aftermarket piece, a comparison figure from another
// model, a warranty or service contract, a structure part filed under a
// panels line, or a duplicate of an item already counted. Each is set
// aside with its reason and kept as a citation, never summed.
export function screenPriceEvidence(
  prices: PriceEvidence[],
  lineId: string,
  lot?: SalvageLot,
): { kept: PriceEvidence[]; setAside: { item: PriceEvidence; reason: string }[] } {
  const kept: PriceEvidence[] = [];
  const setAside: { item: PriceEvidence; reason: string }[] = [];
  const seen = new Set<string>();
  for (const e of prices) {
    const text = `${e.item} ${e.note ?? ''}`;
    const key = e.item
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    if (lot && offSpec(text, lot)) {
      setAside.push({ item: e, reason: 'off-spec variant: not this car' });
    } else if (NOT_THIS_REPAIR.test(text)) {
      setAside.push({
        item: e,
        reason: 'aftermarket, comparison, or warranty figure: not a price for this repair',
      });
    } else if (!/\.structure$/.test(lineId) && STRUCTURE_WORDS.test(e.item)) {
      setAside.push({ item: e, reason: 'a structure part: belongs to the structural line' });
    } else if (seen.has(key)) {
      setAside.push({ item: e, reason: 'duplicate of an item already counted' });
    } else {
      seen.add(key);
      kept.push(e);
    }
  }
  return { kept, setAside };
}

const STRUCTURE_WORDS =
  /\b(frame|chassis|rail|subframe|crash structure|crash box|monocoque|tub)\b/i;

// Cited prices raise a line's floor and, when they price the whole line
// (a job quote, or a full set of parts), its expected value. Nothing here
// lowers a curated number: a used-parts ask proves a job can be done for
// less, not that it will be. A parts sum may lift the expected value to at
// most 1.5× the curated high; beyond that the sum is suspect and the line
// says so.
const CITED_SUM_CAP = 1.5;

export function applyPriceEvidence(
  plan: RepairPlan,
  prices: PriceEvidence[],
  lot?: SalvageLot,
): { plan: RepairPlan; notes: string[] } {
  const notes: string[] = [];
  const byLine = new Map<string, PriceEvidence[]>();
  for (const p of prices) byLine.set(p.line, [...(byLine.get(p.line) ?? []), p]);

  const rewrite = (line: RepairLine): RepairLine => {
    const all = byLine.get(line.id);
    if (!all || all.length === 0) return line;
    const { kept, setAside } = screenPriceEvidence(all, line.id, lot);
    for (const s of setAside) {
      notes.push(`${line.id}: set aside "${s.item.item}" (${s.item.source}): ${s.reason}`);
    }
    const citations = all.map((e) => ({ url: e.url, title: e.item }));
    if (kept.length === 0) {
      return {
        ...line,
        basis: `${line.basis}; cited prices set aside (${[...new Set(setAside.map((s) => s.reason))].join('; ')})`,
        citations,
      };
    }
    const quotes = kept.filter((e) => e.kind === 'job_quote');
    const parts = kept.filter((e) => e.kind !== 'job_quote');
    let { low, expected, high } = line;
    let capped = false;
    if (quotes.length > 0) {
      const qLow = Math.min(...quotes.map((q) => q.low));
      const qHigh = Math.max(...quotes.map((q) => q.high));
      const qMid = Math.round((qLow + qHigh) / 2);
      low = Math.max(low, qLow);
      expected = Math.max(expected, qMid);
      high = Math.max(high, qHigh);
    }
    if (parts.length > 0) {
      const pLow = parts.reduce((s, e) => s + e.low, 0);
      const pHigh = parts.reduce((s, e) => s + e.high, 0);
      const cap = Math.round(line.high * CITED_SUM_CAP);
      const sumLow = Math.min(pLow, cap);
      const sumMid = Math.min(Math.round((pLow + pHigh) / 2), cap);
      capped = pLow > cap || (pLow + pHigh) / 2 > cap;
      low = Math.max(low, sumLow);
      expected = Math.max(expected, sumMid);
      high = Math.max(high, Math.round(Math.min(pHigh, cap) * 1.1)); // parts alone; consumables and the odd broken clip
    }
    const hosts = [...new Set(kept.map((e) => e.source))].join(', ');
    if (low === line.low && expected === line.expected && high === line.high) {
      // Below the curated floor: the citation is kept on the line for the
      // reader, the numbers stand.
      return {
        ...line,
        basis: `${line.basis}; cited prices (${hosts}) sit under the curated floor`,
        citations,
      };
    }
    expected = Math.max(low, Math.min(expected, high));
    notes.push(
      `${line.task} (${line.id}): ${usd(line.expected)} → ${usd(expected)} expected, floor ${usd(low)}, from ${kept.length} cited price${kept.length === 1 ? '' : 's'} (${hosts})${capped ? `; the cited sum exceeds ${CITED_SUM_CAP}× the curated high and is capped there` : ''}`,
    );
    // The professional price is the same task bought from a shop: the same
    // parts plus the same hours at the tier's rate, so a cited price that
    // raises the parts raises it by exactly as much.
    const shopLabor = line.pro.low - line.low;
    return {
      ...line,
      low,
      expected,
      high,
      pro: { low: low + shopLabor, expected: expected + shopLabor, high: high + shopLabor },
      evidence: 'cited',
      basis: `cited: ${hosts}; curated ${line.basis.replace(/^curated: /, '')} beneath${capped ? `; cited sum capped at ${CITED_SUM_CAP}× the curated high` : ''}`,
      citations,
    };
  };

  const programs = plan.programs.map((pr) => ({ ...pr, lines: pr.lines.map(rewrite) }));
  const lines = programs.flatMap((pr) => pr.lines);
  const total = add(...lines);
  return {
    plan: { ...plan, programs, lines, low: total.low, expected: total.expected, high: total.high },
    notes,
  };
}
