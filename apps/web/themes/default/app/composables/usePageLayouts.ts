import { type Component } from 'vue';
import LayoutDefault from '~/components/page-layouts/LayoutDefault.vue';
import LayoutContained from '~/components/page-layouts/LayoutContained.vue';
import LayoutBlank from '~/components/page-layouts/LayoutBlank.vue';

// Map of page-layout id → the wrapper component PageView renders the static
// body inside. Keys MUST match the ids in @cms/blocks `pageLayoutRegistry`
// (the manifest the admin selector lists). Adding a layout = a manifest entry
// there + a wrapper here on the same id (+ a `blank` Nuxt layout for any
// chromeless one). Mirrors useBlockRegistry's static map.
//
// `default` is the fallback for unknown / legacy ids (raw / full-width /
// new-standard / with-register …) and is a pass-through, so old
// `pages.layout_template` values render exactly as they did before layouts
// were applied — no surprise reflow on existing pages.
export const PAGE_LAYOUT_REGISTRY: Readonly<Record<string, Component>> = {
  default: LayoutDefault as Component,
  contained: LayoutContained as Component,
  blank: LayoutBlank as Component,
};

export function resolvePageLayoutComponent(
  id: string | null | undefined,
): Component {
  return (id ? PAGE_LAYOUT_REGISTRY[id] : undefined) ?? PAGE_LAYOUT_REGISTRY['default']!;
}
