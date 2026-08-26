<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  nextTick,
} from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useOnboardingTour } from '@/composables/useOnboardingTour';
import { dashboardTourSteps, type TourStep } from '@/lib/tourSteps';
import TourStepCard from '@/components/TourStep.vue';

const tour = useOnboardingTour();
const auth = useAuthStore();

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Steps actually shown — filtered at activation time so a role-hidden
// sidebar section (e.g. Structure for non-super-admins) is skipped instead
// of pointing at a missing element.
const activeSteps = ref<TourStep[]>([]);
const targetRect = ref<Rect | null>(null);

function visibleSteps(): TourStep[] {
  if (typeof document === 'undefined') return dashboardTourSteps;
  return dashboardTourSteps.filter((s) => document.querySelector(s.target) !== null);
}

function measureCurrent(): void {
  const step = activeSteps.value[tour.currentStepIndex.value];
  if (!step) {
    targetRect.value = null;
    return;
  }
  const el = document.querySelector<HTMLElement>(step.target);
  if (!el) {
    targetRect.value = null;
    return;
  }
  const r = el.getBoundingClientRect();
  // 6px halo around the element so the cutout doesn't crowd the icon.
  targetRect.value = {
    left: r.left - 6,
    top: r.top - 6,
    width: r.width + 12,
    height: r.height + 12,
  };
}

// Tooltip placement: anchor to the right of the highlighted nav item, but
// keep it on-screen. If the viewport is too narrow, fall back to centering
// the card under the viewport top.
const cardLeft = computed(() => {
  if (!targetRect.value) return 24;
  const gap = 16;
  const cardWidth = 320;
  const proposed = targetRect.value.left + targetRect.value.width + gap;
  const maxLeft = window.innerWidth - cardWidth - 16;
  return Math.min(Math.max(16, proposed), Math.max(16, maxLeft));
});

const cardTop = computed(() => {
  if (!targetRect.value) return 24;
  const cardHeight = 200; // approximate
  const proposed = targetRect.value.top;
  const maxTop = window.innerHeight - cardHeight - 16;
  return Math.min(Math.max(16, proposed), Math.max(16, maxTop));
});

function onResize(): void {
  if (tour.isActive.value) measureCurrent();
}
onMounted(() => window.addEventListener('resize', onResize));
onBeforeUnmount(() => window.removeEventListener('resize', onResize));

// Re-measure after every step change so the highlight follows.
watch(
  () => tour.currentStepIndex.value,
  async () => {
    await nextTick();
    measureCurrent();
  },
);

watch(
  () => tour.isActive.value,
  async (active) => {
    if (!active) {
      targetRect.value = null;
      return;
    }
    activeSteps.value = visibleSteps();
    await nextTick();
    measureCurrent();
  },
);

function onSkipOrFinish(): void {
  // If the user has never completed the tour, "Skip" still counts as
  // completion — we don't want to nag them on every login. Replay flows
  // already have a tourCompletedAt set, so they get a silent dismiss.
  if (auth.user?.tourCompletedAt) {
    tour.dismiss();
  } else {
    void tour.complete();
  }
}

function onNext(): void {
  if (
    tour.currentStepIndex.value + 1 >= activeSteps.value.length
  ) {
    onSkipOrFinish();
    return;
  }
  tour.next(activeSteps.value.length);
}

function onBack(): void {
  tour.back();
}

function onKeydown(e: KeyboardEvent): void {
  if (!tour.isActive.value) return;
  if (e.key === 'Escape') onSkipOrFinish();
}
onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Transition name="tour-fade">
    <div
      v-if="tour.isActive.value && activeSteps.length > 0 && targetRect"
      class="tour-overlay"
      aria-hidden="false"
    >
      <!-- Four-rectangle dim wrapping the cutout, so click-through on the
           highlighted element is preserved without resorting to mix-blend. -->
      <div
        class="dim dim-top"
        :style="{ height: `${Math.max(0, targetRect.top)}px` }"
        @click="onSkipOrFinish"
      ></div>
      <div
        class="dim dim-left"
        :style="{
          top: `${targetRect.top}px`,
          height: `${targetRect.height}px`,
          width: `${Math.max(0, targetRect.left)}px`,
        }"
        @click="onSkipOrFinish"
      ></div>
      <div
        class="dim dim-right"
        :style="{
          top: `${targetRect.top}px`,
          height: `${targetRect.height}px`,
          left: `${targetRect.left + targetRect.width}px`,
        }"
        @click="onSkipOrFinish"
      ></div>
      <div
        class="dim dim-bottom"
        :style="{ top: `${targetRect.top + targetRect.height}px` }"
        @click="onSkipOrFinish"
      ></div>

      <!-- The highlight ring (purely decorative). The hole is the absence
           of dim, defined by the four rectangles above. -->
      <div
        class="halo"
        :style="{
          left: `${targetRect.left}px`,
          top: `${targetRect.top}px`,
          width: `${targetRect.width}px`,
          height: `${targetRect.height}px`,
        }"
      ></div>

      <TourStepCard
        :step="activeSteps[tour.currentStepIndex.value]!"
        :index="tour.currentStepIndex.value"
        :total="activeSteps.length"
        :left="cardLeft"
        :top="cardTop"
        @back="onBack"
        @next="onNext"
        @skip="onSkipOrFinish"
      />
    </div>
  </Transition>
</template>

<style scoped>
.tour-overlay {
  position: fixed;
  inset: 0;
  z-index: 1001;
  pointer-events: none;
}
.dim {
  position: fixed;
  background: rgba(0, 0, 0, 0.55);
  left: 0;
  right: 0;
  pointer-events: auto;
  cursor: pointer;
}
.dim-top { top: 0; }
.dim-bottom { bottom: 0; left: 0; right: 0; }
.dim-left { left: 0; }
.dim-right { right: 0; }

.halo {
  position: fixed;
  border-radius: 8px;
  border: 2px solid var(--accent);
  box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.25);
  pointer-events: none;
}

.tour-fade-enter-from,
.tour-fade-leave-to {
  opacity: 0;
}
.tour-fade-enter-active,
.tour-fade-leave-active {
  transition: opacity 0.18s ease;
}
</style>
