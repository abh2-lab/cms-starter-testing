<script setup lang="ts">
// BlockTitleBand — render half for the 'title-band' block. The opening band of
// the portfolio detail page, painted in the PING hero language: a bright-blue
// band with a light-blue curve bleeding behind, echoing the /brands,
// /platforms and /publishing page heroes so a detail page belongs to the same
// family. Reads the title + category from the box.
//
// Every portfolio detail title band draws the SAME curve — the Platforms shape
// (`arcs`, a steep diagonal band on the right). It used to vary by category
// (brands → converging, publishing → swell), but brands and publishing now
// share the Platforms curve so every detail page's title band matches.
interface Data {
  title: string | null;
  category: string | null;
  categoryLabel: string | null;
}

const props = defineProps<{
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  data: Data | null;
}>();

const title = computed(() => props.data?.title ?? '');
const categoryLabel = computed(() => props.data?.categoryLabel ?? '');

// One shape for all categories now (the Platforms `arcs`). Kept as a per-category
// map so any category can be split back out later without reworking this block;
// the shapes themselves live in utils/curves.ts.
const BY_CATEGORY: Record<string, string> = {
  brands: 'arcs',
  platforms: 'arcs',
  publishing: 'arcs',
};
const curve = computed(() => BY_CATEGORY[props.data?.category ?? ''] ?? 'arcs');
</script>

<template>
  <section v-if="title" class="tb">
    <ThemeCurve :shape="curve" reveal="left" />

    <div class="container-custom tb-inner">
      <p v-if="categoryLabel" class="tb-eyebrow">{{ categoryLabel }}</p>
      <h1 class="tb-title">{{ title }}</h1>
    </div>
  </section>
</template>

<style scoped>
.tb {
  position: relative;
  overflow: hidden;
  background: #4295f8;
  padding: clamp(56px, 8vw, 104px) 0;
  min-height: 380px;
  display: flex;
  align-items: center;
}
/* No curve styles. ThemeCurve fills this section and sizes itself; the band's
   380px floor no longer changes how thick the curve is drawn, which is what
   made this band's curve 130px against the page hero's 150px. */
.tb-inner {
  position: relative;
  z-index: 1;
}
/* Copy rises in over the curve; `backwards` holds the from-state through the
   delay so nothing flashes before its turn. */
.tb-inner > * {
  animation: tb-rise var(--motion-slow) var(--ease-out) backwards;
}
.tb-eyebrow {
  animation-delay: 0.12s;
}
.tb-title {
  animation-delay: 0.2s;
}
@keyframes tb-rise {
  from {
    opacity: 0;
    transform: translateY(var(--reveal-rise));
  }
}
.tb-eyebrow {
  margin: 0 0 var(--space-4);
  color: #fff;
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  opacity: 0.9;
}
.tb-title {
  margin: 0;
  color: #fff;
  font-size: var(--fs-h1);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
  letter-spacing: -0.01em;
  max-width: 820px;
}
@media (max-width: 768px) {
  .tb {
    min-height: 0;
    padding: var(--section-y) 0;
  }
}
</style>
