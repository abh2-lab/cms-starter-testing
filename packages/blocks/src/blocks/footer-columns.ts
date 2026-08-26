import type { Block } from '../types.js';

// footer-columns — a standalone block: the footer's main grid. Brand column
// (logo + about blurb + social icons), a Contact Us column (company + address
// + emails), the CMS-menu Quick Links column, and the large "P!" brand mark.
// ONE block for the whole grid: the columns are siblings inside one CSS grid.
//
// The renderer self-fetches the menu named by `menu_slug` (plus the site
// settings logo). All copy (about blurb, social URLs, contact details) is
// editable via fields.

interface FooterColumnsFields {
  about_text?: string;
  facebook_url?: string;
  twitter_url?: string;
  linkedin_url?: string;
  instagram_url?: string;
  youtube_url?: string;
  contact_heading?: string;
  contact_company?: string;
  contact_address?: string;
  contact_email?: string;
  cv_email?: string;
}

interface FooterColumnsOptions {
  menu_slug?: string;
}

const PING_ABOUT =
  'Ping Network India is a YouTube Multi Channel Network (MCN) which is dedicated to helping brands, creators and content owners maximize their reach and revenue on YouTube.';

export const footerColumns: Block<FooterColumnsFields, FooterColumnsOptions> = {
  meta: {
    key: 'footer-columns',
    label: 'Footer Columns',
    category: 'site',
    description:
      'The footer grid: brand column (logo, blurb, social icons), a Contact Us column, the menu-driven Quick Links column, and the brand mark.',
    icon: 'grid',
    fields: [
      {
        key: 'about_text',
        label: 'About text',
        type: 'long_text',
        default: PING_ABOUT,
      },
      { key: 'facebook_url', label: 'Facebook URL', type: 'url', default: '#' },
      { key: 'twitter_url', label: 'Twitter / X URL', type: 'url', default: '#' },
      { key: 'linkedin_url', label: 'LinkedIn URL', type: 'url', default: '#' },
      {
        key: 'instagram_url',
        label: 'Instagram URL',
        type: 'url',
        default: '#',
      },
      {
        key: 'pinterest_url',
        label: 'Pinterest URL',
        type: 'url',
        default: '#',
      },
      { key: 'youtube_url', label: 'YouTube URL', type: 'url', default: '#' },
      {
        key: 'contact_heading',
        label: 'Contact heading',
        type: 'short_text',
        default: 'Contact Us',
      },
      {
        key: 'contact_company',
        label: 'Company name',
        type: 'short_text',
        default: 'Ping Digital Broadcast Pvt. Ltd.',
      },
      {
        key: 'contact_address',
        label: 'Address',
        type: 'long_text',
        default:
          '319, Adhyaru Industrial Estate, Inside Sun-Mill Compound, Opposite Phoenix Mills, Lower Parel, Mumbai, Maharashtra 400013.',
      },
      {
        key: 'contact_email',
        label: 'Contact email',
        type: 'short_text',
        default: 'partner.support@pingnetwork.in',
      },
      {
        key: 'cv_email',
        label: 'Careers email',
        type: 'short_text',
        default: 'jobs@pingnetwork.in',
      },
    ],
    options: [
      {
        key: 'menu_slug',
        label: 'Menu',
        type: 'short_text',
        default: 'footer-nav',
        helpText:
          'Slug of the CMS menu whose top-level item(s) become column headings and children become links. Falls back to the built-in Quick Links when absent.',
      },
    ],
  },
  load() {
    return Promise.resolve(null);
  },
};
