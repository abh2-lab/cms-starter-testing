import type {
  BlockContentDetail,
  BlockContentSummary,
  BlockField,
  BlockLoadContext,
  PostBox,
} from '@cms/blocks';

// A deterministic, DB-free BlockLoadContext for the render-smoke check. It gives
// every loader enough shape to run (a sample post box, archive context, a few
// archive rows) without a server or database — so verify can exercise load() /
// resolveBoxes() and catch loaders that throw, entirely in-process.

const summary: BlockContentSummary = {
  id: 'verify-1',
  title: 'Verify Sample Story',
  slug: 'verify-sample',
  type: 'article',
  publishedAt: '2024-01-01T00:00:00.000Z',
  authors: [{ displayName: 'Verify Author', slug: 'verify-author' }],
  heroImageUrl: null,
  excerpt: 'A deterministic sample row used by the render-smoke check.',
  featured: false,
  taxonomy: [{ termSlug: 'news', termName: 'News', taxonomySlug: 'categories' }],
};

const detail: BlockContentDetail = {
  ...summary,
  customFields: { body: null },
  seo: null,
};

const box: PostBox = { kind: 'detail', content: summary, detail, index: 0, total: 1 };

export function makeStubContext(): BlockLoadContext {
  return {
    tenantId: 'verify',
    locale: 'en',
    fetchContent: () => Promise.resolve(detail),
    fetchArchive: ({ count }) =>
      Promise.resolve(
        Array.from({ length: Math.max(0, Math.min(count, 3)) }, (_v, i) => ({
          ...summary,
          id: `verify-${i + 1}`,
          slug: `verify-sample-${i + 1}`,
        })),
      ),
    box,
    archive: {
      title: 'Verify Term',
      termSlug: 'news',
      taxonomySlug: 'categories',
      description: null,
      taxonomyDescription: null,
      total: 3,
    },
    contentTypeField: () => Promise.resolve({ type: 'short_text', label: 'Field' }),
    resolveMediaUrl: () => Promise.resolve(null),
  };
}

// The meta defaults a loader is most likely to be called with, so the smoke
// exercises a realistic path (e.g. a hero's content_type/slug defaults).
export function defaultsFrom(fields: BlockField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.default !== undefined) out[field.key] = field.default;
  }
  return out;
}
