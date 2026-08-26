<script setup lang="ts">
// Search hero — the /search page header. Echoes the active query as a large
// "You searched for "<query>"" banner on a dark band (matching the Decode
// production search page). No inline input by design: search is initiated from
// the header search button (the site-wide search overlay), so a second box here
// would be redundant. When there is no query, shows the idle heading.
interface Fields {
  heading?: string;
}

const props = defineProps<{
  fields: Fields;
  options: Record<string, unknown>;
  data: unknown;
}>();

const route = useRoute();

const q = computed<string>(() => {
  const raw = route.query['q'];
  return typeof raw === 'string' ? raw.trim() : '';
});

const idleHeading = computed(() => props.fields.heading ?? 'Search');
</script>

<template>
  <section class="search-hero">
    <div class="container-custom">
      <h1 class="search-hero-title">
        <template v-if="q">You searched for “{{ q }}”</template>
        <template v-else>{{ idleHeading }}</template>
      </h1>
    </div>
  </section>
</template>

<style scoped>
.search-hero {
  background: #121212;
  padding: 72px 0 80px;
}
.container-custom {
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 40px;
}
.search-hero-title {
  color: #faf9f2;
  font-size: clamp(38px, 7vw, 84px);
  font-weight: 800;
  line-height: 1.05;
  letter-spacing: -0.02em;
  margin: 0;
  font-family: inherit;
}

@media (max-width: 640px) {
  .search-hero {
    padding: 44px 0 48px;
  }
  .container-custom {
    padding: 0 20px;
  }
}
</style>
