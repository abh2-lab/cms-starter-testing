import { apiFetch } from '@/lib/api';

export interface AiStatus {
  enabled: boolean;
  configured: boolean;
}

export type ChatRole = 'user' | 'assistant';

export interface ChatHistoryItem {
  role: ChatRole;
  content: string;
}

// Frames streamed from POST /api/admin/ai/chat (mirror of the server's
// ChatStreamEvent in apps/api/src/lib/ai/types.ts).
export type ChatStreamEvent =
  | { type: 'token'; text: string }
  | {
      type: 'tool';
      phase: 'start' | 'end';
      name: string;
      mode?: 'executory' | 'advisory';
      ok?: boolean;
      summary?: string;
    }
  | { type: 'done' }
  | { type: 'error'; message: string };

export const aiChatApi = {
  // Admin-readable gate: returns only { enabled, configured } (no secrets).
  status: () => apiFetch<AiStatus>('/admin/ai/status'),
};

/**
 * Stream a chat turn. POSTs the prior history and reads SSE-over-POST frames
 * from the response body (EventSource can't POST or carry the session cookie
 * cleanly, so we parse the `data:` frames ourselves off a fetch stream).
 */
export async function streamChat(
  messages: ChatHistoryItem[],
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
  currentRouteName?: string,
): Promise<void> {
  const res = await fetch('/api/admin/ai/chat', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    // `currentRouteName: undefined` is dropped by JSON.stringify, so the body
    // stays `{ messages }` when no route is supplied (server treats it optional).
    body: JSON.stringify({ messages, currentRouteName }),
    signal: signal ?? null,
  });

  if (!res.ok || !res.body) {
    let message = `Request failed (HTTP ${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body && typeof body.error === 'string') message = body.error;
    } catch {
      /* non-JSON error body */
    }
    onEvent({ type: 'error', message });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line; keep the trailing partial.
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const dataLine = frame
        .split('\n')
        .find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      const data = dataLine.slice(5).trim();
      if (!data) continue;
      try {
        onEvent(JSON.parse(data) as ChatStreamEvent);
      } catch {
        /* ignore malformed frame */
      }
    }
  }
}
