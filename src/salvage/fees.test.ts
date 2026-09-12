import { describe, expect, test } from 'vitest';
import {
  bidDependentFees,
  bidFeeLines,
  BROKER_PCT_EXPECTED,
  brokerFee,
  copartBuyerFee,
  fixedFeeLines,
  virtualBidFee,
} from './fees';

const BID = 40_000;

describe('fee mode: broker is the default, direct drops the broker (SPEC 50)', () => {
  test('the default is the broker schedule every existing caller already gets', () => {
    expect(bidDependentFees(BID)).toBe(bidDependentFees(BID, {}));
    expect(bidDependentFees(BID)).toBe(bidDependentFees(BID, { access: 'broker' }));
    expect(bidDependentFees(BID)).toBe(
      copartBuyerFee(BID) + virtualBidFee(BID) + brokerFee(BID, BROKER_PCT_EXPECTED),
    );
  });

  test('a number in the options position is still the broker percentage', () => {
    expect(bidDependentFees(BID, 0)).toBe(bidDependentFees(BID, { brokerPct: 0 }));
    expect(bidDependentFees(BID, 0)).toBeLessThan(bidDependentFees(BID));
  });

  test('direct access pays the auction schedule without the broker percentage', () => {
    expect(bidDependentFees(BID, { access: 'direct' })).toBe(
      copartBuyerFee(BID) + virtualBidFee(BID),
    );
    expect(bidDependentFees(BID, { access: 'direct' })).toBe(
      bidDependentFees(BID) - brokerFee(BID, BROKER_PCT_EXPECTED),
    );
  });

  test('direct access omits the broker percentage line; broker keeps it', () => {
    expect(bidFeeLines(BID).map((l) => l.id)).toContain('fees.broker');
    expect(bidFeeLines(BID, { access: 'direct' }).map((l) => l.id)).not.toContain('fees.broker');
    // Everything the auction charges regardless of who bids is untouched.
    const auctionOnly = (access: 'broker' | 'direct') =>
      bidFeeLines(BID, { access }).filter((l) => l.id !== 'fees.broker');
    expect(auctionOnly('direct')).toEqual(auctionOnly('broker'));
  });

  test('direct access omits the Copart broker charge from the flat total', () => {
    const broker = fixedFeeLines()[0];
    const direct = fixedFeeLines({ access: 'direct' })[0];
    expect(broker.expected - direct.expected).toBe(100); // COPART_BROKER_FEE
    expect(direct.low).toBe(direct.expected);
    expect(direct.high).toBe(direct.expected);
    expect(direct.label).not.toMatch(/broker/i);
    expect(direct.basis).toContain("licensed buyer pays Copart's schedule directly; no broker");
  });

  test('the broker default is byte-identical to the schedule before the fee mode existed', () => {
    expect(fixedFeeLines()).toEqual(fixedFeeLines({}));
    expect(fixedFeeLines()).toEqual(fixedFeeLines({ access: 'broker' }));
    expect(fixedFeeLines()[0].expected).toBe(230); // gate 95 + environmental 15 + mailing 20 + broker 100
    expect(bidFeeLines(BID)).toEqual(bidFeeLines(BID, {}));
  });

  test('a stated broker percentage prices the expected broker line', () => {
    const line = bidFeeLines(BID, { brokerPct: 0.05 }).find((l) => l.id === 'fees.broker')!;
    expect(line.label).toBe('broker fee (5% of the bid)');
    expect(line.expected).toBe(brokerFee(BID, 0.05));
    expect(line.high).toBeGreaterThanOrEqual(line.expected);
  });
});
