import { Node, mergeAttributes, type CommandProps } from '@tiptap/core';
import type { InlineImageAttrs } from '../types/index.js';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    inlineImage: {
      /** Insert an image block referencing a media UUID (never a URL/src). */
      insertInlineImage: (
        attrs: Pick<InlineImageAttrs, 'mediaId'> & Partial<InlineImageAttrs>,
      ) => ReturnType;
    };
  }
}

/**
 * Replacement for Tiptap's default Image node. Stores a `mediaId` (UUID into
 * the media table) only — the API resolves it to a presigned URL at response
 * time. Caption/credit/width/float ride along as attributes.
 */
export const InlineImage = Node.create({
  name: 'inlineImage',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      mediaId: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-media-id'),
        renderHTML: (attributes: Record<string, unknown>) => {
          const mediaId =
            typeof attributes['mediaId'] === 'string'
              ? attributes['mediaId']
              : '';
          return mediaId ? { 'data-media-id': mediaId } : {};
        },
      },
      caption: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-caption'),
        renderHTML: (attributes: Record<string, unknown>) => {
          const caption =
            typeof attributes['caption'] === 'string'
              ? attributes['caption']
              : '';
          return caption ? { 'data-caption': caption } : {};
        },
      },
      credit: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-credit'),
        renderHTML: (attributes: Record<string, unknown>) => {
          const credit =
            typeof attributes['credit'] === 'string'
              ? attributes['credit']
              : '';
          return credit ? { 'data-credit': credit } : {};
        },
      },
      width: {
        default: 'full',
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-width') ?? 'full',
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-width':
            typeof attributes['width'] === 'string'
              ? attributes['width']
              : 'full',
        }),
      },
      float: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-float'),
        renderHTML: (attributes: Record<string, unknown>) => {
          const float =
            typeof attributes['float'] === 'string' ? attributes['float'] : '';
          return float ? { 'data-float': float } : {};
        },
      },
      // Read-path only: the public content route resolves `mediaId` → a display
      // URL + alt text and injects them here so generateHTML can emit a real
      // <img>. Never set by the admin (the editor stores a mediaId, never a
      // URL) and never persisted — these emit no attribute of their own; the
      // node's renderHTML reads node.attrs.src directly.
      src: { default: null, renderHTML: () => ({}) },
      alt: { default: null, renderHTML: () => ({}) },
    };
  },

  parseHTML() {
    return [{ tag: 'figure[data-inline-image]' }];
  },

  renderHTML({
    node,
    HTMLAttributes,
  }: {
    node: { attrs: Record<string, unknown> };
    HTMLAttributes: Record<string, unknown>;
  }) {
    const src = typeof node.attrs['src'] === 'string' ? node.attrs['src'] : '';
    // Unresolved (admin editor, or a renderer that didn't run media resolution):
    // emit the bare data-attr figure so the document still round-trips. The
    // admin overrides this with a Vue NodeView anyway.
    if (!src) {
      return [
        'figure',
        mergeAttributes(HTMLAttributes, { 'data-inline-image': '' }),
      ];
    }
    const caption =
      typeof node.attrs['caption'] === 'string' ? node.attrs['caption'] : '';
    const credit =
      typeof node.attrs['credit'] === 'string' ? node.attrs['credit'] : '';
    const alt =
      typeof node.attrs['alt'] === 'string' && node.attrs['alt']
        ? node.attrs['alt']
        : caption;
    const width =
      typeof node.attrs['width'] === 'string' ? node.attrs['width'] : 'full';
    const float =
      typeof node.attrs['float'] === 'string' ? node.attrs['float'] : '';
    const className = [
      'inline-image',
      `inline-image--${width}`,
      float ? `inline-image--float-${float}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    const children: unknown[] = [
      ['img', { src, alt, loading: 'lazy', decoding: 'async' }],
    ];
    const captionLine = [caption, credit].filter(Boolean).join(' · ');
    if (captionLine) children.push(['figcaption', {}, captionLine]);
    return [
      'figure',
      mergeAttributes(HTMLAttributes, {
        'data-inline-image': '',
        class: className,
      }),
      ...children,
    ];
  },

  addCommands() {
    return {
      insertInlineImage:
        (attrs: Pick<InlineImageAttrs, 'mediaId'> & Partial<InlineImageAttrs>) =>
        ({ commands }: CommandProps) =>
          commands.insertContent({ type: 'inlineImage', attrs }),
    };
  },
});
