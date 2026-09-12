/**
 * Auction-side fees for a buyer paying secured funds for a non-clean-title
 * lot: the Copart buyer fee, the virtual bid fee, and the broker's cut all
 * scale with the bid, so they are solved together with it
 * (`src/salvage/ceiling.ts`); the gate, environmental, title-mailing, and
 * Copart broker fees are flat. `access` selects the fee mode — a public
 * (non-licensed) buyer bids through a broker and pays for it twice, in the
 * broker's percentage and in Copart's own per-vehicle broker charge, while a
 * licensed buyer pays neither. Broker is the default, so a caller that
 * states no mode gets the public-buyer schedule. The schedule is reproduced
 * from a licensed broker's help center and an independently maintained
 * calculator, cross-checked 2026-08-17 (docs/salvage-economics.md §5);
 * Copart revises it, and every line carries the date so the reader knows how
 * stale the basis is (SPEC 36).
 */

import type { BuyerAccess, CostLine } from './types';

export const FEES_SCHEDULE_DATE = '2026-08-17';

// Non-clean title, secured funds: bracket ceiling → flat buyer fee. Above
// the last bracket Copart charges 7.5% of the hammer, uncapped.
const BUYER_FEE_TIERS: [number, number][] = [
  [49.99, 25],
  [99.99, 45],
  [199.99, 80],
  [299.99, 130],
  [349.99, 137.5],
  [399.99, 145],
  [449.99, 175],
  [499.99, 185],
  [549.99, 205],
  [599.99, 210],
  [699.99, 240],
  [799.99, 270],
  [899.99, 295],
  [999.99, 320],
  [1199.99, 375],
  [1299.99, 395],
  [1399.99, 410],
  [1499.99, 430],
  [1599.99, 445],
  [1699.99, 465],
  [1799.99, 485],
  [1999.99, 510],
  [2399.99, 535],
  [2499.99, 570],
  [2999.99, 610],
  [3499.99, 655],
  [3999.99, 705],
  [4499.99, 725],
  [4999.99, 750],
  [5499.99, 775],
  [5999.99, 800],
  [6499.99, 825],
  [6999.99, 845],
  [7499.99, 880],
  [7999.99, 900],
  [8499.99, 925],
  [9999.99, 945],
  [14999.99, 1000],
];
const BUYER_FEE_PCT_ABOVE = 0.075;

export function copartBuyerFee(bid: number): number {
  if (bid <= 0) return 0;
  for (const [ceiling, fee] of BUYER_FEE_TIERS) {
    if (bid <= ceiling) return Math.round(fee);
  }
  return Math.round(bid * BUYER_FEE_PCT_ABOVE);
}

// Virtual (internet) bid fee, non-clean title, live-bid column.
const VIRTUAL_BID_TIERS: [number, number][] = [
  [99.99, 0],
  [499.99, 50],
  [999.99, 65],
  [1499.99, 85],
  [1999.99, 95],
  [3999.99, 110],
  [5999.99, 125],
  [7999.99, 145],
];
const VIRTUAL_BID_TOP = 160;

export function virtualBidFee(bid: number): number {
  if (bid <= 0) return 0;
  for (const [ceiling, fee] of VIRTUAL_BID_TIERS) {
    if (bid <= ceiling) return fee;
  }
  return VIRTUAL_BID_TOP;
}

// Non-dealer buyers bid through a broker. The large brokers charge a
// percentage of the purchase price with a floor (AutoBidMaster premium:
// greater of $150 or 4%; SalvageBid VIP 3–4%); flat-fee brokers exist and
// the difference is first-order on a six-figure lot, so the flat case is a
// sensitivity row, not the expectation.
export const BROKER_PCT_EXPECTED = 0.04;
export const BROKER_PCT_HIGH = 0.06;
export const BROKER_FLAT = 350; // a flat-fee broker's own service fee, typical

export function brokerFee(bid: number, pct = BROKER_PCT_EXPECTED): number {
  if (bid <= 0) return 0;
  return Math.round(Math.max(150, bid * pct));
}

// How a bidder reaches the auction, and what the broker charges when one is
// in the way. A bare number in the options position is the broker
// percentage, which is how the solver's scenarios state a flat-fee broker.
export type FeeOptions = { access?: BuyerAccess; brokerPct?: number };

