<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch, nextTick, ref } from 'vue';
import { useRoute } from 'vue-router';
import Icon from '@/components/Icon.vue';
import { useHelp } from '@/composables/useHelp';
import { useOnboardingTour } from '@/composables/useOnboardingTour';
import { helpContent, type HelpEntry } from '@/lib/helpContent';

// Renders a plain-text help body with two affordances: backticked spans
// become <code>, and the rest is HTML-escaped so a typo or stray angle
// bracket in the source can't inject markup.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function renderInline(s: string): string {
  return escapeHtml(s).replace(/`([^`]+)`/g, '<code>$1</code>');
}
function paragraphs(body: string | string[]): string[] {
  return Array.isArray(body) ? body : [body];
}

const route = useRoute();
const { isOpen, close } = useHelp();
const tour = useOnboardingTour();

const entry = computed<HelpEntry | null>(() => {
  const name = typeof route.name === 'string' ? route.name : '';
  return helpContent[name] ?? null;
});

const panelRef = ref<HTMLDivElement | null>(null);

// Focus the panel when it opens so screen readers announce the title and
// Escape works without the user clicking inside first.
watch(isOpen, async (open) => {
  if (open) {
    await nextTick();
    panelRef.value?.focus();
  }
});

function onKeydown(e: KeyboardEvent): void {
  if (isOpen.value && e.key === 'Escape') close();
}
onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));

function replayTour(): void {
  close();
  // nextTick so the drawer is fully off-screen before the tour measures
  // the highlighted element's position.
  void nextTick(() => tour.replay());
}
</script>

<template>
  <Transition name="help">
    <div v-if="isOpen" class="help-overlay" @click.self="close">
      <aside
        ref="panelRef"
        class="help-panel"
        role="dialog"
        aria-modal="true"
        :aria-label="entry?.title ?? 'Help'"
        tabindex="-1"
      >
        <header class="help-head">
          <div class="head-text">
            <span class="kicker">Help</span>
            <h2 class="title">{{ entry?.title ?? 'About this page' }}</h2>
          </div>
          <button
            type="button"
            class="close-btn"
            aria-label="Close help"
            @click="close"
          >
            <Icon name="x" :size="18" />
          </button>
        </header>

        <div class="help-body">
          <p v-if="entry" class="intro">{{ entry.intro }}</p>
          <p v-else class="intro">
            Help for this page is coming soon. In the meantime, check the API
            Docs (in the Insights menu) or ask a teammate.
          </p>

          <section
            v-for="section in entry?.sections ?? []"
            :key="section.heading"
            class="section"
          >
            <h3 class="section-heading">{{ section.heading }}</h3>
            <!-- renderInline HTML-escapes its input before re-inserting only
                 <code> spans for backticks, so v-html here is safe. The
                 sources are static authored strings in helpContent.ts. -->
            <!-- eslint-disable vue/no-v-html -->
            <p
              v-for="(para, i) in paragraphs(section.body)"
              :key="i"
              class="section-body"
              v-html="renderInline(para)"
            />
            <ul v-if="section.bullets?.length" class="section-bullets">
              <li
                v-for="(b, i) in section.bullets"
                :key="i"
                v-html="renderInline(b)"
              />
            </ul>
            <!-- eslint-enable vue/no-v-html -->
          </section>

          <div v-if="entry?.showTourReplay" class="replay">
            <button type="button" class="replay-btn" @click="replayTour">
              <Icon name="info" :size="14" />
              <span>Take the welcome tour again</span>
            </button>
          </div>
        </div>
      </aside>
    </div>
  </Transition>
</template>

<style scoped>
.help-overlay {
  position: fixed;
  inset: 0;
  z-index: 990;
  background: rgba(0, 0, 0, 0.28);
  display: flex;
  justify-content: flex-end;
}
.help-panel {
  width: 440px;
  max-width: 100vw;
  height: 100%;
  background: var(--surface);
  border-left: 1px solid var(--border);
  box-shadow: -12px 0 32px rgba(0, 0, 0, 0.12);
  display: flex;
  flex-direction: column;
  outline: none;
}
.help-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 18px 18px 12px;
  border-bottom: 1px solid var(--border);
}
.head-text { display: flex; flex-direction: column; }
.kicker {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  font-weight: 600;
}
.title {
  margin: 2px 0 0;
  font-size: 17px;
  color: var(--fg);
  font-weight: 600;
}
.close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--muted);
  cursor: pointer;
}
.close-btn:hover { color: var(--fg); border-color: var(--accent); }

.help-body {
  padding: 16px 18px 20px;
  overflow-y: auto;
  flex: 1;
}
.intro {
  color: var(--muted);
  margin: 0 0 16px;
  line-height: 1.55;
  font-size: 14px;
}
.section { margin-top: 14px; }
.section-heading {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--fg);
  margin: 0 0 4px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.section-body {
  margin: 0 0 8px;
  font-size: 13.5px;
  color: var(--muted);
  line-height: 1.6;
}
.section-body:last-child { margin-bottom: 0; }
.section-body :deep(code) {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: var(--fg);
}
.section-bullets {
  margin: 4px 0 0;
  padding-left: 18px;
  font-size: 13.5px;
  color: var(--muted);
  line-height: 1.55;
}
.section-bullets li { margin-bottom: 4px; }
.section-bullets :deep(code) {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: var(--fg);
}

.replay {
  margin-top: 22px;
  padding-top: 16px;
  border-top: 1px dashed var(--border);
}
.replay-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  border: 1px solid var(--border);
  background: var(--bg);
  border-radius: 8px;
  color: var(--fg);
  cursor: pointer;
  font: inherit;
  transition: background 0.15s, border-color 0.15s;
}
.replay-btn:hover {
  background: var(--surface);
  border-color: var(--accent);
}

/* Transition: slide in from the right + fade the backdrop. */
.help-enter-from,
.help-leave-to {
  background: rgba(0, 0, 0, 0);
}
.help-enter-from .help-panel,
.help-leave-to .help-panel {
  transform: translateX(100%);
}
.help-enter-active,
.help-leave-active {
  transition: background 0.22s ease;
}
.help-enter-active .help-panel,
.help-leave-active .help-panel {
  transition: transform 0.22s ease;
}
</style>
