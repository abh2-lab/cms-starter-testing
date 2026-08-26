import type { Block } from '../types.js';

// footer-bottom — a standalone block: the footer's bottom bar (© year +
// copyright line on the left, contact email on the right). The year stays
// computed in the renderer; the copy becomes editable fields.

interface FooterBottomFields {
  copyright_text?: string;
  contact_email?: string;
}

export const footerBottom: Block<FooterBottomFields, Record<string, unknown>> =
  {
    meta: {
      key: 'footer-bottom',
      label: 'Footer Bottom Bar',
      category: 'site',
      description:
        'The footer bottom bar: © year + copyright line and a contact email.',
      icon: 'file',
      fields: [
        {
          key: 'copyright_text',
          label: 'Copyright text',
          type: 'short_text',
          default: 'Ping Digital Broadcast Pvt. Ltd. All rights reserved.',
          helpText: 'Rendered after the © and the current year.',
        },
        {
          key: 'contact_email',
          label: 'Contact email',
          type: 'short_text',
          default: 'partner.support@pingnetwork.in',
        },
      ],
      options: [],
    },
    load() {
      return Promise.resolve(null);
    },
  };
