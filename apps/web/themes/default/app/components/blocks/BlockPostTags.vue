<script setup lang="ts">
import { tagUrl } from '~/utils/urls';
import type { TaxonomyTerm } from '~/composables/useCmsFetch';

// Field block: the hashtag chip row under the article body. Markup + styles
// moved verbatim from ArticleView.vue (theme engine v1.5 re-blocking).
interface Data {
  tags: TaxonomyTerm[];
}

const props = defineProps<{
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  data: Data | null;
}>();

const tags = computed<TaxonomyTerm[]>(() => props.data?.tags ?? []);
</script>

<template>
  <div v-if="tags.length > 0" class="article-tags">
    <NuxtLink
      v-for="t in tags"
      :key="t.termSlug"
      :to="tagUrl(t.termSlug)"
      class="article-tag"
    >
      #{{ t.termName }}
    </NuxtLink>
  </div>
</template>

<style scoped>
.article-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 32px 0 24px;
}
.article-tag {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(0, 0, 0, 0.55);
  background: rgba(0, 0, 0, 0.03);
  border: 1px solid rgba(0, 0, 0, 0.06);
  padding: 6px 14px;
  border-radius: 999px;
  text-decoration: none;
  transition: all 0.2s;
}
.article-tag:hover {
  color: #d34135;
  border-color: rgba(211, 65, 53, 0.3);
}
</style>
