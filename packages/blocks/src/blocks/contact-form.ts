import type { Block } from '../types.js';

// ContactForm — the /contact page body ("Ping Us!"). The component POSTs to
// /api/public/submissions itself (a side-effect the loader must never do), so
// server-side load() is a no-op; the editable copy is in fields and the target
// content type in `content_type_slug`. The chosen content type must have
// submissionAccess: 'public' configured in admin.

interface ContactFormFields {
  heading?: string;
  lede?: string;
  button_label?: string;
  success_message?: string;
}
interface ContactFormOptions {
  content_type_slug?: string;
}

export const contactForm: Block<ContactFormFields, ContactFormOptions> = {
  meta: {
    key: 'contact-form',
    label: 'Contact Form',
    category: 'forms',
    description:
      'The PING "Ping Us!" contact form (first/last name, company email, phone, and two message fields) that saves a public submission for review.',
    icon: 'envelope',
    fields: [
      {
        key: 'heading',
        label: 'Heading',
        type: 'short_text',
        default: 'Ping Us!',
      },
      {
        key: 'lede',
        label: 'Intro text',
        type: 'long_text',
        default:
          'Simply submit the contact form and our sales team will get in touch within a business day. They can walk you through:',
      },
      {
        key: 'button_label',
        label: 'Submit button label',
        type: 'short_text',
        default: 'Submit',
      },
      {
        key: 'success_message',
        label: 'Success message',
        type: 'short_text',
        default:
          'Thanks — our sales team will get in touch within a business day.',
      },
    ],
    options: [
      {
        key: 'content_type_slug',
        label: 'Submission content type',
        type: 'content_type_slug',
        default: 'contact-submission',
        helpText:
          'Submissions are saved as drafts of this content type (it must allow public submissions).',
      },
    ],
  },
  load: () => Promise.resolve(null),
};
