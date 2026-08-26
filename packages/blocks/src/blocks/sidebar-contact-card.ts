import type { Block } from '../types.js';

// Sidebar Contact Card — a compact "Send Us A Message" card (Full Name, Phone,
// Email) for the portfolio detail sidebar. Like contact-form, the .vue POSTs to
// /api/public/submissions itself (a side effect the loader must never do), so
// server-side load() is a no-op. The editable copy is in fields and the target
// content type in `content_type_slug` (which must have submissionAccess:
// 'public').

interface SidebarContactCardFields {
  heading?: string;
  button_label?: string;
  success_message?: string;
}
interface SidebarContactCardOptions {
  content_type_slug?: string;
}

export const sidebarContactCard: Block<
  SidebarContactCardFields,
  SidebarContactCardOptions
> = {
  meta: {
    key: 'sidebar-contact-card',
    label: 'Sidebar Contact Card',
    category: 'forms',
    description:
      "A compact 'Send Us A Message' card (Full Name, Phone, Email) that saves a public submission.",
    icon: 'envelope',
    fields: [
      {
        key: 'heading',
        label: 'Heading',
        type: 'short_text',
        default: 'Send Us A Message',
      },
      {
        key: 'button_label',
        label: 'Button label',
        type: 'short_text',
        default: 'Send',
      },
      {
        key: 'success_message',
        label: 'Success message',
        type: 'short_text',
        default: "Thanks — we'll be in touch soon.",
      },
    ],
    options: [
      {
        key: 'content_type_slug',
        label: 'Submission content type',
        type: 'content_type_slug',
        // No default ON PURPOSE. This is a core block, and every publisher's
        // submission type is their own — it used to default to
        // 'portfolio-inquiry', a type that exists only in PING's fixtures,
        // which are excluded from the starter export. A fresh install
        // therefore shipped a block pointing at a content type it did not
        // have. The admin picks from the live content-type list instead.
        helpText:
          'Messages are saved as entries of this type (it must allow public submissions).',
      },
    ],
  },
  load: () => Promise.resolve(null),
};
