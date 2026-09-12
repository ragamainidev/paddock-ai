/** Original synthetic acquisition world. These prices/documents are invented; never historical outcomes. */
import type { Assessment, EvidenceInput, InvestigationResult, OfferedAction } from './types';
export function readyCandidateEvidence(a: Assessment, action: OfferedAction): InvestigationResult {
  const at = a.updatedAt;
  const subject = { vin: a.lot.vin, make: a.lot.make, model: a.lot.model, year: a.lot.year };
  const wrap = (payload: Pick<EvidenceInput, 'kind' | 'value'>, name: string): EvidenceInput =>
    ({
      ...payload,
      subject,
      source: {
        url: `https://example.com/paddock-synthetic/${name}`,
        label: 'SYNTHETIC ready-candidate; invented documents and prices, not a real acquisition',
        capturedBy: 'synthetic_fixture',
        retrievedAt: at,
        observation: structuredClone(payload.value) as Record<string, unknown>,
      },
    }) as EvidenceInput;
  let evidence: EvidenceInput[] = [];
  if (action.kind === 'vin_identity')
    evidence = [
      wrap(
        {
          kind: 'identity',
          value: {
            vin: a.lot.vin,
            valid: true,
            decoded: {
              make: a.lot.make,
              model: a.lot.model,
              year: a.lot.year,
              wmi: a.lot.vin.slice(0, 3),
              serial: a.lot.vin.slice(-6),
            },
            mismatches: [],
            note: 'Synthetic corroborating decode for runtime testing; vPIC not called',
            links: [],
          },
        },
        'identity',
      ),
    ];
  if (action.kind === 'photo_triage')
    evidence = [
      wrap(
        {
          kind: 'triage',
          value: {
            overall: 'rebuildable',
            areas: [
              {
                area: 'front bumper',
                kind: 'cosmetic',
                severity: 'light',
                description: 'Synthetic bumper scuff',
                photos: [0],
              },
            ],
            airbagsDeployed: 'no',
            floodEvidence: false,
            fireEvidence: false,
            drivetrainRisk: 'Physical specialist record covers this separately',
            observations: [{ photo: 0, note: 'Synthetic light bumper scuff' }],
            confidence: 0.9,
          },
        },
        'triage',
      ),
      wrap(
        {
          kind: 'title',
          value: {
            titleBrand: 'Salvage',
            listingDiscrepancyResolution:
              'Synthetic scenario uses this explicit salvage document instead of the seed listing wording',
          },
        },
        'title',
      ),
      wrap(
        {
          kind: 'registration',
          value: {
            jurisdiction: 'US-CA',
            eligible: true,
            requirements: [
              'Complete the jurisdiction inspection and retain required repair receipts before road use',
            ],
          },
        },
        'registration',
      ),
      wrap(
        {
          kind: 'inspection',
          value: {
            inspector: 'Synthetic qualified specialist',
            method: 'physical',
            inspectedAt: at,
            repairScopeConfirmed: true,
            systems: [
              {
                system: 'structure',
                status: 'clear',
                finding: 'Synthetic physical structural inspection complete',
              },
              {
                system: 'srs',
                status: 'clear',
                finding: 'Synthetic SRS diagnostic and physical inspection complete',
              },
              {
                system: 'powertrain',
                status: 'clear',
                finding: 'Synthetic engine and drivetrain inspection complete',
              },
              {
                system: 'hv',
                status: 'clear',
                finding: 'Synthetic qualified HV specialist clearance',
              },
              {
                system: 'water_fire',
                status: 'clear',
                finding: 'Synthetic inspection found no water or fire damage',
              },
            ],
          },
        },
        'inspection',
      ),
    ];
  if (action.kind === 'market_comps') {
    evidence = [300000, 310000, 320000].map((price, i) => {
      const url = `https://example.com/paddock-synthetic/sale-${i}`;
      return wrap(
        {
          kind: 'comp',
          value: {
            lane: 'rebuilt',
            outcome: 'sold',
            title: 'rebuilt',
            price,
            year: a.lot.year,
            date: at.slice(0, 10),
            url,
            source: 'example.com',
            note: 'Invented completed sale for evaluation',
          },
        },
        `sale-${i}`,
      );
    });
  }
  if (action.kind === 'market_comps' || action.kind === 'repair_evidence')
    for (const line of a.decision.report?.plan.lines.filter((line) =>
      action.kind === 'repair_evidence' ? line.id === action.lineId : line.who === 'pro',
    ) ?? []) {
      const url = `https://example.com/paddock-synthetic/quote-${line.id}`;
      evidence.push(
        wrap(
          {
            kind: 'repair_price',
            value: {
              line: line.id,
              item: `Whole job: ${line.task}`,
              kind: 'job_quote',
              low: 5000,
              high: 10000,
              url,
              source: 'example.com',
              note: 'Invented specialist whole-job quote for evaluation',
            },
          },
          `quote-${line.id}`,
        ),
      );
    }
  return {
    evidence,
    costCents: 0,
    detail: `SYNTHETIC ready-candidate ${action.kind}; no network or real inspection`,
  };
}
