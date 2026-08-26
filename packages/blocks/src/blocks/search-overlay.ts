import type { Block } from '../types.js';

// Search Overlay — the Decode "What are you looking for?" modal, rendered as a
// standalone block placed once in the header part so it is globally available.
// The header search button opens it (see the theme's useSearchOverlay); the
// overlay submits to the existing /search results page. Server-side this block
// only resolves the Spotlight story (one hand-picked article, loaded the same
// way as featured-article) and forwards the editable Popular-Categories list to
// the render half.

interface SearchOverlayFields {
  heading?: string;
  placeholder?: string;
  button_label?: string;
  categories_label?: string;
  spotlight_label?: string;
  categories?: Array<{ label: string; value: string }>;
}
interface SearchOverlayOptions {
  spotlight_content_type?: string;
  spotlight_slug?: string;
}

export const searchOverlay: Block<SearchOverlayFields, SearchOverlayOptions> = {
  meta: {
    key: 'search-overlay',
    label: 'Search Overlay',
    category: 'search',
    description: 'Full-screen search modal: heading, query box, popular-category pills, and a spotlight article. Opened by the header search button; submits to /search.',
    icon: 'search',
    fields: [
      {
        key: 'heading',
        label: 'Heading',
        type: 'short_text',
        default: 'What are you looking for?',
      },
      {
        key: 'placeholder',
        label: 'Input placeholder',
        type: 'short_text',
        default: 'Search stories, topics, authors...',
      },
      {
        key: 'button_label',
        label: 'Search button label',
        type: 'short_text',
        default: 'Search',
      },
      {
        key: 'categories_label',
        label: 'Categories section label',
        type: 'short_text',
        default: 'Popular Categories',
      },
      {
        key: 'spotlight_label',
        label: 'Spotlight section label',
        type: 'short_text',
        default: 'Spotlight',
      },
      {
        key: 'categories',
        label: 'Popular categories',
        type: 'kv_list',
        helpText: 'Each row: Label holds emoji + name (e.g. Young Minds); Value holds the category slug (e.g. young-minds) or a full /path.',
      },
    ],
    options: [
      {
        key: 'spotlight_content_type',
        label: 'Spotlight content type',
        type: 'content_type_slug',
        default: 'article',
        helpText: 'Content type to source the spotlight story from.',
      },
      {
        key: 'spotlight_slug',
        label: 'Spotlight story slug',
        type: 'content_slug',
        helpText: 'The featured story shown in the Spotlight row. Leave blank to hide the spotlight.',
      },
    ],
  },
  async load(ctx, { fields, options }) {
    // Drop malformed/empty rows so the renderer never sees a half-filled chip
    // (mirrors the impact-stats guard for the kv_list field type).
    const categories = Array.isArray(fields.categories)
      ? fields.categories.filter(
          (c): c is { label: string; value: string } =>
            typeof c === 'object' &&
            c !== null &&
            typeof (c as { label?: unknown }).label === 'string' &&
            (c as { label: string }).label.length > 0 &&
            typeof (c as { value?: unknown }).value === 'string' &&
            (c as { value: string }).value.length > 0,
        )
      : [];

    const typeSlug = options.spotlight_content_type ?? 'article';
    const slug = options.spotlight_slug ?? '';
    // No slug → hide the spotlight section. This is also the render-smoke path
    // (smoke calls load() with no options), so it must not fetch or throw.
    if (!slug) return { spotlight: null, categories };

    const spotlight = await ctx.fetchContent(typeSlug, slug);
    return { spotlight, categories };
  },
};
