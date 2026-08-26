import { ref } from 'vue';

export type ConfirmTone = 'default' | 'danger';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
}

interface ConfirmRequest extends ConfirmOptions {
  id: number;
  resolve: (value: boolean) => void;
}

// Module-level singleton consumed by the single ConfirmDialog in App.vue.
const current = ref<ConfirmRequest | null>(null);
let seq = 0;

/** Show a confirm dialog; resolves true (confirmed) or false (cancelled). */
function confirm(options: ConfirmOptions): Promise<boolean> {
  // Auto-cancel any dialog already open.
  current.value?.resolve(false);
  return new Promise<boolean>((resolve) => {
    current.value = { ...options, id: ++seq, resolve };
  });
}

function respond(value: boolean): void {
  const req = current.value;
  current.value = null;
  req?.resolve(value);
}

export function useConfirm() {
  return { current, confirm, respond };
}
