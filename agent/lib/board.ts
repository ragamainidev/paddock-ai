/** A compact decision packet: vehicle, buyer, evidence, gates and sensitivity, with no raw provider blobs. */
import { z } from 'zod';
import type { Assessment } from '../../src/assessments/types';
import { DEFAULT_BUYER_PROFILE } from '../../src/assessments/buyer-profile';

export const boardSchema = z.object({
  id: z.string(),
  revision: z.number(),
  epoch: z.number(),
  status: z.string(),
  fixtureCaseId: z.string().optional(),
  mode: z.enum(['fixture', 'live']),
  vehicle: z
    .object({
      make: z.string(),
      model: z.string(),
      year: z.number(),
      vin: z.string(),
      // Where the lot's own data came from; `user-supplied listing` says the
      // buyer typed it and no page was ever read (SPEC 61).
      source: z.string(),
      titleBrand: z.string(),
      damage: z.string(),
      currentBid: z.number().optional(),
      saleDate: z.string().optional(),
    })
    .optional(),
  buyer: z
    .object({
      jurisdiction: z.string(),
      capabilities: z.record(z.string(), z.boolean()),
      laborRatePerHour: z.number(),
      availableDiyHours: z.number(),
      holdingDays: z.number(),
      holdingCostPerDay: z.number(),
      maxAllIn: z.number(),
      minSurplus: z.number(),
    })
    .optional(),
  decision: z.object({
    readiness: z.string(),
    verdict: z.string(),
    ceiling: z.number().nullable(),
    provisionalCeiling: z.number().nullable(),
    unknowns: z.array(z.string()),
    reasons: z.array(z.string()),
    residualRisks: z.array(z.string()).optional(),
    gates: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          status: z.string(),
          detail: z.string(),
          evidenceIds: z.array(z.string()),
        }),
      )
      .optional(),
    economics: z.record(z.string(), z.number()).optional(),
  }),
  evidence: z
    .array(
      z.object({
        id: z.string(),
        kind: z.string(),
        status: z.string(),
        source: z.string(),
        retrievedAt: z.string(),
        basis: z.string(),
        reviewed: z.boolean(),
        summary: z.string(),
      }),
    )
    .optional(),
  repairHypotheses: z
    .array(
      z.object({
        id: z.string(),
        task: z.string(),
        who: z.string(),
        low: z.number(),
        expected: z.number(),
        high: z.number(),
        basis: z.string(),
      }),
    )
    .optional(),
  sensitivities: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        ceiling: z.number().nullable(),
        delta: z.number().nullable(),
        note: z.string(),
      }),
    )
    .optional(),
  offeredActions: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      label: z.string(),
      reason: z.string(),
      maxCostCents: z.number(),
      priority: z.number().optional(),
      impactDollars: z.number().optional(),
      targetEvidenceIds: z.array(z.string()).optional(),
    }),
  ),
  budget: z.object({
    maxInvestigations: z.number(),
    usedInvestigations: z.number(),
    maxCostCents: z.number(),
    spentCostCents: z.number(),
    reservedCostCents: z.number(),
  }),
});
export type AssessmentBoard = z.infer<typeof boardSchema>;
export function assessmentBoard(a: Assessment): AssessmentBoard {
  return boardSchema.parse({
    id: a.id,
    revision: a.revision,
    epoch: a.epoch,
    status: a.status,
    fixtureCaseId: a.fixtureCaseId,
    mode: a.mode,
    vehicle: {
      make: a.lot.make,
      model: a.lot.model,
      year: a.lot.year,
      vin: a.lot.vin,
      source: a.lot.source,
      titleBrand: a.lot.titleBrand,
      damage: a.lot.damage.primary,
      currentBid: a.lot.currentBid,
      saleDate: a.lot.saleDate,
    },
    buyer: a.buyer ?? DEFAULT_BUYER_PROFILE,
    decision: {
      ...a.decision,
      reasons: a.decision.reasons.slice(0, 8),
      unknowns: a.decision.unknowns.slice(0, 12),
      residualRisks: a.decision.residualRisks?.slice(0, 8),
      gates: a.decision.gates,
      // The packet carries the buyer's numbers; the ledger lines and their
      // bases belong to the report, not to a model's context window.
      economics:
        a.decision.buyerEconomics &&
        Object.fromEntries(
          Object.entries(a.decision.buyerEconomics).filter(([, v]) => typeof v === 'number'),
        ),
    },
    evidence: a.evidence.slice(-20).map((e) => ({
      id: e.id,
      kind: e.kind,
      status: e.status,
      source: e.source.url,
      retrievedAt: e.source.retrievedAt,
      basis: e.source.basis ?? e.source.capturedBy,
      reviewed: Boolean(e.review),
      summary: (e.kind === 'comp'
        ? `${e.value.outcome} ${e.value.price} USD; title ${e.value.title ?? 'unknown'}`
        : e.kind === 'repair_price'
          ? `${e.value.line}: ${e.value.low}–${e.value.high} USD (${e.value.kind})`
          : e.kind === 'title'
            ? e.value.titleBrand
            : e.reason
      ).slice(0, 300),
    })),
    repairHypotheses: a.decision.report?.plan.lines.slice(0, 12),
    sensitivities: a.decision.report?.ledger?.sensitivity.slice(0, 10),
    offeredActions: a.offeredActions.slice(0, 12),
    budget: a.budget,
  });
}
