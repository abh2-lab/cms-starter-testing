<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import type { ContentType } from '@/api/content-types';

// "+ New Content" type chooser. Picking a card sends the user straight into
// the full-screen editor in new-post mode (the row is created on first save),
// so this modal replaces the old /content/new form entirely. Hosted locally
// by ContentList like MediaPickerModal — not a global singleton.
const props = defineProps<{
  open: boolean;
  types: ContentType[];
}>();

const emit = defineEmits<{
  close: [];
  select: [type: ContentType];
}>();

function onKeydown(e: KeyboardEvent): void {
  if (props.open && e.key === 'Escape') emit('close');
}
onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Transition name="ctp">
    <div v-if="open" class="ctp-backdrop" @click.self="emit('close')">
      <div
        class="ctp-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Choose a content type"
      >
        <header class="ctp-head">
          <h2 class="ctp-title">What are you creating?</h2>
          <p class="ctp-sub">Pick a content type to start writing.</p>
        </header>

        <div v-if="types.length === 0" class="ctp-empty">
          <p>
            No content types exist yet. Create one in
            <RouterLink :to="{ name: 'content-type-new' }" @click="emit('close')"
              >Content Types</RouterLink
            >
            first.
          </p>
        </div>

        <div v-else class="ctp-grid">
          <button
            v-for="t in types"
            :key="t.id"
            type="button"
            class="ctp-card"
            :data-testid="`ctp-card-${t.slug}`"
            @click="emit('select', t)"
          >
            <!-- ContentType.icon is an emoji string (see ContentTypesList), not an Icon name. -->
            <span class="ctp-icon" aria-hidden="true">{{
              t.icon?.trim() || '📦'
            }}</span>
            <span class="ctp-name">{{ t.name }}</span>
            <span class="ctp-desc">{{
              t.description?.trim() || `A new ${t.name.toLowerCase()} entry.`
            }}</span>
            <span class="ctp-slug">/{{ t.slug }}/</span>
          </button>
        </div>

        <footer class="ctp-actions">
          <button type="button" class="btn btn-secondary" @click="emit('close')">
            Cancel
          </button>
        </footer>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.ctp-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.ctp-dialog {
  width: 560px;
  max-width: 100%;
  max-height: min(80vh, 640px);
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  padding: 22px;
}
.ctp-head {
  margin-bottom: 16px;
}
.ctp-title {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: var(--fg);
}
.ctp-sub {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}
.ctp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}
.ctp-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-2, transparent);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition:
    border-color 0.12s ease,
    background 0.12s ease,
    transform 0.12s ease;
}
.ctp-card:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
  transform: translateY(-1px);
}
.ctp-card:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.ctp-icon {
  font-size: 22px;
  line-height: 1;
  margin-bottom: 4px;
}
.ctp-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--fg);
}
.ctp-desc {
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
}
.ctp-slug {
  margin-top: 4px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  color: var(--text-tertiary);
}
.ctp-empty {
  padding: 18px 4px;
  font-size: 13.5px;
  color: var(--muted);
}
.ctp-empty a {
  color: var(--accent);
}
.ctp-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 18px;
}

/* Transition — mirrors ConfirmDialog */
.ctp-enter-from,
.ctp-leave-to {
  opacity: 0;
}
.ctp-enter-from .ctp-dialog,
.ctp-leave-to .ctp-dialog {
  transform: translateY(8px) scale(0.98);
}
.ctp-enter-active,
.ctp-leave-active {
  transition: opacity 0.18s ease;
}
.ctp-enter-active .ctp-dialog,
.ctp-leave-active .ctp-dialog {
  transition: transform 0.18s ease;
}
</style>
