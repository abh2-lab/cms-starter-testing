import type { ChatMessage, ToolDefinition } from './types.js';

// Thrown when the upstream provider returns a non-2xx. Carries the status so
// the chat route can surface "401 → check your API key" style messages.
export class AiUpstreamError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AiUpstreamError';
  }
}

// One streamed delta from the provider. Text and tool-call fragments arrive
// interleaved; tool-call `arguments` come in pieces that the caller joins by
// `index`.
export interface UpstreamDelta {
  contentDelta?: string | undefined;
  toolCalls?:
    | Array<{
        index: number;
        id?: string | undefined;
        name?: string | undefined;
        argumentsDelta?: string | undefined;
        extraContent?: unknown;
      }>
    | undefined;
  finishReason?: string | null | undefined;
}

// Minimal shape of an OpenAI-compatible streaming chunk (the bits we read).
interface UpstreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
        extra_content?: unknown;
      }>;
    };
    finish_reason?: string | null;
  }>;
}

export interface StreamParams {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  signal?: AbortSignal | undefined;
}

// Providers (especially Gemini) frequently return transient 503/overload or
// drop the connection ("fetch failed"). Retry the request a couple of times
// with backoff BEFORE we start consuming the stream. Retrying mid-stream would
// duplicate already-emitted tokens, so a mid-stream drop still propagates.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function backoffMs(attempt: number): number {
  return 400 * Math.pow(3, attempt - 1); // 400ms, 1200ms, …
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

async function openStream(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
  attempts = 3,
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (e) {
      // Network-level failure (undici "fetch failed" / connection reset).
      if (signal?.aborted || attempt >= attempts) {
        throw new AiUpstreamError(
          503,
          e instanceof Error ? e.message : 'connection failed',
        );
      }
      await sleep(backoffMs(attempt), signal);
      continue;
    }
    if (res.ok && res.body) return res;
    if (RETRYABLE_STATUS.has(res.status) && attempt < attempts) {
      await res.text().catch(() => undefined); // drain so the socket frees
      await sleep(backoffMs(attempt), signal);
      continue;
    }
    const text = await res.text().catch(() => '');
    throw new AiUpstreamError(
      res.status,
      text.slice(0, 500) || res.statusText || 'upstream error',
    );
  }
}

/**
 * Stream a chat completion from any OpenAI-compatible endpoint. Yields parsed
 * deltas; the caller assembles assistant text + tool calls and decides what to
 * do on each `finishReason`.
 */
export async function* streamChatCompletion(
  params: StreamParams,
): AsyncGenerator<UpstreamDelta> {
  const url = `${params.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const hasTools = params.tools.length > 0;

  const init: RequestInit = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      ...(hasTools ? { tools: params.tools, tool_choice: 'auto' } : {}),
      stream: true,
    }),
    signal: params.signal ?? null,
  };

  // Retries transient 503/overload/connection failures before streaming.
  const response = await openStream(url, init, params.signal);
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are newline-delimited; keep the trailing partial line.
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '' ) continue;
      if (data === '[DONE]') return;

      let chunk: UpstreamChunk;
      try {
        chunk = JSON.parse(data) as UpstreamChunk;
      } catch {
        continue; // ignore keep-alive/comment frames
      }

      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      const out: UpstreamDelta = {};

      if (typeof delta.content === 'string' && delta.content.length > 0) {
        out.contentDelta = delta.content;
      }
      if (Array.isArray(delta.tool_calls)) {
        out.toolCalls = delta.tool_calls.map((tc, i) => ({
          index: tc.index ?? i,
          id: tc.id,
          name: tc.function?.name,
          argumentsDelta: tc.function?.arguments,
          extraContent: tc.extra_content,
        }));
      }
      if (choice.finish_reason) out.finishReason = choice.finish_reason;

      if (out.contentDelta || out.toolCalls || out.finishReason) {
        yield out;
      }
    }
  }
}
