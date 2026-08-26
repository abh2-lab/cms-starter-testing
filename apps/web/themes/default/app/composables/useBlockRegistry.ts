import { defineAsyncComponent, type Component } from 'vue';
import BlockHero from '~/components/blocks/BlockHero.vue';
import BlockLatestNews from '~/components/blocks/BlockLatestNews.vue';
import BlockFeaturedArticle from '~/components/blocks/BlockFeaturedArticle.vue';
import BlockImpactStats from '~/components/blocks/BlockImpactStats.vue';
import BlockPostTitle from '~/components/blocks/BlockPostTitle.vue';
import BlockFeaturedImage from '~/components/blocks/BlockFeaturedImage.vue';
import BlockPublishedAt from '~/components/blocks/BlockPublishedAt.vue';
import BlockPostAuthor from '~/components/blocks/BlockPostAuthor.vue';
import BlockArchiveTitle from '~/components/blocks/BlockArchiveTitle.vue';
import BlockGroup from '~/components/blocks/BlockGroup.vue';
import BlockQueryLoop from '~/components/blocks/BlockQueryLoop.vue';
import BlockPost from '~/components/blocks/BlockPost.vue';
import BlockPostCard from '~/components/blocks/BlockPostCard.vue';
import BlockArchiveHero from '~/components/blocks/BlockArchiveHero.vue';
import BlockArchiveManifesto from '~/components/blocks/BlockArchiveManifesto.vue';
import BlockDispatchBox from '~/components/blocks/BlockDispatchBox.vue';
import BlockEditorNotesColumn from '~/components/blocks/BlockEditorNotesColumn.vue';
import BlockSiteNav from '~/components/blocks/BlockSiteNav.vue';
import BlockFooterColumns from '~/components/blocks/BlockFooterColumns.vue';
import BlockFooterBottom from '~/components/blocks/BlockFooterBottom.vue';
import BlockPostHero from '~/components/blocks/BlockPostHero.vue';
import BlockEditorialNote from '~/components/blocks/BlockEditorialNote.vue';
import BlockArticleToc from '~/components/blocks/BlockArticleToc.vue';
import BlockPostTags from '~/components/blocks/BlockPostTags.vue';
import BlockEditorCredit from '~/components/blocks/BlockEditorCredit.vue';
import BlockRelatedPosts from '~/components/blocks/BlockRelatedPosts.vue';
import BlockAuthorBios from '~/components/blocks/BlockAuthorBios.vue';
import BlockNotFound from '~/components/blocks/BlockNotFound.vue';
import BlockSearchForm from '~/components/blocks/BlockSearchForm.vue';
import BlockSearchResults from '~/components/blocks/BlockSearchResults.vue';
import BlockAuthorGrid from '~/components/blocks/BlockAuthorGrid.vue';
import BlockContactForm from '~/components/blocks/BlockContactForm.vue';
import BlockSearchOverlay from '~/components/blocks/BlockSearchOverlay.vue';
import BlockTitleBand from '~/components/blocks/BlockTitleBand.vue';
import BlockSocialShare from '~/components/blocks/BlockSocialShare.vue';
import BlockSidebarContactCard from '~/components/blocks/BlockSidebarContactCard.vue';
import BlockPrevNextNav from '~/components/blocks/BlockPrevNextNav.vue';

// Block key -> Vue component, for the CORE blocks only: the 39 that ship to
// every publisher, matching CORE_BLOCK_KEYS on the server (derived there from
// which folder a block's file lives in).
//
// A theme layer adds its own blocks by spreading this map and appending to it
// — see apps/web/themes/ping/app/composables/useBlockRegistry.ts. Overriding an
// entry here replaces a core renderer for that theme.
// See docs/phase-3-versioning-and-updates-plan.md.
export const BLOCK_REGISTRY: Readonly<Record<string, Component>> = {
  hero: BlockHero as Component,
  'latest-news': BlockLatestNews as Component,
  'featured-article': BlockFeaturedArticle as Component,
  'impact-stats': BlockImpactStats as Component,
  // FSE-style primitives. Field blocks read the current-post box; container/box
  // blocks render their children via the default slot (see BlockNode).
  'post-title': BlockPostTitle as Component,
  // Lazy-loaded: BlockPostContent → ContentBody → renderTiptap (@tiptap/html) is
  // a heavy chain that pulls Node built-ins (path/url/source-map-js) into the
  // client bundle. Code-split it so it loads ONLY when an article body renders —
  // keeping it (and the dev "module externalized" console warnings) off the
  // homepage and every other non-article page that uses the block registry.
  'post-content': defineAsyncComponent(
    () => import('~/components/blocks/BlockPostContent.vue'),
  ) as Component,
  'featured-image': BlockFeaturedImage as Component,
  'published-at': BlockPublishedAt as Component,
  'post-author': BlockPostAuthor as Component,
  // Lazy-loaded for the same reason as post-content: rich-text custom fields
  // render via ContentBody → renderTiptap, a heavy chain best code-split so it
  // only loads when a custom-field block actually renders.
  'custom-field': defineAsyncComponent(
    () => import('~/components/blocks/BlockCustomField.vue'),
  ) as Component,
  'archive-title': BlockArchiveTitle as Component,
  group: BlockGroup as Component,
  'query-loop': BlockQueryLoop as Component,
  post: BlockPost as Component,
  // Archive re-blocking (v1.5).
  'post-card': BlockPostCard as Component,
  'archive-hero': BlockArchiveHero as Component,
  'archive-manifesto': BlockArchiveManifesto as Component,
  'dispatch-box': BlockDispatchBox as Component,
  'editor-notes-column': BlockEditorNotesColumn as Component,
  // Site chrome (v1.5 parts).
  'site-nav': BlockSiteNav as Component,
  'footer-columns': BlockFooterColumns as Component,
  'footer-bottom': BlockFooterBottom as Component,
  // Article chrome (v1.5).
  'post-hero': BlockPostHero as Component,
  'editorial-note': BlockEditorialNote as Component,
  'article-toc': BlockArticleToc as Component,
  'post-tags': BlockPostTags as Component,
  'editor-credit': BlockEditorCredit as Component,
  'related-posts': BlockRelatedPosts as Component,
  'author-bios': BlockAuthorBios as Component,
  // System-page blocks (v2 Phase 4): 404 / search / authors / contact.
  'not-found': BlockNotFound as Component,
  'search-form': BlockSearchForm as Component,
  'search-results': BlockSearchResults as Component,
  'author-grid': BlockAuthorGrid as Component,
  'contact-form': BlockContactForm as Component,
  // <gen:block-registry> — `pnpm gen:block` inserts new block entries here. Keep this marker.
  'search-overlay': BlockSearchOverlay as Component,
  'title-band': BlockTitleBand as Component,
  'social-share': BlockSocialShare as Component,
  'sidebar-contact-card': BlockSidebarContactCard as Component,
  'prev-next-nav': BlockPrevNextNav as Component,
};

// The shape the API's block composer returns, and the prop BlockNode renders.
// Lives here because the registry is what maps a `key` to the component that
// consumes it. Theme layers re-export this rather than redeclaring it.
export interface ComposedBlock {
  id: string;
  key: string;
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  data: Record<string, unknown> | null;
  children?: ComposedBlock[];
  error?: 'load_failed' | 'unknown_block' | 'max_depth' | 'budget_exceeded';
}

export function useBlockRegistry(): typeof BLOCK_REGISTRY {
  return BLOCK_REGISTRY;
}
