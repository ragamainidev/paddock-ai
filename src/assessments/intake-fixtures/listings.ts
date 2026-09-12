/**
 * Listing blocks composed in the public Copart and IAA layouts, over the
 * seeded lots' VINs (`src/salvage/seed-lots.ts`), so the intake parser is
 * tested against the text a hobbyist actually copies without carrying a
 * private owner's VIN into the repository (SPEC 61, `docs/patterns.md §7`).
 *
 * Each block is chosen for what it leaves behind: the first states every
 * field the deterministic pass reads, the second uses IAA's labels so half
 * of them do not match, the third states an unknown odometer and no
 * secondary damage or value at all.
 */

/** Copart layout, complete: every deterministic rule has something to read. */
export const COPART_COMPLETE = `2021 FERRARI SF90 STRADALE
Lot # 63198496
VIN: ZFF95NLA2M0263155
Title Code: IL CERTIFICATE OF TITLE-SALVAGE
Odometer: 3,004 mi (ACTUAL)
Primary Damage: FRONT END
Secondary Damage: UNDERCARRIAGE
Estimated Retail Value: $412,500.00
Location: IL - Chicago North
Sale Date: 09/22/2026
Current Bid: $128,000
Engine: 4.0L V8 Twin Turbo Hybrid
Drive: AWD
Keys: PRESENT`;

/**
 * IAA layout: a stock number rather than a lot number, a branch rather than a
 * location line, and a cash value that names neither a bid nor retail. What
 * the deterministic pass cannot read is left for the model to propose.
 */
export const IAA_SPARSE = `IAA - Buy Now
Stock # 41892205
2023 FERRARI 296 GTB
VIN ZFF99SLAXP0291115
Branch: Fort Wayne
Sale Date 10/06/2026
Odometer 6,412 miles (NOT ACTUAL)
Loss Type: Collision
Primary Damage: FRONT END
Secondary Damage: NONE
Actual Cash Value: $268,900
Run & Drive: No
Seller: Insurance Company`;

/**
 * Copart layout, thin: an unknown odometer, one damage line, no valuation, and
 * the `Title Status:` label rather than `Title Code:`, so the label variants
 * are read as labels rather than as the brand.
 */
export const COPART_MINIMAL = `2023 MCLAREN ARTURA
Lot #62848556
VIN: SBM16AEA2PW001787
Odometer: Unknown
Primary Damage: VANDALISM
Title Status: CA SALVAGE CERTIFICATE
Location: CA - Sacramento
Sale Date: Aug 13, 2026
Current Bid: $2,800`;
