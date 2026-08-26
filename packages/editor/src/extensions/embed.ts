import { Node, mergeAttributes, type CommandProps } from '@tiptap/core';
import type { EmbedAttrs, EmbedMode, EmbedProvider } from '../types/index.js';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    embed: {
      /** Insert an embed block (defaults to an empty Link-mode embed). */
      insertEmbed: (attrs?: Partial<EmbedAttrs>) => ReturnType;
    };
  }
}

/**
 * Best-effort provider detection from a source URL. Retained as a shared
 * utility; the public theme does its own (richer) provider matching.
 */
export function detectProvider(url: string): EmbedProvider {
  const u = url.toLowerCase();
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('twitter.com') || u.includes('x.com')) return 'twitter';
  if (u.includes('instagram.com')) return 'instagram';
  return 'generic';
}

const EMBED_MODES: readonly EmbedMode[] = ['link', 'iframe', 'card'];

function isEmbedMode(v: unknown): v is EmbedMode {
  return typeof v === 'string' && (EMBED_MODES as readonly string[]).includes(v);
}

/**
 * Atomic block node holding an external embed reference. Stores the
 * journalist-chosen `type` ('link' | 'iframe' | 'card'), the `value` (a URL, or
 * raw embed code for iframe mode) and an optional caption. The public theme
 * turns that into the actual embed (iframe / widget / card).
 *
 * `url` is a legacy attribute: pre-{type,value} docs stored their URL there. It
 * stays DECLARED (not removed) because ProseMirror drops any JSON attr not in
 * the schema on load — so without it an old doc's URL would vanish before the
 * renderer/editor could fall back to it. renderHTML re-emits it as `data-url`;
 * both the public renderer and the editor read `value` with a `url` fallback.
 * New embeds never write it (it stays null and is cleared on first edit).
 */
export const Embed = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      type: {
        default: 'link',
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-type') ?? 'link',
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-type': isEmbedMode(attributes['type'])
            ? attributes['type']
            : 'link',
        }),
      },
      value: {
        default: '',
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-value') ?? '',
        renderHTML: (attributes: Record<string, unknown>) => {
          const value =
            typeof attributes['value'] === 'string' ? attributes['value'] : '';
          return value ? { 'data-value': value } : {};
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
      // Legacy read-through (see node doc). Declared so an old doc's URL survives
      // JSON load; emitted as data-url so renderer/editor can fall back to it.
      url: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-url'),
        renderHTML: (attributes: Record<string, unknown>) => {
          const url =
            typeof attributes['url'] === 'string' ? attributes['url'] : '';
          return url ? { 'data-url': url } : {};
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-embed]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-embed': '' })];
  },

  addCommands() {
    return {
      insertEmbed:
        (attrs: Partial<EmbedAttrs> = {}) =>
        ({ commands }: CommandProps) =>
          commands.insertContent({
            type: 'embed',
            attrs: { type: 'link', value: '', caption: null, ...attrs },
          }),
    };
  },
});
