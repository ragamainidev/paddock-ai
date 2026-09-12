# Synthetic decision cohort

Original synthetic cases; no licensed records, live models, or provider calls

Holdout labels reserve contract variants; these authored synthetic cases are not blind real-world validation. The capability loop is deterministic; actual Eve transport is separately evaluated by eval:agent. Owner review is simulated, not performed by the agent.

As of 2026-09-06T00:00:00.000Z. Provider spend: $0.

| Case                        | Split       | Access | Exit          | Your ceiling | Market ceiling | Independent expectation | Listing-only diagnostic | Legacy conditional kernel | Captured, unreviewed | Reviewed capability loop | Result |
| --------------------------- | ----------- | ------ | ------------- | ------------ | -------------- | ----------------------- | ----------------------- | ------------------------- | -------------------- | ------------------------ | ------ |
| equipped-opportunity        | development | broker | private_party | $150,500     | $144,500       | build                   | needs_evidence          | build                     | needs_evidence       | build                    | pass   |
| cash-constrained            | development | broker | private_party | $0           | $144,000       | walk                    | needs_evidence          | build                     | walk                 | walk                     | pass   |
| missing-physical-inspection | development | broker | private_party | $150,500     | $144,500       | needs_evidence          | needs_evidence          | build                     | needs_evidence       | needs_evidence           | pass   |
| ineligible-title            | development | broker | private_party | –            | –              | walk                    | needs_evidence          | walk                      | walk                 | walk                     | pass   |
| wrong-jurisdiction          | holdout     | broker | private_party | $150,500     | $144,500       | needs_evidence          | needs_evidence          | build                     | needs_evidence       | needs_evidence           | pass   |
| future-sale-leakage         | holdout     | broker | private_party | –            | –              | needs_evidence          | needs_evidence          | walk                      | needs_evidence       | needs_evidence           | pass   |
| unknown-title-market        | holdout     | broker | private_party | $150,500     | $144,500       | needs_evidence          | needs_evidence          | build                     | needs_evidence       | needs_evidence           | pass   |
| unequipped-buyer            | holdout     | broker | private_party | $150,000     | $144,000       | needs_evidence          | needs_evidence          | build                     | needs_evidence       | needs_evidence           | pass   |
| above-optimistic-bound      | holdout     | broker | private_party | $0           | $144,000       | walk                    | needs_evidence          | build                     | walk                 | walk                     | pass   |
| quote-on-diy-line           | holdout     | broker | private_party | $150,500     | $144,500       | build                   | needs_evidence          | build                     | needs_evidence       | build                    | pass   |
| dominated-at-high-exit      | holdout     | broker | private_party | $121,500     | $116,000       | walk                    | needs_evidence          | build                     | walk                 | walk                     | pass   |
| self-attested-market        | holdout     | broker | private_party | $150,500     | $144,500       | needs_evidence          | needs_evidence          | walk                      | needs_evidence       | needs_evidence           | pass   |
| broker-vs-direct            | holdout     | direct | private_party | $157,000     | $144,500       | build                   | needs_evidence          | build                     | needs_evidence       | build                    | pass   |
| private-party-vs-retail     | holdout     | broker | retail        | $140,000     | $144,500       | walk                    | needs_evidence          | build                     | needs_evidence       | walk                     | pass   |
| keep-not-sell               | holdout     | broker | keep          | $162,000     | $144,500       | build                   | needs_evidence          | build                     | needs_evidence       | build                    | pass   |
| no-edge-walk                | holdout     | broker | private_party | $0           | $144,500       | walk                    | needs_evidence          | build                     | needs_evidence       | walk                     | pass   |
| edge-positive-build         | holdout     | direct | keep          | $167,000     | $144,500       | build                   | needs_evidence          | build                     | needs_evidence       | build                    | pass   |
| state-title-process         | holdout     | broker | private_party | $150,500     | $144,500       | build                   | needs_evidence          | build                     | needs_evidence       | build                    | pass   |

Passed 18/18; unsafe positive results 0.

Access, exit and the two ceilings are the case's bidder-relative inputs and the numbers they solve (SPEC 58–60): this buyer's own ceiling beside the marginal professional rebuilder's on the same plan and the same exit evidence. Both are solved arithmetic, not an authorization to bid — the verdict columns say what the decision does with them, and an en dash means no plan or exit anchor was solved at all.

The final policy is evaluated against literal case expectations. It includes simulated owner review of physical and documentary evidence; a model never attests to those records. The legacy kernel column is its conditional arithmetic verdict before document gates, not a claim that the old product certified roadworthiness. Listing-only is a deliberately weak diagnostic, not a calibrated production baseline.
