import type { Block } from '../types.js';

// Hero — a single featured story shown in the masthead position. Resolves
// the story by slug from a configured content type (article by default).
// When the slug is missing or the row isn't published, the loader returns
// `{ story: null }` and the renderer shows a "Configure a featured story"
// affordance for editors.

interface HeroFields {
  badge?: string;
}
interface HeroOptions {
  content_type?: string;
  slug?: string;
}
export const hero: Block<HeroFields, HeroOptions> = {
  meta: {
    key: 'hero',
    label: 'Hero',
    category: 'lead',
    description: 'A large featured story card pulled from any content type.',
    icon: 'sparkles',
    fields: [
      {
        key: 'badge',
        label: 'Badge label',
        type: 'short_text',
        helpText: 'Optional "Breaking" / "Editor\'s pick" pill above the title.',
      },
    ],
    options: [
      {
        key: 'content_type',
        label: 'Content type',
        type: 'content_type_slug',
        required: true,
        default: 'article',
        helpText: 'Pick the content type to source the story from.',
      },
      {
        key: 'slug',
        label: 'Story slug',
        type: 'content_slug',
        required: true,
        helpText: 'Slug of the specific story to feature.',
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
