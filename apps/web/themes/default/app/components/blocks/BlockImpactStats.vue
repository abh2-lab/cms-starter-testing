<script setup lang="ts">
import { ref } from 'vue';
import { useCountUp } from '~/composables/useCountUp';

// Impact Stats block — orange band with a big VIDEO PLACEHOLDER on top and the
// aggregated stats in a left-aligned row below. Data-driven from `fields.stats`
// (loader-cleaned via `data.stats`). An optional `video_url` field swaps the
// blue placeholder for a real embed once a video is supplied.
// The home thumbnail lives in /public so Nitro serves it as a plain static
// file (see /public/images/video-thumbnail-home.jpeg).

interface Stat {
  label: string;
  value: string;
}
interface Fields {
  eyebrow?: string;
  title?: string;
  video_url?: string;
  stats?: Stat[];
}
interface Data {
  title: string;
  eyebrow: string;
  stats: Stat[];
}

const props = defineProps<{
  fields: Fields;
  options: Record<string, unknown>;
  data: Data | null;
}>();

// Prefer the loader-resolved data (the loader cleans malformed entries),
// fall back to the raw fields so a dev who skips the loader path still
// gets something to look at.
// The three big figures count up the first time they are seen. The template
// still prints the real strings ("202+", "1.7L+"), so SSR, crawlers and no-JS
// visitors never see a 0.
const root = ref<HTMLElement | null>(null);
useCountUp(root, '.impact-value');

const stats = computed<Stat[]>(() =>
  props.data?.stats ??
  (props.fields.stats ?? []).filter(
    (s): s is Stat =>
      !!s && typeof s.label === 'string' && typeof s.value === 'string',
  ),
);
const title = computed(() => props.data?.title ?? props.fields.title ?? '');
const eyebrow = computed(
  () => props.data?.eyebrow ?? props.fields.eyebrow ?? '',
);
const videoUrl = computed(() =>
  typeof props.fields.video_url === 'string' ? props.fields.video_url.trim() : '',
);
</script>

<template>
  <section v-if="stats.length > 0" ref="root" class="impact">
    <div class="container-custom">
      <p v-if="eyebrow" v-reveal class="impact-eyebrow">{{ eyebrow }}</p>
      <h2 v-if="title" v-reveal class="impact-title">{{ title }}</h2>

      <!-- Video: home thumbnail with a play button until a real embed URL is
           supplied, then it swaps to the iframe. -->
      <div v-reveal class="impact-video">
        <iframe
          v-if="videoUrl"
          :src="videoUrl"
          class="impact-video-frame"
          title="PING Network video"
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen
        ></iframe>
        <template v-else>
          <img
            src="/images/video-thumbnail-home.jpeg"
            class="impact-video-thumb"
            alt="PING Network video thumbnail"
            decoding="async"
          />
          <span class="impact-video-play" aria-hidden="true"></span>
        </template>
      </div>

      <!-- One stat at a time, so the three big numbers land in sequence
           rather than all at once. -->
      <ul v-reveal.stagger class="impact-grid">
        <li v-for="s in stats" :key="s.label" class="impact-stat">
          <div class="impact-value">{{ s.value }}</div>
          <div class="impact-label">{{ s.label }}</div>
        </li>
      </ul>
    </div>
  </section>
  <div v-else class="impact-empty container">
    <p>Impact Stats block: add at least one stat to display.</p>
  </div>
</template>

<style scoped>
.impact {
  background: #ff6a4d;
  padding: var(--section-y) 0;
}
.impact-eyebrow {
  color: #0f2d96;
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  text-align: center;
  margin: 0 0 var(--space-2);
}
.impact-title {
  color: #0f2d96;
  text-align: center;
  font-size: var(--fs-h2);
  font-weight: var(--fw-semibold);
  margin: 0 0 var(--space-6);
}
.impact-video {
  position: relative;
  width: 100%;
  aspect-ratio: 5 / 2;
  background: #4295f8;
  border-radius: 32px;
  overflow: hidden;
  margin: 0 0 var(--space-8);
}
/* Thumbnail only — the <iframe> variant is never scaled, because zooming a
   live embed would crop the player chrome. Clipped by .impact-video's existing
   overflow: hidden + 32px radius. */
.impact-video-thumb {
  transition: transform var(--motion-base) var(--ease-out);
}
.impact-video:hover .impact-video-thumb {
  transform: scale(1.04);
}
.impact-video-frame {
  width: 100%;
  height: 100%;
  display: block;
  border: 0;
}
.impact-video-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 35%;
  display: block;
}
/* Play button over the thumbnail */
.impact-video-play {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 88px;
  height: 88px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 8px 28px rgba(15, 45, 150, 0.28);
}
.impact-video-play::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 54%;
  transform: translate(-50%, -50%);
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 15px 0 15px 26px;
  border-color: transparent transparent transparent #0f2d96;
}
.impact-grid {
  list-style: none;
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: var(--space-12);
  padding: 0;
  margin: 0;
}
.impact-stat {
  text-align: left;
}
.impact-value {
  color: #0f2d96;
  /* Matched to the "12+" stat in BlockAboutIntro (90px) by request — same
     expression in both so the two home stat blocks stay in step. */
  font-size: calc(var(--fs-display) + 16px);
  font-weight: var(--fw-bold);
  line-height: 1;
  /* Fixed-width digits while useCountUp ticks this from 0 — proportional
     figures change width as they change value and the number visibly jitters. */
  font-variant-numeric: tabular-nums;
}
.impact-label {
  color: #ffffff;
  /* Matched to BlockAboutIntro's body copy (28px) by request — same expression
     in both so they stay in step. */
  font-size: calc(var(--fs-h3) - 2px);
  font-weight: var(--fw-regular);
  line-height: var(--lh-snug);
  /* Scaled with the font: 135px was sized for 18px copy, and "Aggregated" alone
     is 151px at 28px — the text spilled out of the box. 210px keeps the same
     two-line wrap and still fits the grid cell. */
  max-width: 210px;
  margin-top: var(--space-3);
}
.impact-empty {
  padding: var(--space-4) var(--space-5);
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  color: var(--muted);
  font-size: var(--fs-sm);
}
@media (max-width: 768px) {
  .impact-video {
    aspect-ratio: 3 / 2;
    border-radius: 20px;
    margin-bottom: var(--space-6);
  }
  /* A wrapping flex row degrades badly here: each stat sized to its own
     content, so the three landed 210 / 210 / 182px wide, one per line, with a
     ragged right edge. A single-column grid gives them equal full-width rows —
     left-aligned, which is how PING presents a stat everywhere else. */
  .impact-grid {
    display: grid;
    grid-template-columns: 1fr;
    justify-content: stretch;
    gap: var(--space-6);
  }
  /* Sized for the desktop 90px number; at 48px it just clipped the wrap early. */
  .impact-label {
    max-width: none;
  }
}
</style>
