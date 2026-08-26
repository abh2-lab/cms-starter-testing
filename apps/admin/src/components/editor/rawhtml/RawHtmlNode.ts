import { VueNodeViewRenderer } from '@tiptap/vue-3';
import { RawHTML as BaseRawHTML } from '@cms/editor/extensions';
import RawHtmlView from './RawHtmlView.vue';

export type { RawHtmlAttrs } from '@cms/editor/types';

/**
 * Admin build of the shared RawHTML escape-hatch node. The canonical schema and
 * `insertRawHtml` command live in @cms/editor; here we attach a Vue NodeView
 * with a code editor. The stored markup is sanitised by the public renderer
 * before it ever reaches a reader (see apps/web utils/tiptap.ts).
 */
export const RawHTML = BaseRawHTML.extend({
  addNodeView() {
    return VueNodeViewRenderer(RawHtmlView);
  },
});
