import type { Block } from '../types.js';

// site-nav — a standalone block: the sticky black site header (logo, CMS-menu
// navigation with dropdowns, Sign In / Subscribe / Search actions, mobile
// collapse). ONE block on purpose: the mobile-collapse and dropdown state are
// a single interactive organism, and splitting it across block boundaries
// would split that reactive state — a direct pixel/behavior-parity risk.
//
// The renderer self-fetches its data (the menu named by `menu_slug` plus the
// site settings logo) exactly as the hand-built SiteHeader did — so the part
// payload stays structure-only and menu edits show up without recomposing the
// part. The previously hardcoded action labels become fields; the action
// buttons get visibility toggles.

interface SiteNavFields {
  subscribe_label?: string;
  signin_label?: string;
}

interface SiteNavOptions {
  menu_slug?: string;
  show_subscribe?: boolean;
  show_search?: boolean;
  show_signin?: boolean;
}

export const siteNav: Block<SiteNavFields, SiteNavOptions> = {
  meta: {
    key: 'site-nav',
    label: 'Site Navigation',
    category: 'site',
    description:
      'The site header: logo, menu-driven navigation with dropdowns, and the Sign In / Subscribe / Search actions.',
    icon: 'list',
    fields: [
      {
        key: 'subscribe_label',
        label: 'Subscribe button label',
        type: 'short_text',
        default: 'Subscribe',
      },
      {
        key: 'signin_label',
        label: 'Sign-in button label',
        type: 'short_text',
        default: 'Sign In',
      },
    ],
    options: [
      {
        key: 'menu_slug',
        label: 'Menu',
        type: 'short_text',
        default: 'main-nav',
        helpText:
          'Slug of the CMS menu (admin → Menus) that drives the navigation. Falls back to the built-in set when the menu is absent.',
      },
      {
        key: 'show_subscribe',
        label: 'Show Subscribe button',
        type: 'boolean',
        default: true,
      },
      {
        key: 'show_search',
        label: 'Show search button',
        type: 'boolean',
        default: true,
      },
      {
        key: 'show_signin',
        label: 'Show Sign In button',
        type: 'boolean',
        default: true,
      },
    ],
  },
  // Renderer-fetched block: the menu + logo load client/SSR-side so the part
  // payload stays static structure.
  load() {
    return Promise.resolve(null);
  },
};
