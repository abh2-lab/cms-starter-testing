/**
 * Thin wrapper around $fetch that points at the public CMS API. Returns the
 * unwrapped `data` field of the response (the API always wraps payloads as
 * { data: ... }) or null when the row is absent.
 *
 * `path` is a same-origin relative URL (e.g. `/api/public/site-settings`).
 * Nitro's `/api/public/**` proxy route rule (nuxt.config.ts) forwards it to the
 * API — for both SSR and browser calls — so there's no cross-origin request and
 * no API base URL to configure.
 */
import type { ComposedBlock } from '~/composables/useBlockRegistry';

export async function cmsFetch<T>(
  path: string,
  query?: Record<string, string | number | undefined>,
): Promise<T | null> {
  try {
    const res = await $fetch<{ data: T | null }>(path, {
      query,
    });
    return res.data ?? null;
  } catch (err) {
    // Distinguish EXPECTED empty-states from genuine failures. Both return
    // null so callers render an empty state, but only genuine failures log.
    //   404 — missing menu, archive page out of range, unknown slug.
    //   422 — a block that isn't previewable in isolation / has no sample
    //         content (the Block Gallery's /blocks/:key/preview path); a clean
    //         "No preview" render, NOT an error worth logging on every card.
    const status =
      typeof err === 'object' && err !== null && 'statusCode' in err
        ? (err as { statusCode: number }).statusCode
        : 0;
    if (status === 404 || status === 422) {
      return null;
    }
    console.error('[cmsFetch] failed', path, err);
    return null;
  }
}

/**
 * Shapes shared by multiple components — keep loose, the API surface is the
 * source of truth and these are read-only.
 */
export interface SiteSettings {
  siteName: string;
  siteUrl: string;
  siteDescription: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  ogImageUrl: string | null;
  socialLinks: Record<string, string> | null;
  defaultMetaTitleSuffix: string | null;
  defaultRobots: string;
  extra: {
    tagline?: string;
    tickerHeadlines?: { kind: string; text: string }[];
    impactStats?: { label: string; value: string }[];
    footerCoordinates?: string;
  } | null;
}

export interface MenuItem {
  id: string;
  label: string;
  url: string | null;
  contentSlug: string | null;
  contentType: string | null;
  openInNewTab: boolean;
  sortOrder: number;
  children: MenuItem[];
}

export interface Menu {
  id: string;
  name: string;
  slug: string;
  items: MenuItem[];
}

export interface TaxonomyTerm {
  termSlug: string;
  termName: string;
  taxonomySlug: string;
}

export interface StoryAuthor {
  displayName: string;
  // Present when the byline came from a content_fields.authors[] entry
  // (an author CPT row that has its own /author/<slug> page). null when
  // the byline fell back to the admin user's displayName — no detail
  // page to link to in that case.
  slug: string | null;
}

export interface StoryListItem {
  id: string;
  title: string;
  slug: string;
  publishedAt: string | null;
  // Multi-author bylines: each entry → /author/<slug> when slug is set.
  // Rendered with " & " between entries on cards. null when the row has
  // no byline (neither a typed-in custom_fields.authors[] entry nor an
  // admin-user displayName fallback).
  authors: StoryAuthor[] | null;
  heroImageUrl: string | null;
  excerpt: string | null;
  featured: boolean;
  taxonomy: TaxonomyTerm[];
  // First taxonomy term whose taxonomySlug === 'categories', picked
  // server-side. Drives the canonical /<category>/<article> URL the
  // url helper builds in utils/urls.ts; null when the row has no
  // category (frontend falls back to /uncategorized/<slug>).
  primaryCategorySlug: string | null;
  // Only present when the archive request opts in via ?include=customFields.
  // Default callers will see this as undefined.
  customFields?: Record<string, unknown>;
}

export interface StoryArchive {
  items: StoryListItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

/** Composed archive view (theme engine v1.5) — /api/public/views/archive/
 *  <taxonomy>/<term>. Page 1 of the term's listing as a composed block tree
 *  plus the term metadata; load-more pages keep coming from the raw
 *  /api/public/archive endpoint (hybrid pagination). */
export interface ArchiveViewPayload {
  archive: {
    title: string;
    termSlug: string;
    taxonomySlug: string;
    description: string | null;
    taxonomyDescription: string | null;
    total: number;
  };
  blocks: ComposedBlock[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

/** Public-search result envelope. items are a superset of StoryListItem
 *  (contentTypeSlug added) so the same StoryCard renders either source. */
export interface SearchItem extends StoryListItem {
  contentTypeSlug: string;
}

export interface SearchResults {
  items: SearchItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface StoryDetail {
  id: string;
  title: string;
  slug: string;
  type: string;
  publishedAt: string | null;
  authors: StoryAuthor[] | null;
  customFields: Record<string, unknown>;
  seo: {
    metaTitle: string | null;
    metaDescription: string | null;
    ogImageUrl: string | null;
    twitterImageUrl: string | null;
    canonicalUrl: string | null;
    robotsIndex: boolean;
    robotsFollow: boolean;
    schemaType: string | null;
  } | null;
  taxonomy: TaxonomyTerm[];
  // First taxonomy term whose taxonomySlug === 'categories'. Mirrors
  // the same field on StoryListItem; emitted by the public content
  // endpoint for use by the article page (breadcrumb anchor + canonical
  // URL self-link).
  primaryCategorySlug: string | null;
  // Resolved post-template key (per-post override ?? content-type default ??
  // theme default). The theme maps it to an article layout — see
  // usePostTemplateRegistry.
  templateKey: string | null;
  // Composed `single` template block-tree (post-content body block in v1).
  // ArticleView renders this in its content column via <BlockTree>.
  blocks: ComposedBlock[];
}

/**
 * Shared useAsyncData wrappers. Centralising the handler functions here means
 * the layout and any page asking for the same chrome data use the SAME
 * function reference + key — Nuxt's "incompatible options detected" guard
 * (which would otherwise drop the payload data, forcing a client-side
 * re-fetch and hydration mismatches) is satisfied automatically.
 */
export const useSiteSettings = () =>
  useAsyncData('cms:site-settings', () =>
    cmsFetch<SiteSettings>('/api/public/site-settings'),
  );

export const useCmsMenu = (slug: string) =>
  useAsyncData(`cms:menu:${slug}`, () =>
    cmsFetch<Menu>(`/api/public/menus/${encodeURIComponent(slug)}`),
  );

/** Composed template-PART (theme engine v1.5): header / footer / sidebar —
 *  a named block-list the layout and view shells mount around the per-route
 *  content. Structure-only payload (part blocks self-fetch their menus). */
export interface PartPayload {
  key: string;
  blocks: ComposedBlock[];
}

export const useCmsPart = (key: string) => {
  // Theme-preview sessions (structure editor iframe, ?theme_preview=) see
  // DRAFT part overrides: forward the token and key the payload on it so a
  // preview render never shares a cache slot with the public one.
  const route = useRoute();
  const themePreview = computed<string | null>(() => {
    const raw = route.query['theme_preview'];
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  });
  return useAsyncData(
    () => `cms:part:${key}:${themePreview.value ?? 'live'}`,
    () =>
      cmsFetch<PartPayload>(
        `/api/public/parts/${encodeURIComponent(key)}`,
        themePreview.value ? { theme_preview: themePreview.value } : undefined,
      ),
    { watch: [themePreview] },
  );
};
