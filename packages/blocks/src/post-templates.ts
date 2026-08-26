// Post (single) template VARIANTS — the WordPress-style layout keys a content
// row renders through. This file is the registry of variant KEYS + labels (for
// the admin's per-post template picker and content-type default validation) and
// the DEFAULT key. It is NOT a competing block-tree location: the single
// block-TREE these compose lives once in ./templates/single.ts, and the
// template hierarchy that picks the key lives once in ./templates/
// resolve-template.ts (resolveTemplate, role 'single'). The theme maps the key
// to a CSS layout variant — see usePostTemplateRegistry — and must handle every
// key listed here.
//
// Resolution order (implemented by resolveTemplate, role 'single'):
//   content.template_key                          (per-post override)
//   ?? content_types.settings.templates.default   (per-type default)
//   ?? DEFAULT_POST_TEMPLATE_KEY                   (safe fallback)

export interface PostTemplateMeta {
  /** Stable lowercase-dashed key. Stored on content.template_key and in a
   *  content type's settings.templates.default; the theme keys its renderer
   *  off the same string. */
  key: string;
  label: string;
  description?: string;
}

export const postTemplateRegistry: ReadonlyArray<PostTemplateMeta> = [
  {
    key: 'article-standard',
    label: 'Standard article',
    description: 'The default article layout.',
  },
  {
    key: 'article-feature',
    label: 'Feature / long read',
    description: 'Serif, long-form layout for features and investigations.',
  },
];

// Safe fallback when neither a per-post override nor a per-type default is set
// (or the set key is unknown). MUST always exist in the registry above.
export const DEFAULT_POST_TEMPLATE_KEY = 'article-standard';

export function listPostTemplates(): PostTemplateMeta[] {
  return [...postTemplateRegistry];
}

export function getPostTemplate(key: string): PostTemplateMeta | undefined {
  return postTemplateRegistry.find((t) => t.key === key);
}
