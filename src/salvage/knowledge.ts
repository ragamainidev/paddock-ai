/**
 * Curated rebuild knowledge, as one import surface. The work is split by
 * question — `programs.ts` (which program a zone belongs to),
 * `repair-lines.ts` (what a program's lines cost and who does them),
 * `repair-plan.ts` (the plan a triage folds into), `evidence.ts` (what a
 * cited price may do to a line), `topics.ts` (what to research, and what
 * bidders miss) — and this module re-exports it so callers keep one name
 * for the knowledge layer (SPEC 35, 43, 44).
 *
 * Import the file that owns the behavior when you are changing it; import
 * this one when you only need the plan.
 */

export { applyPriceEvidence, screenPriceEvidence } from './evidence';
export { programForArea } from './programs';
export { proPrice } from './repair-lines';
export { deriveRepairPlan } from './repair-plan';
export { lineResearchTopics, whatPeopleMiss, type LineResearchTopic } from './topics';
