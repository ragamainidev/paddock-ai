/** An old Eve session cannot gain authority over an assessment's refreshed epoch. */
import { afterEach, expect, it } from 'vitest';
import { createAssessmentService, type AssessmentService } from '../../src/assessments/service';
import { MemoryAssessmentStore } from '../../src/assessments/store';
import { assessmentPrincipal } from '../../agent/lib/auth';
import {
  finishOwnedAssessment,
  investigateOwnedAssessment,
  readOwnedAssessment,
} from '../../agent/lib/domain';

const globals = globalThis as typeof globalThis & { __paddockAssessments?: AssessmentService };
afterEach(() => {
  delete globals.__paddockAssessments;
});
function context(epoch: number) {
  const principal = assessmentPrincipal('owner', 'assessment', epoch);
  return {
    session: {
      id: 'session',
      turn: { id: 'turn', sequence: 1 },
      auth: { current: principal, initiator: principal },
    },
    callId: 'call',
  };
}
it('rejects all old-epoch capabilities even when the model supplies a fresh revision and action', async () => {
  const service = createAssessmentService({
    store: new MemoryAssessmentStore(),
    id: () => 'assessment',
  });
  globals.__paddockAssessments = service;
  const initial = await service.createAssessment('owner', {
    seedLotId: 'sf90-front-il',
    mode: 'fixture',
  });
  const refreshed = await service.refreshAssessment(
    'owner',
    initial.id,
    initial.revision,
    'refresh',
  );
  await expect(readOwnedAssessment(context(0))).rejects.toThrow('epoch');
  await expect(
    investigateOwnedAssessment(
      { actionId: refreshed.offeredActions[0].id, expectedRevision: refreshed.revision },
      context(0),
    ),
  ).rejects.toThrow('epoch');
  await expect(
    finishOwnedAssessment(
      { reason: 'Old session attempt', expectedRevision: refreshed.revision },
      context(0),
    ),
  ).rejects.toThrow('epoch');
  expect((await service.getAssessment('owner', initial.id))?.revision).toBe(refreshed.revision);
  expect((await service.getAssessment('owner', initial.id))?.budget.usedInvestigations).toBe(0);
  expect((await readOwnedAssessment(context(1))).assessment.epoch).toBe(1);
});
