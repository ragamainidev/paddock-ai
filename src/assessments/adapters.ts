/** Explicit-live adapters reuse Paddock's bounded providers; model research remains a claim (SPEC 47–49). */
import { mergeVpic } from '@/agent/vin-stage';
import { checkVin, decodeVinVpic, defaultVpicFetcher, type VpicFetcher } from '@/inspector/vin';
import {
  createCompsObservationFetcher,
  type CompsFetcher,
  type CompObservationsFetcher,
} from '@/salvage/comps';
import { lineResearchTopics } from '@/salvage/knowledge';
import {
  defaultSalvageEvidenceCaller,
  runSalvageEvidence,
  salvageEvidenceTopics,
  type SalvageEvidenceCaller,
} from '@/salvage/research';
import { defaultTriageCaller, triagePhotos, type TriageCaller } from '@/salvage/triage';
import { lotProvenanceUrl, NO_LOT_ADDRESS } from '@/lib/url';
import { AssessmentError, type AssessmentInvestigator, type EvidenceInput } from './types';
import { captureSourceArtifact, type SourceArtifact } from './source-artifacts';

export type LiveAssessmentDeps = {
  vpicFetcher?: VpicFetcher | null;
  comps?: CompsFetcher | null;
  compObservations?: CompObservationsFetcher | null;
  triageCaller?: TriageCaller | null;
  evidenceCaller?: SalvageEvidenceCaller | null;
  now?: () => Date;
};
export function createLiveInvestigator(deps: LiveAssessmentDeps = {}): AssessmentInvestigator {
  return async (a, action) => {
    if (a.mode !== 'live')
      throw new AssessmentError(
        'invalid_input',
        'Live sources require an explicitly live assessment',
      );
    const at = (deps.now?.() ?? new Date()).toISOString();
    const subject = { vin: a.lot.vin, make: a.lot.make, model: a.lot.model, year: a.lot.year };
    const wrap = (
      payload: Pick<EvidenceInput, 'kind' | 'value'>,
      url: string,
      label: string,
      capture: {
        inference?: boolean;
        observed?: boolean;
        artifact?: SourceArtifact;
        version: string;
      },
    ): EvidenceInput =>
      ({
        ...payload,
        subject,
        source: {
          url,
          label,
          capturedBy: capture.inference ? 'model' : 'provider',
          basis: capture.inference ? 'model_inference' : 'source_observation',
          extraction: {
            method: capture.inference ? 'model' : 'deterministic',
            version: capture.version,
          },
          ...(capture.artifact ? { artifact: capture.artifact } : {}),
          retrievedAt: at,
          ...(capture.observed === false ? {} : { observation: structuredClone(payload.value) }),
        },
      }) as EvidenceInput;
    if (action.kind === 'vin_identity') {
      const fetcher = deps.vpicFetcher === null ? null : (deps.vpicFetcher ?? defaultVpicFetcher);
      if (!fetcher) return { evidence: [], detail: 'vPIC disabled' };
      let response: unknown;
      const raw = await decodeVinVpic(a.lot.vin, async (url) => {
        response = await fetcher(url);
        return response;
      });
      const artifact = captureSourceArtifact('provider_response', response);
      const decoded = { ...raw };
      const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
      // Some manufacturers put the commercial model suffix in Trim. Only
      // concatenate when those exact two fields equal the claimed model;
      // never use substring similarity to conceal a different variant.
      if (raw.model && raw.trim && normalize(`${raw.model} ${raw.trim}`) === normalize(a.lot.model))
        decoded.model = `${raw.model} ${raw.trim}`;
      const check = mergeVpic(checkVin(a.lot.vin, a.lot), decoded, a.lot);
      if (check.decoded && raw.trim) check.decoded.trim = raw.trim;
      if (decoded.model && normalize(decoded.model) !== normalize(a.lot.model))
        check.mismatches.push(
          `Decoded model ${decoded.model} differs from listed model ${a.lot.model}; trim/model normalization needs review`,
        );
      const rows = artifact.content.Results;
      const row: unknown = Array.isArray(rows) ? rows[0] : undefined;
      const code =
        row && typeof row === 'object' && 'ErrorCode' in row && typeof row.ErrorCode === 'string'
          ? row.ErrorCode.trim()
          : '';
      if (
        row &&
        typeof row === 'object' &&
        'VIN' in row &&
        typeof row.VIN === 'string' &&
        row.VIN.trim().toUpperCase() !== a.lot.vin.trim().toUpperCase()
      )
        check.mismatches.push(
          'vPIC returned VIN differs from the requested vehicle; the source cannot corroborate this assessment',
        );
      // Partial decoded fields do not establish a clean identity result.
      // Error 0 is the documented clean decode; every other or missing
      // status remains a visible identity conflict for investigation.
      if (!code || code.split(',').some((value) => value.trim() !== '0'))
        check.mismatches.push(
          code
            ? `vPIC decode returned error code ${code}; identity needs corroboration`
            : 'vPIC decode did not include a clean result status; identity needs corroboration',
        );
      return {
        evidence: [
          wrap(
            { kind: 'identity', value: check },
            `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(a.lot.vin)}?format=json`,
            'NHTSA vPIC decoded fields; title, theft and accident history unchecked',
            {
              artifact,
              version: 'vpic-identity-v1',
            },
          ),
        ],
        detail: 'One bounded federal VIN decode',
        costCents: 0,
      };
    }
    if (action.kind === 'market_comps') {
      // Legacy injected fetchers expose normalized observations only. The
      // default fixed-provider path retains the actual item summary as well.
      const capture =
        deps.compObservations === null
          ? null
          : (deps.compObservations ??
            (deps.comps === undefined &&
            process.env.EBAY_CLIENT_ID &&
            process.env.EBAY_CLIENT_SECRET
              ? createCompsObservationFetcher(undefined, () => at.slice(0, 10))
              : null));
      if (!capture && !deps.comps)
        return {
          evidence: [],
          detail: 'eBay Browse credentials unavailable; no market observations fabricated',
        };
      const observations = (
        capture
          ? await capture(a.lot)
          : (await deps.comps!(a.lot)).map((comp) => ({ comp, raw: undefined }))
      ).filter(({ comp }) => comp.outcome === 'ask');
      return {
        evidence: observations.slice(0, 36).map(({ comp: value, raw }) =>
          wrap(
            { kind: 'comp', value },
            value.url,
            'eBay Browse active asking price; title status is seller wording or unknown, not independently verified',
            {
              ...(raw ? { artifact: captureSourceArtifact('listing_item', raw) } : {}),
              version: 'ebay-ask-extraction-v2',
            },
          ),
        ),
        detail: `One bounded eBay search; ${Math.min(observations.length, 36)} asking-price observations, no completed-sale claims`,
        costCents: 0,
      };
    }
    if (action.kind === 'photo_triage') {
      const caller =
        deps.triageCaller === null
          ? null
          : (deps.triageCaller ?? (process.env.ANTHROPIC_API_KEY ? defaultTriageCaller : null));
      if (!caller)
        return { evidence: [], detail: 'Photo model unavailable; triage remains unknown' };
      const listing = lotProvenanceUrl(a.lot);
      if (!listing) return { evidence: [], detail: NO_LOT_ADDRESS };
      const value = await triagePhotos(a.lot, caller, 12);
      return {
        evidence: [
          wrap(
            { kind: 'triage', value },
            listing,
            'Photo-model inference over at most 12 listing images; not a physical inspection',
            {
              inference: true,
              version: 'photo-triage-v1',
              artifact: captureSourceArtifact('image_manifest', {
                listingUrl: listing,
                images: a.lot.photos.slice(0, 12),
                contentCaptured: false,
              }),
            },
          ),
        ],
        detail:
          'One bounded photo-triage invocation; provider billing is not measured by this adapter',
      };
    }
    const caller =
      deps.evidenceCaller === null
        ? null
        : (deps.evidenceCaller ??
          (process.env.ANTHROPIC_API_KEY ? defaultSalvageEvidenceCaller : null));
    if (!caller || !a.decision.report)
      return {
        evidence: [],
        detail: 'Repair research unavailable; curated cost allowance remains unchanged',
      };
    const topic = salvageEvidenceTopics(
      a.lot,
      lineResearchTopics(a.decision.report.plan, a.lot),
    ).find((t) => t.kind === 'prices' && t.lineId === action.lineId);
    if (!topic) return { evidence: [], detail: 'No supported research topic for this repair line' };
    const result = await runSalvageEvidence(a.lot, [topic], caller);
    return {
      evidence: result.prices
        .slice(0, 20)
        .map((value) =>
          wrap(
            { kind: 'repair_price', value },
            value.url,
            'Model research claim; source page contents have not been independently captured',
            { inference: true, observed: false, version: 'repair-research-v1' },
          ),
        ),
      detail:
        'One bounded repair worker; cited claims remain unverified until source evidence is acquired',
    };
  };
}
