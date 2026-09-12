/**
 * The shared tool-worker loop. One small agent, one report tool, a hard
 * clock: the worker searches (server `web_search`), then must deliver its
 * whole output as ONE forced-shape tool call. The caller supplies the tool,
 * the system prompt, and up to two push-backs (a citation repair, an
 * empty-report nudge) that each fire at most once inside the same
 * conversation.
 *
 * Both agents run on this loop — the inspector's findings workers and the
 * salvage evidence workers — so the container-id handling, the deadline
 * abort, and the progress grammar (`[lane] note`) exist exactly once
 * (`docs/patterns.md §5.5`). The loop owns no prompt and no schema: what a
 * worker researches, and what counts as a usable report, belong to the
 * domain that asks.
 *
 * A run either produced a report or it did not, and the loop names which
 * kind of "did not" it was: an exhausted clock and a worker that never
 * called its tool are different facts about the car, and neither is
 * recoverable from the clock a caller can read afterwards.
 */

// The SDK type is reached through a type-only dynamic import: the loop takes
// a client, it never constructs one, so nothing here loads the SDK.
export type AnthropicClient = InstanceType<(typeof import('@anthropic-ai/sdk'))['default']>;

export const RESEARCH_MODEL = 'claude-sonnet-5';

// A turn needs room to search, read and report; below this the loop stops
// rather than start one it cannot finish. The threshold stays private: the
// stop reason travels in the outcome, so no caller measures against it.
const EARLY_EXIT_MS = 5_000;

export type ToolWorkerSpec = {
  tag: string; // console lane: '[resale] searching: …'
  system: string;
  userMessage: string;
  tool: { name: string; description: string; strict?: boolean; input_schema: unknown };
  maxSearches: number;
  maxTurns: number;
  maxTokens: number;
  budgetMs: number;
  // Fires once when the first report needs a fix; return the tool_result
  // error text, or null when the report is acceptable.
  repair?: (input: unknown) => string | null;
  // Fires once when the report is empty after the worker actually read
  // search results; return the push-back text, or null to accept.
  emptyPushback?: (input: unknown) => string | null;
  onProgress?: (note: string) => void;
};

/**
 * What one worker run produced. `result` is the accepted report's tool
 * input, unvalidated — the domain that supplied the schema parses it.
 * `stopped` is the loop's own account of why there is no report:
 * `out-of-time` when the budget ran out (a partial answer is honest, an
 * empty one may be too), `never-reported` when the worker had the turns and
 * the clock and still never called its tool (a failure, never an answer).
 */
export type ToolWorkerOutcome = { result: unknown } | { stopped: 'out-of-time' | 'never-reported' };

export async function runToolWorker(
  client: AnthropicClient,
  spec: ToolWorkerSpec,
): Promise<ToolWorkerOutcome> {
  const deadline = Date.now() + spec.budgetMs;
  const say = (text: string) => spec.onProgress?.(`[${spec.tag}] ${text}`);
  type Msg = { role: 'user' | 'assistant'; content: unknown };
  let messages: Msg[] = [{ role: 'user', content: spec.userMessage }];
  let repairUsed = false;
  let emptyPushbackUsed = false;
  let sawResults = false;
  // Server-side search executes in a container; every continuation request
  // (pause, nudge, repair, push-back) MUST return its id or the API 400s
  // with "container_id is required" AFTER the search money is spent.
  let containerId: string | undefined;
  say('starting');

  for (let turn = 0; turn < spec.maxTurns; turn++) {
    const remaining = deadline - Date.now();
    if (remaining < EARLY_EXIT_MS) {
      say('out of time, keeping whatever was cited');
      return { stopped: 'out-of-time' };
    }
    const stream = client.messages.stream({
      model: RESEARCH_MODEL,
      max_tokens: spec.maxTokens,
      system: spec.system,
      tools: [
        // allowed_callers 'direct' forces the classic server-tool flow: the
        // default (programmatic calling inside a code-execution container)
        // is what made continuations demand a container_id at all.
        {
          type: 'web_search_20260318',
          name: 'web_search',
          max_uses: spec.maxSearches,
          allowed_callers: ['direct'],
        } as never,
        spec.tool as never,
      ],
      ...(containerId ? { container: containerId } : {}),
      messages: messages as never,
    });
    // The hard deadline: request timeouts do not bound a stream that keeps
    // trickling tokens, so the worker aborts its own stream on the clock.
    const killer = setTimeout(() => stream.controller.abort(), remaining);
    // Capture the container id from RAW events: the SDK's accumulator drops
    // the field from message_delta, so finalMessage() never carries it and
    // continuations 400 with "container_id is required".
    stream.on('streamEvent', (event) => {
      const fromStart = (event as { message?: { container?: { id?: string } | null } }).message
        ?.container?.id;
      const fromDelta = (event as { delta?: { container?: { id?: string } | null } }).delta
        ?.container?.id;
      containerId = fromDelta ?? fromStart ?? containerId;
    });
    stream.on('contentBlock', (block) => {
      if (block.type === 'server_tool_use' && block.name === 'web_search') {
        const query = (block.input as { query?: string } | null)?.query;
        if (query) say(`searching: ${query}`);
      } else if (block.type === 'web_search_tool_result') {
        sawResults = true;
        const n = Array.isArray((block as { content?: unknown }).content)
          ? ((block as { content: unknown[] }).content.length ?? 0)
          : 0;
        say(n > 0 ? `reading ${n} sources` : 'reading results');
      } else if (block.type === 'tool_use' && block.name === spec.tool.name) {
        say('reporting'); // the silent stretch is the report streaming in
      } else if (block.type === 'text') {
        say('writing up what the sources say');
      }
    });

    let response;
    try {
      response = await stream.finalMessage();
    } catch (err) {
      clearTimeout(killer);
      if (Date.now() >= deadline - 1_000) {
        say(`hit the ${Math.round(spec.budgetMs / 1000)}s budget, moving on without this topic`);
        return { stopped: 'out-of-time' };
      }
      throw err;
    }
    clearTimeout(killer);
    containerId = (response as { container?: { id?: string } }).container?.id ?? containerId;

    const report = response.content.find(
      (block) => block.type === 'tool_use' && block.name === spec.tool.name,
    );
    if (report && report.type === 'tool_use') {
      const pushback = (text: string) => {
        messages = [
          ...messages,
          { role: 'assistant', content: response.content },
          {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: report.id, is_error: true, content: text },
            ],
          },
        ];
      };
      const repairText = !repairUsed && spec.repair ? spec.repair(report.input) : null;
      if (repairText) {
        repairUsed = true;
        say('report needs a fix, asking once');
        pushback(repairText);
        continue;
      }
      const emptyText =
        !emptyPushbackUsed && sawResults && spec.emptyPushback
          ? spec.emptyPushback(report.input)
          : null;
      if (emptyText) {
        emptyPushbackUsed = true;
        say('reported empty after reading sources, pushing back once');
        pushback(emptyText);
        continue;
      }
      return { result: report.input };
    }

    if (response.stop_reason === 'pause_turn') {
      say('long turn, continuing');
      messages = [...messages, { role: 'assistant', content: response.content }];
      continue;
    }

    messages = [
      ...messages,
      { role: 'assistant', content: response.content },
      { role: 'user', content: `Call ${spec.tool.name} now with your findings.` },
    ];
  }
  say('never reported, dropping this topic');
  return { stopped: 'never-reported' };
}
