import type { Block } from '../types.js';

// SearchResults — the result list + pagination for the /search page (theme
// engine v2 Phase 4). The component reads `q`/`page` from the URL and fetches
// /api/public/search itself (client + SSR via useAsyncData), so the loader has
// nothing to do server-side — it returns null and the block renders from the
// live query. `content_type` lets an install search a CPT other than article.

interface SearchResultsFields {
  empty_prefix?: string;
}
interface SearchResultsOptions {
  content_type?: string;
  page_size?: number;
}
const HARD_MAX_PAGE_SIZE = 50;

export const searchResults: Block<SearchResultsFields, SearchResultsOptions> = {
  meta: {
    key: 'search-results',
    label: 'Search Results',
    category: 'search',
    description:
      'Renders the matches for the current query, with pagination. Reads the query from the URL.',
    icon: 'list',
    fields: [
      {
        key: 'empty_prefix',
        label: 'Empty-prompt text',
        type: 'short_text',
        default: 'Type a query above to search.',
      },
    ],
    options: [
      {
        key: 'content_type',
        label: 'Content type',
        type: 'content_type_slug',
        default: 'article',
        helpText: 'Which content type to search. Defaults to articles.',
      },
      {
        key: 'page_size',
        label: 'Results per page',
        type: 'number',
        default: 12,
        min: 1,
        max: HARD_MAX_PAGE_SIZE,
      },
    ],
  },
  load: () => Promise.resolve(null),
};
