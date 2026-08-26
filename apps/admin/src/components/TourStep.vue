<script setup lang="ts">
import type { TourStep } from '@/lib/tourSteps';

defineProps<{
  step: TourStep;
  index: number;
  total: number;
  /** Top-left of the tooltip card relative to the viewport. */
  left: number;
  top: number;
}>();
const emit = defineEmits<{
  back: [];
  next: [];
  skip: [];
}>();
</script>

<template>
  <div class="tour-card" :style="{ left: `${left}px`, top: `${top}px` }" role="dialog" aria-modal="true">
    <div class="tour-head">
      <span class="step-count">{{ index + 1 }} of {{ total }}</span>
      <button
        type="button"
        class="skip"
        aria-label="Skip the welcome tour"
        @click="emit('skip')"
      >
        Skip tour
      </button>
    </div>
    <h3 class="tour-title">{{ step.title }}</h3>
    <p class="tour-body">{{ step.body }}</p>
    <div class="tour-actions">
      <button
        type="button"
        class="btn-ghost"
        :disabled="index === 0"
        @click="emit('back')"
      >
        Back
      </button>
      <button type="button" class="btn-primary" @click="emit('next')">
        {{ index + 1 >= total ? 'Finish' : 'Next' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.tour-card {
  position: fixed;
  z-index: 1002;
  width: 320px;
  max-width: calc(100vw - 32px);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.25);
  padding: 16px 16px 14px;
  /* Re-position transitions feel laggy with the highlight box; just snap. */
}
.tour-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.step-count {
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  font-weight: 600;
}
.skip {
  background: none;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
}
.skip:hover { color: var(--fg); background: var(--bg); }

.tour-title {
  margin: 4px 0 6px;
  font-size: 16px;
  font-weight: 600;
  color: var(--fg);
}
.tour-body {
  margin: 0 0 14px;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--muted);
}
.tour-actions {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.btn-primary, .btn-ghost {
  padding: 7px 14px;
  border-radius: 6px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid transparent;
}
.btn-primary {
  background: var(--accent);
  color: #fff;
}
.btn-ghost {
  background: transparent;
  color: var(--fg);
  border-color: var(--border);
}
.btn-ghost:hover:not(:disabled) { background: var(--bg); }
.btn-ghost:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
