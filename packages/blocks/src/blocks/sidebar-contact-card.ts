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
        default: 'portfolio-inquiry',
        helpText:
          'Messages are saved as entries of this type (it must allow public submissions).',
      },
    ],
  },
  load: () => Promise.resolve(null),
};
