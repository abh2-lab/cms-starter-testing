<script setup lang="ts">
// Field block: renders the current post's title at a configurable heading level.
// Style-unaware — the enclosing container/template owns typography.
interface Fields {
  level?: number;
}
interface Data {
  title: string | null;
}

const props = defineProps<{
  fields: Fields;
  options: Record<string, unknown>;
  data: Data | null;
}>();

const tag = computed(() => {
  const raw = Number(props.fields.level ?? 1);
  const n = Number.isFinite(raw) ? Math.min(6, Math.max(1, Math.round(raw))) : 1;
  return `h${n}`;
});
</script>

<template>
  <component :is="tag" v-if="data && data.title" class="block-post-title">
    {{ data.title }}
  </component>
</template>
