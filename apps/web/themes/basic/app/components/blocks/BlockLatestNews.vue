<script setup lang="ts">
import type { StoryListItem } from '../../../../default/app/composables/useCmsFetch';
import ScardCard from '../ScardCard.vue';

// Basic theme "latest" list: a neutral heading + a responsive grid of plain
// cards (the basic ScardCard). Same data contract as the default block; only
// the styling is neutral (no Decode red eyebrow / dark heading / 1440px width).
interface Fields {
  eyebrow?: string;
  title?: string;
}
interface BlockOptions {
  content_type?: string;
  category?: string;
  count?: number;
}
interface Data {
  items: StoryListItem[];
}

const props = defineProps<{
  fields: Fields;
  options: BlockOptions;
  data: Data | null;
}>();

const eyebrow = computed<string | null>(() => {
  const e = (props.fields.eyebrow ?? '').trim();
  return e.length > 0 ? e : null;
});
const heading = computed<string | null>(() => {
  const t = (props.fields.title ?? '').trim();
  if (t.length > 0) return t;
  const e = (props.fields.eyebrow ?? '').trim();
  return e.length > 0 ? e : null;
});
const showEyebrowSeparately = computed<boolean>(
  () => eyebrow.value !== null && eyebrow.value !== heading.value,
);
</script>

<template>
  <section v-if="data && data.items.length > 0" class="block-latest">
    <div class="container">
      <div v-if="heading || showEyebrowSeparately" class="latest-head">
        <p v-if="showEyebrowSeparately" class="latest-eyebrow">{{ eyebrow }}</p>
        <h2 v-if="heading" class="latest-heading">{{ heading }}</h2>
      </div>
      <div class="card-grid">
        <ScardCard v-for="story in data.items" :key="story.id" :story="story" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.block-latest {
  padding: 40px 0;
}
.container {
  max-width: var(--container);
  margin: 0 auto;
  padding: 0 20px;
}
.latest-head {
  margin: 0 0 20px;
}
.latest-eyebrow {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
  margin: 0 0 4px;
}
.latest-heading {
  font-size: 24px;
  font-weight: 700;
  color: var(--text);
  margin: 0;
}
.card-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}
@media (max-width: 900px) {
  .card-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 560px) {
  .card-grid {
    grid-template-columns: 1fr;
  }
}
</style>
