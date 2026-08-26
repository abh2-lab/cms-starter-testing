<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type {
  LayoutTemplateKey,
  PageContentMode,
  PageLayoutMeta,
} from '@/api/pages';
import { slugify } from '@/api/taxonomies';

// Page Details card — Card 1 in the static editor stack. Owns:
//   - Page Name input (auto-fills slug until user touches the slug field)
//   - URL Slug input (with `yoursite.com/{slug}` live preview row below)
//   - Content mode toggle (Normal rich text / Raw HTML)
//   - Layout Template `<select>` (theme-coded layouts, passed in) + info banner
//
// Editable fields are v-model bound — the parent (StaticEditor.vue) owns the
// source of truth. `layoutOptions` is the theme's layout registry, fetched by
// the shell from the API.

const title = defineModel<string>('title', { required: true });
const slug = defineModel<string>('slug', { required: true });
const layoutTemplate = defineModel<LayoutTemplateKey>('layoutTemplate', {
  required: true,
});
const contentMode = defineModel<PageContentMode>('contentMode', {
  required: true,
});

const props = defineProps<{
  layoutOptions: PageLayoutMeta[];
}>();

// Slug auto-fill: once the user touches the slug field, stop auto-filling so
// their custom slug doesn't get overwritten by a later title edit.
const slugTouched = ref(false);
watch(title, (v) => {
  if (slugTouched.value) return;
  // Only auto-fill if the slug looks like one we previously auto-generated
  // (or is empty / the placeholder). Avoids wiping a slug a user set
  // explicitly before this watcher mounted.
  if (slug.value === '' || /^untitled-[a-z0-9]+$/.test(slug.value)) {
    slug.value = slugify(v);
  }
});

// The selected layout's meta (label + description) for the info banner. Comes
// from the theme registry passed in via `layoutOptions`; undefined when the
// stored value isn't a known theme layout (legacy keys).
const selectedLayout = computed(() =>
  props.layoutOptions.find((o) => o.id === layoutTemplate.value),
);
// True when the saved layout id isn't in the theme's current list — keep it
// selectable so saving doesn't silently drop it.
const layoutUnknown = computed(
  () =>
    !!layoutTemplate.value &&
    !props.layoutOptions.some((o) => o.id === layoutTemplate.value),
);
</script>

