<script setup lang="ts">
import { computed, ref } from 'vue';
import type {
  LayoutTemplateKey,
  PageContentMode,
  PageLayoutMeta,
  PageSeo,
  PageStatus,
} from '@/api/pages';
import Icon from '@/components/Icon.vue';
import PageDetailsCard from './PageDetailsCard.vue';
import PageContentCard from './PageContentCard.vue';
import PageRichContentCard from './PageRichContentCard.vue';
import SeoCard from './SeoCard.vue';
import { combineMarkup, splitMarkup } from '@/lib/static-page-markup';

// StaticEditor — 2-column body for type='static' pages. Left column stacks
// the Page Details and Page Content cards; the right rail holds the Publish
// panel plus collapsible SEO and Extra <head> sections. All inputs are
// v-model bound up to the PageEditStatic shell; actions (save / publish /
// preview) bubble back through emits so the topbar and the rail trigger the
// same shell handlers.
//
// The shell stores html and css as separate columns (public renderer puts
// css in <Head> as a <style> tag, body html in the page wrapper) but the
// admin sees ONE editor: combineMarkup(html, css) at load, splitMarkup() on
// every keystroke so admins can paste a complete chunk of markup including
// inline <style> blocks.

const title = defineModel<string>('title', { required: true });
const slug = defineModel<string>('slug', { required: true });
const html = defineModel<string>('html', { required: true });
const css = defineModel<string>('css', { required: true });
const layoutTemplate = defineModel<LayoutTemplateKey>('layoutTemplate', {
  required: true,
});
const contentMode = defineModel<PageContentMode>('contentMode', {
  required: true,
});
const body = defineModel<object | null>('body', { required: true });
const locale = defineModel<string>('locale', { required: true });
const seo = defineModel<PageSeo>('seo', { required: true });

defineProps<{
  status: PageStatus;
  statusLabel: string;
  saving: boolean;
  transitioning: boolean;
  canPublish: boolean;
  layoutOptions: PageLayoutMeta[];
}>();

const emit = defineEmits<{
  save: [];
  publish: [];
  preview: [];
}>();

const pageMarkup = computed<string>({
  get() {
    return combineMarkup(html.value, css.value);
  },
  set(value) {
    const split = splitMarkup(value);
    if (split.html !== html.value) html.value = split.html;
    if (split.css !== css.value) css.value = split.css;
  },
});

// Rail collapse state — SEO defaults open (most edits live there), Extra
// <head> defaults closed (placeholder, no real backend yet).
const seoOpen = ref(true);
const extraHeadOpen = ref(false);
</script>

<template>
  <div class="editor-layout">
    <!-- LEFT: main form -->
    <div class="editor-main">
      <PageDetailsCard
        v-model:title="title"
        v-model:slug="slug"
        v-model:layout-template="layoutTemplate"
        v-model:content-mode="contentMode"
        :layout-options="layoutOptions"
      />
      <!-- Content editor swaps on the mode: rich text (Normal) or the raw
           HTML/CSS editor (Raw). Each keeps its own storage. -->
      <PageRichContentCard
        v-if="contentMode === 'normal'"
        v-model:body="body"
      />
      <PageContentCard v-else v-model:markup="pageMarkup" />
    </div>

    <!-- RIGHT: publish + SEO + extra head -->
    <aside class="editor-rail">
      <!-- PUBLISH PANEL — mirror of the topbar's CTA so common actions are
           never more than one scroll away on tall pages. -->
      <div class="rail-panel">
        <div class="rail-head">
          <span class="rail-title">Publish</span>
          <span :class="['status-pill', `status-pill--${status}`]">
            {{ statusLabel }}
          </span>
        </div>
        <div class="rail-body">
          <button type="button" class="pub-preview" @click="emit('preview')">
            <Icon name="eye" :size="13" />
            Open Preview ↗
          </button>
          <div class="pub-sep" />
          <button
            type="button"
            class="pub-draft"
            :disabled="saving"
            @click="emit('save')"
          >
            {{ saving ? 'Saving…' : 'Save Draft' }}
          </button>
          <button
            v-if="canPublish"
            type="button"
            class="pub-main"
            :disabled="transitioning"
            @click="emit('publish')"
          >
            <Icon name="check" :size="14" />
            Publish Page
          </button>
        </div>
      </div>

      <!-- SEO -->
      <section class="rail-panel">
        <button
          type="button"
          class="rail-head rail-head--toggle"
          :aria-expanded="seoOpen"
          @click="seoOpen = !seoOpen"
        >
          <span class="rail-title">SEO</span>
          <span :class="['rail-chev', { 'rail-chev--open': seoOpen }]">▾</span>
        </button>
        <div v-show="seoOpen" class="rail-body">
          <SeoCard v-model:seo="seo" v-model:locale="locale" />
        </div>
      </section>

      <!-- EXTRA <HEAD> — placeholder; backend hookup lands with the Phase D
           SEO follow-up. Disabled so admins don't paste content that won't
           persist. Mirrors how the Group field on PageDetailsCard advertises
           "coming soon" without faking functionality. -->
      <section class="rail-panel">
        <button
          type="button"
          class="rail-head rail-head--toggle"
          :aria-expanded="extraHeadOpen"
          @click="extraHeadOpen = !extraHeadOpen"
        >
          <span class="rail-title">Extra &lt;head&gt; HTML</span>
          <span
            :class="['rail-chev', { 'rail-chev--open': extraHeadOpen }]"
          >▾</span>
        </button>
        <div v-show="extraHeadOpen" class="rail-body">
          <textarea
            class="rail-textarea"
            rows="3"
            placeholder='e.g. <meta name="robots" content="noindex">'
            disabled
          />
          <div class="rail-hint">
            Injected into &lt;head&gt; as-is (trusted markup only).
            <em>(Coming soon.)</em>
          </div>
        </div>
      </section>
    </aside>
  </div>
