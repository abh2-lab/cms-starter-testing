<script setup lang="ts">
import { useSystemView } from '~/composables/useSystemView';

// Theme error page (theme engine v2 Phase 4). For a 404 it renders the
// override-backed `template-404` (the editable not-found block) inside the site
// chrome; any other error shows a minimal message. Wrapped in <NuxtLayout>
// because error.vue renders OUTSIDE <NuxtPage>, so it doesn't inherit the
// header/footer layout for free.
//
// IMPORTANT: no top-level `await` here. error.vue renders outside the page's
// <Suspense>, and a fatal-error render won't await an async setup — an awaited
// fetch would yield an empty SSR body. useSystemView is left non-blocking: its
// data resolves for SSR through Nuxt's async-data collection when available,
// and the synchronous fallback covers the no-data path so the page is never
// empty. The structure editor previews this by loading an unmatched URL with
// ?theme_preview, which useSystemView forwards.
const props = defineProps<{
  error: {
    statusCode?: number;
    statusMessage?: string;
    message?: string;
  };
}>();

const is404 = computed(() => props.error?.statusCode === 404);

const { data: view } = useSystemView('404');
const blocks = computed(() =>
  is404.value ? (view.value?.blocks ?? []) : [],
);

const fallbackCode = computed(() => String(props.error?.statusCode ?? 500));
const fallbackHeading = computed(() =>
  is404.value ? 'Page not found' : 'Something went wrong',
);
const fallbackMessage = computed(() =>
  is404.value
    ? "The page you're looking for doesn't exist or may have been moved."
    : 'An unexpected error occurred. Please try again, or head back home.',
);

useHead({
  title: () => fallbackHeading.value,
});

function goHome(): void {
  // clearError leaves the error boundary and navigates in one step.
  void clearError({ redirect: '/' });
}
</script>

<template>
  <NuxtLayout>
    <BlockTree v-if="blocks.length" :blocks="blocks" />
    <section v-else class="container err-fallback">
      <p class="err-code">{{ fallbackCode }}</p>
      <h1>{{ fallbackHeading }}</h1>
      <p class="err-msg">{{ fallbackMessage }}</p>
      <button type="button" class="btn-primary" @click="goHome">
        Back to home
      </button>
    </section>
  </NuxtLayout>
</template>

<style scoped>
.err-fallback {
  padding: 80px 20px 100px;
  max-width: 640px;
  text-align: center;
}
.err-code {
  font-size: 72px;
  font-weight: 800;
  line-height: 1;
  color: #d34135;
  letter-spacing: -0.03em;
  margin: 0 0 8px;
}
.err-fallback h1 {
  font-size: 30px;
  font-weight: 700;
  margin: 0 0 12px;
}
.err-msg {
  color: var(--muted);
  margin: 0 0 28px;
  line-height: 1.6;
}
</style>
