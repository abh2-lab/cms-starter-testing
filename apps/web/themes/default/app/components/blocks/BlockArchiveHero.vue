<script setup lang="ts">
// Field block: the dark tag-archive hero — kicker, red-hash title,
// description, story count. Markup + styles moved verbatim from
// TagArchiveView.vue (theme engine v1.5 re-blocking); the hash-title
// whitespace-stripping ("Digital Rights" → #DigitalRights) moved with them.
interface Data {
  title: string | null;
  description: string | null;
  total: number | null;
}

const props = defineProps<{
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  data: Data | null;
}>();

const kicker = computed(() => {
  const k = props.fields['kicker'];
  return typeof k === 'string' && k.length > 0 ? k : 'Tag';
});
const hashTagTitle = computed(() =>
  (props.data?.title ?? '').replace(/\s+/g, ''),
);
const storyCount = computed(() => props.data?.total ?? 0);
</script>

<template>
  <section v-if="data && data.title" class="tag-hero-section">
    <div class="container-custom">
      <span class="tag-hero-kicker">{{ kicker }}</span>
      <h1 class="tag-hero-title">
        <span class="tag-hero-hash">#</span>{{ hashTagTitle }}
      </h1>
      <p class="tag-hero-desc">
        {{ data.description }}
      </p>
      <span v-if="storyCount > 0" class="tag-story-count">
        {{ storyCount }} {{ storyCount === 1 ? 'Story' : 'Stories' }}
      </span>
    </div>
  </section>
</template>

<style scoped>
.container-custom {
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 40px;
}

.tag-hero-section {
  background-color: #121212;
  color: #e5e5e5;
  padding: 60px 0 50px;
}
.tag-hero-kicker {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4em;
  color: #d34135;
  margin-bottom: 16px;
  display: block;
}
.tag-hero-title {
  font-size: 56px;
  font-weight: 700;
  line-height: 1.05;
  color: #f3f0e0;
  margin: 0 0 20px 0;
  letter-spacing: -0.02em;
}
.tag-hero-hash {
  color: #d34135;
}
.tag-hero-desc {
  font-size: 18px;
  color: #9ca3af;
  line-height: 1.6;
  max-width: 680px;
  margin: 0;
}
.tag-story-count {
  display: inline-block;
  font-size: 12px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 20px;
  text-transform: uppercase;
  letter-spacing: 0.15em;
}

@media (max-width: 1024px) {
  .tag-hero-title {
    font-size: 40px;
  }
}
@media (max-width: 768px) {
  .tag-hero-section {
    padding: 40px 0 32px;
  }
  .tag-hero-title {
    font-size: 32px;
  }
  .tag-hero-desc {
    font-size: 16px;
  }
}
</style>
