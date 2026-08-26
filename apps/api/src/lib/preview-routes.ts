// Pure helper that turns a content type's `previewPath` template into a real
// URL path for a specific content row. The template lives on the
// `content_types.preview_path` column and is set by editors in the content-
// type form (admin) — it supports two placeholders, substituted with their
// URL-encoded values here:
//   * `{slug}`     → the content row's slug
//   * `{category}` → the row's primary category slug (first term in the
//                    `categories` taxonomy), or `uncategorized` when the row
//                    has none — mirroring the public articleUrl() fallback in
//                    apps/web/.../utils/urls.ts so the admin Preview URL and
//                    the public canonical agree.
// Returns null when the content type has no template configured, which the
// call site translates into the 422 `no_public_route` response the admin UI
// knows how to render.
//
// Keeping the substitution side pure (no DB access) leaves the DB read at
// the call site, where the contentTypes row is already in scope from the
// join. Cheaper than a second round-trip and trivially unit-testable.

export function buildPreviewPath(
  previewPath: string | null | undefined,
  slug: string,
  categorySlug?: string | null,
): string | null {
  if (!previewPath || previewPath.length === 0) return null;
  // Keep placeholder keys in `{snake_case}` form to match common path
  // templating conventions. Both values are URL-encoded — the substitution is
  // the only sanitizer between a runaway slug/category and a malformed URL.
  const category =
    categorySlug && categorySlug.length > 0 ? categorySlug : 'uncategorized';
  return previewPath
    .replace(/\{slug\}/g, encodeURIComponent(slug))
    .replace(/\{category\}/g, encodeURIComponent(category));
}