<template>
  <div class="card">
    <div class="card-header">
      <span class="card-title">Page Details</span>
    </div>
    <div class="card-body">
      <!-- Page name — full width, prominent. Slug preview row shows where
           the page resolves on the public site. -->
      <div class="fgroup">
        <label class="flabel">
          Page Name <span class="freq">*</span>
        </label>
        <input
          v-model="title"
          type="text"
          maxlength="500"
          class="fi"
          placeholder="e.g. About Us"
          required
        />
        <div v-if="slug" class="slug-preview">
          <span class="slug-domain">yoursite.com</span>
          <span class="slug-path">/{{ slug }}</span>
        </div>
      </div>

      <!-- URL slug + Group -->
      <div class="frow">
        <div class="fgroup">
          <label class="flabel">
            URL Slug <span class="freq">*</span>
          </label>
          <input
            v-model="slug"
            type="text"
            maxlength="255"
            pattern="[a-z0-9][a-z0-9\-]*"
            class="fi mono"
            placeholder="about-us"
            required
            @input="slugTouched = true"
          />
          <div class="fhint">
            Lowercase letters, numbers, and hyphens only. No spaces.
          </div>
        </div>
        <div class="fgroup">
          <!-- Phase D adds a real `group` column. Disabled placeholder keeps
               the two-column rhythm so layout doesn't jump when Group lands. -->
          <label class="flabel">
            Group <span class="optional">(coming soon)</span>
          </label>
          <input
            type="text"
            class="fi"
            placeholder="e.g. legal, help, company"
            disabled
          />
          <div class="fhint">Organises pages in the listing view.</div>
        </div>
      </div>

      <!-- Content mode — how the page body is authored. Normal = rich-text
           editor; Raw HTML = paste markup. Each mode keeps its own content. -->
      <div class="fgroup">
        <label class="flabel">Content</label>
        <div class="seg" role="group" aria-label="Content mode">
          <button
            type="button"
            class="seg-btn"
            :class="{ 'seg-btn--active': contentMode === 'normal' }"
            @click="contentMode = 'normal'"
          >Normal</button>
          <button
            type="button"
            class="seg-btn"
            :class="{ 'seg-btn--active': contentMode === 'raw' }"
            @click="contentMode = 'raw'"
          >Raw HTML</button>
        </div>
        <div class="fhint">
          {{
            contentMode === 'normal'
              ? 'Write with the rich-text editor.'
              : 'Paste raw HTML and CSS.'
          }}
          Each mode keeps its own content — switching doesn't convert.
        </div>
      </div>

      <!-- Layout template — theme-coded shells, fetched from the API. -->
      <div class="fgroup fgroup--last">
        <label class="flabel">
          Layout Template <span class="freq">*</span>
        </label>
        <select v-model="layoutTemplate" class="fsel">
          <option
            v-for="opt in props.layoutOptions"
            :key="opt.id"
            :value="opt.id"
          >
            {{ opt.label }}
          </option>
          <!-- Keep a saved value that's no longer in the theme's list selectable
               so the form doesn't silently drop it on the next save. -->
          <option v-if="layoutUnknown" :value="layoutTemplate">
            {{ layoutTemplate }} (not in theme)
          </option>
        </select>
        <div v-if="selectedLayout" class="tpl-info">
          <div class="tpl-info-icon" aria-hidden="true">
            <svg
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div>
            <div class="tpl-info-key">{{ selectedLayout.id }}</div>
            <div class="tpl-info-desc">{{ selectedLayout.description }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.card-header {
  padding: 14px 20px;
  border-bottom: 1px solid var(--border-soft);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.card-title {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}
.card-body {
  padding: 20px;
}

/* ── Form primitives (scoped — global .form-* uses uppercase labels which
   don't match the mockup's mixed-case look here). ─────────────────────── */
.fgroup {
  margin-bottom: 16px;
}
.fgroup--last {
  margin-bottom: 0;
}
.frow {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.frow--last {
  margin-bottom: 0;
}
@media (max-width: 640px) {
  .frow {
    grid-template-columns: 1fr;
  }
}
.flabel {
  font-size: 12px;
  font-weight: 600;
  color: var(--fg);
  margin-bottom: 5px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.freq {
  color: var(--danger);
  font-size: 13px;
  line-height: 1;
}
.optional {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-tertiary);
}
.fi,
.fsel {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-family: inherit;
  font-size: 13.5px;
  color: var(--fg);
  background: var(--surface);
  outline: none;
  transition: border 0.15s, box-shadow 0.15s;
}
.fi:focus,
.fsel:focus {
  border-color: var(--info);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.08);
}
.fi:disabled {
  opacity: 0.5;
  background: var(--bg);
  cursor: not-allowed;
}
.fsel {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath fill='%236B7280' d='M5 7L1 3h8z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 2rem;
  cursor: pointer;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, monospace;
}
.fhint {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 3px;
  line-height: 1.45;
}

/* Segmented control — content mode toggle (Normal / Raw HTML). */
.seg {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--surface);
}
.seg-btn {
  appearance: none;
  border: none;
  background: none;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
  padding: 7px 16px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.seg-btn + .seg-btn {
  border-left: 1px solid var(--border);
}
.seg-btn:hover:not(.seg-btn--active) {
  background: var(--bg);
  color: var(--fg);
}
.seg-btn--active {
  background: var(--info);
  color: #fff;
}

/* Slug preview row */
.slug-preview {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  font-size: 11.5px;
  font-family: ui-monospace, SFMono-Regular, monospace;
}
.slug-domain {
  color: var(--text-tertiary);
}
.slug-path {
  color: var(--info);
  font-weight: 600;
}

/* Template info banner — inline blue strip beneath the select. */
.tpl-info {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 11px 14px;
  background: var(--info-soft);
  border: 1px solid #bfdbfe;
  border-radius: var(--radius);
  margin-top: 10px;
}
[data-theme='dark'] .tpl-info {
  border-color: rgba(96, 165, 250, 0.4);
}
.tpl-info-icon {
  width: 28px;
  height: 28px;
  background: var(--info);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  flex-shrink: 0;
  margin-top: 1px;
}
.tpl-info-key {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--info);
  font-family: ui-monospace, SFMono-Regular, monospace;
  margin-bottom: 2px;
}
.tpl-info-desc {
  font-size: 12px;
  color: #1e40af;
  line-height: 1.5;
}
[data-theme='dark'] .tpl-info-desc {
  color: #bfdbfe;
}
</style>
