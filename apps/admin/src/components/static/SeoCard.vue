<script setup lang="ts">
import type { PageSeo } from '@/api/pages';

// SEO panel — rendered inside the right rail's collapsible SEO section in
// StaticEditor.vue. No card chrome of its own (the rail's .rail-panel
// wraps it). Mirrors the mockup's SS body: single-column inputs sized for
// a 320px rail, label/input pairs stacked vertically.

const seo = defineModel<PageSeo>('seo', { required: true });
const locale = defineModel<string>('locale', { required: true });

function update(patch: Partial<PageSeo>): void {
  seo.value = { ...seo.value, ...patch };
}

// Languages offered today. Keywords lands in Phase D — kept here as a
// disabled placeholder so the visual order matches the mockup.
const SEO_LOCALES = ['en', 'hi', 'bn', 'mr', 'ta'] as const;
</script>

<template>
  <div class="seo-rail">
    <div class="srow">
      <label class="slabel">SEO Title</label>
      <input
        :value="seo.metaTitle ?? ''"
        type="text"
        maxlength="500"
        class="sinput"
        placeholder="Title shown in Google (50–60 chars)"
        @input="update({ metaTitle: ($event.target as HTMLInputElement).value || null })"
      />
    </div>

    <div class="srow">
      <label class="slabel">Meta Description</label>
      <textarea
        :value="seo.metaDescription ?? ''"
        rows="2"
        maxlength="1000"
        class="stextarea"
        placeholder="Short description for search results (120–160 chars)…"
        @input="update({ metaDescription: ($event.target as HTMLTextAreaElement).value || null })"
      />
    </div>

    <div class="srow">
      <label class="slabel">
        Keywords <span class="optional">(coming soon)</span>
      </label>
      <input
        type="text"
        class="sinput"
        placeholder="keyword1, keyword2"
        disabled
      />
    </div>

    <div class="srow">
      <label class="slabel">Canonical URL</label>
      <input
        :value="seo.canonicalUrl ?? ''"
        type="url"
        maxlength="2048"
        class="sinput"
        placeholder="Leave empty to use default page URL"
        @input="update({ canonicalUrl: ($event.target as HTMLInputElement).value || null })"
      />
    </div>

    <div class="srow srow--last">
      <label class="slabel">Language</label>
      <select v-model="locale" class="sselect">
        <option v-for="l in SEO_LOCALES" :key="l" :value="l">{{ l }}</option>
      </select>
    </div>
  </div>
</template>

<style scoped>
.seo-rail {
  display: flex;
  flex-direction: column;
}
.srow {
  margin-bottom: 10px;
}
.srow--last {
  margin-bottom: 0;
}
.slabel {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--fg);
  margin-bottom: 4px;
  display: block;
}
.optional {
  font-size: 10.5px;
  font-weight: 400;
  color: var(--text-tertiary);
}
.sinput,
.stextarea,
.sselect {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-family: inherit;
  font-size: 12.5px;
  color: var(--fg);
  background: var(--surface);
  outline: none;
  transition: border 0.15s, box-shadow 0.15s;
}
.sinput:focus,
.stextarea:focus,
.sselect:focus {
  border-color: var(--info);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.08);
}
.sinput:disabled,
.sselect:disabled {
  opacity: 0.55;
  background: var(--bg);
  cursor: not-allowed;
}
.stextarea {
  resize: vertical;
  min-height: 60px;
  line-height: 1.5;
}
.sselect {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath fill='%236B7280' d='M5 7L1 3h8z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 28px;
  cursor: pointer;
}
</style>
