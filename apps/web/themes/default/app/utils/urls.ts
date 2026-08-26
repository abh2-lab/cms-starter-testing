// Single source of truth for public-site URL construction.
//
// Decode uses publisher-CMS URL conventions: static pages, category
// archives and tag archives all live at the publication root (one slug
// segment), and articles live under their primary category (two segments).
// Every internal link in the codebase routes through this helper so a
// future URL-rules change (e.g. adding a year prefix to article URLs)
// flows through one file instead of grepping for `\`/article/${slug}\``
// across 20+ components.
//
// Hard rules baked into the URL shape:
//   * categoryUrl(slug)  → `/<slug>`        (flat at root)
//   * tagUrl(slug)       → `/<slug>`        (flat at root, same shape as
//                                            category — disambiguation
//                                            happens server-side via
//                                            /api/public/resolve)
//   * articleUrl(slug, primaryCategorySlug)
//       → `/<primaryCategorySlug>/<slug>` when a category exists
//       → `/uncategorized/<slug>`         defensive fallback (the publish
//                                          gate from commit 2.1 makes this
//                                          unreachable from the editorial
//                                          flow, but the type still allows
//                                          null because draft / preview
//                                          paths can hit this helper).
//   * authorUrl(slug)    → `/author/<slug>` (unchanged — authors keep
//                                            their prefix to leave room
//                                            in the root namespace).
//
// Pure functions on purpose: no Vue imports, no reactivity, safe to call
// from anywhere (template, script, SSR, plain JS test).

export function categoryUrl(slug: string): string {
  return `/${slug}`;
}

export function tagUrl(slug: string): string {
  return `/${slug}`;
}

export function articleUrl(
  slug: string,
  primaryCategorySlug: string | null | undefined,
): string {
  if (primaryCategorySlug && primaryCategorySlug.length > 0) {
    return `/${primaryCategorySlug}/${slug}`;
  }
  return `/uncategorized/${slug}`;
}

export function authorUrl(slug: string): string {
  return `/author/${slug}`;
}

// Portfolio entries live under their category: /<category-slug>/<slug>
// (e.g. /brands/acme). This is the same two-segment shape the theme's article
// route uses; this site has no news content type, so that route serves the
// portfolio detail page (see pages/[slug]/[article].vue). `categorySlug` is the
// entry's portfolio-categories term. It falls back to a /portfolio/<slug>
// prefix when the category is missing — that path resolves to the same
// two-segment route, so the link still works (and admin "Preview" keeps using
// it, since the admin has no category token).
export function portfolioUrl(
  slug: string,
  categorySlug: string | null | undefined,
): string {
  if (categorySlug && categorySlug.length > 0) {
    return `/${categorySlug}/${slug}`;
  }
  return `/portfolio/${slug}`;
}
