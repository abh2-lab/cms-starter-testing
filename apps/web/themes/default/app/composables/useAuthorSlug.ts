// Tiny helper shared by the article page and the author page. Articles store
// each byline as { slug?, name } — slug was added in Part 2; rows seeded
// earlier still carry only { name }. Both paths derive the same author URL
// either by reading slug or falling back to a kebab-case of the name. As
// long as the Author content row uses the same convention for its own slug,
// the byline link resolves to the right author page.
export function authorSlug(author: { slug?: string; name?: string }): string {
  if (typeof author.slug === 'string' && author.slug.length > 0) {
    return author.slug;
  }
  const name = typeof author.name === 'string' ? author.name : '';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
