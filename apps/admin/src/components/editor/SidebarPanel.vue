<script setup lang="ts">
import { ref } from 'vue';
import Icon from '@/components/Icon.vue';

// icon/badge are intentionally undefined when omitted — the template uses
// `v-if="icon"` and `v-if="badge !== undefined"` to handle absence.
// exactOptionalPropertyTypes makes passing `undefined` to withDefaults a
// type error, and any non-undefined sentinel would change the v-if checks.
/* eslint-disable vue/require-default-prop */
const props = withDefaults(
  defineProps<{
    title: string;
    icon?: string;
    badge?: string | number;
    defaultOpen?: boolean;
  }>(),
  { defaultOpen: true },
);
/* eslint-enable vue/require-default-prop */

const open = ref(props.defaultOpen);
</script>

<template>
  <section class="panel">
    <button
      type="button"
      class="panel-head"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="panel-title">
        <Icon v-if="icon" :name="icon" :size="13" />
        {{ title }}
        <span v-if="badge !== undefined" class="panel-badge">{{ badge }}</span>
      </span>
      <Icon
        name="chevron-down"
        :size="14"
        class="panel-chevron"
        :class="{ open }"
      />
    </button>
    <div v-show="open" class="panel-body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.panel {
  border-bottom: 1px solid var(--border);
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 12px 16px;
  cursor: pointer;
  background: none;
  border: none;
  font-family: inherit;
  color: inherit;
  text-align: left;
}
.panel-head:hover {
  background: var(--row-hover);
}
.panel-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}
.panel-badge {
  background: var(--border);
  color: var(--muted);
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 10px;
  font-weight: 600;
}
.panel-chevron {
  color: var(--text-tertiary);
  transition: transform 0.2s;
}
.panel-chevron.open {
  transform: rotate(180deg);
}
.panel-body {
  padding: 4px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>
