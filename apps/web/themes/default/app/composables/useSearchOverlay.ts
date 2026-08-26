import type { Ref } from 'vue';

// Shared open/close state for the site-wide search overlay (the Decode
// "What are you looking for?" modal). The header search button (BlockSiteNav)
// calls open(); the BlockSearchOverlay block reads isOpen and renders the modal.
// useState gives an SSR-safe, per-request, app-wide singleton, so the trigger
// and the overlay — sibling blocks in the header part — share one source of
// truth without prop drilling or a global event bus.
export interface SearchOverlayController {
  isOpen: Ref<boolean>;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export function useSearchOverlay(): SearchOverlayController {
  const isOpen = useState<boolean>('search-overlay-open', () => false);
  return {
    isOpen,
    open: () => {
      isOpen.value = true;
    },
    close: () => {
      isOpen.value = false;
    },
    toggle: () => {
      isOpen.value = !isOpen.value;
    },
  };
}
