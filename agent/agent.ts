/** Bounded Paddock coordinator with explicit local fixture versus paid model provenance. */
import { defineAgent, defineDynamic } from 'eve';
import { defineState } from 'eve/context';
import { createGateway, wrapLanguageModel } from 'ai';
import { fixtureModel } from './lib/fixture-model';
import { modelMode } from './lib/settings';
import { getScopedAssessment } from './lib/domain';
import { reserveLiveModelCall } from './lib/events';

const calls = defineState('paddock.coordinator.calls', () => 0);
export default defineAgent({
  defaultTools: false,
  build: { externalDependencies: ['@libsql/client'] },
  model: defineDynamic({
    events: {
      'step.started': async (_event, ctx) => {
        const { scope } = await getScopedAssessment(ctx);
        if (calls.get() >= (modelMode() === 'fixture' ? 32 : 12))
          throw new Error('Coordinator model-call limit reached. Assessment state remains saved.');
        calls.update((n) => n + 1);
        if (modelMode() === 'fixture')
          return { model: fixtureModel, modelContextWindowTokens: 32_000 };
        const gateway = createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY });
        const model = wrapLanguageModel({
          model: gateway(process.env.PADDOCK_AGENT_MODEL!),
          middleware: {
            specificationVersion: 'v4',
            wrapGenerate: async ({ doGenerate }) => {
              await reserveLiveModelCall(scope.ownerId, scope.assessmentId, ctx.session.id);
              return doGenerate();
            },
            wrapStream: async ({ doStream }) => {
              await reserveLiveModelCall(scope.ownerId, scope.assessmentId, ctx.session.id);
              return doStream();
            },
            transformParams: async ({ params }) => ({
              ...params,
              maxOutputTokens: Math.min(params.maxOutputTokens ?? 512, 512),
              abortSignal: params.abortSignal
                ? AbortSignal.any([params.abortSignal, AbortSignal.timeout(30_000)])
                : AbortSignal.timeout(30_000),
            }),
          },
        });
        return { model, modelContextWindowTokens: 32_000 };
      },
    },
  }),
  limits: {
    maxInputTokensPerSession: 60_000,
    maxOutputTokensPerSession: 6_144,
    maxTokenCostUsdPerSession: 0.25,
  },
});
