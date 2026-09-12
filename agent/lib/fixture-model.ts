/** Zero-cost local policy LanguageModel. Decisions depend on current offered work, not a transcript. */
import { mockModel, type MockModelRequest, type MockModelResponse } from 'eve/evals';
import { boardSchema } from './board';

export function chooseFixtureAction(request: MockModelRequest): MockModelResponse {
  const available = new Set(request.tools.map((t) => t.name));
  const last = request.toolResults.at(-1);
  const data = typeof last?.output === 'string' ? safelyParse(last.output) : last?.output;
  const board = boardSchema.safeParse(
    data && typeof data === 'object' && 'assessment' in data ? data.assessment : null,
  );
  const call = (name: string, input: unknown): MockModelResponse =>
    available.has(name)
      ? { toolCalls: [{ name, input }] }
      : { text: 'Required bounded capability unavailable.' };
  // Every externally requested turn reloads persisted state even when prior conversation history exists.
  const lastUserIndex = request.messages.map((m) => m.role).lastIndexOf('user');
  const currentHasResult = request.messages.slice(lastUserIndex + 1).some((m) => m.role === 'tool');
  if (!currentHasResult || !last || !board.success) return call('read_assessment', {});
  if (last.name === 'finish_assessment')
    return {
      text: `Saved revision ${board.data.revision}; ${board.data.decision.verdict}. Fixture coordinator; no provider calls.`,
    };
  if (board.data.status === 'investigating')
    return { text: 'An investigation is pending. Continue after its lease settles.' };
  // The domain ranks expected decision impact. Preserve that order instead
  // of imposing a generic VIN/photo/market script or a per-turn handoff.
  const action = board.data.offeredActions[0];
  if (board.data.status === 'active' && action) {
    return call('investigate_assessment', {
      actionId: action.id,
      expectedRevision: board.data.revision,
    });
  }
  return call('finish_assessment', {
    expectedRevision: board.data.revision,
    reason:
      board.data.decision.readiness === 'vetoed'
        ? 'A domain veto prevents proceeding.'
        : action
          ? 'The decision is ready.'
          : 'No eligible investigation remains within the current budget.',
  });
}
function safelyParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
export const fixtureModel = mockModel({
  modelId: 'paddock-offered-actions-v1',
  provider: 'paddock-fixture',
  respond: async (request) => {
    const delay = Math.min(
      250,
      Math.max(0, Number(process.env.PADDOCK_AGENT_FIXTURE_DELAY_MS) || 0),
    );
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    return chooseFixtureAction(request);
  },
});
