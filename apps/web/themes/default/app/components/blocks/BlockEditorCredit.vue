<script setup lang="ts">
// Field block: the "Edited by …" credit line under the tags. Markup + styles
// moved verbatim from ArticleView.vue (theme engine v1.5 re-blocking); the
// prefix became a field.
interface Data {
  editor: string | null;
}

const props = defineProps<{
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  data: Data | null;
}>();

const prefix = computed(() => {
  const v = props.fields['prefix'];
  return typeof v === 'string' && v.length > 0 ? v : 'Edited by';
});
</script>

<template>
  <p v-if="data && data.editor" class="article-editor-credit">
    {{ prefix }}
    <span class="article-editor-link">{{ data.editor }}</span>
  </p>
</template>

<style scoped>
.article-editor-credit {
  font-size: 12px;
  font-weight: 700;
  color: #999;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  padding: 18px 0 4px;
  border-top: 1px solid rgba(0, 0, 0, 0.1);
  margin-top: 28px;
}
.article-editor-link {
  color: #121212;
  text-decoration: none;
  border-bottom: 1px solid rgba(0, 0, 0, 0.18);
  transition: color 0.18s, border-color 0.18s;
}
.article-editor-link:hover {
  color: #d34135;
  border-color: #d34135;
}
</style>
