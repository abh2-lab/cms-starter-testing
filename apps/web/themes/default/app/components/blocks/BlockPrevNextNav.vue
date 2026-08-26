<script setup lang="ts">
// BlockPrevNextNav — render half for the 'prev-next-nav' block. A two-column
// footer row linking to the previous (older) and next (newer) portfolio entries.
// Either side hides on its own when there is no neighbour, so an edge entry
// still renders cleanly.
import { portfolioUrl } from '~/utils/urls';

interface NavLink {
  title: string;
  slug: string;
  category: string | null;
}
interface Data {
  prev: NavLink | null;
  next: NavLink | null;
}

const props = defineProps<{
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  data: Data | null;
}>();

const hasNav = computed(() => !!(props.data && (props.data.prev || props.data.next)));
const href = (link: NavLink): string => portfolioUrl(link.slug, link.category);
</script>

<template>
  <nav v-if="hasNav" class="block-prev-next" aria-label="Portfolio navigation">
    <NuxtLink
      v-if="data && data.prev"
      :to="href(data.prev)"
      class="block-prev-next__item block-prev-next__item--prev"
    >
      <span class="block-prev-next__label">
        <span class="block-prev-next__chev" aria-hidden="true">‹</span> Previous
      </span>
      <span class="block-prev-next__title">{{ data.prev.title }}</span>
    </NuxtLink>
    <span v-else class="block-prev-next__item" />

    <NuxtLink
      v-if="data && data.next"
      :to="href(data.next)"
      class="block-prev-next__item block-prev-next__item--next"
    >
      <span class="block-prev-next__label">
        Next <span class="block-prev-next__chev" aria-hidden="true">›</span>
      </span>
      <span class="block-prev-next__title">{{ data.next.title }}</span>
    </NuxtLink>
    <span v-else class="block-prev-next__item" />
  </nav>
</template>

<style scoped>
.block-prev-next {
  display: flex;
  justify-content: space-between;
  gap: var(--space-5);
  padding-top: var(--space-6);
  border-top: 1px solid var(--border);
}
.block-prev-next__item {
  display: flex;
  flex-direction: column;
  gap: var(--space-2, 6px);
  text-decoration: none;
  max-width: 45%;
}
.block-prev-next__item--next {
  text-align: right;
  margin-left: auto;
}
.block-prev-next__label {
  font-size: var(--fs-sm);
  color: var(--muted, #6b7280);
  font-weight: var(--fw-medium);
}
.block-prev-next__chev {
  font-size: 1.1em;
}
.block-prev-next__title {
  font-size: var(--fs-lead);
  font-weight: var(--fw-semibold);
  color: #0f2d96;
  line-height: var(--lh-tight);
  transition: color var(--motion-fast) var(--ease-out);
}
.block-prev-next__item:hover .block-prev-next__title {
  color: #ff6a4d;
}
</style>
