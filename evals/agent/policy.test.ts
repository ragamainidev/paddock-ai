/** Fixture policy must adapt to state and available actions rather than replay a canned transcript. */
import { expect, it } from 'vitest';
import { chooseFixtureAction } from '../../agent/lib/fixture-model';
import type { MockModelRequest } from 'eve/evals';
const board = {
  id: 'test',
  revision: 7,
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
    { id: 'market-7', kind: 'market_comps', label: 'Comps', reason: 'Need price', maxCostCents: 0 },
  ],
  budget: {
    maxInvestigations: 4,
    usedInvestigations: 0,
    maxCostCents: 0,
    spentCostCents: 0,
    reservedCostCents: 0,
  },
};
const request: MockModelRequest = {
  messages: [
    { role: 'user', text: 'Assess' },
    { role: 'tool', text: 'state' },
  ],
  lastUserMessage: 'Assess',
  userMessages: ['Assess'],
  userMessageCount: 1,
  tools: ['read_assessment', 'investigate_assessment', 'finish_assessment'].map((name) => ({
    name,
  })),
  toolResults: [
    { id: 'r', name: 'read_assessment', output: { ok: true, assessment: board }, isError: false },
  ],
};
it('chooses the offered action and current revision', () => {
  expect(chooseFixtureAction(request).toolCalls).toEqual([
    { name: 'investigate_assessment', input: { actionId: 'market-7', expectedRevision: 7 } },
  ]);
});
it('finishes when the budget leaves no offered work', () => {
  expect(
    chooseFixtureAction({
      ...request,
      toolResults: [
        { ...request.toolResults[0], output: { assessment: { ...board, offeredActions: [] } } },
      ],
    }).toolCalls?.[0].name,
  ).toBe('finish_assessment');
});
it('reloads authoritative state at the beginning of a continuation', () => {
  expect(
    chooseFixtureAction({
      ...request,
      messages: [...request.messages, { role: 'user', text: 'Continue' }],
      lastUserMessage: 'Continue',
    }).toolCalls,
  ).toEqual([{ name: 'read_assessment', input: {} }]);
});
it('does not invent authority or call an unavailable capability', () => {
  expect(chooseFixtureAction({ ...request, tools: [] }).toolCalls).toBeUndefined();
});
