/**
 * The exit: what this car sells for once it is rebuilt and road-registered,
 * selected from classified comps (SPEC 38). Pure and deterministic — comps
 * arrive typed (lane, outcome, price, year, date, title, variant) and the
 * selection strikes what does not belong, states why, and derives a
 * low/typical/high band from quartiles of what remains. Nothing here parses
 * prose; a comp without a price never reached this module.
 *
 * Also owns the wreck-market summary: what lots like this hammer for,
 * shown as context beside the ceiling and never used to compute it.
 */

import { usd } from '@/lib/money';
import type { Comp, CompUse, ExitEstimate, SalvageLot, WreckMarket } from './types';
import { effectiveLane, offSpec as offSpecText } from './variants';

export type ExitOptions = {
  discount: { low: number; high: number; basis: string }; // rebuilt vs clean sold, tier band
  askHaircut: number; // asks → transacted money, e.g. 0.07
  now?: Date;
};

const YEAR_WINDOW = 2;
const STALE_MONTHS = 24;
const REBUILT_CAP_VS_CLEAN = 0.85; // rebuilt "sold" at clean money is not rebuilt data
const OUTLIER_SIGMAS = 3;
const MIN_POOL_FOR_MAD = 4;
const HARD_HIGH = 2.5; // vs median, regardless of MAD
const HARD_LOW = 0.4;

// -- Statistics ------------------------------------------------------------------

export function quartiles(values: number[]): { p25: number; median: number; p75: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => {
    if (sorted.length === 1) return sorted[0];
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  };
  return { p25: at(0.25), median: at(0.5), p75: at(0.75) };
}

const median = (values: number[]) => quartiles(values).median;

// -- Comp hygiene ------------------------------------------------------------------

function monthsBetween(iso: string, now: Date): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
}

function offSpec(comp: Comp, lot: SalvageLot): boolean {
  return offSpecText(`${comp.variant ?? ''} ${comp.note ?? ''}`, lot);
}

// Strike everything that is not this car at transacted money, in the order
// a reader would apply the rules; the first reason that fires is the one
// shown.
function annotate(
  comps: Comp[],
  lot: SalvageLot,
  opts: ExitOptions,
  accept: (c: Comp) => string | null, // null = eligible, string = struck reason
): CompUse[] {
  const now = opts.now ?? new Date();
  const uses: CompUse[] = comps.map((comp) => {
    const gate = accept(comp);
    if (gate) return { comp, used: false, adjusted: comp.price, reason: gate };
    if (comp.year !== undefined && Math.abs(comp.year - lot.year) > YEAR_WINDOW) {
      return {
        comp,
        used: false,
        adjusted: comp.price,
        reason: `model year ${comp.year} is outside the ${lot.year - YEAR_WINDOW}–${lot.year + YEAR_WINDOW} window`,
      };
    }
    if (offSpec(comp, lot)) {
      return {
        comp,
        used: false,
        adjusted: comp.price,
        reason: `off-spec variant (${comp.variant ?? comp.note}): a different car from this lot`,
      };
    }
    if (comp.date) {
      const months = monthsBetween(comp.date, now);
      if (months !== null && months > STALE_MONTHS) {
        return {
          comp,
          used: false,
          adjusted: comp.price,
          reason: `stale: ${Math.round(months)} months old, exotic prices moved since`,
        };
      }
    }
    if (comp.outcome === 'ask') {
      const adjusted = Math.round(comp.price * (1 - opts.askHaircut));
      return {
        comp,
        used: true,
        adjusted,
        reason: `ask haircut ${Math.round(opts.askHaircut * 100)}% to transacted money`,
      };
    }
    return { comp, used: true, adjusted: comp.price };
  });
  return strikeOutliers(uses);
}

// A market band has a shape. With four or more comps, anything beyond three
// robust sigmas of the median is not this market (the special-series ask,
// the typo); with fewer, only the hard bounds apply.
function strikeOutliers(uses: CompUse[]): CompUse[] {
  const pool = uses.filter((u) => u.used).map((u) => u.adjusted);
  if (pool.length < 2) return uses;
  const m = median(pool);
  const mad = median(pool.map((x) => Math.abs(x - m))) * 1.4826;
  return uses.map((u) => {
    if (!u.used) return u;
    const ratio = u.adjusted / m;
    const hard = ratio > HARD_HIGH || ratio < HARD_LOW;
    const soft =
      pool.length >= MIN_POOL_FOR_MAD &&
      mad > 0 &&
      Math.abs(u.adjusted - m) > OUTLIER_SIGMAS * mad &&
      Math.abs(ratio - 1) > 0.15; // never strike a comp within 15% of the median
    if (!hard && !soft) return u;
    return {
      ...u,
      used: false,
      reason: `outlier: ${usd(u.adjusted)} against a ${usd(m)} median for the pool`,
    };
  });
}

type Band = { low: number; typical: number; high: number; n: number; thin: boolean };

