<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { RouterLink } from 'vue-router';
import {
  docsGeneratorApi,
  type DocsGenerateInput,
  type DocsSectionsResponse,
} from '@/api/docs-generator';
import { toast } from '@/composables/useToast';

// ── State ──────────────────────────────────────────────────────────────────
const sectionsData = ref<DocsSectionsResponse | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

const mode = ref<'readable' | 'compact'>('readable');

// Each top-level section has an `include` flag; Content additionally tracks
// which content types are ticked. Defaults follow the mock: the first three
// content sections on, Settings + Webhooks off, Search on, Submissions on
// (only visible when at least one type accepts them).
const selected = reactive({
  content: true,
  taxonomy: true,
  menus: true,
  settings: false,
  webhooks: false,
  search: true,
  submissions: true,
});
const contentTypeChecks = reactive<Record<string, boolean>>({});
const contentExpanded = ref(true);

const markdown = ref('');
const filename = ref('');
const generating = ref(false);

// ── Lifecycle ──────────────────────────────────────────────────────────────
onMounted(async () => {
  loading.value = true;
  error.value = null;
  try {
    const res = await docsGeneratorApi.sections();
    sectionsData.value = res.data;
    // Default: every content type ticked.
    for (const t of res.data.contentTypes) {
      contentTypeChecks[t.id] = true;
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load';
  } finally {
    loading.value = false;
  }
});

// ── Derived ────────────────────────────────────────────────────────────────
const showSubmissions = computed(
  () => sectionsData.value?.hasSubmissionsEnabled ?? false,
);

const selectedContentTypes = computed(() => {
  const data = sectionsData.value;
  if (!data) return [];
  return data.contentTypes.filter((t) => contentTypeChecks[t.id]);
});

const sectionCount = computed(() => {
  let n = 0;
  if (selected.content && selectedContentTypes.value.length > 0) n++;
  if (selected.taxonomy) n++;
  if (selected.menus) n++;
  if (selected.settings) n++;
  if (selected.webhooks) n++;
  if (selected.search) n++;
  if (selected.submissions && showSubmissions.value) n++;
  return n;
});

const summary = computed(() => {
  const parts: string[] = [];
  if (selected.content && selectedContentTypes.value.length > 0) {
    parts.push(
      `Content (${selectedContentTypes.value.map((t) => t.name).join(', ')})`,
    );
  }
  if (selected.taxonomy) parts.push('Taxonomy');
  if (selected.menus) parts.push('Menus');
  if (selected.settings) parts.push('Site Settings');
  if (selected.webhooks) parts.push('Webhooks');
  if (selected.search) parts.push('Search');
  if (selected.submissions && showSubmissions.value) parts.push('Submissions');
  return parts.join(' · ');
});

const modeHint = computed(() =>
  mode.value === 'readable'
    ? 'Human-friendly — explanations + context for every endpoint.'
    : 'Token-efficient — minimal prose, dense reference. Best for AI coding agents.',
);

// ── Actions ────────────────────────────────────────────────────────────────
function toggleContent(): void {
  selected.content = !selected.content;
  if (selected.content) contentExpanded.value = true;
}

function toggleContentType(id: string): void {
  contentTypeChecks[id] = !contentTypeChecks[id];
}

function buildInput(): DocsGenerateInput {
  return {
    mode: mode.value,
    sections: {
      content: {
        include: selected.content,
        contentTypeIds: selectedContentTypes.value.map((t) => t.id),
      },
      taxonomy: { include: selected.taxonomy },
      menus: { include: selected.menus },
      settings: { include: selected.settings },
      webhooks: { include: selected.webhooks },
      search: { include: selected.search },
      // If submissions section card is hidden (no type accepts them), force
      // include=false so the server skips the section entirely.
      submissions: {
        include: selected.submissions && showSubmissions.value,
      },
    },
  };
}

async function onGenerate(): Promise<void> {
  generating.value = true;
  try {
    const res = await docsGeneratorApi.generate(buildInput());
    markdown.value = res.data.markdown;
    filename.value = res.data.filename;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Generate failed');
  } finally {
    generating.value = false;
  }
}

async function onCopy(): Promise<void> {
  if (!markdown.value) return;
  try {
    await navigator.clipboard.writeText(markdown.value);
    toast.success('Copied to clipboard');
  } catch {
    toast.error('Copy failed — your browser blocked clipboard access.');
  }
}

function onDownload(): void {
  if (!markdown.value) return;
  const blob = new Blob([markdown.value], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.value || 'api-reference.md';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast.success(`Downloaded ${a.download}`);
}

// ── Markdown preview rendering ─────────────────────────────────────────────
// Tiny highlighter modelled on the mock. CRITICAL: escape HTML first so a
// content type description containing `<script>` cannot pop the admin shell
// via v-html.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const highlightedHtml = computed(() => {
  if (!markdown.value) return '';
  let html = escapeHtml(markdown.value);
  html = html
    // Headings — match against the already-escaped string. `# `, `## `, `### `
    // remain literal because they only contain safe characters.
    .replace(/^(### .+)$/gm, '<span class="md-h3">$1</span>')
    .replace(/^(## .+)$/gm, '<span class="md-h2">$1</span>')
    .replace(/^(# .+)$/gm, '<span class="md-h1">$1</span>')
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<span class="md-bold">$1</span>')
    // Inline code — backticks survive escapeHtml unchanged
    .replace(/`([^`]+)`/g, '<span class="md-code">`$1`</span>')
    // Block-quote lines
    .replace(/^(&gt; .+)$/gm, '<span class="md-comment">$1</span>')
    // Horizontal rule
    .replace(
      /^---$/gm,
      '<span class="md-divider">───────────────────────────────────</span>',
    );
  return html.replace(/\n/g, '<br>');
});
</script>

<template>
  <section class="docs-page">
    <header class="page-header">
      <div>
        <h1 class="page-title">API Documentation Generator</h1>
        <p class="page-subtitle">
          Select what to document and generate a Markdown file for frontend
          developers — or paste it into an AI coding tool like Cursor or Claude.
        </p>
      </div>
      <RouterLink :to="{ name: 'home' }" class="btn btn-ghost btn-sm">
        ← Back to dashboard
      </RouterLink>
    </header>

    <p v-if="loading" class="state-msg">Loading…</p>
    <p v-else-if="error" class="state-msg error">{{ error }}</p>

    <div v-else-if="sectionsData" class="doc-layout">
      <!-- LEFT — SELECTOR -->
      <div class="selector-panel">
        <!-- Mode toggle -->
        <div class="card mode-card">
          <div class="mode-label">Output Mode</div>
          <div class="mode-toggle">
            <button
              type="button"
              class="mode-btn"
              :class="{ active: mode === 'readable' }"
              :aria-pressed="mode === 'readable'"
              @click="mode = 'readable'"
            >
              📖 Readable
            </button>
            <button
              type="button"
              class="mode-btn"
              :class="{ active: mode === 'compact' }"
              :aria-pressed="mode === 'compact'"
              @click="mode = 'compact'"
            >
              ⚡ Compact (AI-optimised)
            </button>
          </div>
          <p class="mode-hint">{{ modeHint }}</p>
        </div>

        <!-- Content -->
        <div class="section-card" :class="{ selected: selected.content }">
          <button
            type="button"
            class="section-header"
            @click="toggleContent"
          >
            <span class="section-icon icon-info">📰</span>
            <span class="section-info">
              <span class="section-name">Content Types</span>
              <span class="section-desc">
                {{ sectionsData.contentTypes.length }} type{{
                  sectionsData.contentTypes.length === 1 ? '' : 's'
                }}
                · list + single-item endpoints
              </span>
            </span>
            <span class="check-box" :class="{ checked: selected.content }" />
          </button>
          <div
            v-if="selected.content && contentExpanded"
            class="sub-items"
          >
            <div v-if="sectionsData.contentTypes.length === 0" class="sub-empty">
              No content types yet. Create one under Structure → Content Types.
            </div>
            <div
              v-for="t in sectionsData.contentTypes"
              :key="t.id"
              class="sub-item"
              role="checkbox"
              :aria-checked="!!contentTypeChecks[t.id]"
              tabindex="0"
              @click="toggleContentType(t.id)"
              @keydown.enter.prevent="toggleContentType(t.id)"
              @keydown.space.prevent="toggleContentType(t.id)"
            >
              <span
                class="check-box"
                :class="{ checked: contentTypeChecks[t.id] }"
              />
              <span class="sub-item-name">{{ t.name }}</span>
              <span class="sub-item-slug">{{ t.slug }}</span>
            </div>
          </div>
        </div>

        <!-- Taxonomy -->
        <div class="section-card" :class="{ selected: selected.taxonomy }">
          <button
            type="button"
            class="section-header"
            @click="selected.taxonomy = !selected.taxonomy"
          >
            <span class="section-icon icon-warning">🏷️</span>
            <span class="section-info">
              <span class="section-name">Taxonomy</span>
              <span class="section-desc">
                Categories and tags — how to filter content
              </span>
            </span>
            <span class="check-box" :class="{ checked: selected.taxonomy }" />
          </button>
        </div>

        <!-- Menus -->
        <div class="section-card" :class="{ selected: selected.menus }">
          <button
            type="button"
            class="section-header"
            @click="selected.menus = !selected.menus"
          >
            <span class="section-icon icon-success">🧭</span>
            <span class="section-info">
              <span class="section-name">Menus</span>
              <span class="section-desc">
                {{ sectionsData.menus.length }} active menu{{
                  sectionsData.menus.length === 1 ? '' : 's'
                }}
              </span>
            </span>
            <span class="check-box" :class="{ checked: selected.menus }" />
          </button>
        </div>

        <!-- Search -->
        <div class="section-card" :class="{ selected: selected.search }">
          <button
            type="button"
            class="section-header"
            @click="selected.search = !selected.search"
          >
            <span class="section-icon icon-info">🔍</span>
            <span class="section-info">
              <span class="section-name">Search</span>
              <span class="section-desc">
                Full-text query endpoint backed by Meilisearch
              </span>
            </span>
            <span class="check-box" :class="{ checked: selected.search }" />
          </button>
        </div>

        <!-- Site Settings -->
        <div class="section-card" :class="{ selected: selected.settings }">
          <button
            type="button"
            class="section-header"
            @click="selected.settings = !selected.settings"
          >
            <span class="section-icon icon-purple">⚙️</span>
            <span class="section-info">
              <span class="section-name">Site Settings & SEO</span>
              <span class="section-desc">
                Global config, meta defaults, social fields
              </span>
            </span>
            <span class="check-box" :class="{ checked: selected.settings }" />
          </button>
        </div>

        <!-- Webhooks -->
        <div class="section-card" :class="{ selected: selected.webhooks }">
          <button
            type="button"
            class="section-header"
            @click="selected.webhooks = !selected.webhooks"
          >
            <span class="section-icon icon-danger">🔔</span>
            <span class="section-info">
              <span class="section-name">Webhooks & Events</span>
              <span class="section-desc">
                {{ sectionsData.webhookEvents.length }} events available for
                cache revalidation, etc.
              </span>
            </span>
            <span class="check-box" :class="{ checked: selected.webhooks }" />
          </button>
        </div>

        <!-- Submissions (conditional) -->
        <div
          v-if="showSubmissions"
          class="section-card"
          :class="{ selected: selected.submissions }"
        >
          <button
            type="button"
            class="section-header"
            @click="selected.submissions = !selected.submissions"
          >
            <span class="section-icon icon-accent">✉️</span>
            <span class="section-info">
              <span class="section-name">Submissions</span>
              <span class="section-desc">
                Reader-submitted drafts — at least one content type accepts them
              </span>
            </span>
            <span
              class="check-box"
              :class="{ checked: selected.submissions }"
            />
          </button>
        </div>

        <!-- Generate area -->
        <div class="generate-area card">
          <div class="selection-summary">
            <strong>{{ sectionCount }} section{{ sectionCount === 1 ? '' : 's' }}</strong>
            <template v-if="summary"> selected — {{ summary }}</template>
            <template v-else> selected</template>
          </div>
          <button
            type="button"
            class="btn btn-primary generate-btn"
            :disabled="generating"
            @click="onGenerate"
          >
            <span aria-hidden="true">📄</span>
            {{ generating ? 'Generating…' : 'Generate Documentation' }}
          </button>
        </div>
      </div>

      <!-- RIGHT — PREVIEW -->
      <div class="preview-panel">
        <div class="preview-topbar">
          <div class="preview-title">
            <span>Preview</span>
            <span v-if="markdown" class="preview-badge">Generated</span>
          </div>
          <div v-if="markdown" class="preview-actions">
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              @click="onCopy"
            >
              Copy
            </button>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              @click="onDownload"
            >
              Download .md
            </button>
          </div>
        </div>

        <div v-if="!markdown" class="preview-empty">
          <div class="preview-empty-icon" aria-hidden="true">📄</div>
          <div class="preview-empty-title">Nothing generated yet</div>
          <div class="preview-empty-sub">
            Select the sections you want to include on the left, then click
            <strong>Generate Documentation</strong>.
          </div>
        </div>

        <!-- HTML is internally escaped before light-touch highlighting, see
             `escapeHtml` in the script. The Vue v-html sink is intentional. -->
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-else class="preview-body" v-html="highlightedHtml" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.docs-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}
.state-msg {
  padding: 16px;
  color: var(--muted);
  font-size: 13px;
}
.state-msg.error {
  color: var(--danger);
}

/* ── Two-column layout ── */
.doc-layout {
  display: grid;
  grid-template-columns: minmax(320px, 380px) 1fr;
  gap: 20px;
  align-items: start;
}
@media (max-width: 980px) {
  .doc-layout {
    grid-template-columns: 1fr;
  }
}

/* ── Selector panel ── */
.selector-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mode-card {
  padding: 14px;
}
.mode-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--text-tertiary);
  margin-bottom: 8px;
}
.mode-toggle {
  display: flex;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 3px;
  gap: 2px;
}
.mode-btn {
  flex: 1;
  padding: 6px 12px;
  border: none;
  border-radius: 6px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  color: var(--muted);
  background: none;
}
.mode-btn.active {
  background: var(--surface);
  color: var(--fg);
  box-shadow: var(--shadow-sm);
}
.mode-hint {
  font-size: 11px;
  color: var(--text-tertiary);
  margin: 8px 0 0;
}

/* ── Section cards ── */
.section-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  transition: border-color 0.15s;
}
.section-card.selected {
  border-color: var(--fg);
}
.section-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  cursor: pointer;
  user-select: none;
  width: 100%;
  background: none;
  border: none;
  font-family: inherit;
  text-align: left;
  color: inherit;
}
.section-header:hover {
  background: var(--row-hover);
}
.section-icon {
  width: 36px;
  height: 36px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
}
.icon-info {
  background: var(--info-soft);
}
.icon-warning {
  background: var(--warning-soft);
}
.icon-success {
  background: var(--success-soft);
}
.icon-purple {
  background: var(--purple-soft);
}
.icon-danger {
  background: var(--danger-soft);
}
.icon-accent {
  background: var(--accent-soft);
}
.section-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.section-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--fg);
}
.section-desc {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

/* Custom checkbox */
.check-box {
  width: 18px;
  height: 18px;
  border: 1.5px solid var(--border);
  border-radius: 5px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}
.check-box.checked {
  background: var(--fg);
  border-color: var(--fg);
}
.check-box.checked::after {
  content: '';
  width: 5px;
  height: 9px;
  border: 2px solid var(--surface);
  border-top: none;
  border-left: none;
  transform: rotate(45deg) translateY(-1px);
  display: block;
}

/* Sub-items (content types under Content section) */
.sub-items {
  border-top: 1px solid var(--border-soft);
  padding: 8px 16px 12px;
}
.sub-empty {
  font-size: 12px;
  color: var(--text-tertiary);
  padding: 8px 0;
}
.sub-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border-soft);
  cursor: pointer;
}
.sub-item:last-child {
  border-bottom: none;
}
.sub-item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 4px;
}
.sub-item-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--fg);
  flex: 1;
}
.sub-item-slug {
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: ui-monospace, SFMono-Regular, monospace;
}

/* Generate area */
.generate-area {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.selection-summary {
  font-size: 12px;
  color: var(--muted);
}
.selection-summary strong {
  color: var(--fg);
}
.generate-btn {
  width: 100%;
  justify-content: center;
  padding: 10px 16px;
  font-size: 14px;
}

/* ── Preview panel ── */
.preview-panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  position: sticky;
  top: 16px;
}
.preview-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
}
.preview-title {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--muted);
  display: flex;
  align-items: center;
  gap: 8px;
}
.preview-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0;
  text-transform: none;
  background: var(--accent-soft);
  color: var(--accent-hover);
}
.preview-actions {
  display: flex;
  gap: 6px;
}

.preview-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 360px;
  height: calc(100vh - 280px);
  color: var(--text-tertiary);
  text-align: center;
  padding: 40px;
}
.preview-empty-icon {
  font-size: 36px;
  margin-bottom: 12px;
  opacity: 0.5;
}
.preview-empty-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--muted);
  margin-bottom: 6px;
}
.preview-empty-sub {
  font-size: 12px;
  line-height: 1.6;
}

.preview-body {
  padding: 20px;
  font-family: ui-monospace, SFMono-Regular, 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.7;
  color: var(--muted);
  min-height: 360px;
  height: calc(100vh - 280px);
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

/* Markdown syntax highlighter classes — applied via v-html. */
:deep(.md-h1) {
  color: var(--fg);
  font-size: 14px;
  font-weight: 700;
  display: block;
  margin-top: 4px;
}
:deep(.md-h2) {
  color: var(--info);
  font-size: 13px;
  font-weight: 700;
  display: block;
  margin-top: 12px;
}
:deep(.md-h3) {
  color: var(--purple);
  font-size: 12px;
  font-weight: 600;
  display: block;
  margin-top: 8px;
}
:deep(.md-code) {
  color: var(--success);
}
:deep(.md-bold) {
  color: var(--fg);
  font-weight: 700;
}
:deep(.md-comment) {
  color: var(--text-tertiary);
  font-style: italic;
}
:deep(.md-divider) {
  color: var(--border);
  display: block;
  margin: 8px 0;
}
</style>
