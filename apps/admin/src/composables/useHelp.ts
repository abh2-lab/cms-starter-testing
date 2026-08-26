import { readonly, ref } from 'vue';

// Module-scope singleton — one HelpDrawer is mounted at App.vue, every "?"
// button across the app drives this same flag.
const isOpen = ref(false);

function open(): void {
  isOpen.value = true;
}

function close(): void {
  isOpen.value = false;
}

function toggle(): void {
  isOpen.value = !isOpen.value;
}

export function useHelp() {
  return { isOpen: readonly(isOpen), open, close, toggle };
}
