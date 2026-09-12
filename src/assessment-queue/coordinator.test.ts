import { expect, it } from 'vitest';
import type { MockModelRequest } from 'eve/evals';
import { chooseFixtureAction } from '../../agent/lib/fixture-model';

it('continues the domain-prioritized action after three completed investigations', () => {
  const board = {
    id: 'assessment',
    revision: 9,
    epoch: 0,
    status: 'active',
    mode: 'fixture',
    decision: {
      readiness: 'needs_evidence',
      verdict: 'needs_evidence',
      ceiling: null,
      provisionalCeiling: null,
      unknowns: [],
      reasons: [],
    },
    offeredActions: [
      {
        id: 'repair-high-impact',
        kind: 'repair_evidence',
        label: 'Repair',
        reason: 'Can change decision',
        maxCostCents: 0,
        priority: 0,
      },
      {
        id: 'vin-low-impact',
        kind: 'vin_identity',
        label: 'VIN',
        reason: 'Lower priority',
        maxCostCents: 0,
        priority: 10,
      },
    ],
    budget: {
      maxInvestigations: 12,
      usedInvestigations: 3,
      maxCostCents: 0,
      spentCostCents: 0,
      reservedCostCents: 0,
    },
  };
  const request = {
    messages: [
      { role: 'user', text: 'Assess' },
      ...Array.from({ length: 3 }, () => ({ role: 'tool', text: '{"attempt":{}}' })),
    ],
    lastUserMessage: 'Assess',
    userMessages: ['Assess'],
    userMessageCount: 1,
    tools: ['read_assessment', 'investigate_assessment', 'finish_assessment'].map((name) => ({
      name,
    })),
    toolResults: [
      {
        id: 'latest',
        name: 'investigate_assessment',
        output: { ok: true, assessment: board },
        isError: false,
      },
    ],
  } as MockModelRequest;
  expect(chooseFixtureAction(request).toolCalls).toEqual([
    {
      name: 'investigate_assessment',
      input: { actionId: 'repair-high-impact', expectedRevision: 9 },
    },
  ]);
});
