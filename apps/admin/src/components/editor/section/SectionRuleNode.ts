import { VueNodeViewRenderer } from '@tiptap/vue-3';
import { SectionRule as BaseSectionRule } from '@cms/editor/extensions';
import SectionRuleView from './SectionRuleView.vue';

/**
 * Admin build of the shared SectionRule node. The canonical schema and
 * `insertSectionRule` command live in @cms/editor; here we attach a Vue
 * NodeView that previews the kicker label + hairline and lets the editor
 * rename the label / set an optional anchor id. The public renderer uses the
 * bare node (which emits the `.article-section-rule` markup).
 */
export const SectionRule = BaseSectionRule.extend({
  addNodeView() {
    return VueNodeViewRenderer(SectionRuleView);
  },
});
