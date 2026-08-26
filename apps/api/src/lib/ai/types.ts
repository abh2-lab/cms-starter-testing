// Shared shapes for the OpenAI-compatible chat layer. We speak the Chat
// Completions wire format (one code path for OpenAI, Anthropic, Google, and
// local/gateway endpoints), so these mirror that API's subset we use.

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
  // Provider-specific passthrough. Gemini's OpenAI-compat layer attaches
  // `extra_content.google.thought_signature` to each tool call and REQUIRES it
  // echoed back on the follow-up turn (else 400). We capture it off the
  // response and replay it verbatim; other providers simply omit it.
  extra_content?: unknown;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// Result of executing one tool. `content` is JSON-serialized back to the model
// as the tool message; `summary` drives the UI status chip.
export interface ToolResult {
  ok: boolean;
  summary: string;
  content: unknown;
}

// Frames streamed (SSE-over-POST) to the admin panel.
export type ChatStreamEvent =
  | { type: 'token'; text: string }
  | {
      type: 'tool';
      phase: 'start' | 'end';
      name: string;
      mode?: 'executory' | 'advisory' | undefined;
      ok?: boolean | undefined;
      summary?: string | undefined;
    }
  | { type: 'done' }
  | { type: 'error'; message: string };
