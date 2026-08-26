<script setup lang="ts">
// Field block: the cream "Why read this" editorial callout rendering the
// post's excerpt. Markup + styles moved verbatim from ArticleView.vue
// (theme engine v1.5 re-blocking); the label became a field.
interface Data {
  text: string | null;
}

const props = defineProps<{
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  data: Data | null;
}>();

const label = computed(() => {
  const v = props.fields['label'];
  return typeof v === 'string' && v.length > 0
    ? v
    : 'Editorial Note: Why read this';
});
</script>

<template>
  <div v-if="data && data.text" class="article-editorial-note">
    <div class="article-editorial-header">
      <svg
        class="icon-xs"
        fill="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          d="M12 19l7-7 3 3-7 7-3-3z M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"
        />
      </svg>
      <span class="article-editorial-label">
        {{ label }}
      </span>
    </div>
    <p class="article-editorial-text">{{ data.text }}</p>
  </div>
</template>

<style scoped>
.article-editorial-note {
  background: #faf7f2;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 18px;
  padding: 24px 28px;
  margin-bottom: 24px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}
.article-editorial-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  color: #d34135;
}
.article-editorial-label {
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.3em;
}
.article-editorial-text {
  font-size: 15px;
  line-height: 1.7;
  color: #444;
  margin: 0;
}
.icon-xs {
  width: 18px;
  height: 18px;
}
</style>
