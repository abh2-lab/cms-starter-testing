import { VueNodeViewRenderer } from '@tiptap/vue-3';
import { Embed as BaseEmbed } from '@cms/editor/extensions';
import EmbedView from './EmbedView.vue';

export type { EmbedAttrs } from '@cms/editor/types';

/**
 * Admin build of the shared Embed node. The canonical schema, attributes and
 * commands live in @cms/editor; here we only attach the Vue NodeView that
 * renders the in-editor embed card. The public renderer uses the bare node.
 */
export const Embed = BaseEmbed.extend({
  addNodeView() {
    return VueNodeViewRenderer(EmbedView);
  },
});
