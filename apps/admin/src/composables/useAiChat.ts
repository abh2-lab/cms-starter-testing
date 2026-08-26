import { readonly, ref } from 'vue';
import { useAuthStore } from '@/stores/auth';
import {
  aiChatApi,
  streamChat,
  type ChatStreamEvent,
} from '@/api/ai-chat';

export interface ToolActivity {
  name: string;
  mode?: 'executory' | 'advisory' | undefined;
  status: 'running' | 'ok' | 'error';
  summary?: string | undefined;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  tools: ToolActivity[];
  time: string;
}

// Module-scope singleton — one AiAssistant panel is mounted at App.vue; any
// trigger drives this same state (mirrors useHelp's pattern).
const isOpen = ref(false);
const available = ref(false); // enabled && configured (from /ai/status)
const checked = ref(false);
const streaming = ref(false);
const turns = ref<ChatTurn[]>([]);
// True when a reply arrived while the panel was closed; drives the FAB dot.
const unread = ref(false);
let controller: AbortController | null = null;

// ── Persistence ────────────────────────────────────────────────────────────
// Chat survives a full page reload. (Closing the panel already preserves it,
// since this is a module singleton — close() only hides it.) Stored PER-USER so
// a shared browser never shows one operator's chat to another. Mirrors the
// localStorage idiom in useTheme.ts. The bin button clears it (see reset()).
const STORAGE_PREFIX = 'admin:ai-chat:';
const MAX_PERSISTED_TURNS = 100;

function storageKey(): string {
  const email = useAuthStore().user?.email ?? 'anon';
  return `${STORAGE_PREFIX}${email}`;
}

function persist(): void {
  try {
    localStorage.setItem(
      storageKey(),
      JSON.stringify(turns.value.slice(-MAX_PERSISTED_TURNS)),
    );
  } catch {
    /* storage full / unavailable — non-fatal */
  }
}

// Hydrate from storage once the user is known (called from the panel). Only
// fills an empty in-memory session so it never clobbers an active conversation.
function loadHistory(): void {
  if (turns.value.length > 0) return;
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) turns.value = parsed as ChatTurn[];
  } catch {
    /* ignore corrupt payload */
  }
}

// Streaming-smoothness: coalesce token appends to one DOM update per animation
// frame instead of one per SSE frame, so the Markdown re-render (and code
// re-highlight) can't thrash if a provider streams in tiny pieces. Non-token
// events flush the buffer first so chips never jump ahead of their text.
let activeIdx = -1;
let pendingText = '';
let rafId: number | null = null;

function flushPending(): void {
  rafId = null;
  if (!pendingText) return;
  const turn = turns.value[activeIdx];
  if (turn) turn.content += pendingText;
  pendingText = '';
}

function applyEvent(event: ChatStreamEvent): void {
  if (event.type === 'token') {
    pendingText += event.text;
    rafId ??= requestAnimationFrame(flushPending);
    return;
  }
  flushPending();
  const turn = turns.value[activeIdx];
  if (!turn) return;
  if (event.type === 'error') {
    turn.content += `${turn.content ? '\n\n' : ''}_⚠ ${event.message}_`;
  } else if (event.type === 'tool') {
    if (event.phase === 'start') {
      turn.tools.push({
        name: event.name,
        mode: event.mode,
        status: 'running',
      });
    } else {
      // Resolve the most recent running entry with this name.
      for (let i = turn.tools.length - 1; i >= 0; i--) {
        const t = turn.tools[i];
        if (t && t.name === event.name && t.status === 'running') {
          t.status = event.ok ? 'ok' : 'error';
          t.summary = event.summary;
          break;
        }
      }
    }
  }
}

async function refreshStatus(): Promise<void> {
  try {
    const status = await aiChatApi.status();
    available.value = status.enabled && status.configured;
  } catch {
    available.value = false;
  } finally {
    checked.value = true;
  }
}

function open(): void {
  isOpen.value = true;
  unread.value = false;
}
function close(): void {
  isOpen.value = false;
}
function toggle(): void {
  isOpen.value = !isOpen.value;
  if (isOpen.value) unread.value = false;
}

function reset(): void {
  if (streaming.value) return;
  turns.value = [];
  try {
    localStorage.removeItem(storageKey());
  } catch {
    /* non-fatal */
  }
}

function stop(): void {
  controller?.abort();
}

function nowTime(): string {
  return new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function send(text: string, currentRouteName?: string): Promise<void> {
  const content = text.trim();
  if (!content || streaming.value) return;

  turns.value.push({ role: 'user', content, tools: [], time: nowTime() });
  turns.value.push({ role: 'assistant', content: '', tools: [], time: nowTime() });
  activeIdx = turns.value.length - 1;

  // History excludes the empty assistant turn we just created.
  const history = turns.value
    .slice(0, -1)
    .map((t) => ({ role: t.role, content: t.content }));

  streaming.value = true;
  controller = new AbortController();
  try {
    await streamChat(history, applyEvent, controller.signal, currentRouteName);
  } catch (e) {
    if (!(e instanceof DOMException && e.name === 'AbortError')) {
      applyEvent({
        type: 'error',
        message: e instanceof Error ? e.message : 'Request failed',
      });
    }
  } finally {
    flushPending();
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    streaming.value = false;
    controller = null;
    if (!isOpen.value) unread.value = true;
    // Persist the completed exchange (not per-token — keeps writes cheap).
    persist();
  }
}

export function useAiChat() {
  return {
    isOpen: readonly(isOpen),
    available: readonly(available),
    unread: readonly(unread),
    checked: readonly(checked),
    streaming: readonly(streaming),
    turns: readonly(turns),
    open,
    close,
    toggle,
    reset,
    stop,
    send,
    refreshStatus,
    loadHistory,
  };
}
