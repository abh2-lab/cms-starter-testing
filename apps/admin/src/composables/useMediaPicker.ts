import { ref, type Ref } from 'vue';
import type { Media } from '@/api/media';

export interface MediaPickerController {
  /** Whether the modal is currently open (drive `<MediaPickerModal v-if>`). */
  open: Ref<boolean>;
  /** Single vs multiple selection for the open session. */
  multiple: Ref<boolean>;
  /**
   * Open the picker and resolve with the chosen media once the user confirms,
   * or `[]` if they close it. Image/gallery insertion needs a real mediaId
   * *before* inserting (an empty image fails the body validator), so callers
   * await this and only insert on a non-empty result.
   */
  pick: (multiple: boolean) => Promise<Media[]>;
  /** Bound to the modal's `@select`. */
  resolve: (items: Media[]) => void;
  /** Bound to the modal's `@close`. */
  cancel: () => void;
}

/**
 * Promise-based bridge between the editor toolbar / slash menu and a single
 * shared `<MediaPickerModal>` hosted by the editor page. The modal can't be
 * mounted from inside the ProseMirror slash plugin, so the page owns it and the
 * toolbar/slash call `pick()` to drive it.
 */
export function useMediaPicker(): MediaPickerController {
  const open = ref(false);
  const multiple = ref(false);
  let resolver: ((items: Media[]) => void) | null = null;

  function settle(items: Media[]): void {
    open.value = false;
    const r = resolver;
    resolver = null;
    r?.(items);
  }

  return {
    open,
    multiple,
    pick(m: boolean): Promise<Media[]> {
      // A second open while one is pending cancels the first.
      if (resolver) settle([]);
      multiple.value = m;
      open.value = true;
      return new Promise<Media[]>((res) => {
        resolver = res;
      });
    },
    resolve: (items: Media[]) => settle(items),
    cancel: () => settle([]),
  };
}