function bandOf(values: number[]): Band | null {
  if (values.length === 0) return null;
  if (values.length === 1) {
    return {
      low: Math.round(values[0] * 0.9),
      typical: values[0],
      high: Math.round(values[0] * 1.05),
      n: 1,
      thin: true,
    };
  }
  if (values.length === 2) {
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    return {
      low: Math.round(lo * 0.97),
      typical: Math.round((lo + hi) / 2),
      high: hi,
      n: 2,
      thin: true,
    };
  }
  // Quartiles beyond ±35% of the median mean the pool mixes specs or
  // vintages the strikes did not catch; the band is clamped there so one
  // straggler cannot stretch an exit.
  const q = quartiles(values);
  return {
    low: Math.round(Math.max(q.p25, q.median * 0.7)),
    typical: Math.round(q.median),
    high: Math.round(Math.min(q.p75, q.median * 1.4)),
    n: values.length,
    thin: false,
  };
}

const usedValues = (uses: CompUse[]) => uses.filter((u) => u.used).map((u) => u.adjusted);

const hostsOf = (uses: CompUse[]) =>
  [...new Set(uses.filter((u) => u.used).map((u) => u.comp.source))].join(', ');

// -- The exit ----------------------------------------------------------------------

export function selectExit(comps: Comp[], lot: SalvageLot, opts: ExitOptions): ExitEstimate | null {
  const d = opts.discount;
  const dMid = (d.low + d.high) / 2;
  const discountLabel = `${Math.round(d.low * 100)}–${Math.round(d.high * 100)}% of clean`;

  // Lanes are what the evidence IS, not what the worker echoed: a
  // salvage-auction listing filed as "rebuilt sold" is wreck evidence.
  const laned = comps.map((c) => ({ ...c, lane: effectiveLane(c) }));
  // Clean money: sold first, asks as the fallback rung. A branded title in
  // the clean lane is not clean money; it joins the rebuilt pool instead.
  const cleanLane = laned.filter((c) => c.lane === 'clean');
  const branded = (c: Comp) => c.title === 'rebuilt' || c.title === 'salvage';
  const cleanSold = annotate(cleanLane, lot, opts, (c) =>
    branded(c)
      ? 'branded title: rebuilt evidence, not clean money'
      : c.outcome === 'sold'
        ? null
        : c.outcome === 'ask'
          ? 'ask: sold comps anchor this band'
          : 'a bid that did not sell is not a price',
  );
  const soldOnlyBand = bandOf(usedValues(cleanSold));
  // Fewer than three sold comps is a thin band; haircut asks join the pool
  // so two disparate sales cannot span the exit on their own. With no sold
  // comps at all the pool is asks alone (the ask rung).
  const soldCount = soldOnlyBand?.n ?? 0;
  const cleanMixed =
    soldCount >= 3
      ? null
      : annotate(cleanLane, lot, opts, (c) =>
          branded(c)
            ? 'branded title: rebuilt evidence, not clean money'
            : c.outcome === 'ask' || c.outcome === 'sold'
              ? null
              : 'a bid that did not sell is not a price',
        );
  const mixedBand = cleanMixed ? bandOf(usedValues(cleanMixed)) : null;
  const useMixed = Boolean(mixedBand && (!soldOnlyBand || mixedBand.n > soldOnlyBand.n));
  const cleanUses = useMixed ? cleanMixed! : cleanSold;
  const cleanBand = useMixed ? mixedBand : soldOnlyBand;
  const askCount = cleanUses.filter((u) => u.used && u.comp.outcome === 'ask').length;
  const soldUsed = cleanUses.filter((u) => u.used && u.comp.outcome === 'sold').length;
  const cleanAskBand = soldUsed > 0 ? null : cleanBand;
  const cleanAsks = soldUsed > 0 ? null : cleanUses;

  // Rebuilt money: the model's own branded-title sales, when they exist.
  const rebuiltPool = [...laned.filter((c) => c.lane === 'rebuilt'), ...cleanLane.filter(branded)];
  const rebuilt = annotate(rebuiltPool, lot, opts, (c) =>
    c.outcome === 'sold' ? null : 'rebuilt asks and no-sale bids do not anchor the exit',
  );
  const rebuiltBand = bandOf(usedValues(rebuilt));

  const table = (...groups: (CompUse[] | null)[]) => groups.flatMap((g) => g ?? []);

  if (rebuiltBand && rebuiltBand.n >= 2) {
    let { low, typical, high } = rebuiltBand;
    let capNote = '';
    if (cleanBand && typical > cleanBand.typical * REBUILT_CAP_VS_CLEAN) {
      const cap = Math.round(cleanBand.typical * REBUILT_CAP_VS_CLEAN);
      const scale = cap / typical;
      low = Math.round(low * scale);
      high = Math.round(high * scale);
      typical = cap;
      capNote = `; capped at ${Math.round(REBUILT_CAP_VS_CLEAN * 100)}% of clean money (${usd(cleanBand.typical)}): rebuilt sales at clean prices are not rebuilt data`;
    }
    return {
      low,
      typical,
      high,
      lane: 'rebuilt_sold',
      n: rebuiltBand.n,
      thin: rebuiltBand.thin,
      basis: `${rebuiltBand.n} rebuilt-title sold comp${rebuiltBand.n === 1 ? '' : 's'} (${hostsOf(rebuilt)})${rebuiltBand.thin ? '; thin, band widened' : ''}${capNote}`,
      comps: table(rebuilt, cleanSold, cleanAsks),
    };
  }

  if (cleanBand) {
    const fromAsks = cleanBand === cleanAskBand;
    const uses = cleanUses;
    const what = fromAsks
      ? `${cleanBand.n} clean ask comp${cleanBand.n === 1 ? '' : 's'}`
      : askCount > 0
        ? `${soldUsed} clean sold + ${askCount} haircut ask comps (sold pool under three)`
        : `${cleanBand.n} clean sold comp${cleanBand.n === 1 ? '' : 's'}`;
    return {
      low: Math.round(cleanBand.low * d.low),
      typical: Math.round(cleanBand.typical * dMid),
      high: Math.round(cleanBand.high * d.high),
      lane: fromAsks ? 'clean_ask_derived' : 'clean_sold_derived',
      n: cleanBand.n,
      thin: cleanBand.thin,
      discount: d,
      basis: `derived: ${discountLabel} of ${what} (${hostsOf(uses)}; ${usd(cleanBand.low)}–${usd(cleanBand.high)}, typical ${usd(cleanBand.typical)}${askCount > 0 || fromAsks ? `, asks after a ${Math.round(opts.askHaircut * 100)}% haircut` : ''})${cleanBand.thin ? '; thin, band widened' : ''}; ${d.basis}`,
      comps: table(uses, rebuilt),
    };
  }

  if (lot.estRetailValue) {
    return {
      low: Math.round(lot.estRetailValue * d.low),
      typical: Math.round(lot.estRetailValue * dMid),
      high: Math.round(lot.estRetailValue * d.high),
      lane: 'acv_derived',
      n: 0,
      thin: true,
      discount: d,
      basis: `derived: ${discountLabel} of the listing's stated ACV (${usd(lot.estRetailValue)}); no comps survived selection; ${d.basis}`,
      comps: table(cleanSold, cleanAsks, rebuilt),
    };
  }
  return null;
}

