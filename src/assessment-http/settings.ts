/** Explicit runtime provenance and fail-closed live-coordinator admission. */
export type ModelMode = 'fixture' | 'live-coordinator';

export function modelMode(env: Record<string, string | undefined> = process.env): ModelMode {
  const mode = env.PADDOCK_AGENT_MODE ?? 'fixture';
  if (mode === 'fixture') return mode;
  if (mode !== 'live-coordinator') throw new Error('Unsupported PADDOCK_AGENT_MODE.');
  if (env.PADDOCK_AGENT_LIVE_ACK !== 'yes' || !env.AI_GATEWAY_API_KEY || !env.PADDOCK_AGENT_MODEL) {
    throw new Error('Live coordinator requires explicit acknowledgement, model and gateway key.');
  }
  return mode;
}

export function liveEvidenceEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.PADDOCK_AGENT_ALLOW_LIVE_EVIDENCE === 'yes' && modelMode(env) === 'live-coordinator';
}
