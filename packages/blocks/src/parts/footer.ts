import type { TemplateMeta } from '../types.js';

// The `footer` PART — a named, reusable block-list with the reserved
// 'footer' role, mounted by the layout (see parts/header.ts). One band: the
// columns grid (brand + Contact Us + Quick Links + brand mark). Each visual
// band is one block so the structure editor can reorder/remove them, while
// the bands' insides stay coarse for pixel parity.
//
// The `footer-bottom` band (© line + support email) was removed from the
// footer on request. The block itself is still registered, so it can be put
// back by re-adding a { block_key: 'footer-bottom' } entry below.
export const footerPart: TemplateMeta = {
  key: 'footer',
  role: 'footer',
  name: 'Footer',
  description:
    'The site-wide footer: brand column, Contact Us, and Quick Links.',
  blocks: [
    {
      block_key: 'footer-columns',
      default_fields: {
        about_text:
          'Ping Network India is a YouTube Multi Channel Network (MCN) which is dedicated to helping brands, creators and content owners maximize their reach and revenue on YouTube.',
        facebook_url: '#',
        twitter_url: '#',
        linkedin_url: '#',
        instagram_url: '#',
        pinterest_url: '#',
        youtube_url: '#',
        contact_heading: 'Contact Us',
        contact_company: 'Ping Digital Broadcast Pvt. Ltd.',
        contact_address:
          '319, Adhyaru Industrial Estate, Inside Sun-Mill Compound, Opposite Phoenix Mills, Lower Parel, Mumbai, Maharashtra 400013.',
        contact_email: 'partner.support@pingnetwork.in',
        cv_email: 'jobs@pingnetwork.in',
      },
      default_options: { menu_slug: 'footer-nav' },
    },
  ],
};
