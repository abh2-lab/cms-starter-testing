<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import { useToast, type ToastType } from '@/composables/useToast';

const { toasts, dismiss } = useToast();

const ICON: Record<ToastType, string> = {
  success: 'check',
  error: 'alert-circle',
  warning: 'alert-triangle',
  info: 'info',
};
</script>

<template>
  <TransitionGroup tag="div" name="toast" class="toast-host">
    <div
      v-for="t in toasts"
      :key="t.id"
      class="toast"
      :class="`toast--${t.type}`"
      role="status"
      aria-live="polite"
    >
      <span class="toast-icon"><Icon :name="ICON[t.type]" :size="15" /></span>
      <div class="toast-body">
        <p v-if="t.title" class="toast-title">{{ t.title }}</p>
        <p class="toast-message">{{ t.message }}</p>
      </div>
      <button
        type="button"
        class="toast-close"
        aria-label="Dismiss"
        @click="dismiss(t.id)"
      >
        <Icon name="x" :size="14" />
      </button>
    </div>
  </TransitionGroup>
</template>

<style scoped>
.toast-host {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 1100;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: min(380px, calc(100vw - 40px));
  pointer-events: none;
}
.toast {
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding: 12px 12px 12px 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-left-width: 3px;
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}
.toast-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 1px;
}
.toast-body {
  flex: 1;
  min-width: 0;
}
.toast-title {
  margin: 0 0 2px;
  font-size: 13px;
  font-weight: 600;
  color: var(--fg);
}
.toast-message {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: var(--muted);
  word-break: break-word;
}
.toast-close {
  display: inline-flex;
  border: none;
  background: none;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 2px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}
.toast-close:hover {
  color: var(--fg);
  background: var(--bg);
}

/* Per-type accents */
.toast--success {
  border-left-color: var(--success);
}
.toast--success .toast-icon {
  background: var(--success-soft);
  color: var(--success);
}
.toast--error {
  border-left-color: var(--danger);
}
.toast--error .toast-icon {
  background: var(--danger-soft);
  color: var(--danger);
}
.toast--warning {
  border-left-color: var(--warning);
}
.toast--warning .toast-icon {
  background: var(--warning-soft);
  color: var(--warning);
}
.toast--info {
  border-left-color: var(--info);
}
.toast--info .toast-icon {
  background: var(--info-soft);
  color: var(--info);
}

/* Enter / leave / move transitions */
.toast-enter-from {
  opacity: 0;
  transform: translateX(20px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}
.toast-leave-active {
  position: absolute;
  right: 0;
  width: 100%;
}
.toast-move {
  transition: transform 0.25s ease;
}
</style>
