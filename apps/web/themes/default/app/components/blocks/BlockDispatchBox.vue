<script setup lang="ts">
// Standalone block: the black "From the Editors" call-to-action card from the
// category sidebar. Copy comes from editable fields (it was hardcoded in
// CategoryArchiveView.vue before v1.5 re-blocking); markup + styles moved
// verbatim.
const props = defineProps<{
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  data: Record<string, unknown> | null;
}>();

function str(key: string, fallback: string): string {
  const v = props.fields[key];
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

const title = computed(() => str('title', 'From the Editors'));
const text = computed(() => str('text', ''));
const ctaLabel = computed(() => str('cta_label', 'Report With Us'));
const ctaUrl = computed(() => str('cta_url', '/about'));
</script>

<template>
  <div class="category-dispatch-box">
    <h3 class="category-dispatch-title">{{ title }}</h3>
    <p v-if="text" class="category-dispatch-text">
      {{ text }}
    </p>
    <NuxtLink :to="ctaUrl" class="category-dispatch-btn">
      {{ ctaLabel }}
    </NuxtLink>
  </div>
</template>

<style scoped>
.category-dispatch-box {
  background: #121212;
  padding: 32px;
  border-radius: 24px;
  color: #f3f0e0;
  margin-bottom: 24px;
}
.category-dispatch-title {
  font-size: 20px;
  font-weight: 800;
  margin: 0 0 12px 0;
}
.category-dispatch-text {
  color: #6b7280;
  font-size: 14px;
  line-height: 1.6;
  margin: 0 0 24px 0;
}
.category-dispatch-btn {
  display: block;
  width: 100%;
  background: #d34135;
  color: #fff;
  padding: 14px;
  border-radius: 999px;
  font-weight: 700;
  border: none;
  text-align: center;
  font-family: 'Figtree', sans-serif;
  font-size: 15px;
  text-decoration: none;
  transition: background 0.2s;
}
.category-dispatch-btn:hover {
  background: #fff;
  color: #000;
}
</style>
