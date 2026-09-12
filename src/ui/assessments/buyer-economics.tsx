'use client';

/**
 * The buyer's side of the decision: what the ceiling costs this reader in cash
 * and in time, each line with the basis it was solved from, both bidders'
 * ledgers as disclosures, and the form that edits those inputs. The figures are
 * the decision's; this module states them.
 */
import { DEFAULT_BUYER_PROFILE } from '@/assessments/buyer-profile';
import { EvidenceChip } from '@/ui/run/program-table';
import { BuyerFields } from './buyer';
import { buyerFromForm } from './buyer-form';
import { actionLinkClass, type SectionProps } from './client';
import { Cell } from './decision-headline';
import { moneyLabel, type SavedBuyerEconomics } from './format';
import { SEED_CHANGED, useSeededForm } from './form-seed';
import { LedgerLines } from './ledger-lines';

export function BuyerEconomics({ data, busy, save }: SectionProps) {
  const a = data.assessment;
  const form = useSeededForm(a.revision);
  // Read as a saved shape: a decision written before the ceiling became
  // bidder-relative carries no market ceiling and no lines (SPEC 60).
  const economics: SavedBuyerEconomics | undefined = a.decision.buyerEconomics;
  // The decision solves against this same fallback when no profile is saved.
  const buyer = a.buyer ?? DEFAULT_BUYER_PROFILE;
  // Labor is priced from the plan's DIY hours, not from the hours on offer.
  const diyHours = a.decision.report?.plan.diyHoursTotal;
  const lines = economics
    ? [
        {
          label: 'DIY labor',
          value: economics.laborOpportunityCost,
          basis:
            diyHours === undefined
              ? `$${buyer.laborRatePerHour}/h, your stated opportunity cost`
              : `${diyHours} h × $${buyer.laborRatePerHour}/h, your stated opportunity cost`,
        },
        {
          label: 'Holding',
          value: economics.holdingCost,
          basis: `${buyer.holdingDays} d × $${buyer.holdingCostPerDay}/d`,
        },
        { label: 'Cash limit', value: economics.maxAllIn, basis: 'your stated limit' },
        { label: 'Required surplus', value: economics.minSurplus, basis: 'your stated minimum' },
        {
          label: 'Stress ceiling',
          value: economics.stressMaxBid,
          basis: 'every repair at its high',
        },
        {
          label: 'Best case',
          value: economics.bestCaseMaxBid,
          basis: 'repairs at low, no contingency, exit at high',
        },
      ]
    : [];
  return (
    <>
      <section aria-label="Your economics">
        <h2 className="type-h2 border-b border-border pb-3">Your rebuild economics</h2>
        {lines.length ? (
          <ul className="divide-y divide-border">
            {lines.map((line) => (
              <li key={line.label} className="py-3">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
                  <span className="type-body min-w-0">{line.label}</span>
                  <span className="flex items-baseline gap-2">
                    <span className="font-mono text-[13px] tabular-nums">
                      {moneyLabel(line.value)}
                    </span>
                    <EvidenceChip evidence="derived" />
                  </span>
                </div>
                <p className="type-meta mt-1">{line.basis}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="type-body py-3 text-dim">
            This decision has no buyer arithmetic yet: it needs an exit anchor and a repair plan
            before your cash, time and holding costs can price a ceiling.
          </p>
        )}
        {economics && (
          <div className="mt-4 grid grid-cols-1 gap-px overflow-hidden rounded-[4px] border border-border bg-border sm:grid-cols-2">
            <Cell
              label="cash at ceiling"
              value={moneyLabel(economics.cashAtCeiling)}
              note="cash at acquisition; not selling costs or labor"
            />
            <Cell
              label="all-in at ceiling"
              value={moneyLabel(economics.totalEconomicCostAtCeiling)}
              note="cash plus selling costs and your DIY time"
            />
          </div>
        )}
        <p className="type-body mt-3 max-w-3xl text-dim">
          Cash at ceiling is what the acquisition costs you in money: it excludes selling costs,
          which are paid from the proceeds, and your labor, which is not cash. All-in at ceiling
          includes both. Stress and best case price adverse and favorable repair assumptions; they
          are scenarios, not probabilities.
        </p>
      </section>

      {/* A decision saved before the ceiling became bidder-relative carries no
          lines for either bidder; a disclosure of nothing is not shown. */}
      {economics?.lines && <LedgerLines label="your lines" lines={economics.lines} />}
      {economics?.market?.lines && (
        <LedgerLines label="market lines" lines={economics.market.lines} />
      )}

      <details className="border-t border-border pt-4">
        <summary className="type-body cursor-pointer text-accent">
          Review your equipment, time and budget
        </summary>
        <form
          className="mt-4 space-y-4"
          onInput={form.onEdit}
          onSubmit={(event) => {
            event.preventDefault();
            void save('buyer', {
              buyer: buyerFromForm(new FormData(event.currentTarget)),
            }).then((saved) => {
              if (saved) form.settle();
            });
          }}
        >
          <BuyerFields key={form.key} buyer={a.buyer} />
          {form.stale && <p className="type-meta">{SEED_CHANGED}</p>}
          <button className={actionLinkClass} disabled={busy} type="submit">
            Update buyer constraints
          </button>
        </form>
      </details>
    </>
  );
}
