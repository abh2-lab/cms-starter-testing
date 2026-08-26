import { ref } from 'vue';

export interface LinkDialogOptions {
  /** Current href when editing an existing link; '' when creating one. */
  href: string;
  /** True when invoked on an existing link — shows the Remove button. */
  existing: boolean;
}

export type LinkDialogResult =
  | { action: 'apply'; href: string }
  | { action: 'remove' }
  | { action: 'cancel' };

interface LinkDialogRequest extends LinkDialogOptions {
  id: number;
  resolve: (value: LinkDialogResult) => void;
}

// Module-level singleton consumed by the single LinkDialog in App.vue —
// same pattern as useConfirm/ConfirmDialog.
const current = ref<LinkDialogRequest | null>(null);
let seq = 0;

/**
 * Accept what people actually paste into a link field and return a usable
 * href: absolute http(s), mailto:, tel:, site-relative paths and in-page
 * anchors pass through; bare domains ("example.com/x") get https:// added.
 * Returns null for anything else (including javascript: and friends).
 */
export function normalizeLinkHref(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(v)) return v;
  if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/i.test(v)) return `https://${v}`;
  return null;
}

/** Show the link dialog; resolves with the user's action. */
function openLinkDialog(
  options: LinkDialogOptions,
): Promise<LinkDialogResult> {
  // Auto-cancel any dialog already open.
  current.value?.resolve({ action: 'cancel' });
  return new Promise<LinkDialogResult>((resolve) => {
    current.value = { ...options, id: ++seq, resolve };
  });
}

function respond(value: LinkDialogResult): void {
  const req = current.value;
  current.value = null;
  req?.resolve(value);
}

export function useLinkDialog() {
  return { current, openLinkDialog, respond };
}
