import { ref } from 'vue';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: number;
  type: ToastType;
  message: string;
  title?: string;
  timeout: number;
}

export interface ToastOptions {
  title?: string;
  /** Auto-dismiss delay in ms. Pass 0 to make it sticky. */
  timeout?: number;
}

// Module-level singleton so any component can raise a toast and the single
// ToastHost (mounted in App.vue) renders them.
const toasts = ref<Toast[]>([]);
let seq = 0;

const DEFAULT_TIMEOUT: Record<ToastType, number> = {
  success: 3500,
  info: 3500,
  warning: 5000,
  error: 6000,
};

function dismiss(id: number): void {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

function push(type: ToastType, message: string, options?: ToastOptions): number {
  const id = ++seq;
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT[type];
  const entry: Toast = { id, type, message, timeout };
  if (options?.title) entry.title = options.title;
  toasts.value = [...toasts.value, entry];
  if (timeout > 0) {
    window.setTimeout(() => dismiss(id), timeout);
  }
  return id;
}

export const toast = {
  success: (message: string, options?: ToastOptions) =>
    push('success', message, options),
  error: (message: string, options?: ToastOptions) =>
    push('error', message, options),
  info: (message: string, options?: ToastOptions) =>
    push('info', message, options),
  warning: (message: string, options?: ToastOptions) =>
    push('warning', message, options),
};

export function useToast() {
  return { toasts, toast, dismiss };
}
