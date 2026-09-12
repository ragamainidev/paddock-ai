/** Admission and opt-in guards run without starting providers or the Eve server. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Assessment } from '../../src/assessments/types';
import {
  assessmentIdInput,
  assessmentPrincipal,
  assessmentScope,
  bridgeAuth,
  bridgeAuthorized,
  ownerInput,
} from '../../agent/lib/auth';
import { liveEvidenceEnabled, modelMode } from '../../agent/lib/settings';

const stored = new Map<string, Pick<Assessment, 'id' | 'epoch' | 'mode'>>();
vi.mock('../../src/assessments/service', () => ({
  getAssessmentService: () => ({
    getAssessment: async (ownerId: string, id: string) => stored.get(`${ownerId}/${id}`) ?? null,
  }),
}));

const secret = 'fixture-only-test-secret-0123456789';
const scopeHeaders = {
  authorization: `Bearer ${secret}`,
  'x-paddock-owner': 'alice',
  'x-paddock-assessment': 'assessment_1',
  'x-paddock-epoch': '2',
  'x-paddock-dispatch': 'assessment_1:2:1',
};

function bridgeRequest(headers: Record<string, string>) {
  return new Request('http://localhost/eve/v1/session', { method: 'POST', headers });
}

/** The auth walk rejects by throwing a framework error carrying its response. */
async function rejection(headers: Record<string, string>): Promise<number> {
  try {
    await bridgeAuth()(bridgeRequest(headers));
  } catch (error) {
    if (error instanceof Error && 'response' in error && error.response instanceof Response)
      return error.response.status;
    throw error;
  }
  throw new Error('The auth walk accepted a request it must refuse.');
}

describe('assessment runtime admission', () => {
  it('fails closed on absent, short, incorrect and missing secrets', () => {
    const request = new Request('http://localhost/eve/v1/health');
    expect(bridgeAuthorized(request, '')).toBe(false);
    expect(bridgeAuthorized(request, 'short')).toBe(false);
    expect(bridgeAuthorized(request, secret)).toBe(false);
    expect(
      bridgeAuthorized(
        new Request(request, { headers: { authorization: `Bearer ${secret}` } }),
        secret,
      ),
    ).toBe(true);
  });

  it('rejects caller-supplied authority and route traversal', () => {
    expect(ownerInput.safeParse({ ownerId: 'alice', assessmentId: 'other' }).success).toBe(false);
    expect(assessmentIdInput.safeParse('../other').success).toBe(false);
    const current = assessmentPrincipal('alice', 'assessment_1', 0);
    const ctx = {
      session: {
        id: 's',
        turn: { id: 't', sequence: 1 },
        auth: { current, initiator: current },
        parent: null,
      },
    };
    expect(assessmentScope(ctx)).toEqual({
      ownerId: 'alice',
      assessmentId: 'assessment_1',
      epoch: 0,
    });
    expect(() =>
      assessmentScope({
        session: {
          ...ctx.session,
          auth: { current, initiator: assessmentPrincipal('bob', 'assessment_1', 0) },
        },
      }),
    ).toThrow('not authorized');
  });

  it('pins trusted principal scope to one epoch', () => {
    const current = assessmentPrincipal('alice', 'assessment_1', 1);
    expect(assessmentScope({ session: { auth: { current, initiator: current } } })).toEqual({
      ownerId: 'alice',
      assessmentId: 'assessment_1',
      epoch: 1,
    });
    expect(() =>
      assessmentScope({
        session: { auth: { current, initiator: assessmentPrincipal('alice', 'assessment_1', 0) } },
      }),
    ).toThrow('not authorized');
    const missing = { ...current, attributes: { assessmentId: 'assessment_1' } };
    expect(() =>
      assessmentScope({ session: { auth: { current: missing, initiator: missing } } }),
    ).toThrow('not authorized');
  });

  it('defaults to a fixture and requires every live switch', () => {
    expect(modelMode({})).toBe('fixture');
    expect(liveEvidenceEnabled({ PADDOCK_AGENT_ALLOW_LIVE_EVIDENCE: 'yes' })).toBe(false);
    expect(
      liveEvidenceEnabled({
        PADDOCK_AGENT_MODE: 'live-coordinator',
        PADDOCK_AGENT_LIVE_ACK: 'yes',
        AI_GATEWAY_API_KEY: 'test',
        PADDOCK_AGENT_MODEL: 'test/model',
        PADDOCK_AGENT_ALLOW_LIVE_EVIDENCE: 'yes',
      }),
    ).toBe(true);
    expect(() => modelMode({ PADDOCK_AGENT_MODE: 'live-coordinator' })).toThrow();
    expect(() => modelMode({ PADDOCK_AGENT_MODE: 'unknown' })).toThrow();
    expect(
      modelMode({
        PADDOCK_AGENT_MODE: 'live-coordinator',
        PADDOCK_AGENT_LIVE_ACK: 'yes',
        AI_GATEWAY_API_KEY: 'test',
        PADDOCK_AGENT_MODEL: 'test/model',
      }),
    ).toBe('live-coordinator');
  });
});

