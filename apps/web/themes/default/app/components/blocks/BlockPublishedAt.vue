<script setup lang="ts">
// Field block: renders the current post's publish date. Style-unaware.
interface Fields {
  format?: string; // 'long' | 'short'
}
interface Data {
  iso: string | null;
}

const props = defineProps<{
  fields: Fields;
  options: Record<string, unknown>;
  data: Data | null;
}>();

const formatted = computed<string | null>(() => {
  const iso = props.data?.iso;
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const short = props.fields.format === 'short';
  return d.toLocaleDateString(
    'en-US',
    short
      ? { year: 'numeric', month: 'short', day: 'numeric' }
      : { year: 'numeric', month: 'long', day: 'numeric' },
  );
});
</script>

<template>
  <time
    v-if="data && data.iso && formatted"
    :datetime="data.iso"
    class="block-published-at"
  >
    {{ formatted }}
  </time>
</template>
