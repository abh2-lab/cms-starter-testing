import type { TemplateMeta } from '../types.js';

// static-textpage — placeholder. Sub-phase 3 ports the five hard-coded static
// pages (about/contact/privacy/terms/editorial-policy) onto rows of type
// 'static', which use the html + css columns directly and do NOT go through
// the block composer. This template remains here for the "+ New Page" picker
// — when an admin chooses "static text page" we want to land them on a
// type=static row with starter copy rather than an empty dynamic page.
//
// The composer skips static pages entirely; an empty `blocks` array on a
// dynamic page that picks this template renders nothing — which is fine,
// because the admin UI maps "static-textpage" selection to creating a
// type=static page row in the first place.

export const staticTextpage: TemplateMeta = {
  key: 'static-textpage',
  role: 'page',
  name: 'Static text page',
  description:
    'A simple static page — paste HTML + CSS. Used by /about, /privacy, /terms, and similar.',
  blocks: [],
};
