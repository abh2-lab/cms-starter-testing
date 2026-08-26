<script setup lang="ts">
import { articleUrl } from '~/utils/urls';

// Field block: the "Read next" related-stories card under the article.
// Markup + styles moved verbatim from ArticleView.vue (theme engine v1.5
// re-blocking); the items now arrive composed (the loader fetched them
// server-side from the post's primary category), so this renderer is pure.
interface RelatedItem {
  id: string;
  title: string;
  slug: string;
  primaryCategorySlug: string | null;
}
interface Data {
  items: RelatedItem[];
}

const props = defineProps<{
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  data: Data | null;
}>();

const heading = computed(() => {
  const v = props.fields['heading'];
  return typeof v === 'string' && v.length > 0 ? v : 'Read next';
});
const items = computed<RelatedItem[]>(() => props.data?.items ?? []);
</script>

<template>
  <section v-if="items.length > 0" class="article-related-card">
    <div class="article-related-header">
      <div class="article-related-title">{{ heading }}</div>
    </div>
    <div class="article-related-grid">
      <NuxtLink
        v-for="r in items"
        :key="r.id"
        :to="articleUrl(r.slug, r.primaryCategorySlug)"
        class="article-related-item"
      >
        <div
          v-if="r.primaryCategorySlug"
          class="article-related-item-cat"
        >{{ r.primaryCategorySlug.replace(/-/g, ' ') }}</div>
        <div class="article-related-item-title">{{ r.title }}</div>
      </NuxtLink>
    </div>
  </section>
</template>

<style scoped>
.article-related-card {
  background: #faf7f2;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 22px;
  padding: 24px 28px;
  margin: 40px 0;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}
.article-related-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.article-related-title {
  font-size: 18px;
  font-weight: 800;
  color: #121212;
}
.article-related-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 16px;
}
.article-related-item {
  background: rgba(0, 0, 0, 0.03);
  border-radius: 14px;
  padding: 16px;
  text-decoration: none;
  transition: opacity 0.2s;
}
.article-related-item:hover {
  opacity: 0.7;
}
.article-related-item-cat {
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgba(0, 0, 0, 0.45);
}
.article-related-item-title {
  font-weight: 800;
  color: #121212;
  line-height: 1.3;
  margin-top: 4px;
  font-size: 15px;
}
@media (max-width: 640px) {
  .article-related-grid {
    grid-template-columns: 1fr;
  }
}
</style>
