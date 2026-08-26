import type { Block } from '../types.js';

// LatestNews — paginated archive listing pulled from a content type, optionally
// filtered by a category (taxonomy term slug). Mirrors the public /archive
// endpoint shape. The "count" option caps fan-out so a published-but-misconfigured
// page can't request 10k rows; the composer also enforces a hard ceiling.

interface LatestNewsFields {
  title?: string;
  eyebrow?: string;
}
interface LatestNewsOptions {
  content_type?: string;
  category?: string;
  count?: number;
}
const HARD_MAX_COUNT = 24;

export const latestNews: Block<LatestNewsFields, LatestNewsOptions> = {
  meta: {
    key: 'latest-news',
    label: 'Latest News',
    category: 'lists',
    description: 'A grid of the most recent stories from a content type.',
    icon: 'list',
    fields: [
      { key: 'eyebrow', label: 'Eyebrow', type: 'short_text' },
      {
        key: 'title',
        label: 'Section title',
        type: 'short_text',
        default: 'Latest news',
      },
    ],
    options: [
      {
        key: 'content_type',
        label: 'Content type',
        type: 'content_type_slug',
        required: true,
        default: 'article',
        helpText: 'Pick the content type whose latest items should appear.',
      },
      {
        key: 'category',
        label: 'Category filter',
        type: 'category_slug',
        helpText: 'Optional — leave blank to pull from every category.',
      },
      {
        key: 'count',
        label: 'Number of stories',
        type: 'number',
        required: true,
        default: 6,
        min: 1,
        max: HARD_MAX_COUNT,
      },
    ],
  },
  async load(ctx, { options }) {
    const typeSlug = options.content_type ?? 'article';
    const requested = Number.isFinite(options.count) ? Number(options.count) : 6;
    const count = Math.max(1, Math.min(HARD_MAX_COUNT, requested));
    const items = await ctx.fetchArchive({
      typeSlug,
      ...(options.category ? { category: options.category } : {}),
      count,
    });
    return { items };
  },
};