</template>

<style scoped>
.editor-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 20px;
  max-width: 1400px;
  margin: 0 auto;
  align-items: start;
}
.editor-main {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.editor-rail {
  display: flex;
  flex-direction: column;
  gap: 12px;
  /* Sticky under the 56px editor topbar so the publish panel stays
     reachable as the form scrolls. The topbar's effective bottom edge sits
     32px from .content-area's padding-box top (it uses top: -24px to
     compensate for AppLayout's 24px content padding, and is 56px tall:
     -24 + 56 = 32). The rail sticks there so it docks under the topbar
     with no visible gap. */
  position: sticky;
  top: 32px;
}

@media (max-width: 1024px) {
  .editor-layout {
    grid-template-columns: 1fr;
  }
  .editor-rail {
    position: static;
  }
}

/* ── Rail panels ─────────────────────────────────────────────────────── */
.rail-panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.rail-head {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-soft);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.rail-head--toggle {
  width: 100%;
  background: none;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
  /* Use the same border-bottom; reset the default button border to keep
     parity with the publish panel header. */
  border: none;
  border-bottom: 1px solid var(--border-soft);
}
.rail-head--toggle:hover .rail-title {
  color: var(--fg);
}
.rail-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}
.rail-chev {
  font-size: 10px;
  color: var(--text-tertiary);
  transition: transform 0.2s;
  display: inline-block;
}
.rail-chev--open {
  transform: rotate(180deg);
}
.rail-body {
  padding: 14px 16px;
}

/* Status pill — kept local so the rail can render without the topbar. */
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 20px;
  background: var(--surface-2);
  color: var(--muted);
  box-shadow: inset 0 0 0 1px var(--border);
  white-space: nowrap;
  text-transform: capitalize;
}
.status-pill::before {
  content: '';
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--text-tertiary);
  display: inline-block;
}
.status-pill--published {
  background: var(--success-soft);
  color: var(--success);
}
.status-pill--published::before {
  background: var(--success);
}
.status-pill--in_review {
  background: var(--warning-soft);
  color: var(--warning);
}
.status-pill--in_review::before {
  background: var(--warning);
}
.status-pill--approved {
  background: var(--info-soft);
  color: var(--info);
}
.status-pill--approved::before {
  background: var(--info);
}
.status-pill--scheduled {
  background: var(--purple-soft);
  color: var(--purple);
}
.status-pill--scheduled::before {
  background: var(--purple);
}
.status-pill--archived {
  background: var(--danger-soft);
  color: var(--danger);
}
.status-pill--archived::before {
  background: var(--danger);
}

/* ── Publish panel buttons ──────────────────────────────────────────── */
.pub-preview {
  width: 100%;
  padding: 7px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface);
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-bottom: 7px;
  transition: all 0.15s;
}
.pub-preview:hover {
  background: var(--bg);
  color: var(--fg);
}
.pub-sep {
  height: 1px;
  background: var(--border-soft);
  margin: 2px 0 8px;
}
.pub-draft {
  width: 100%;
  padding: 8px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface);
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--fg);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-bottom: 7px;
  transition: all 0.15s;
}
.pub-draft:hover:not(:disabled) {
  background: var(--bg);
}
.pub-draft:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.pub-main {
  width: 100%;
  padding: 10px;
  border-radius: var(--radius);
  border: none;
  background: var(--success);
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 700;
  color: #fff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  transition: all 0.15s;
}
.pub-main:hover:not(:disabled) {
  background: #047857;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(5, 150, 105, 0.3);
}
.pub-main:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* ── Extra <head> textarea (placeholder) ──────────────────────────── */
.rail-textarea {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12.5px;
  color: var(--fg);
  background: var(--surface);
  outline: none;
  resize: vertical;
  min-height: 60px;
  transition: border 0.15s;
}
.rail-textarea:focus {
  border-color: var(--info);
}
.rail-textarea:disabled {
  background: var(--bg);
  opacity: 0.7;
  cursor: not-allowed;
}
.rail-hint {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 4px;
  line-height: 1.5;
}
.rail-hint em {
  font-style: italic;
}
</style>
