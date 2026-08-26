<script setup lang="ts">
// EditorNotesSlider — the 4-slide "From the Editor" promo carousel.
//
// Single source of truth for the slide copy + slide-switching state. Used in
// two places:
//   * BlockEditorNotes — on the home page, wrapped in a discovery-card row
//     (layout="row", image left / content right).
//   * Category page sidebar — sticky sidebar under the manifesto, wrapped in
//     .category-sidebar-slider (layout="column", image top / content below).
//
// Slide copy is design-locked. CTAs point at /about until publishers ship
// the dedicated membership / tipline / mission pages — landing on the
// broader About page reads better than a 404 from the home / category CTA.

interface NoteSlide {
  imageUrl: string;
  imageAlt: string;
  heading: string;
  text: string;
  ctaLabel: string;
  ctaUrl: string;
}

defineProps<{
  // 'row' for the home discovery-card (image on the left); 'column' for
  // the category sidebar (image stacked on top). Defaults to 'row'.
  layout?: 'row' | 'column';
}>();

const noteSlides: NoteSlide[] = [
  {
    imageUrl:
      'https://images.unsplash.com/photo-1582213782179-e0d53f98f2ca?auto=format&fit=crop&w=1280&h=768&q=80',
    imageAlt: 'Help PING',
    heading: 'Help PING',
    text: 'Have you seen how technology is shaping your community? We want to hear from you.',
    ctaLabel: 'Get Involved',
    ctaUrl: '/about',
  },
  {
    imageUrl:
      'https://images.unsplash.com/photo-1485827404703-89b55fcc595f?auto=format&fit=crop&w=1280&h=768&q=80',
    imageAlt: 'Share a Tip',
    heading: 'Share a Tip',
    text: "Spotted a scam, a pattern, a system that isn't working? Tell us what you know.",
    ctaLabel: 'Share a Tip',
    ctaUrl: '/about',
  },
  {
    imageUrl:
      'https://images.unsplash.com/photo-1516321497487-e288fb19713f?auto=format&fit=crop&w=1280&h=768&q=80',
    imageAlt: 'Why We Exist',
    heading: 'Why We Exist',
    text: 'Technology is not neutral. It reflects power, incentives, and inequalities. We investigate all three.',
    ctaLabel: 'Read Our Mission',
    ctaUrl: '/about',
  },
  {
    imageUrl:
      'https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=1280&h=768&q=80',
    imageAlt: 'Support Independent Reporting',
    heading: 'Support Independent Reporting',
    text: 'Our journalism is funded by readers.',
    ctaLabel: 'Become a Member',
    ctaUrl: '/about',
  },
];

const noteIndex = ref(0);
function setNote(i: number): void {
  if (i >= 0 && i < noteSlides.length) noteIndex.value = i;
}
function prevNote(): void {
  noteIndex.value =
    (noteIndex.value - 1 + noteSlides.length) % noteSlides.length;
}
function nextNote(): void {
  noteIndex.value = (noteIndex.value + 1) % noteSlides.length;
}
</script>

<template>
  <div class="editor-notes-slider" :data-layout="layout ?? 'row'">
    <div class="note-slider-content">
      <div
        v-for="(slide, i) in noteSlides"
        :key="slide.heading"
        class="note-slide"
        :class="{ active: i === noteIndex }"
      >
        <NuxtLink :to="slide.ctaUrl" class="note-slide-image-link">
          <img
            loading="lazy"
            decoding="async"
            :src="slide.imageUrl"
            :alt="slide.imageAlt"
            class="note-img"
          />
        </NuxtLink>
        <div class="note-slide-body">
          <h4 class="note-slide-heading">{{ slide.heading }}</h4>
          <p class="note-slide-text">{{ slide.text }}</p>
          <NuxtLink :to="slide.ctaUrl" class="btn-note-cta">
            {{ slide.ctaLabel }}
          </NuxtLink>
        </div>
      </div>
    </div>
    <div class="note-slider-footer">
      <div class="dashes-row">
        <button
          v-for="(_, i) in noteSlides"
          :key="i"
          type="button"
          class="dash"
          :class="{ active: i === noteIndex }"
          :aria-label="`Note ${i + 1}`"
          @click="setNote(i)"
        />
      </div>
      <div class="arrows-row">
        <button
          type="button"
          class="arrow-nav"
          aria-label="Previous note"
          @click="prevNote"
        >
          &#8592;
        </button>
        <button
          type="button"
          class="arrow-nav"
          aria-label="Next note"
          @click="nextNote"
        >
          &#8594;
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor-notes-slider {
  display: flex;
  flex-direction: column;
}

