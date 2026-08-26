import { Node, mergeAttributes, type CommandProps } from '@tiptap/core';
import type { GalleryAttrs } from '../types/index.js';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    gallery: {
      /** Insert a gallery block referencing an array of media UUIDs. */
      insertGallery: (
        attrs: Pick<GalleryAttrs, 'mediaIds'> & Partial<GalleryAttrs>,
      ) => ReturnType;
    };
  }
}

function parseMediaIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : [];
  } catch {
    return [];
  }
}

/**
 * Atomic block node holding an ordered set of media UUIDs plus a layout hint.
 * The id array is serialised as JSON in `data-media-ids` so it round-trips
 * through HTML parse/serialize as well as getJSON()/setContent().
 */
export const Gallery = Node.create({
  name: 'gallery',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      mediaIds: {
        default: [] as string[],
        parseHTML: (element: HTMLElement) =>
          parseMediaIds(element.getAttribute('data-media-ids')),
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-media-ids': JSON.stringify(attributes['mediaIds'] ?? []),
        }),
      },
      layout: {
        default: 'grid',
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-layout') ?? 'grid',
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-layout':
            typeof attributes['layout'] === 'string'
              ? attributes['layout']
              : 'grid',
        }),
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
      // Read-path only: the public content route resolves `mediaIds` → an
      // ordered list of { src, alt } and injects it here so generateHTML can
      // emit real <img>s. Never set by the admin and never persisted — emits no
      // attribute of its own; the node's renderHTML reads node.attrs.images.
      images: { default: null, renderHTML: () => ({}) },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-gallery]' }];
  },

  renderHTML({
    node,
    HTMLAttributes,
  }: {
    node: { attrs: Record<string, unknown> };
    HTMLAttributes: Record<string, unknown>;
  }) {
    const images = Array.isArray(node.attrs['images'])
      ? (node.attrs['images'] as unknown[])
      : null;
    // Unresolved: emit the bare data-attr div (admin overrides via NodeView).
    if (!images || images.length === 0) {
      return ['div', mergeAttributes(HTMLAttributes, { 'data-gallery': '' })];
    }
    const layout =
      typeof node.attrs['layout'] === 'string' ? node.attrs['layout'] : 'grid';
    const caption =
      typeof node.attrs['caption'] === 'string' ? node.attrs['caption'] : '';
    const figures = images.map((im) => {
      const src =
        im && typeof im === 'object' && typeof (im as { src?: unknown }).src === 'string'
          ? (im as { src: string }).src
          : '';
      const alt =
        im && typeof im === 'object' && typeof (im as { alt?: unknown }).alt === 'string'
          ? (im as { alt: string }).alt
          : '';
      return ['img', { src, alt, loading: 'lazy', decoding: 'async' }];
    });
    const children: unknown[] = [
      ['div', { class: 'gallery-grid' }, ...figures],
    ];
    if (caption) children.push(['figcaption', {}, caption]);
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-gallery': '',
        class: `gallery gallery--${layout}`,
      }),
      ...children,
    ];
  },

  addCommands() {
    return {
      insertGallery:
        (attrs: Pick<GalleryAttrs, 'mediaIds'> & Partial<GalleryAttrs>) =>
        ({ commands }: CommandProps) =>
          commands.insertContent({ type: 'gallery', attrs }),
    };
  },
});
