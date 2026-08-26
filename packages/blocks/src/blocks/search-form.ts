import type { Block } from '../types.js';

// SearchForm — the heading + search input that sits atop the /search page
// (theme engine v2 Phase 4). Standalone, no data binding: the input is wired to
// the URL's `q` query in the Vue component, so the form and the results block
// stay in sync through the route (single source of truth). Editable copy lets an
// install retitle "Search" or change the placeholder/button text.

interface SearchFormFields {
  heading?: string;
  placeholder?: string;
  button_label?: string;
}

export const searchForm: Block<SearchFormFields, Record<string, unknown>> = {
  meta: {
    key: 'search-form',
    label: 'Search Form',
    category: 'search',
    description: 'Search heading + query input that drives the results below.',
    icon: 'search',
    fields: [
      { key: 'heading', label: 'Heading', type: 'short_text', default: 'Search' },
      {
        key: 'placeholder',
        label: 'Input placeholder',
        type: 'short_text',
        default: 'Search…',
      },
      {
        key: 'button_label',
        label: 'Button label',
        type: 'short_text',
        default: 'Search',
      },
    ],
    options: [],
  },
  load: () => Promise.resolve(null),
};
