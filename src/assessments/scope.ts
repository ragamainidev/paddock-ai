/** Bind inspection/quote attestation to material damage hypotheses, not merely stable line IDs. */
import type { Assessment } from './types';
import { fingerprint } from './validation';
export function repairScopeFingerprint(a: Assessment): string | undefined {
  const triage = a.evidence.findLast((e) => e.kind === 'triage' && e.status === 'accepted');
  if (triage?.kind !== 'triage') return undefined;
  const { overall, areas, airbagsDeployed, floodEvidence, fireEvidence, drivetrainRisk } =
    triage.value;
  return fingerprint({
    vin: a.lot.vin,
    overall,
    areas,
    airbagsDeployed,
    floodEvidence,
    fireEvidence,
    drivetrainRisk,
  });
}
