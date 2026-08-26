<script setup lang="ts">
import { computed } from 'vue';
import type { ContentStatus } from '@/api/content';

const props = defineProps<{ status: ContentStatus }>();

const STEPS: { key: ContentStatus; label: string }[] = [
  { key: 'draft', label: 'Draft' },
  { key: 'in_review', label: 'In Review' },
  { key: 'approved', label: 'Approved' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'published', label: 'Published' },
];

// archived sits outside the linear flow — treat it as "past published".
const currentIndex = computed(() =>
  props.status === 'archived'
    ? STEPS.length
    : STEPS.findIndex((s) => s.key === props.status),
);

function state(i: number): 'done' | 'current' | 'todo' {
  if (i < currentIndex.value) return 'done';
  if (i === currentIndex.value) return 'current';
  return 'todo';
}
</script>

<template>
  <div class="flow">
    <div
      v-for="(step, i) in STEPS"
      :key="step.key"
      class="step"
      :class="`step--${state(i)}`"
    >
      <span class="dot">
        <template v-if="state(i) === 'done'">✓</template>
        <template v-else-if="state(i) === 'current'">→</template>
        <template v-else>{{ i + 1 }}</template>
      </span>
      <span class="label">{{ step.label }}</span>
    </div>
    <p v-if="status === 'archived'" class="archived-note">Archived</p>
  </div>
</template>

<style scoped>
.flow {
  display: flex;
  flex-direction: column;
}
.step {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  position: relative;
}
.step:not(:last-of-type)::after {
  content: '';
  position: absolute;
  left: 10px;
  top: 27px;
  bottom: -6px;
  width: 1px;
  background: var(--border);
}
.dot {
  width: 21px;
  height: 21px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
  border: 2px solid var(--border);
  background: var(--surface);
  color: var(--text-tertiary);
  position: relative;
  z-index: 1;
}
.label {
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
}
.step--done .dot {
  background: var(--success);
  border-color: var(--success);
  color: #fff;
}
.step--done .label {
  color: var(--text-tertiary);
}
.step--current .dot {
  background: var(--warning);
  border-color: var(--warning);
  color: #fff;
}
.step--current .label {
  color: var(--warning);
  font-weight: 600;
}
.archived-note {
  margin: 8px 0 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--danger);
}
</style>
