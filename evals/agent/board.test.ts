/** The decision packet the coordinator reads: typed values, and the lot's own provenance among them. */
import { expect, it } from 'vitest';
import { assessmentBoard } from '../../agent/lib/board';
import { USER_LOT_SOURCE } from '../../src/assessments/intake';
import { createAssessmentService } from '../../src/assessments/service';
import { MemoryAssessmentStore } from '../../src/assessments/store';
import { getSalvageLot } from '../../src/salvage/seed-lots';

function service() {
  return createAssessmentService({
    store: new MemoryAssessmentStore(),
    now: () => new Date('2026-09-11T00:00:00.000Z'),
    investigator: async () => ({ evidence: [], detail: 'No network in packet cases' }),
  });
}

it('states the lot source, so a lot the buyer brought is never read as an auction page', async () => {
  const seed = getSalvageLot('sf90-front-il')!;
  const assessments = service();
  const brought = await assessments.createAssessment('buyer', {
    lot: { ...seed, id: 'lot_typed', source: USER_LOT_SOURCE, url: undefined },
  });
  const packet = assessmentBoard(brought);
  expect(packet.vehicle?.source).toBe('user-supplied listing');
  expect(packet.decision.residualRisks).toContain(
    'Listing details were typed or pasted by the owner and not captured from the auction page',
  );
  // A catalog lot names the broker page its data was collected from.
  const recorded = await assessments.createAssessment('buyer', { seedLotId: seed.id });
  expect(assessmentBoard(recorded).vehicle?.source).toBe(
    'Copart via A Better Bid (licensed broker)',
  );
});
