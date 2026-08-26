import { onBeforeUnmount, watch } from 'vue';
import { useEditor } from '@tiptap/vue-3';
import Placeholder from '@tiptap/extension-placeholder';
// standardExtensions bundles these at runtime, but the compiled @cms/editor
// d.ts erases the value imports that carry their `declare module '@tiptap/core'`
// command augmentations (insertTable, setColor, setTextAlign). Import them here
// so those commands stay typed in the toolbar/slash menu.
import '@tiptap/extension-table';
import '@tiptap/extension-text-align';
import '@tiptap/extension-color';
import {
  standardExtensions,
  PullQuote,
  PullquoteUnderline,
  LeadParagraph,
} from '@cms/editor/extensions';
import type { Media } from '@/api/media';
import { InlineImage } from '@/components/editor/image/InlineImageNode';
import { Gallery } from '@/components/editor/gallery/GalleryNode';
import { Embed } from '@/components/editor/embed/EmbedNode';
import { RawHTML } from '@/components/editor/rawhtml/RawHtmlNode';
import { SectionRule } from '@/components/editor/section/SectionRuleNode';
import { SlashCommand } from '@/components/editor/slash/SlashCommand';

export interface BodyStats {
  words: number;
  chars: number;
  readMin: number;
}

interface Options {
  /** Current body value (a Tiptap JSON doc) pulled from customFields. */
  getValue: () => unknown;
  /** Persist the body doc back into customFields. */
  onChange: (value: object) => void;
  onStats: (stats: BodyStats) => void;
  placeholder?: string;
  /**
   * Opens the shared media picker and resolves with the chosen media. Wired by
   * the page so the image/gallery slash commands can pick before inserting (an
   * empty image fails the body validator). Toolbar image/gallery buttons use
   * the same picker directly.
   */
  pickMedia?: (multiple: boolean) => Promise<Media[]>;
}

function computeStats(text: string): BodyStats {
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  return {
    words,
    chars: text.length,
    readMin: Math.max(1, Math.round(words / 200)),
  };
}

/**
 * Creates the main body Tiptap editor. The instance is lifted into the page so
 * the top toolbar and the in-flow content area can share it. The body doc lives
 * in customFields under the convention-resolved body field, so changes persist
 * through the unchanged content save path.
 *
 * The standard schema (StarterKit + alignment + colour + tables) comes straight
 * from @cms/editor's `standardExtensions` — the same list the public renderer
 * mounts — so the admin editor can never silently drift from what the site can
 * render. The custom CMS nodes are layered on top: the media/escape-hatch ones
 * as admin NodeView builds, the toggle ones (pull-quote, lead) as the bare
 * shared nodes.
 */
export function useBodyEditor(options: Options) {
  const editor = useEditor({
    content: (options.getValue() as object | string | null | undefined) ?? '',
    extensions: [
      ...standardExtensions,
      Placeholder.configure({
        placeholder: options.placeholder ?? 'Write your story… press / for blocks',
      }),
      PullQuote,
      PullquoteUnderline,
      LeadParagraph,
      InlineImage,
      Gallery,
      Embed,
      RawHTML,
      SectionRule,
      SlashCommand.configure({ pickMedia: options.pickMedia ?? null }),
    ],
    onCreate({ editor }) {
      // If the body value already loaded before the editor mounted, pull it in
      // (the change watch below only fires on subsequent changes).
      const v = options.getValue();
      if (v && JSON.stringify(editor.getJSON()) !== JSON.stringify(v)) {
        editor.commands.setContent(v, { emitUpdate: false });
      }
      options.onStats(computeStats(editor.getText()));
    },
    onUpdate({ editor }) {
      options.onChange(editor.getJSON());
      options.onStats(computeStats(editor.getText()));
    },
  });

  // Sync external value changes (initial load, server echo after save). Skip
  // while focused so the autosave round-trip never yanks the caret.
  watch(options.getValue, (value) => {
    const ed = editor.value;
    if (!ed || ed.isFocused) return;
    if (JSON.stringify(ed.getJSON()) !== JSON.stringify(value)) {
      ed.commands.setContent(
        (value as object | string | null | undefined) ?? '',
        { emitUpdate: false },
      );
      options.onStats(computeStats(ed.getText()));
    }
  });

  onBeforeUnmount(() => {
    editor.value?.destroy();
  });

  return { editor };
}
