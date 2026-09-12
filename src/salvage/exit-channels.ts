/**
 * How the car leaves. The tier's `selling` band and rebuilt-title exit
 * describe one channel — the enthusiast private sale a rebuilder plans on —
 * and a bidder who plans another gets that channel's costs instead: what
 * the sale costs (`sellingPct`, a share of the exit, exactly as the tier
 * band is) and where that channel transacts against the private-party
 * money the exit lane estimates (`exitFactor`).
 *
 * `private_party` is the exception: the tier's own `selling` band already
 * prices that channel for this class of car (SPEC 39,
 * docs/salvage-economics.md §3), and it is model-specific where this table
 * is national, so the bidder layer keeps it and this entry's percentages are
 * informational — nothing solves against them.
 *
 * `keep` is the honest case for a car that is not for sale: no selling
 * costs at all, valued at the private-party typical as money retained
 * rather than money received. Every band is an estimate labeled as one;
 * auction and lot costs are flat per unit in the real world, so a
 * percentage overstates them on an expensive car and understates them on a
 * cheap one, and each basis says so (docs/salvage-economics.md §12,
 * SPEC 44).
 */

import type { ExitChannel, Range3 } from './types';

export type ExitChannelBand = {
  sellingPct: Range3; // seller-side cost as a share of the exit
  exitFactor: { low: number; high: number }; // this channel's money vs the private-party exit
  basis: string;
};

export const EXIT_CHANNELS: Record<ExitChannel, ExitChannelBand> = {
  private_party: {
    // Informational: the tier's own selling band prices this channel, so no
    // solve reads these percentages (SPEC 39, docs/salvage-economics.md §3).
    sellingPct: { low: 0.008, expected: 0.02, high: 0.025 },
    exitFactor: { low: 1.0, high: 1.0 },
    basis:
      'private sale: listing, detailing, photography, paperwork and a PPI, 0.8–2.5% of the sale (docs/salvage-economics.md §3). The exit lanes already estimate private-party money, so this channel neither adds to nor discounts them. These percentages are informational: the tier band (SPEC 39, docs/salvage-economics.md §3) prices this channel, being model-specific where this national table is not, and the bidder layer keeps it.',
  },
  wholesale: {
    sellingPct: { low: 0.03, expected: 0.04, high: 0.05 },
    exitFactor: { low: 0.8, high: 0.9 },
    basis:
      'dealer auction: neither Manheim nor ADESA publishes a percentage seller fee — the run, simulcast, condition-report and post-sale-inspection charges are flat tiers negotiated by volume, industry guidance budgeting roughly $400–700 a unit across both sides — so 3–5% is an estimate covering those charges plus transport to the lane and arbitration exposure, and it overstates the cost on an expensive car (https://site.manheim.com/en/marketplace-policies/us-policies/manheim-terms-and-conditions.html). A wholesale buyer prices below retail: the dealer markup from auction cost to asking price runs 25–40%, so wholesale money sits at 0.80–0.90 of private-party money here, shaded conservative because a branded title thins the dealer bid too (https://otdcheck.com/blog/wholesale-vs-retail-car-price-gap-2026).',
  },
  retail: {
    sellingPct: { low: 0.06, expected: 0.08, high: 0.1 },
    exitFactor: { low: 1.0, high: 1.05 },
    basis:
      'retail from a lot: reconditioning to frontline runs $500–1,500 a unit, the dealer pack that absorbs advertising and lot overhead $800–1,200, floorplan interest about $150–220 a month per unit, and F&I income is booked net of a chargeback reserve — roughly 6–10% of a mid-five-figure sale, an estimate (https://niada.com/dashboard/auto-reconditioning-best-practices/, https://beancount.io/blog/2026/05/26/independent-used-car-dealer-bookkeeping-floorplan-financing-curtailment-fi-reserve-holdback-chargeback-recon-wip-form-8300-ftc-used-car-rule-bhph-repossession-loss-reserve-guide). A reconditioned, warrantied car on a lot asks 1.00–1.05 of private-party money on a rebuilt title, where financing is scarce and the brand caps what the counter can add.',
  },
  keep: {
    sellingPct: { low: 0, expected: 0, high: 0 },
    exitFactor: { low: 1.0, high: 1.0 },
    basis:
      'no sale is planned, so no seller-side cost is charged; the car is valued at the private-party typical as money retained rather than money received. Holding costs belong to the buyer profile, not to this band.',
  },
};
