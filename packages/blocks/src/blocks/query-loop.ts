import type { Block, PostBox } from '../types.js';

// query-loop — a BOX block. Resolves N posts from a content type (optionally
// filtered by a category) and sets each as the current box for ITS child blocks
// (the per-item template). The composer expands the children once per resolved
// box and flattens the result, so the renderer just walks children. This is the
// composable cousin of the self-sufficient `latest-news` block: latest-news
// renders its own cards, query-loop lets field/container blocks compose the card.
//
// Boxes are lean SUMMARY boxes (the archive query is lean); a child that needs
// the full body (post-content) hydrates on demand. The composer additionally
// caps boxes-per-loop, so this count ceiling is a first line of defence.

interface QueryLoopOptions {
  content_type?: string;
  category?: string;
  tags?: string;
  count?: number;
  grid?: string;
}

const HARD_MAX_COUNT = 24;

export const queryLoop: Block<Record<string, unknown>, QueryLoopOptions> = {
  meta: {
    key: 'query-loop',
    label: 'Query Loop',
    category: 'box',
    description:
      'Iterates posts from a content type and renders its child blocks once per post.',
    icon: 'repeat',
    kind: 'box',
    fields: [],
    options: [
      {
        key: 'content_type',
        label: 'Content type',
        type: 'content_type_slug',
        required: true,
        default: 'article',
      },
      {
        key: 'category',
        label: 'Category filter',
        type: 'category_slug',
        taxonomySlug: 'categories',
        helpText: 'Optional — leave blank to pull from every category.',
      },
      {
        key: 'tags',
        label: 'Tags filter',
        type: 'category_slug',
        taxonomySlug: 'tags',
        helpText:
          'Optional — combined with the category filter (AND). Leave blank to ignore tags.',
      },
      {
        key: 'count',
        label: 'Number of posts',
        type: 'number',
        required: true,
        default: 6,
        min: 1,
        max: HARD_MAX_COUNT,
      },
      {
        key: 'grid',
        label: 'Grid layout',
        type: 'select',
        options: ['auto', 'none'],
        default: 'auto',
        helpText:
          "'auto' renders the loop's own responsive grid; 'none' makes the wrapper transparent (display: contents) so the surrounding layout owns the grid — used by archive views whose grid (and load-more appends) live in the page shell.",
      },
    ],
  },
  // Box blocks expose no data of their own; the boxes drive the children.
  load() {
    return Promise.resolve(null);
  },
  async resolveBoxes(ctx, { options }) {
    const typeSlug = options.content_type ?? 'article';
    const requested = Number.isFinite(options.count) ? Number(options.count) : 6;
    const count = Math.max(1, Math.min(HARD_MAX_COUNT, requested));
    // Category: an explicit option wins; otherwise inherit the ambient archive
    // term (set on archive templates via ctx.archive). This keeps the archive
    // template declarative — it carries no hardcoded category, so ONE archive
    // template serves every category/tag (the "by-category" condition lives in
    // template SELECTION / context, never in the template).
    //
    // When the term comes from the ambient archive, scope the match to that
    // archive's taxonomy — a tag archive must not surface a same-slug
    // category's rows. An explicit option keeps the historical any-taxonomy
    // match.
    const explicitCategory =
      typeof options.category === 'string' && options.category.length > 0
        ? options.category
        : null;
    const category = explicitCategory ?? ctx.archive?.termSlug;
    const taxonomy = explicitCategory ? undefined : ctx.archive?.taxonomySlug;
    // Tags are an independent, always-explicit filter scoped to the 'tags'
    // taxonomy. Combined with the category filter using AND; blank = ignored.
    const tag =
      typeof options.tags === 'string' && options.tags.length > 0
        ? options.tags
        : undefined;
    const items = await ctx.fetchArchive({
      typeSlug,
      ...(category ? { category } : {}),
      ...(taxonomy ? { taxonomy } : {}),
      ...(tag ? { tag } : {}),
      count,
    });
    return items.map(
      (content, index): PostBox => ({
        kind: 'summary',
        content,
        index,
        total: items.length,
      }),
    );
  },
};
