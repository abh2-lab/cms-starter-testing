// The theme's render-side half of the post-template system. Maps a post-template
// key (resolved by the API and shipped on StoryDetail.templateKey) to the
// article layout the theme renders. The metadata half — the list of available
// templates the admin shows — lives in @cms/blocks; this is the contract's
// rendering side: the theme must handle every key the metadata lists.
//
// Today both templates render through ArticleView, switching its long-form
// "variant". A future template that needs a genuinely different component can
// graduate this map from key -> variant to key -> component.

export type ArticleVariant = 'decode' | 'nyt';

export const POST_TEMPLATE_VARIANTS: Readonly<Record<string, ArticleVariant>> = {
  'article-standard': 'decode',
  'article-feature': 'nyt',
};

// Returns the variant for a key, or null when the key is absent/unknown — the
// caller then falls back to the legacy customFields.variant, then 'decode'.
export function resolvePostTemplateVariant(
  key: string | null | undefined,
): ArticleVariant | null {
  if (!key) return null;
  return POST_TEMPLATE_VARIANTS[key] ?? null;
}
