import { Extension, type Editor, type Range } from '@tiptap/core';
import Suggestion, {
  type SuggestionProps,
  type SuggestionKeyDownProps,
} from '@tiptap/suggestion';
import { createApp, h, reactive, type App } from 'vue';
import type { Media } from '@/api/media';
import SlashMenu from './SlashMenu.vue';

export interface SlashItem {
  title: string;
  description: string;
  icon: string;
  command: (props: { editor: Editor; range: Range }) => void;
}

export interface SlashCommandOptions {
  /** Opens the shared media picker; injected by the page (see useMediaPicker). */
  pickMedia: ((multiple: boolean) => Promise<Media[]>) | null;
}

/**
 * Build the slash-menu items. Image/Gallery need the page's media picker
 * (passed in) so they can resolve a mediaId before inserting; everything else
 * runs a plain command. Items whose insert depends on the picker are omitted
 * when no picker is wired, so the menu never offers a dead action.
 */
function buildItems(
  pickMedia: SlashCommandOptions['pickMedia'],
): SlashItem[] {
  const items: SlashItem[] = [
    {
      title: 'Heading 2',
      description: 'Large section heading',
      icon: 'H2',
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleHeading({ level: 2 }).run(),
    },
    {
      title: 'Heading 3',
      description: 'Medium section heading',
      icon: 'H3',
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleHeading({ level: 3 }).run(),
    },
    {
      title: 'Bullet List',
      description: 'Simple bulleted list',
      icon: '•',
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleBulletList().run(),
    },
    {
      title: 'Numbered List',
      description: 'Ordered list',
      icon: '1.',
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
    },
    {
      title: 'Quote',
      description: 'Blockquote or citation',
      icon: '"',
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
    },
    {
      title: 'Pull Quote',
      description: 'Large decorative quote',
      icon: '❝',
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).togglePullQuote().run(),
    },
    {
      title: 'Pull Quote (Underline)',
      description: 'Bold statement with underline',
      icon: '❞',
      command: ({ editor, range }) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .togglePullquoteUnderline()
          .run(),
    },
    {
      title: 'Lead Paragraph',
      description: 'Bold article opener / standfirst',
      icon: '¶',
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleLeadParagraph().run(),
    },
    {
      title: 'Code Block',
      description: 'Formatted code block',
      icon: '</>',
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
    },
    {
      title: 'Divider',
      description: 'Horizontal rule',
      icon: '—',
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
    },
    {
      title: 'Section Rule',
      description: 'Labelled section divider',
      icon: '§',
      // Label and anchor are edited inline in the node view — no prompt.
      command: ({ editor, range }) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertSectionRule({ label: '' })
          .run(),
    },
    {
      title: 'Table',
      description: 'Insert a 3×3 table',
      icon: '⊞',
      command: ({ editor, range }) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
    {
      title: 'Embed',
      description: 'Link, embed code, or card',
      icon: '⊕',
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).insertEmbed().run(),
    },
    {
      title: 'Raw HTML',
      description: 'Sanitised HTML escape hatch',
      icon: '{}',
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).insertRawHtml({ html: '' }).run(),
    },
  ];

  if (pickMedia) {
    items.push(
      {
        title: 'Image',
        description: 'Pick an image from the media library',
        icon: '🖼',
        command: ({ editor, range }) => {
          // Drop the "/" text first, then pick — an image needs a real mediaId
          // before insert (an empty image fails the body validator). The
          // isDestroyed check covers navigating away while the picker is open.
          editor.chain().focus().deleteRange(range).run();
          void pickMedia(false).then((media) => {
            const m = media[0];
            if (m && !editor.isDestroyed)
              editor.chain().focus().insertInlineImage({ mediaId: m.id }).run();
          });
        },
      },
      {
        title: 'Gallery',
        description: 'Pick multiple images',
        icon: '▦',
        command: ({ editor, range }) => {
          editor.chain().focus().deleteRange(range).run();
          void pickMedia(true).then((media) => {
            if (media.length > 0 && !editor.isDestroyed) {
              editor
                .chain()
                .focus()
                .insertGallery({ mediaIds: media.map((m) => m.id) })
                .run();
            }
          });
        },
      },
    );
  }

  return items;
}

// Mounts the SlashMenu Vue component on document.body and drives it from a
// reactive state object. Keyboard navigation is handled in onKeyDown (the
// suggestion plugin forwards keys here); selection runs the item's command.
function createRenderer() {
  let app: App | null = null;
  let el: HTMLDivElement | null = null;
  let latest: SuggestionProps<SlashItem, SlashItem> | null = null;
  // Escape dismisses the menu for the rest of the suggestion session (the
  // session itself only ends when the "/" text goes away). Without this flag
  // the next keystroke's onUpdate → position() would un-hide the menu.
  let dismissed = false;
  const state = reactive<{ items: SlashItem[]; selected: number }>({
    items: [],
    selected: 0,
  });

  function pickByIndex(index: number): void {
    const item = latest?.items[index];
    if (item && latest) latest.command(item);
  }

  function position(): void {
    if (dismissed) return;
    const rect = latest?.clientRect?.();
    if (!el || !rect) return;
    el.style.display = '';
    el.style.left = `${rect.left + window.scrollX}px`;
    el.style.top = `${rect.bottom + window.scrollY + 6}px`;
  }

  return {
    onStart(props: SuggestionProps<SlashItem, SlashItem>): void {
      latest = props;
      state.items = props.items;
      state.selected = 0;
      dismissed = false;
      el = document.createElement('div');
      el.style.position = 'absolute';
      el.style.zIndex = '300';
      document.body.appendChild(el);
      app = createApp({
        render: () =>
          h(SlashMenu, {
            items: state.items,
            selected: state.selected,
            onSelect: (i: number) => pickByIndex(i),
          }),
      });
      app.mount(el);
      position();
    },
    onUpdate(props: SuggestionProps<SlashItem, SlashItem>): void {
      latest = props;
      state.items = props.items;
      if (state.selected >= props.items.length) state.selected = 0;
      position();
    },
    onKeyDown(props: SuggestionKeyDownProps): boolean {
      // After Escape the menu is gone — stop intercepting keys (Enter must
      // insert a newline again, not pick an invisible item).
      if (dismissed) return false;
      const n = state.items.length;
      switch (props.event.key) {
        case 'ArrowDown':
          if (n) state.selected = (state.selected + 1) % n;
          return true;
        case 'ArrowUp':
          if (n) state.selected = (state.selected - 1 + n) % n;
          return true;
        case 'Enter':
          pickByIndex(state.selected);
          return true;
        case 'Escape':
          dismissed = true;
          if (el) el.style.display = 'none';
          return true;
        default:
          return false;
      }
    },
    onExit(): void {
      app?.unmount();
      app = null;
      el?.remove();
      el = null;
      latest = null;
      dismissed = false;
    },
  };
}

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: 'slashCommand',
  addOptions() {
    return { pickMedia: null };
  },
  addProseMirrorPlugins() {
    const items = buildItems(this.options.pickMedia);
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        char: '/',
        startOfLine: false,
        items: ({ query }) =>
          items
            .filter((i) => i.title.toLowerCase().includes(query.toLowerCase()))
            // High enough that the full unfiltered list fits — a lower cap
            // silently hid the tail items (Embed/Raw HTML/Image/Gallery) on
            // an empty query.
            .slice(0, 16),
        command: ({ editor, range, props }) => {
          props.command({ editor, range });
        },
        render: createRenderer,
      }),
    ];
  },
});
