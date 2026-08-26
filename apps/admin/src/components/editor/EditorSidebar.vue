<script setup lang="ts">
import { computed } from 'vue';

type SidebarTab = 'post' | 'seo' | 'revisions';

const props = withDefaults(
  defineProps<{
    tab: SidebarTab;
    /** Tabs to suppress — e.g. SEO/Revisions before a new post's first save. */
    hideTabs?: SidebarTab[];
  }>(),
  { hideTabs: () => [] },
);
const emit = defineEmits<{ 'update:tab': [value: SidebarTab] }>();

const TABS: { key: SidebarTab; label: string }[] = [
  { key: 'post', label: 'Post' },
  { key: 'seo', label: 'SEO' },
  { key: 'revisions', label: 'Revisions' },
];
const tabs = computed(() =>
  TABS.filter((t) => !props.hideTabs.includes(t.key)),
);
</script>

<template>
  <aside class="sidebar">
    <div class="tabs">
      <button
        v-for="t in tabs"
        :key="t.key"
        type="button"
        class="tab"
        :class="{ active: tab === t.key }"
        @click="emit('update:tab', t.key)"
      >
        {{ t.label }}
      </button>
    </div>
    <div class="tab-body">
      <slot v-if="tab === 'post'" name="post" />
      <slot v-else-if="tab === 'seo'" name="seo" />
      <slot v-else name="revisions" />
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  background: var(--surface-2);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  min-height: 100%;
}
.tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  position: sticky;
  top: 0;
  z-index: 2;
}
.tab {
  flex: 1;
  padding: 11px 4px;
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  color: var(--text-tertiary);
  border: none;
  border-bottom: 2px solid transparent;
  background: none;
  font-family: inherit;
  margin-bottom: -1px;
  transition: color 0.15s;
}
.tab:hover {
  color: var(--muted);
}
.tab.active {
  color: var(--fg);
  border-bottom-color: var(--accent);
}
.tab-body {
  display: flex;
  flex-direction: column;
}
</style>
