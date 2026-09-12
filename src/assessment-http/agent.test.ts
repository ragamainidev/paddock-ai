import { describe, expect, it, vi } from 'vitest';
import {
  agentBaseUrl,
  agentCapability,
  assessmentAgentStatus,
  dispatchAssessment,
  type AgentReceipt,
  type DeliveryQueue,
} from './agent';

const TOKEN = 'bridge-token-0123456789-abcdef';
const LOCAL = { PADDOCK_AGENT_TOKEN: TOKEN, PADDOCK_AGENT_URL: 'http://127.0.0.1:2001' };
const RECEIPT: AgentReceipt = {
  assessmentId: 'car-1',
  epoch: 3,
  modelMode: 'fixture',
  sessionId: 'wrun_A',
};

function accepted(sessionId: string, status = 202) {
  return Response.json({ ok: true, sessionId, status: 'accepted' }, { status });
}

function notActive() {
  return Response.json({ ok: false, code: 'session_not_active' }, { status: 409 });
}

/** Drives the one-second wake retry without spending it. */
async function withWakeDelay<T>(operation: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  try {
    const result = operation();
    await vi.advanceTimersByTimeAsync(1000);
    return await result;
  } finally {
    vi.useRealTimers();
  }
}

function fakeQueue(overrides: Partial<DeliveryQueue> = {}): DeliveryQueue {
  return {
    beginDelivery: vi.fn<DeliveryQueue['beginDelivery']>(async () => ({
      fresh: true,
      receipt: undefined,
      uncertain: false,
    })),
    deliveredSession: vi.fn<DeliveryQueue['deliveredSession']>(async () => undefined),
    received: vi.fn<DeliveryQueue['received']>(async () => undefined),
    releaseDelivery: vi.fn<DeliveryQueue['releaseDelivery']>(async () => undefined),
    retryUndelivered: vi.fn<DeliveryQueue['retryUndelivered']>(async () => true),
    status: vi.fn<DeliveryQueue['status']>(async () => null),
    ...overrides,
  };
}

