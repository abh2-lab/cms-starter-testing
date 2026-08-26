<script setup lang="ts">
import type { SlashItem } from './SlashCommand';

defineProps<{ items: SlashItem[]; selected: number }>();
const emit = defineEmits<{ select: [index: number] }>();
</script>

<template>
  <div class="slash-menu">
    <div class="slash-title">Insert block</div>
    <template v-if="items.length">
      <button
        v-for="(item, i) in items"
        :key="item.title"
        type="button"
        class="slash-item"
        :class="{ sel: i === selected }"
        @mousedown.prevent="emit('select', i)"
      >
        <span class="slash-icon">{{ item.icon }}</span>
        <span class="slash-meta">
          <span class="slash-name">{{ item.title }}</span>
          <span class="slash-desc">{{ item.description }}</span>
        </span>
      </button>
    </template>
    <div v-else class="slash-empty">No matching blocks</div>
  </div>
</template>

<style scoped>
.slash-menu {
  width: 256px;
  padding: 6px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
}
.slash-title {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-tertiary);
  padding: 4px 8px 6px;
}
.slash-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 8px;
  border: none;
  background: none;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  color: inherit;
}
.slash-item:hover,
.slash-item.sel {
  background: var(--accent-soft);
}
.slash-icon {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  background: var(--surface);
  flex-shrink: 0;
}
.slash-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.slash-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--fg);
}
.slash-desc {
  font-size: 11px;
  color: var(--text-tertiary);
}
.slash-empty {
  padding: 8px;
  font-size: 12px;
  color: var(--text-tertiary);
}
</style>