describe('framework channel auth walk', () => {
  beforeEach(() => {
    vi.stubEnv('PADDOCK_AGENT_TOKEN', secret);
    stored.set('alice/assessment_1', { id: 'assessment_1', epoch: 2, mode: 'fixture' });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    stored.clear();
  });

  it('answers 401 for an absent, short or incorrect bridge credential', async () => {
    const unauthenticated = { ...scopeHeaders, authorization: '' };
    expect(await rejection(unauthenticated)).toBe(401);
    expect(await rejection({ ...scopeHeaders, authorization: 'Bearer short' })).toBe(401);
    expect(await rejection({ ...scopeHeaders, authorization: `Bearer ${secret}x` })).toBe(401);
    vi.stubEnv('PADDOCK_AGENT_TOKEN', 'too-short');
    expect(await rejection(scopeHeaders)).toBe(401);
  });

  it('answers 401 when the bridge scope headers are absent or malformed', async () => {
    for (const header of ['x-paddock-owner', 'x-paddock-assessment', 'x-paddock-epoch']) {
      const headers = { ...scopeHeaders };
      delete headers[header as keyof typeof scopeHeaders];
      expect(await rejection(headers)).toBe(401);
    }
    expect(await rejection({ ...scopeHeaders, 'x-paddock-assessment': '../other' })).toBe(401);
    expect(await rejection({ ...scopeHeaders, 'x-paddock-epoch': '-1' })).toBe(401);
    expect(await rejection({ ...scopeHeaders, 'x-paddock-dispatch': '' })).toBe(401);
  });

  it('answers 403 for another owner, an unknown assessment and a superseded epoch', async () => {
    expect(await rejection({ ...scopeHeaders, 'x-paddock-owner': 'bob' })).toBe(403);
    expect(await rejection({ ...scopeHeaders, 'x-paddock-assessment': 'assessment_2' })).toBe(403);
    expect(await rejection({ ...scopeHeaders, 'x-paddock-epoch': '1' })).toBe(403);
  });

  it('answers 403 for live evidence that was never acknowledged', async () => {
    stored.set('alice/assessment_1', { id: 'assessment_1', epoch: 2, mode: 'live' });
    expect(await rejection(scopeHeaders)).toBe(403);
  });

  it('returns exactly the assessment principal the tools already read', async () => {
    const principal = (await bridgeAuth()(bridgeRequest(scopeHeaders))) ?? null;
    expect(principal).toEqual(assessmentPrincipal('alice', 'assessment_1', 2, 'assessment_1:2:1'));
    expect(
      assessmentScope({ session: { auth: { current: principal, initiator: principal } } }),
    ).toEqual({
      ownerId: 'alice',
      assessmentId: 'assessment_1',
      epoch: 2,
      dispatchId: 'assessment_1:2:1',
    });
  });
});
