import type { Block } from '../types.js';

// AuthorGrid — the whole /authors page as one editable block (theme engine v2
// Phase 4): a dark hero (kicker + title), a search + beat filter bar, and the
// card grid. The component fetches /api/public/archive/<type>?include=customFields
// itself (the loader can't carry custom fields), so server-side load() is a
// no-op; the editable copy lives in fields and the beat list in `beats`.

interface AuthorGridFields {
  hero_kicker?: string;
  hero_title?: string;
  search_placeholder?: string;
  // Comma-separated beat filters; "All" is always prepended by the component.
  beats?: string;
}
interface AuthorGridOptions {
  content_type?: string;
  count?: number;
}
const HARD_MAX_COUNT = 96;

export const authorGrid: Block<AuthorGridFields, AuthorGridOptions> = {
  meta: {
    key: 'author-grid',
    label: 'Author Grid',
    category: 'lists',
    description:
      'The authors page: dark hero, search + beat filter bar, and a grid of author cards.',
    icon: 'users',
    fields: [
      {
        key: 'hero_kicker',
        label: 'Hero kicker',
        type: 'short_text',
        default: 'Our Team',
      },
      {
        key: 'hero_title',
        label: 'Hero title',
        type: 'short_text',
        default: 'The People Behind Decode',
      },
      {
        key: 'search_placeholder',
        label: 'Search placeholder',
        type: 'short_text',
        default: 'Search authors by name or role...',
      },
      {
        key: 'beats',
        label: 'Beat filters',
        type: 'short_text',
        default: 'Investigation, Digital State, Young Minds, Labour',
        helpText: 'Comma-separated. "All" is always shown first.',
      },
    ],
    options: [
      {
        key: 'content_type',
        label: 'Author content type',
        type: 'content_type_slug',
        default: 'author',
        helpText: 'The content type whose rows are the authors.',
      },
      {
        key: 'count',
        label: 'Max authors',
        type: 'number',
        default: 24,
        min: 1,
        max: HARD_MAX_COUNT,
      },
    ],
  },
  load: () => Promise.resolve(null),
};
