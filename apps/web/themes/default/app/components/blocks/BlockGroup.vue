<script setup lang="ts">
// Container block: a styling wrapper that holds child blocks (rendered via the
// default slot, which BlockNode fills with a nested <BlockTree>). STYLE lives
// here — the style fields map to a small fixed set of classes that reference the
// existing theme.css tokens (no free-form token system in v1; that's v2).
interface Fields {
  width?: string;
  direction?: string;
  background?: string;
  padding?: string;
  gap?: string;
  tag?: string;
}

const props = defineProps<{
  fields: Fields;
  options: Record<string, unknown>;
  data: unknown;
}>();

const tag = computed(() => {
  const t = props.fields.tag;
  return t === 'section' || t === 'article' ? t : 'div';
});

const classes = computed(() => [
  'block-group',
  `bg-w-${props.fields.width ?? 'wide'}`,
  `bg-dir-${props.fields.direction ?? 'column'}`,
  `bg-bg-${props.fields.background ?? 'none'}`,
  `bg-pad-${props.fields.padding ?? 'none'}`,
  `bg-gap-${props.fields.gap ?? 'md'}`,
]);
</script>

<template>
  <component :is="tag" :class="classes">
    <slot />
  </component>
</template>

<style scoped>
.block-group {
  display: flex;
  flex-direction: column;
}
.bg-dir-row {
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
}
.bg-w-full {
  width: 100%;
}
.bg-w-wide {
  width: 100%;
  max-width: var(--container, 1100px);
  margin-inline: auto;
}
.bg-w-narrow {
  width: 100%;
  max-width: 720px;
  margin-inline: auto;
}
.bg-bg-surface {
  background: var(--surface, #fff);
}
.bg-bg-muted {
  background: var(--surface-muted, #f6f6f7);
}
.bg-pad-sm {
  padding: 12px;
}
.bg-pad-md {
  padding: 24px;
}
.bg-pad-lg {
  padding: 40px;
}
.bg-gap-none {
  gap: 0;
}
.bg-gap-sm {
  gap: 8px;
}
.bg-gap-md {
  gap: 20px;
}
.bg-gap-lg {
  gap: 36px;
}
</style>
