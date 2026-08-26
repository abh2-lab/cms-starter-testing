<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import MarkdownRenderer from '@/components/MarkdownRenderer.vue';
import { getDocs } from '@/lib/docs';

// Developer-facing documentation reader. Renders the in-repo Markdown bundled
// under src/docs/*.md (see lib/docs.ts) with a sidebar table of contents on
// the left and the formatted article on the right. The active doc is mirrored
// to the ?doc= query so links are shareable and survive a refresh.

const docs = getDocs();

const route = useRoute();
const router = useRouter();

const initial =
  typeof route.query['doc'] === 'string' &&
  docs.some((d) => d.slug === route.query['doc'])
    ? route.query['doc']
    : (docs[0]?.slug ?? '');

const activeSlug = ref<string>(initial);

const activeDoc = computed(
  () => docs.find((d) => d.slug === activeSlug.value) ?? docs[0] ?? null,
);

function select(slug: string): void {
  activeSlug.value = slug;
  void router.replace({ query: { ...route.query, doc: slug } });
}
</script>

<template>
  <section class="docs">
    <div class="page-header">
      <div>
        <h1 class="page-title">Documentation</h1>
        <div class="page-subtitle">
          Developer guides for working with this CMS — the theme, blocks,
          templates, and reading CMS data in the public Nuxt app.
        </div>
      </div>
    </div>

    <div v-if="docs.length === 0" class="card docs-empty">
      No documentation has been added yet. Drop Markdown files into
      <code>apps/admin/src/docs/</code> and they'll appear here.
    </div>

    <div v-else class="docs-layout">
      <!-- Sidebar TOC -->
      <nav class="docs-nav" aria-label="Documentation">
        <button
          v-for="doc in docs"
          :key="doc.slug"
          type="button"
          :class="['docs-nav-item', { active: doc.slug === activeSlug }]"
          @click="select(doc.slug)"
        >
          {{ doc.title }}
        </button>
      </nav>

      <!-- Rendered article -->
      <div class="card docs-main">
        <MarkdownRenderer v-if="activeDoc" :source="activeDoc.body" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.docs {
  padding-bottom: 32px;
}

.docs-empty {
  font-size: 13.5px;
  color: var(--muted);
  line-height: 1.6;
}
.docs-empty code {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12.5px;
  background: var(--bg);
  border: 1px solid var(--border);
  padding: 1px 5px;
  border-radius: 3px;
}

.docs-layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 20px;
  align-items: start;
}

.docs-nav {
  position: sticky;
  top: 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.docs-nav-item {
  text-align: left;
  padding: 8px 12px;
  border: none;
  background: none;
  border-radius: var(--radius);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  color: var(--muted);
  cursor: pointer;
  transition: all 0.15s;
}
.docs-nav-item:hover {
  background: var(--surface-2);
  color: var(--fg);
}
.docs-nav-item.active {
  background: var(--info-soft);
  color: var(--info);
  font-weight: 600;
}

.docs-main {
  padding: 28px 32px;
  min-width: 0;
}

@media (max-width: 720px) {
  .docs-layout {
    grid-template-columns: 1fr;
  }
  .docs-nav {
    position: static;
    flex-direction: row;
    flex-wrap: wrap;
  }
}
</style>
