import type { Block } from '../types.js';

// Social Share — a "Share:" label plus Facebook / X / LinkedIn buttons for the
// current post. A FIELD block: the loader only projects the post title (used as
// the share text); the .vue builds the share links from the live page URL, so
// no server-side URL guessing is needed.

interface SocialShareFields {
  label?: string;
}
interface SocialShareData extends Record<string, unknown> {
  title: string | null;
}

export const socialShare: Block<SocialShareFields, Record<string, unknown>> = {
  meta: {
    key: 'social-share',
    label: 'Social Share',
    category: 'fields',
    description:
      'Share buttons (Facebook, X, LinkedIn) for the current post, with a label.',
    icon: 'share-2',
    kind: 'field',
    fields: [
      {
        key: 'label',
        label: 'Label',
        type: 'short_text',
        default: 'Share:',
      },
    ],
    options: [],
  },
  load(ctx): Promise<SocialShareData> {
    return Promise.resolve({ title: ctx.box?.content.title ?? null });
  },
};