describe('assessment runtime bridge', () => {
  it('stays unavailable until the bridge credential is configured', () => {
    expect(agentCapability({})).toEqual({ configured: false });
    expect(agentCapability({ PADDOCK_AGENT_TOKEN: TOKEN })).toEqual({ configured: true });
  });

  it('resolves the agent address from configuration, the deployment, then a loopback request', () => {
    expect(agentBaseUrl(LOCAL).origin).toBe('http://127.0.0.1:2001');
    expect(agentBaseUrl({ VERCEL: '1', VERCEL_URL: 'paddock.vercel.app' }).origin).toBe(
      'https://paddock.vercel.app',
    );
    expect(agentBaseUrl({}, 'http://localhost:3000').origin).toBe('http://localhost:3000');
    expect(agentBaseUrl({}, 'http://[::1]:3000').origin).toBe('http://[::1]:3000');
    expect(() => agentBaseUrl({})).toThrow('not connected');
    expect(() => agentBaseUrl({ PADDOCK_AGENT_URL: 'ftp://agent' })).toThrow('address is invalid');
    expect(() => agentBaseUrl({ VERCEL: '1' }, 'http://127.0.0.1:3000')).toThrow(
      'address is invalid',
    );
  });

  it('never sends the bridge credential to an address a forged host header named', () => {
    // The origin is derived from `host`/`x-forwarded-host`; a non-loopback one
    // is refused outright rather than addressed with the bridge credential.
    expect(() => agentBaseUrl({}, 'https://evil.example')).toThrow(
      'The research agent is not connected. Your assessment is saved.',
    );
    expect(() => agentBaseUrl({}, 'https://localhost.evil.example')).toThrow('not connected');
    expect(() => agentBaseUrl({}, 'not a url')).toThrow('not connected');
    // A configured deployment address still wins over the request's own.
    expect(agentBaseUrl({ VERCEL_URL: 'paddock.vercel.app' }, 'https://evil.example').origin).toBe(
      'https://paddock.vercel.app',
    );
    expect(agentBaseUrl(LOCAL, 'https://evil.example').origin).toBe('http://127.0.0.1:2001');
  });

  it('starts a session with the owner, epoch and delivery scope, then records the receipt', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(accepted('wrun_A'));
    const queue = fakeQueue();
    const receipt = await dispatchAssessment('car-1', 'owner', {
      dispatchId: 'car-1:3:2',
      env: LOCAL,
      expectedEpoch: 3,
      fetcher,
      queue,
    });
    expect(receipt).toEqual(RECEIPT);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:2001/eve/v1/session');
    expect(options?.headers).toEqual({
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      'x-paddock-assessment': 'car-1',
      'x-paddock-dispatch': 'car-1:3:2',
      'x-paddock-epoch': '3',
      'x-paddock-owner': 'owner',
    });
    expect(JSON.parse(String(options?.body))).toEqual({
      message: expect.stringContaining('Read the saved assessment'),
      operationId: 'car-1:3:2',
    });
    expect(queue.beginDelivery).toHaveBeenCalledWith('owner', 'car-1', 3, 'car-1:3:2');
    expect(queue.received).toHaveBeenCalledWith('car-1:3:2', RECEIPT);
  });

  it('reads the durable session from the header when the body omits it', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(null, { status: 202, headers: { 'x-eve-session-id': 'wrun_A' } }),
      );
    await expect(
      dispatchAssessment('car-1', 'owner', {
        dispatchId: 'car-1:3:2',
        env: LOCAL,
        expectedEpoch: 3,
        fetcher,
        queue: fakeQueue(),
      }),
    ).resolves.toEqual(RECEIPT);
  });

  it('sends the deployment-protection bypass when the secret is set', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(accepted('wrun_A'));
    await dispatchAssessment('car-1', 'owner', {
      dispatchId: 'car-1:3:2',
      env: { ...LOCAL, VERCEL_AUTOMATION_BYPASS_SECRET: 'bypass-secret' },
      expectedEpoch: 3,
      fetcher,
      queue: fakeQueue(),
    });
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({
      'x-vercel-protection-bypass': 'bypass-secret',
    });
  });

  it('returns the accepted receipt of a repeated delivery without a second session', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const queue = fakeQueue({
      beginDelivery: vi.fn<DeliveryQueue['beginDelivery']>(async () => ({
        fresh: false,
        receipt: { ...RECEIPT },
        uncertain: false,
      })),
    });
    await expect(
      dispatchAssessment('car-1', 'owner', {
        dispatchId: 'car-1:3:2',
        env: LOCAL,
        expectedEpoch: 3,
        fetcher,
        queue,
      }),
    ).resolves.toEqual(RECEIPT);
    expect(fetcher).not.toHaveBeenCalled();
    expect(queue.received).not.toHaveBeenCalled();
  });

  it('continues the session already recorded for the epoch', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(accepted('wrun_A'));
    const queue = fakeQueue({
      deliveredSession: vi.fn<DeliveryQueue['deliveredSession']>(async () => 'wrun_A'),
    });
    await dispatchAssessment('car-1', 'owner', {
      dispatchId: 'car-1:3:3',
      env: LOCAL,
      expectedEpoch: 3,
      fetcher,
      queue,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:2001/eve/v1/session/wrun_A');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).not.toHaveProperty('operationId');
  });

  it('waits out a session whose inbox is still starting instead of opening a second one', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(notActive())
      .mockResolvedValueOnce(accepted('wrun_A'));
    const queue = fakeQueue({
      deliveredSession: vi.fn<DeliveryQueue['deliveredSession']>(async () => 'wrun_A'),
    });
    const receipt = await withWakeDelay(() =>
      dispatchAssessment('car-1', 'owner', {
        dispatchId: 'car-1:3:3',
        env: LOCAL,
        expectedEpoch: 3,
        fetcher,
        queue,
      }),
    );
    expect(receipt).toMatchObject({ sessionId: 'wrun_A' });
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      'http://127.0.0.1:2001/eve/v1/session/wrun_A',
      'http://127.0.0.1:2001/eve/v1/session/wrun_A',
    ]);
  });

  it('starts a fresh session only when the recorded one refuses twice', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(notActive())
      .mockResolvedValueOnce(notActive())
      .mockResolvedValueOnce(accepted('wrun_B'));
    const queue = fakeQueue({
      deliveredSession: vi.fn<DeliveryQueue['deliveredSession']>(async () => 'wrun_A'),
    });
    const receipt = await withWakeDelay(() =>
      dispatchAssessment('car-1', 'owner', {
        dispatchId: 'car-1:3:3',
        env: LOCAL,
        expectedEpoch: 3,
        fetcher,
        queue,
      }),
    );
    expect(receipt).toMatchObject({ sessionId: 'wrun_B' });
    expect(fetcher.mock.calls[2][0]).toBe('http://127.0.0.1:2001/eve/v1/session');
  });

  it('does not echo the runtime error body or credentials', async () => {
    const fetcher = async () => new Response('private upstream error', { status: 401 });
    await expect(
      dispatchAssessment('car-1', 'owner', {
        dispatchId: 'car-1:3:2',
        env: LOCAL,
        expectedEpoch: 3,
        fetcher,
        queue: fakeQueue(),
      }),
    ).rejects.toThrow('not accepted');
  });

  it('releases a delivery the agent never received, and keeps an uncertain one', async () => {
    const unreachable = fakeQueue();
    await expect(
      dispatchAssessment('car-1', 'owner', {
        dispatchId: 'car-1:3:2',
        env: LOCAL,
        expectedEpoch: 3,
        fetcher: () => Promise.reject(new TypeError('fetch failed')),
        queue: unreachable,
      }),
    ).rejects.toThrow('could not be reached');
    expect(unreachable.releaseDelivery).toHaveBeenCalledWith('car-1:3:2');

    const uncertain = fakeQueue();
    await expect(
      dispatchAssessment('car-1', 'owner', {
        dispatchId: 'car-1:3:2',
        env: LOCAL,
        expectedEpoch: 3,
        fetcher: () => Promise.reject(new DOMException('timed out', 'TimeoutError')),
        queue: uncertain,
      }),
    ).rejects.toThrow('could not be reached');
    expect(uncertain.releaseDelivery).not.toHaveBeenCalled();
  });

  it('cancels the turn on the session recorded for the current epoch', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
    const queue = fakeQueue({
      deliveredSession: vi.fn<DeliveryQueue['deliveredSession']>(async () => 'wrun_A'),
    });
    await expect(
      dispatchAssessment('car-1', 'owner', {
        cancel: true,
        env: LOCAL,
        expectedEpoch: 3,
        fetcher,
        queue,
      }),
    ).resolves.toEqual({ cancelled: true });
    expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:2001/eve/v1/session/wrun_A/cancel');
  });

  it('accepts cancellation of an assessment that never reached a session', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      dispatchAssessment('car-1', 'owner', {
        cancel: true,
        env: LOCAL,
        expectedEpoch: 3,
        fetcher,
        queue: fakeQueue(),
      }),
    ).resolves.toEqual({ cancelled: true });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('agent capability status', () => {
  const LIVE = {
    ...LOCAL,
    PADDOCK_AGENT_MODE: 'live-coordinator',
    PADDOCK_AGENT_LIVE_ACK: 'yes',
    PADDOCK_AGENT_MODEL: 'test/model',
    AI_GATEWAY_API_KEY: 'test-key',
    PADDOCK_AGENT_ALLOW_LIVE_EVIDENCE: 'yes',
  };
  const ready = () => Response.json({ ok: true, status: 'ready', workflowId: 'w' });

  it('reports the coordinator only when the agent answers its health route', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(ready());
    await expect(assessmentAgentStatus({ env: LIVE, fetcher })).resolves.toEqual({
      configured: true,
      liveEvidenceEnabled: true,
      modelMode: 'live-coordinator',
    });
    expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:2001/eve/v1/health');
  });

  it('claims no capability for an agent that is not answering', async () => {
    for (const fetcher of [
      vi.fn<typeof fetch>().mockResolvedValue(new Response('down', { status: 503 })),
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true, status: 'starting' })),
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed')),
    ]) {
      await expect(assessmentAgentStatus({ env: LIVE, fetcher })).resolves.toEqual({
        configured: false,
        liveEvidenceEnabled: false,
      });
    }
  });

  it('claims no capability without a bridge credential, and never probes', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(assessmentAgentStatus({ env: {}, fetcher })).resolves.toEqual({
      configured: false,
      liveEvidenceEnabled: false,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
