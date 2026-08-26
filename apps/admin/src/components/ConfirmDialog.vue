<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import Icon from '@/components/Icon.vue';
import { useConfirm } from '@/composables/useConfirm';

const { current, respond } = useConfirm();

function onKeydown(e: KeyboardEvent): void {
  if (current.value && e.key === 'Escape') respond(false);
}
onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Transition name="confirm">
    <div
      v-if="current"
      class="confirm-backdrop"
      @click.self="respond(false)"
    >
      <div
        class="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        :aria-label="current.title ?? 'Confirm'"
      >
        <div class="confirm-head">
          <span
            class="confirm-icon"
            :class="`confirm-icon--${current.tone ?? 'default'}`"
          >
            <Icon
              :name="
                (current.tone ?? 'default') === 'danger'
                  ? 'alert-triangle'
                  : 'info'
              "
              :size="18"
            />
          </span>
          <div class="confirm-text">
            <h2 v-if="current.title" class="confirm-title">
              {{ current.title }}
            </h2>
            <p class="confirm-message">{{ current.message }}</p>
          </div>
        </div>
        <div class="confirm-actions">
          <button
            type="button"
            class="btn btn-secondary"
            @click="respond(false)"
          >
            {{ current.cancelLabel ?? 'Cancel' }}
          </button>
          <button
            type="button"
            class="btn"
            :class="
              (current.tone ?? 'default') === 'danger'
                ? 'btn-danger'
                : 'btn-primary'
            "
            @click="respond(true)"
          >
            {{ current.confirmLabel ?? 'Confirm' }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
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
.confirm-dialog {
  width: 420px;
  max-width: 100%;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  padding: 22px;
}
.confirm-head {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}
.confirm-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  flex-shrink: 0;
}
.confirm-icon--default {
  background: var(--info-soft);
  color: var(--info);
}
.confirm-icon--danger {
  background: var(--danger-soft);
  color: var(--danger);
}
.confirm-text {
  padding-top: 2px;
}
.confirm-title {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: var(--fg);
}
.confirm-message {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--muted);
}
.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 22px;
}

/* Transition */
.confirm-enter-from,
.confirm-leave-to {
  opacity: 0;
}
.confirm-enter-from .confirm-dialog,
.confirm-leave-to .confirm-dialog {
  transform: translateY(8px) scale(0.98);
}
.confirm-enter-active,
.confirm-leave-active {
  transition: opacity 0.18s ease;
}
.confirm-enter-active .confirm-dialog,
.confirm-leave-active .confirm-dialog {
  transition: transform 0.18s ease;
}
</style>
