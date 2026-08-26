import type { Block } from '../types.js';

// article-toc — a standalone block: the "In this story" quick-navigation
// card. Entirely CLIENT-side: the renderer scans the rendered body's h2/h3
// (handed down by the article shell via provide/inject), assigns anchor ids,
// and scroll-spies with an IntersectionObserver — so the loader has nothing
// to project. Standalone (not field) because it reads the DOM, not the box.

interface ArticleTocFields {
  label?: string;
  title?: string;
}

export const articleToc: Block<ArticleTocFields, Record<string, unknown>> = {
  meta: {
    key: 'article-toc',
    label: 'Table of Contents',
    category: 'article',
    description:
      "Quick-navigation card built client-side from the body's headings. Renders only when the body has 2+ headings.",
    icon: 'list',
    fields: [
      {
        key: 'label',
        label: 'Label',
        type: 'short_text',
        default: 'In this story',
      },
      {
        key: 'title',
        label: 'Title',
        type: 'short_text',
        default: 'Quick navigation',
      },
    ],
    options: [],
  },
  load() {
    return Promise.resolve(null);
  },
};
