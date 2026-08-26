import type { Component } from 'vue';
import { BLOCK_REGISTRY as CORE_REGISTRY } from '../../../default/app/composables/useBlockRegistry';
import BlockFooterBottom from '~/components/blocks/BlockFooterBottom.vue';
import BlockSearchOverlay from '~/components/blocks/BlockSearchOverlay.vue';
import BlockLatestNews from '~/components/blocks/BlockLatestNews.vue';

// The basic theme's block→component map: the 39 CORE renderers spread from the
// core layer, with neutral site chrome swapped in.
//
// It used to spread PING's full 77-renderer registry, which meant the neutral
// starter silently depended on another publisher's theme — and would have
// broken outright when that theme left for its own repo. It now takes only
// core, so a blank install renders core blocks and nothing publisher-specific.
// See docs/phase-3-versioning-and-updates-plan.md.
//
// Block components are resolved through this map (not by filename), so a neutral
// chrome override must live HERE, not just as a same-named .vue — and the paired
// BlockNode.vue in this layer imports THIS registry (via `~`) so every rendered
// block routes through it.
export type { ComposedBlock } from '../../../default/app/composables/useBlockRegistry';

export const BLOCK_REGISTRY: Readonly<Record<string, Component>> = {
  ...CORE_REGISTRY,
  'footer-bottom': BlockFooterBottom as Component,
  'search-overlay': BlockSearchOverlay as Component,
  'latest-news': BlockLatestNews as Component,
};

export function useBlockRegistry(): typeof BLOCK_REGISTRY {
  return BLOCK_REGISTRY;
}
