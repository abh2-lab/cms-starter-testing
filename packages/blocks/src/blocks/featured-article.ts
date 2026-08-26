import type { Block } from '../types.js';

// FeaturedArticle — a single hand-picked story callout. Distinct from Hero
// because it sits in-flow alongside other blocks (a "must read" slot below
// the fold) rather than at the top of the page.

interface FeaturedArticleFields {
  eyebrow?: string;
}
interface FeaturedArticleOptions {
  content_type?: string;
  slug?: string;
}
export const featuredArticle: Block<FeaturedArticleFields, FeaturedArticleOptions> = {
  meta: {
    key: 'featured-article',
    label: 'Featured Article',
    category: 'feature',
    description: 'A single hand-picked story shown as a feature card.',
    icon: 'page',
    fields: [
      {
        key: 'eyebrow',
        label: 'Eyebrow',
        type: 'short_text',
        default: 'Editor\'s pick',
      },
    ],
    options: [
      {
        key: 'content_type',
        label: 'Content type',
        type: 'content_type_slug',
        required: true,
        default: 'article',
        helpText: 'Pick the content type to source the featured story from.',
      },
      {
        key: 'slug',
        label: 'Story slug',
        type: 'content_slug',
        required: true,
      },
    ],
  },
  async load(ctx, { options }) {
    const typeSlug = options.content_type ?? 'article';
    const storySlug = options.slug ?? '';
    if (!storySlug) return { story: null };
    const story = await ctx.fetchContent(typeSlug, storySlug);
    return { story };
  },
};
