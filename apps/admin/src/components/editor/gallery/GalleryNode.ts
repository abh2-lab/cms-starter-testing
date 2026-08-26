import { VueNodeViewRenderer } from '@tiptap/vue-3';
import { Gallery as BaseGallery } from '@cms/editor/extensions';
import GalleryView from './GalleryView.vue';

export type { GalleryAttrs } from '@cms/editor/types';

/**
 * Admin build of the shared Gallery node. The canonical schema, attributes and
 * `insertGallery` command live in @cms/editor; here we attach the Vue NodeView
 * that resolves the stored mediaIds to thumbnails and exposes layout/caption
 * controls plus add/remove. The public renderer uses the bare node.
 */
export const Gallery = BaseGallery.extend({
  addNodeView() {
    return VueNodeViewRenderer(GalleryView);
  },
});
