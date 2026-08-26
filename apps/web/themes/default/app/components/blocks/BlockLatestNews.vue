<script setup lang="ts">
import ScardCard from '~/components/ScardCard.vue';
import type { StoryListItem } from '~/composables/useCmsFetch';

// Latest News block — Decode mock styling ("More from Decode" scard grid).
// Data is pre-resolved by the composer (one query → N items). The component
// is pure render; no own fetches. Card markup lives in ScardCard so the
// tag and category archive pages get the same treatment.

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
  // Fall back to eyebrow as the heading if only eyebrow was set — keeps
  // legacy fixtures that put "More from Decode" in the eyebrow slot
  // rendering correctly until the data is reseeded.
  const e = (props.fields.eyebrow ?? '').trim();
  return e.length > 0 ? e : null;
});
const showEyebrowSeparately = computed<boolean>(
  () => eyebrow.value !== null && eyebrow.value !== heading.value,
);
</script>

<template>
  <section v-if="data && data.items.length > 0" class="block-latest-news">
    <div class="container-custom">
      <div v-if="heading || showEyebrowSeparately" class="more-from-head">
        <p v-if="showEyebrowSeparately" class="more-from-eyebrow">
          {{ eyebrow }}
        </p>
        <h2 v-if="heading" class="more-from-heading">{{ heading }}</h2>
      </div>
      <div class="scard-grid">
        <ScardCard
          v-for="story in data.items"
          :key="story.id"
          :story="story"
        />
      </div>
    </div>
  </section>
  <section v-else class="block-latest-news empty">
    <div class="container-custom">
      <p>No items to show yet.</p>
    </div>
  </section>
</template>

<style scoped>
.block-latest-news {
  padding: 48px 0 72px;
  background: transparent;
}
.container-custom {
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 40px;
}
.more-from-head {
  text-align: center;
  margin: 0 0 32px;
}
.more-from-eyebrow {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.3em;
  color: #d34135;
  margin: 0 0 8px;
}
.more-from-heading {
  font-size: 36px;
  font-weight: 700;
  color: #121212;
  margin: 0;
}
.scard-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 28px;
}

.empty p {
  color: #6b7280;
  text-align: center;
}

@media (max-width: 992px) {
  .scard-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 24px;
  }
  .more-from-heading {
    font-size: 28px;
  }
}
@media (max-width: 600px) {
  .scard-grid {
    grid-template-columns: 1fr;
    gap: 20px;
  }
  .block-latest-news {
    padding: 32px 0 48px;
  }
  .more-from-heading {
    font-size: 24px;
  }
}
</style>
