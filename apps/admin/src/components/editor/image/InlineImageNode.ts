import { VueNodeViewRenderer } from '@tiptap/vue-3';
import { InlineImage as BaseInlineImage } from '@cms/editor/extensions';
import InlineImageView from './InlineImageView.vue';

export type { InlineImageAttrs } from '@cms/editor/types';

/**
 * Admin build of the shared InlineImage node. The canonical schema, attributes
 * and `insertInlineImage` command live in @cms/editor; here we attach the Vue
 * NodeView that resolves the stored mediaId to a thumbnail and exposes
 * caption/credit/width/float controls. The public renderer uses the bare node
 * (which emits an <img> once the API resolves the mediaId to a URL).
 */
export const InlineImage = BaseInlineImage.extend({
  addNodeView() {
    return VueNodeViewRenderer(InlineImageView);
  },
});
