import { streamChatCompletion } from './openai-compat-client.js';
import { dispatchTool, getToolMode, type ToolContext } from './tools.js';
import type {
  ChatMessage,
  ChatStreamEvent,
  ToolDefinition,
  ToolResult,
} from './types.js';

export interface ChatLoopParams {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  ctx: ToolContext;
  emit: (event: ChatStreamEvent) => void;
  signal?: AbortSignal;
  maxRounds?: number;
}

/**
 * The manual agentic loop. Each round streams one assistant completion; if it
 * ends with tool calls we execute them (forwarding the session cookie via
 * dispatchTool → fastify.inject), append the results, and loop. A pure-text
 * completion ends the turn. Manual (not an auto-runner) so advisory gating and
 * audit annotation stay in our hands.
 */
export async function runChatLoop(p: ChatLoopParams): Promise<void> {
  const maxRounds = p.maxRounds ?? 8;
  const messages: ChatMessage[] = [...p.messages];

  for (let round = 0; round < maxRounds; round++) {
    let assistantText = '';
    // Tool-call fragments arrive interleaved and split across deltas; join by index.
    const acc = new Map<
      number,
      { id: string; name: string; args: string; extra?: unknown }
    >();

    for await (const delta of streamChatCompletion({
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      model: p.model,
      messages,
      tools: p.tools,
      signal: p.signal,
    })) {
      if (delta.contentDelta) {
        assistantText += delta.contentDelta;
        p.emit({ type: 'token', text: delta.contentDelta });
      }
      if (delta.toolCalls) {
        for (const tc of delta.toolCalls) {
          const cur = acc.get(tc.index) ?? { id: '', name: '', args: '' };
          if (tc.id) cur.id = tc.id;
          if (tc.name) cur.name = tc.name;
          if (tc.argumentsDelta) cur.args += tc.argumentsDelta;
          if (tc.extraContent !== undefined) cur.extra = tc.extraContent;
          acc.set(tc.index, cur);
        }
      }
    }

    const calls = [...acc.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, t], i) => ({
        id: t.id || `call_${round}_${i}`,
        name: t.name,
        args: t.args || '{}',
        extra: t.extra,
      }))
      .filter((t) => t.name);

    // No tool calls → the assistant gave its final answer for this turn.
    if (calls.length === 0) {
      p.emit({ type: 'done' });
      return;
    }

    // Record the assistant's tool-call message, then execute each call.
    messages.push({
      role: 'assistant',
      content: assistantText || null,
      tool_calls: calls.map((t) => ({
        id: t.id,
        type: 'function',
        function: { name: t.name, arguments: t.args },
        // Echo back Gemini's thought_signature (and any future provider
        // passthrough); omitted entirely for providers that don't send it.
        ...(t.extra !== undefined ? { extra_content: t.extra } : {}),
      })),
    });

    for (const t of calls) {
      const mode = getToolMode(t.name);
      p.emit({ type: 'tool', phase: 'start', name: t.name, mode });
      let result: ToolResult;
      try {
        const args = JSON.parse(t.args || '{}') as Record<string, unknown>;
        result = await dispatchTool(t.name, args, p.ctx);
      } catch (e) {
        result = {
          ok: false,
          summary: 'tool failed',
          content: { error: e instanceof Error ? e.message : String(e) },
        };
      }
      p.emit({
        type: 'tool',
        phase: 'end',
        name: t.name,
        mode,
        ok: result.ok,
        summary: result.summary,
      });
      messages.push({
        role: 'tool',
        tool_call_id: t.id,
        content: JSON.stringify(result.content),
      });
    }
  }

  // Safety valve: don't loop forever on a runaway tool chain.
  p.emit({
    type: 'token',
    text: '\n\n_(Stopped: reached the tool-step limit for one message. Ask me to continue if needed.)_',
  });
  p.emit({ type: 'done' });
}