.note-slider-content {
  position: relative;
}

/* Row layout — used by BlockEditorNotes on the home page. Image on the left,
   body on the right, both children flex-justified to top. */
.editor-notes-slider[data-layout='row'] .note-slide {
  display: none;
  flex-direction: row;
  align-items: flex-start;
  gap: 1.5rem;
}
.editor-notes-slider[data-layout='row'] .note-slide.active {
  display: flex;
  animation: fadeIn 0.4s ease;
}
.editor-notes-slider[data-layout='row'] .note-slide-image-link {
  flex: 0 0 200px;
}
.editor-notes-slider[data-layout='row'] .note-slide-body {
  flex: 1;
  min-width: 0;
}
.editor-notes-slider[data-layout='row'] .note-img {
  width: 100%;
  aspect-ratio: 1280 / 768;
  height: auto;
  object-fit: cover;
  border-radius: 8px;
  display: block;
}

/* Column layout — used by the category sidebar. Image stacked on top, body
   below. Image height matches the mock's .category-sidebar-slider .note-img
   spec (160px fixed height, not aspect-ratio). */
.editor-notes-slider[data-layout='column'] .note-slide {
  display: none;
  flex-direction: column;
  gap: 0;
}
.editor-notes-slider[data-layout='column'] .note-slide.active {
  display: flex;
  animation: fadeIn 0.4s ease;
}
.editor-notes-slider[data-layout='column'] .note-img {
  width: 100%;
  height: 160px;
  object-fit: cover;
  border-radius: 12px;
  margin-bottom: 12px;
  display: block;
}

.note-slide-heading {
  font-size: 18px;
  font-weight: 700;
  color: #d34135;
  text-transform: uppercase;
  margin: 0 0 4px 0;
}
.note-slide-text {
  font-size: 14px;
  color: #4b5563;
  margin: 0 0 16px 0;
  line-height: 1.55;
}
.btn-note-cta {
  display: inline-block;
  background: #000;
  color: #fff;
  padding: 8px 24px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  text-decoration: none;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  transition: background 0.2s;
}
.btn-note-cta:hover {
  background: #d34135;
  color: #fff;
}

.note-slider-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 1rem;
}
.dashes-row {
  display: flex;
  gap: 6px;
}
.dash {
  width: 25px;
  height: 3px;
  background: #ddd;
  border-radius: 2px;
  transition: 0.3s;
  cursor: pointer;
  border: none;
  padding: 0;
}
.dash.active {
  background: #d34135;
  width: 45px;
}

.arrows-row {
  display: flex;
  gap: 1rem;
}
.arrow-nav {
  font-size: 24px;
  color: #121212;
  cursor: pointer;
  transition: 0.3s;
  font-weight: bold;
  user-select: none;
  background: transparent;
  border: none;
  padding: 0;
}
.arrow-nav:hover {
  color: #d34135;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* Row → column at mobile breakpoint so the home discovery-row card doesn't
   try to fit a 200px image side-by-side with text on a small screen. */
@media (max-width: 900px) {
  .editor-notes-slider[data-layout='row'] .note-slide.active {
    flex-direction: column;
  }
  .editor-notes-slider[data-layout='row'] .note-slide-image-link {
    flex: 0 0 auto;
    width: 100%;
  }
}
</style>
