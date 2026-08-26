import type { Block } from '../types.js';

// editor-credit — a FIELD block: the "Edited by …" line under the tags.
// Reads customFields.editor off the current (detail) box; renders nothing
// when the post has no editor set — same gate as the hand-built ArticleView.

interface EditorCreditFields {
  prefix?: string;
}

export const editorCredit: Block<EditorCreditFields, Record<string, unknown>> =
  {
    meta: {
      key: 'editor-credit',
      label: 'Editor Credit',
      category: 'article',
      description:
        "The post's 'Edited by' credit line. Must sit inside a box.",
      icon: 'user',
      kind: 'field',
      fields: [
        {
          key: 'prefix',
          label: 'Prefix',
          type: 'short_text',
          default: 'Edited by',
        },
      ],
      options: [],
    },
    load(ctx) {
      const box = ctx.box;
      const cf = box?.kind === 'detail' ? box.detail.customFields : {};
      const v = cf['editor'];
      return Promise.resolve({
        editor: typeof v === 'string' && v.length > 0 ? v : null,
      });
    },
  };
