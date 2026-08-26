<script lang="ts">
import { defineComponent } from 'vue';

// Core stub. The real ThemeCurve — PING's signature hand-drawn curve engine —
// lives in that theme's layer together with utils/curves.ts and friends,
// roughly 1,600 lines of brand-specific art.
//
// Two CORE blocks decorate themselves with a curve: BlockContactForm and
// BlockTitleBand. Each does it in a single line. Rather than duplicate those
// blocks per theme (one is 529 lines) or ship the curve engine to every
// publisher, core keeps the call site and renders nothing; a theme that has
// curves overrides this component by filename and the call site lights up.
// That is Nuxt layer overriding doing exactly what it is for.
//
// Written as a render function returning null, NOT as an empty <template>: Vue
// requires a template to have a root element, so an "empty" one is a lint
// error (vue/valid-template-root) — CI caught exactly that. Props mirror the
// real component so a call site type-checks against either.
// See docs/phase-3-versioning-and-updates-plan.md.
export default defineComponent({
  name: 'ThemeCurve',
  props: {
    shape: { type: String, required: true },
    reveal: { type: String, default: undefined },
    trigger: { type: String, default: undefined },
    sequence: { type: Boolean, default: false },
    colour: { type: String, default: undefined },
  },
  // Decoration a themeless install simply does without.
  render: () => null,
});
</script>
