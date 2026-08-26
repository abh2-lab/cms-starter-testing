<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useAiChat } from '@/composables/useAiChat';
import { useConfirm } from '@/composables/useConfirm';
import { toast } from '@/composables/useToast';
import { helpContent } from '@/lib/helpContent';
import MarkdownRenderer from '@/components/MarkdownRenderer.vue';

const auth = useAuthStore();
const route = useRoute();
const {
  isOpen,
  available,
  unread,
  streaming,
  turns,
  open,
  close,
  reset,
  stop,
  send,
  refreshStatus,
  loadHistory,
} = useAiChat();
const { confirm } = useConfirm();

// Gated to admin + super_admin (the server enforces this too).
const canUse = computed(() => auth.hasRole('admin'));
// Only show once the assistant is enabled AND configured.
const visible = computed(() => canUse.value && available.value);

watch(
  canUse,
  (v) => {
    if (v) {
      void refreshStatus();
      loadHistory();
    }
  },
  { immediate: true },
);

const draft = ref('');
const bodyEl = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLTextAreaElement | null>(null);
// Remember the message-list scroll position so closing and reopening the panel
// returns to exactly where you were (the inner panel is v-if'd, so its scroll
// element is destroyed on close). null until the user scrolls / opens once.
const savedScrollTop = ref<number | null>(null);

// "Viewing <page>" label — reuse the help-drawer titles keyed by route name.
const pageLabel = computed(() => {
  const name = typeof route.name === 'string' ? route.name : '';
  const entry = helpContent[name];
  if (entry) return entry.title;
  return name
    ? name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : 'Admin';
});

const firstName = computed(() => {
  const dn = auth.user?.displayName ?? '';
  return dn.split(' ')[0] || 'there';
});

// Current admin route name, sent to the backend so the assistant knows which
// page the user is on ("what is this page?") and can tailor navigation.
const currentRouteName = computed(() =>
  typeof route.name === 'string' ? route.name : undefined,
);

// First-open conversation starters. The panel is gated to admin+, so these
// assume management capability; the SMTP one is super-admin-only.
const starters = computed<string[]>(() => {
  const list = [
    'Draft a new blog post',
    'Add a link to a menu',
    'Explain my content types',
  ];
  if (auth.isSuperAdmin) list.push('How do I set up email (SMTP)?');
  return list;
});

function runStarter(text: string): void {
  if (streaming.value) return;
  void send(text, currentRouteName.value);
}

// Bin button: confirm before wiping the conversation (closing never deletes).
async function clearChat(): Promise<void> {
  if (streaming.value || turns.value.length === 0) return;
  const ok = await confirm({
    title: 'Clear conversation',
    message:
      'This permanently deletes the current chat history. This cannot be undone.',
    confirmLabel: 'Clear',
    tone: 'danger',
  });
  if (!ok) return;
  reset();
  toast.success('Conversation cleared');
}

function scrollToBottom(): void {
  const el = bodyEl.value;
  if (el) el.scrollTop = el.scrollHeight;
}
function onMessagesScroll(): void {
  const el = bodyEl.value;
  if (el) savedScrollTop.value = el.scrollTop;
}
const scrollSignal = computed(
  () => `${turns.value.length}:${turns.value.at(-1)?.content ?? ''}`,
);
watch(scrollSignal, () => void nextTick(scrollToBottom));

// On open: restore the previous scroll position; on the first open of an
// already-populated conversation (e.g. after a reload) jump to the latest
// message. Focus the input either way.
watch(isOpen, (v) => {
  if (!v) return;
  void nextTick(() => {
    inputEl.value?.focus();
    const el = bodyEl.value;
    if (el) el.scrollTop = savedScrollTop.value ?? el.scrollHeight;
  });
});

async function submit(): Promise<void> {
  const text = draft.value;
  if (!text.trim() || streaming.value) return;
  draft.value = '';
  if (inputEl.value) inputEl.value.style.height = 'auto';
  await send(text, currentRouteName.value);
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    void submit();
  }
}

