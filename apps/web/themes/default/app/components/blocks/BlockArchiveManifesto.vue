<script setup lang="ts">
// Field block: the category sidebar manifesto — small label, term name split
// across two visual lines, term description, owning-taxonomy sub-line.
// Markup + styles + the two-line title split moved verbatim from
// CategoryArchiveView.vue (theme engine v1.5 re-blocking).
interface Data {
  title: string | null;
  description: string | null;
  taxonomyDescription: string | null;
}

const props = defineProps<{
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  data: Data | null;
}>();

const label = computed(() => {
  const l = props.fields['label'];
  return typeof l === 'string' && l.length > 0 ? l : 'Archive';
});

// Mock splits the manifesto title across two visual lines via <br>. Derive
// a two-line split from the term name: take the first word as line 1 and
// the rest as line 2. Single-word names render on a single line.
const manifestoTitleParts = computed<[string, string]>(() => {
  const title = props.data?.title ?? '';
  const parts = title.split(/\s+/).filter((p) => p.length > 0);
  if (parts.length <= 1) return [title, ''];
  return [parts[0] ?? '', parts.slice(1).join(' ')];
});
</script>

<template>
  <div v-if="data && data.title" class="category-manifesto">
    <span class="category-manifesto-label">{{ label }}</span>
    <h2 class="category-manifesto-title">
      {{ manifestoTitleParts[0] }}<br v-if="manifestoTitleParts[1]" />{{ manifestoTitleParts[1] }}
    </h2>
    <p class="category-manifesto-text">{{ data.description }}</p>
    <p v-if="data.taxonomyDescription" class="category-manifesto-sub">
      {{ data.taxonomyDescription }}
    </p>
  </div>
</template>

<style scoped>
.category-manifesto {
  margin-bottom: 32px;
}
.category-manifesto-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.3em;
  color: #d34135;
  margin-bottom: 16px;
  display: block;
}
.category-manifesto-title {
  font-size: 48px;
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 0.9;
  margin: 0 0 20px 0;
  color: #121212;
}
.category-manifesto-text {
  font-size: 16px;
  color: #4b5563;
  line-height: 1.7;
  margin: 0 0 12px 0;
}
.category-manifesto-sub {
  font-size: 14px;
  color: #6b7280;
  line-height: 1.6;
  margin: 0;
}

@media (max-width: 1024px) {
  .category-manifesto-title {
    font-size: 40px;
  }
}
@media (max-width: 768px) {
  .category-manifesto-title {
    font-size: 36px;
  }
}
</style>
