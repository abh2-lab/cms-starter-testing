<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Icon from '@/components/Icon.vue';
import { normalizeLinkHref, useLinkDialog } from '@/composables/useLinkDialog';

// Singleton link editor for the body editor's Link button — replaces the old
// window.prompt(). Mounted once in App.vue like ConfirmDialog.
const { current, respond } = useLinkDialog();

const draft = ref('');
const invalid = ref(false);
const inputEl = ref<HTMLInputElement | null>(null);

watch(current, async (req) => {
  if (!req) return;
  draft.value = req.href;
  invalid.value = false;
  await nextTick();
  inputEl.value?.focus();
  inputEl.value?.select();
});

function apply(): void {
  const href = normalizeLinkHref(draft.value);
  if (!href) {
    invalid.value = true;
    inputEl.value?.focus();
    return;
  }
  respond({ action: 'apply', href });
}

function onKeydown(e: KeyboardEvent): void {
  if (current.value && e.key === 'Escape') respond({ action: 'cancel' });
}
onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Transition name="confirm">
    <div
      v-if="current"
      class="confirm-backdrop"
      @click.self="respond({ action: 'cancel' })"
    >
      <div
        class="link-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="current.existing ? 'Edit link' : 'Add link'"
      >
        <div class="ld-head">
          <span class="ld-icon"><Icon name="link" :size="16" /></span>
          <h2 class="ld-title">
            {{ current.existing ? 'Edit link' : 'Add link' }}
          </h2>
        </div>
        <form class="ld-form" @submit.prevent="apply">
          <input
            ref="inputEl"
            v-model="draft"
            type="text"
            class="ld-input"
            :class="{ 'ld-input--invalid': invalid }"
            placeholder="https://example.com/page"
            data-testid="link-dialog-input"
            spellcheck="false"
            @input="invalid = false"
          />
          <p v-if="invalid" class="ld-error" role="alert">
            Enter a valid URL — https://…, mailto:, tel:, or a /relative path.
          </p>
          <div class="ld-actions">
            <button
              v-if="current.existing"
              type="button"
              class="btn btn-danger"
              data-testid="link-dialog-remove"
              @click="respond({ action: 'remove' })"
            >
              Remove link
            </button>
            <span class="ld-spacer" />
            <button
              type="button"
              class="btn btn-secondary"
              @click="respond({ action: 'cancel' })"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="btn btn-primary"
              data-testid="link-dialog-apply"
            >
              {{ current.existing ? 'Update' : 'Add link' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* Backdrop + transition mirror ConfirmDialog so the two dialogs feel alike. */
.confirm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.link-dialog {
  width: 440px;
  max-width: 100%;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  padding: 20px;
}
.ld-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.ld-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--info-soft);
  color: var(--info);
  flex-shrink: 0;
}
.ld-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--fg);
}
.ld-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 6px);
  background: var(--surface-2, transparent);
  color: var(--fg);
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 13px;
  outline: none;
}
.ld-input:focus {
  border-color: var(--accent);
}
.ld-input--invalid {
  border-color: var(--danger);
}
.ld-error {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--danger);
}
.ld-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}
.ld-spacer {
  flex: 1;
}

.confirm-enter-from,
.confirm-leave-to {
  opacity: 0;
}
.confirm-enter-from .link-dialog,
.confirm-leave-to .link-dialog {
  transform: translateY(8px) scale(0.98);
}
.confirm-enter-active,
.confirm-leave-active {
  transition: opacity 0.18s ease;
}
.confirm-enter-active .link-dialog,
.confirm-leave-active .link-dialog {
  transition: transform 0.18s ease;
}
</style>
