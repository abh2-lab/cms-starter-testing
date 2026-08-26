import type { Block } from '../types.js';

// NotFound — the editable body of the 404 page (theme engine v2 Phase 4: system
// pages become override-backed templates). Pure copy: a big code, a heading, a
// message and a "back home" button, all editable per-install. Standalone (no
// box / no content binding) so it renders the same on the real error page and
// in the Block Gallery preview. The 404 template (`template-404`) places this
// block; admins can add more blocks (newsletter, latest-news, …) around it.

interface NotFoundFields {
  code?: string;
  heading?: string;
  message?: string;
  button_label?: string;
  button_url?: string;
}

export const notFound: Block<NotFoundFields, Record<string, unknown>> = {
  meta: {
    key: 'not-found',
    label: 'Not Found (404)',
    category: 'system',
    description:
      'The 404 page body: status code, heading, message and a button back to safety.',
    icon: 'alert',
    fields: [
      { key: 'code', label: 'Status code', type: 'short_text', default: '404' },
      {
        key: 'heading',
        label: 'Heading',
        type: 'short_text',
        default: 'Page not found',
      },
      {
        key: 'message',
        label: 'Message',
        type: 'long_text',
        default:
          "The page you're looking for doesn't exist or may have been moved.",
      },
      {
        key: 'button_label',
        label: 'Button label',
        type: 'short_text',
        default: 'Back to home',
      },
      { key: 'button_url', label: 'Button link', type: 'url', default: '/' },
    ],
    options: [],
  },
  load: () => Promise.resolve(null),
};