function autoResize(): void {
  const el = inputEl.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 100)}px`;
}

function prettyTool(name: string): string {
  return name.replace(/_/g, ' ');
}

function isStreamingLast(i: number): boolean {
  return streaming.value && i === turns.value.length - 1;
}
</script>

<template>
  <!-- Launcher bubble -->
  <button
    v-if="visible && !isOpen"
    type="button"
    class="ai-fab"
    aria-label="Open AI assistant"
    @click="open"
  >
    <span v-if="unread" class="ai-fab-dot" />
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
      <path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z" />
    </svg>
  </button>

  <!-- Panel -->
  <Transition name="ai-pop">
    <section
      v-if="visible && isOpen"
      class="chat-bubble"
      role="dialog"
      aria-label="AI assistant"
    >
      <!-- Header -->
      <header class="bubble-header">
        <div class="bubble-header-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" aria-hidden="true">
            <path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z" />
          </svg>
        </div>
        <div class="bubble-header-info">
          <div class="bubble-title">
            AI Assistant
            <span class="bubble-beta">Beta</span>
          </div>
          <div class="bubble-sub">Powered by your configured AI provider</div>
        </div>
        <div class="bubble-header-actions">
          <button
            type="button"
            class="bubble-icon-btn"
            title="Clear conversation"
            :disabled="streaming || turns.length === 0"
            @click="clearChat"
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" /></svg>
          </button>
          <button
            type="button"
            class="bubble-icon-btn"
            aria-label="Close"
            @click="close"
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      </header>

      <!-- Context strip -->
      <div class="bubble-context">
        <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" class="ctx-clock" aria-hidden="true"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
        <span class="bubble-context-label">Viewing</span>
        <span class="bubble-context-val">{{ pageLabel }}</span>
        <span class="bubble-context-trail">Actions logged to audit trail</span>
      </div>

      <!-- Messages (simple) -->
      <div ref="bodyEl" class="bubble-messages" @scroll="onMessagesScroll">
        <div v-if="turns.length === 0" class="ai-intro">
          <p class="ai-welcome">
            Hi {{ firstName }}! I can help manage
            <strong>content, types, taxonomies, static pages, and menus</strong>.
            For risky changes (settings, users, deletes) I’ll guide you step by
            step.
          </p>
          <div class="ai-starters">
            <button
              v-for="s in starters"
              :key="s"
              type="button"
              class="ai-starter"
              :disabled="streaming"
              @click="runStarter(s)"
            >
              {{ s }}
            </button>
          </div>
        </div>

        <div
          v-for="(turn, i) in turns"
          :key="i"
          class="ai-turn"
          :class="turn.role === 'user' ? 'is-user' : 'is-assistant'"
        >
          <div v-if="turn.role === 'user'" class="ai-bubble-user">
            {{ turn.content }}
          </div>

          <template v-else>
            <div v-if="turn.tools.length" class="ai-tools">
              <span
                v-for="(t, ti) in turn.tools"
                :key="ti"
                class="ai-chip"
                :class="t.status"
                :title="t.summary ?? ''"
              >
                <span class="ai-chip-dot" />
                {{ prettyTool(t.name) }}
              </span>
            </div>

            <div v-if="!turn.content && isStreamingLast(i)" class="ai-typing">
              <span class="ai-typing-dot" /><span class="ai-typing-dot" /><span class="ai-typing-dot" />
            </div>

            <MarkdownRenderer
              v-if="turn.content"
              :source="turn.content"
              class="ai-md"
              copyable
            />
          </template>
        </div>
      </div>

      <!-- Input -->
      <div class="bubble-input-area">
        <div class="bubble-input-wrap">
          <textarea
            ref="inputEl"
            v-model="draft"
            class="bubble-textarea"
            rows="1"
            placeholder="Ask me anything about your CMS…"
            @keydown="onKeydown"
            @input="autoResize"
          />
          <button
            v-if="streaming"
            type="button"
            class="bubble-send-btn is-stop"
            title="Stop"
            @click="stop"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
          </button>
          <button
            v-else
            type="button"
            class="bubble-send-btn"
            :disabled="!draft.trim()"
            title="Send"
            @click="submit"
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
          </button>
        </div>
      </div>
    </section>
  </Transition>
</template>

<style scoped>
/* Purple branding is fixed (the assistant's identity); every neutral/semantic
   color uses the admin CSS variables so the panel follows light & dark mode. */

/* ── FAB ── */
.ai-fab {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 970;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  color: #fff;
  background: linear-gradient(135deg, #7c3aed, #9333ea);
  opacity: 0.5;
  box-shadow: 0 2px 12px rgba(124, 58, 237, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    opacity 0.2s,
    transform 0.2s,
    box-shadow 0.2s;
}
.ai-fab:hover {
  opacity: 1;
  transform: scale(1.08);
  box-shadow: 0 4px 20px rgba(124, 58, 237, 0.45);
}
.ai-fab-dot {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--accent);
  border: 2px solid var(--surface);
}

/* ── Bubble ── */
.chat-bubble {
  position: fixed;
  bottom: 74px;
  right: 24px;
  z-index: 980;
  width: 440px;
  max-width: calc(100vw - 32px);
  height: 540px;
  max-height: calc(100vh - 96px);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 18px;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.14),
    0 2px 8px rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ai-pop-enter-active {
  transition:
    transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
    opacity 0.18s ease;
}
.ai-pop-leave-active {
  transition:
    transform 0.16s ease,
    opacity 0.16s ease;
}
.ai-pop-enter-from,
.ai-pop-leave-to {
  transform: scale(0.88) translateY(16px);
  opacity: 0;
}

/* ── Header ── */
.bubble-header {
  padding: 9px 12px;
  background: linear-gradient(135deg, #5b21b6, #7c3aed);
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.bubble-header-icon {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.bubble-header-info {
  flex: 1;
  min-width: 0;
}
.bubble-title {
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  display: flex;
  align-items: center;
  gap: 6px;
}
.bubble-beta {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
  padding: 1px 5px;
  border-radius: 10px;
}
.bubble-sub {
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.7);
  margin-top: 1px;
}
.bubble-header-actions {
  display: flex;
  gap: 6px;
}
.bubble-icon-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: rgba(255, 255, 255, 0.18);
  cursor: pointer;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}
.bubble-icon-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.34);
  color: #fff;
}
.bubble-icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── Context strip ── */
.bubble-context {
  padding: 6px 14px;
  background: rgba(124, 58, 237, 0.06);
  border-bottom: 1px solid rgba(124, 58, 237, 0.15);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.ctx-clock {
  color: var(--muted);
}
.bubble-context-label {
  font-size: 10.5px;
  color: var(--muted);
}
.bubble-context-val {
  font-size: 10.5px;
  font-weight: 600;
  color: #7c3aed;
  background: rgba(124, 58, 237, 0.12);
  padding: 1px 7px;
  border-radius: 8px;
}
.bubble-context-trail {
  margin-left: auto;
  font-size: 10px;
  color: var(--muted);
}

/* ── Messages (simple) ── */
.bubble-messages {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}

.ai-welcome {
  font-size: 13px;
  line-height: 1.6;
  color: var(--muted);
  margin: 0;
}
.ai-welcome strong {
  color: var(--fg);
}

/* First-open conversation starters. */
.ai-starters {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
}
.ai-starter {
  text-align: left;
  font-family: inherit;
  font-size: 12.5px;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px 11px;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background 0.15s;
}
.ai-starter:hover:not(:disabled) {
  border-color: #7c3aed;
  background: var(--accent-soft);
}
.ai-starter:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ai-turn {
  display: flex;
  flex-direction: column;
}
.ai-turn.is-user {
  align-items: flex-end;
}

.ai-bubble-user {
  max-width: 85%;
  background: var(--accent-soft);
  color: var(--fg);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  padding: 8px 11px;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

/* Assistant text renders plainly via MarkdownRenderer (kept as-is). */
.ai-md {
  font-size: 13px;
}

/* Tool chips — simple pill + status dot. */
.ai-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: 6px;
}
.ai-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  padding: 2px 9px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--muted);
  text-transform: capitalize;
}
.ai-chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--muted);
}
.ai-chip.running .ai-chip-dot {
  background: var(--info);
  animation: ai-pulse 1s ease-in-out infinite;
}
.ai-chip.ok .ai-chip-dot {
  background: var(--success);
}
.ai-chip.error {
  border-color: var(--danger);
  color: var(--danger);
}
.ai-chip.error .ai-chip-dot {
  background: var(--danger);
}
@keyframes ai-pulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}

/* Typing indicator */
.ai-typing {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 2px;
}
.ai-typing-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--muted);
  animation: ai-typing 1.2s ease-in-out infinite;
}
.ai-typing-dot:nth-child(2) {
  animation-delay: 0.18s;
}
.ai-typing-dot:nth-child(3) {
  animation-delay: 0.36s;
}
@keyframes ai-typing {
  0%,
  60%,
  100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  30% {
    transform: translateY(-5px);
    opacity: 1;
  }
}

/* ── Input ── */
.bubble-input-area {
  padding: 7px 12px 9px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
.bubble-input-wrap {
  display: flex;
  align-items: flex-end;
  gap: 7px;
  background: var(--bg);
  border: 1.5px solid var(--border);
  border-radius: 12px;
  padding: 7px 7px 7px 12px;
  transition: border-color 0.15s;
}
.bubble-input-wrap:focus-within {
  border-color: #7c3aed;
  box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.12);
}
.bubble-textarea {
  flex: 1;
  border: none;
  background: none;
  outline: none;
  font-family: inherit;
  font-size: 13px;
  color: var(--fg);
  resize: none;
  line-height: 1.5;
  max-height: 100px;
  min-height: 20px;
}
.bubble-textarea::placeholder {
  color: var(--muted);
}
.bubble-send-btn {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  flex-shrink: 0;
  background: #7c3aed;
  box-shadow: 0 2px 8px rgba(124, 58, 237, 0.35);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  transition: all 0.15s;
}
.bubble-send-btn:hover:not(:disabled) {
  background: #6d28d9;
}
.bubble-send-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.bubble-send-btn.is-stop {
  background: var(--danger);
}
</style>
