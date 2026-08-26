// Page layouts — the SHELLS a static page can render in. A layout is the
// developer-coded wrapper around a page's body (container width, whether the
// page heading shows, whether the site header/footer render at all). The admin
// "Layout Template" selector lists these; the public renderer applies them.
//
// THEME-COUPLING NOTE: this manifest lives here alongside templateRegistry /
// partRegistry for consistency and so the API can serve it to the admin without
// importing the Nuxt theme. But page layouts are inherently theme-specific — the
// matching wrapper COMPONENTS live in the active theme
// (apps/web/themes/default/app/components/page-layouts/* + usePageLayouts). For
// the single bundled theme this is fine; if multi-theme support ever lands, the
// layout list should come from the ACTIVE theme rather than this shared package.
// Adding a layout = a manifest entry here + a matching component (and a `blank`
// Nuxt layout for any chromeless one) in the theme.

export interface PageLayoutMeta {
  /** Stable id stored in pages.layout_template and matched by the theme. */
  id: string;
  /** Human label for the admin selector. */
  label: string;
  /** One-line description shown under the selector. */
  description: string;
  /** When true, the page renders with NO site header/footer (a clean page).
   *  The theme switches to its `blank` Nuxt layout for these. */
  chromeless?: boolean;
}

export const pageLayoutRegistry: ReadonlyMap<string, PageLayoutMeta> = new Map<
  string,
  PageLayoutMeta
>([
  [
    'default',
    {
      id: 'default',
      label: 'Default',
      description:
        'Your content, full width, inside the site header and footer. No container or added heading — the page controls its own width and headings.',
    },
  ],
  [
    'contained',
    {
      id: 'contained',
      label: 'Contained',
      description:
        'A centered, readable content column inside the site header and footer. Best for long text pages (About / Policy).',
    },
  ],
  [
    'blank',
    {
      id: 'blank',
      label: 'Blank',
      description:
        'No site header or footer — a completely clean page. For bespoke landing pages and embeds.',
      chromeless: true,
    },
  ],
]);

/** All page layouts, in registry (insertion) order — for the admin selector. */
export function listPageLayouts(): PageLayoutMeta[] {
  return Array.from(pageLayoutRegistry.values());
}

/** Whether `id` is a known page layout. Used to validate the admin's choice. */
export function isPageLayout(id: string): boolean {
  return pageLayoutRegistry.has(id);
}

/** The layout meta for `id`, or the `default` layout when `id` is unknown
 *  (legacy keys like `raw` / `new-standard` fall back so old rows still render). */
export function resolvePageLayout(id: string | null | undefined): PageLayoutMeta {
  return (
    (id ? pageLayoutRegistry.get(id) : undefined) ??
    pageLayoutRegistry.get('default')!
  );
}