// -- The wreck market ---------------------------------------------------------------

export function summarizeWreckMarket(
  comps: Comp[],
  lot: SalvageLot,
  ctx: { cleanTypical?: number; now?: Date },
): WreckMarket | null {
  const wreck = comps.filter((c) => effectiveLane(c) === 'wreck');
  if (wreck.length === 0) return null;
  const now = ctx.now ?? new Date();
  const uses: CompUse[] = wreck.map((comp) => {
    if (comp.price < 1000) {
      return { comp, used: false, adjusted: comp.price, reason: 'pocket change: not a hammer' };
    }
    if (ctx.cleanTypical && comp.price >= ctx.cleanTypical * 0.9) {
      return {
        comp,
        used: false,
        adjusted: comp.price,
        reason: `clean money in the wreck lane (${usd(comp.price)} against ${usd(ctx.cleanTypical)} clean typical)`,
      };
    }
    if (comp.year !== undefined && Math.abs(comp.year - lot.year) > YEAR_WINDOW + 1) {
      return {
        comp,
        used: false,
        adjusted: comp.price,
        reason: `model year ${comp.year} is too far from ${lot.year}`,
      };
    }
    if (comp.date) {
      const months = monthsBetween(comp.date, now);
      if (months !== null && months > STALE_MONTHS + 12) {
        return {
          comp,
          used: false,
          adjusted: comp.price,
          reason: `stale: ${Math.round(months)} months old`,
        };
      }
    }
    return { comp, used: true, adjusted: comp.price };
  });
  const used = uses.filter((u) => u.used);
  if (used.length === 0) return null;
  const values = used.map((u) => u.adjusted);
  const nSold = used.filter((u) => u.comp.outcome === 'sold').length;
  const nBids = used.filter((u) => u.comp.outcome === 'bid_no_sale').length;
  const nAsks = used.length - nSold - nBids;
  const parts = [
    nSold ? `${nSold} sold` : '',
    nBids ? `${nBids} high bid${nBids === 1 ? '' : 's'} that did not sell` : '',
    nAsks ? `${nAsks} ask${nAsks === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return {
    low: Math.min(...values),
    median: Math.round(median(values)),
    high: Math.max(...values),
    n: used.length,
    nSold,
    basis: `${parts.join(', ')} for wrecked ${lot.make} ${lot.model}s (${hostsOf(used)}); context, not a verdict input`,
    comps: uses,
  };
}
