<script setup lang="ts">
// Not Found (404) block — the editable body of the theme's error page (theme
// engine v2 Phase 4). Pure copy from fields; standalone, no data binding, so it
// renders the same on the real error page and in the Block Gallery preview.
interface Fields {
  code?: string;
  heading?: string;
  message?: string;
  button_label?: string;
  button_url?: string;
}

const props = defineProps<{
  fields: Fields;
  options: Record<string, unknown>;
  data: unknown;
}>();

const code = computed(() => props.fields.code ?? '404');
const heading = computed(() => props.fields.heading ?? 'Page not found');
const message = computed(
  () =>
    props.fields.message ??
    "The page you're looking for doesn't exist or may have been moved.",
);
const buttonLabel = computed(() => props.fields.button_label ?? 'Back to home');
const buttonUrl = computed(() => props.fields.button_url ?? '/');
</script>

<template>
  <section class="notfound container">
    <p class="notfound-code">{{ code }}</p>
    <h1 class="notfound-heading">{{ heading }}</h1>
    <p class="notfound-message">{{ message }}</p>
    <NuxtLink v-if="buttonUrl" :to="buttonUrl" class="notfound-btn btn-primary">
      {{ buttonLabel }}
    </NuxtLink>
  </section>
</template>

<style scoped>
.notfound {
  padding: 80px 20px 100px;
  max-width: 640px;
  text-align: center;
}
.notfound-code {
  font-size: 72px;
  font-weight: 800;
  line-height: 1;
  color: #d34135;
  letter-spacing: -0.03em;
  margin: 0 0 8px;
}
.notfound-heading {
  font-size: 30px;
  font-weight: 700;
  margin: 0 0 12px;
}
.notfound-message {
  color: var(--muted);
  font-size: 16px;
  line-height: 1.6;
  margin: 0 0 28px;
}
.notfound-btn {
  display: inline-block;
  text-decoration: none;
}
@media (max-width: 640px) {
  .notfound {
    padding: 56px 20px 72px;
  }
  .notfound-code {
    font-size: 56px;
  }
}
</style>