function feeMode(options: number | FeeOptions): Required<FeeOptions> {
  const stated = typeof options === 'number' ? { brokerPct: options } : options;
  return { access: stated.access ?? 'broker', brokerPct: stated.brokerPct ?? BROKER_PCT_EXPECTED };
}

// Every fee that moves with the bid, at one bid: what the solver adds to
// the hammer at each step of the search.
export function bidDependentFees(bid: number, options: number | FeeOptions = {}): number {
  const { access, brokerPct } = feeMode(options);
  const broker = access === 'direct' ? 0 : brokerFee(bid, brokerPct);
  return copartBuyerFee(bid) + virtualBidFee(bid) + broker;
}

const GATE_FEE = 95; // non-clean title
const ENVIRONMENTAL_FEE = 15;
const TITLE_MAILING_FEE = 20;
const COPART_BROKER_FEE = 100; // Copart's own per-vehicle broker charge, passed through

const SCHEDULE_BASIS = `Copart US fee schedule (public buyer, non-clean title, secured funds), reproduced from a licensed broker's help center, as of ${FEES_SCHEDULE_DATE}; estimate`;
const DIRECT_BASIS = "licensed buyer pays Copart's schedule directly; no broker";

// The bid-independent auction fees. A licensed buyer needs no broker, so
// Copart's per-vehicle broker charge leaves the flat total with the broker.
export function fixedFeeLines(options: FeeOptions = {}): CostLine[] {
  const direct = feeMode(options).access === 'direct';
  const flat = GATE_FEE + ENVIRONMENTAL_FEE + TITLE_MAILING_FEE + (direct ? 0 : COPART_BROKER_FEE);
  return [
    {
      id: 'fees.fixed',
      label: `gate + environmental + title mailing${direct ? '' : ' + Copart broker charge'}`,
      group: 'fees',
      low: flat,
      expected: flat,
      high: flat,
      basis: direct ? `${SCHEDULE_BASIS}; ${DIRECT_BASIS}` : SCHEDULE_BASIS,
      evidence: 'schedule',
    },
  ];
}

// The bid-dependent fee lines, rendered at one bid (the ceiling). A direct
// buyer's list is the auction's own lines and nothing else.
export function bidFeeLines(bid: number, options: FeeOptions = {}): CostLine[] {
  const { access, brokerPct } = feeMode(options);
  const at = bid > 0 ? `at a $${bid.toLocaleString('en-US')} bid` : 'at no bid';
  return [
    {
      id: 'fees.buyer',
      label: 'copart buyer fee',
      group: 'fees',
      low: copartBuyerFee(bid),
      expected: copartBuyerFee(bid),
      high: copartBuyerFee(bid),
      basis: `${SCHEDULE_BASIS}; 7.5% of the hammer above $15,000, uncapped; ${at}`,
      evidence: 'schedule',
      bidDependent: true,
    },
    {
      id: 'fees.virtual',
      label: 'virtual bid fee (live)',
      group: 'fees',
      low: virtualBidFee(bid),
      expected: virtualBidFee(bid),
      high: virtualBidFee(bid),
      basis: `${SCHEDULE_BASIS}; ${at}`,
      evidence: 'schedule',
      bidDependent: true,
    },
    ...(access === 'direct'
      ? []
      : [
          {
            id: 'fees.broker',
            label: `broker fee (${Math.round(brokerPct * 100)}% of the bid)`,
            group: 'fees' as const,
            low: bid > 0 ? BROKER_FLAT : 0,
            expected: brokerFee(bid, brokerPct),
            // The high case is the top of the published band, never under
            // the percentage the caller stated.
            high: brokerFee(bid, Math.max(brokerPct, BROKER_PCT_HIGH)),
            basis: `non-dealer brokers charge 3–6% of the purchase price with a floor (AutoBidMaster, SalvageBid); a flat-fee broker (~$${BROKER_FLAT}) is the low case; ${at}; docs/salvage-economics.md §5`,
            evidence: 'schedule' as const,
            bidDependent: true,
          },
        ]),
  ];
}
