<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { Editor } from '@tiptap/vue-3';
import type { Media } from '@/api/media';
import Icon from '@/components/Icon.vue';
import { useLinkDialog } from '@/composables/useLinkDialog';

const props = defineProps<{
  editor: Editor;
  /** Opens the shared media picker; supplied by the editor page. */
  pickMedia?: (multiple: boolean) => Promise<Media[]>;
}>();
const emit = defineEmits<{ 'toggle-focus': [] }>();

// Tiptap's isActive()/can() aren't reactive refs; bump a counter on every
// transaction so the toolbar's computed active/disabled states recompute.
const tick = ref(0);
function bump(): void {
  tick.value++;
}
onMounted(() => {
  props.editor.on('transaction', bump);
  props.editor.on('selectionUpdate', bump);
});
onBeforeUnmount(() => {
  props.editor.off('transaction', bump);
  props.editor.off('selectionUpdate', bump);
});

function active(name: string, attrs?: Record<string, unknown>): boolean {
  void tick.value;
  return attrs
    ? props.editor.isActive(name, attrs)
    : props.editor.isActive(name);
}

function alignActive(value: string): boolean {
  void tick.value;
  return props.editor.isActive({ textAlign: value });
}

const blockType = computed<string>(() => {
  void tick.value;
  const e = props.editor;
  if (e.isActive('heading', { level: 2 })) return 'h2';
  if (e.isActive('heading', { level: 3 })) return 'h3';
  if (e.isActive('leadParagraph')) return 'lead';
  if (e.isActive('pullQuote')) return 'pullquote';
  if (e.isActive('pullquoteUnderline')) return 'pullquote-underline';
  if (e.isActive('blockquote')) return 'quote';
  if (e.isActive('codeBlock')) return 'code';
  return 'paragraph';
});

const canUndo = computed<boolean>(() => {
  void tick.value;
  return props.editor.can().undo();
});
const canRedo = computed<boolean>(() => {
  void tick.value;
  return props.editor.can().redo();
});

// <input type="color"> only accepts #rrggbb — expand #rgb and convert
// rgb(...) (pasted docs can carry either); anything else is unusable.
function toHexColor(v: string): string | null {
  const s = v.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s;
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    return (
      '#' +
      s
        .slice(1)
        .split('')
        .map((ch) => ch + ch)
        .join('')
    );
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s);
  if (rgb) {
    const hex = (n: string): string =>
      Math.min(255, Number(n)).toString(16).padStart(2, '0');
    return `#${hex(rgb[1] ?? '0')}${hex(rgb[2] ?? '0')}${hex(rgb[3] ?? '0')}`;
  }
  return null;
}

// Swatch default is the theme's text colour, not black — in dark mode a
// hardcoded black swatch reads as if a colour were already applied.
function themeTextColor(): string {
  const fg = getComputedStyle(document.documentElement)
    .getPropertyValue('--fg')
    .trim();
  return toHexColor(fg) ?? '#000000';
}

const currentColor = computed<string>(() => {
  void tick.value;
  // getAttributes returns Record<string, any>; read through unknown to narrow.
  const c: unknown = props.editor.getAttributes('textStyle')['color'];
  const hex = typeof c === 'string' && c ? toHexColor(c) : null;
  return hex ?? themeTextColor();
});

function setBlock(value: string): void {
  const e = props.editor;
  let c = e.chain().focus();
  // Leaving a quote: lift the blockquote wrapper first — setParagraph/setNode
  // alone only convert the paragraph inside it, so the dropdown would snap
  // straight back to "quote".
  if (value !== 'quote' && e.isActive('blockquote')) {
    c = c.toggleBlockquote();
  }
  switch (value) {
    case 'h2':
      c.setNode('heading', { level: 2 }).run();
      break;
    case 'h3':
      c.setNode('heading', { level: 3 }).run();
      break;
    case 'lead':
      c.toggleLeadParagraph().run();
      break;
    case 'pullquote':
      c.togglePullQuote().run();
      break;
    case 'pullquote-underline':
      c.togglePullquoteUnderline().run();
      break;
    case 'quote':
      c.toggleBlockquote().run();
      break;
    case 'code':
      c.toggleCodeBlock().run();
      break;
    default:
      c.setParagraph().run();
  }
}

function setAlign(value: string): void {
  props.editor.chain().focus().setTextAlign(value).run();
}

function setColor(e: Event): void {
  props.editor
    .chain()
    .focus()
    .setColor((e.target as HTMLInputElement).value)
    .run();
}
function clearColor(): void {
  props.editor.chain().focus().unsetColor().run();
}

const { openLinkDialog } = useLinkDialog();

// Linking needs something to attach to: either a text selection or an
// existing link under the caret (which extendMarkRange can widen to).
const canLink = computed<boolean>(() => {
  void tick.value;
  return !props.editor.state.selection.empty || props.editor.isActive('link');
});

async function toggleLink(): Promise<void> {
  const e = props.editor;
  const onLink = e.isActive('link');
  if (!onLink && e.state.selection.empty) return;
  const prev = onLink
    ? ((e.getAttributes('link')['href'] as string | undefined) ?? '')
    : '';
  const result = await openLinkDialog({ href: prev, existing: onLink });
  if (e.isDestroyed || result.action === 'cancel') return;
  if (result.action === 'remove') {
    e.chain().focus().extendMarkRange('link').unsetLink().run();
    return;
  }
  e.chain()
    .focus()
    .extendMarkRange('link')
    .setLink({ href: result.href })
    .run();
}

const inTable = computed<boolean>(() => {
  void tick.value;
  return props.editor.isActive('table');
});

function insertTable(): void {
  props.editor
    .chain()
    .focus()
    .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
    .run();
}

type TableCommand =
  | 'addRowBefore'
  | 'addRowAfter'
  | 'deleteRow'
  | 'addColumnBefore'
  | 'addColumnAfter'
  | 'deleteColumn'
  | 'toggleHeaderRow'
  | 'deleteTable';

function tableCmd(name: TableCommand): void {
  props.editor.chain().focus()[name]().run();
}

// Image/Gallery resolve a mediaId via the shared picker before inserting — an
// empty image would fail the body validator. The isDestroyed check covers the
// user navigating away while the picker is open.
function insertImage(): void {
  if (!props.pickMedia) return;
  void props.pickMedia(false).then((media) => {
    const m = media[0];
    if (m && !props.editor.isDestroyed)
      props.editor.chain().focus().insertInlineImage({ mediaId: m.id }).run();
  });
}
function insertGallery(): void {
  if (!props.pickMedia) return;
  void props.pickMedia(true).then((media) => {
    if (media.length > 0 && !props.editor.isDestroyed) {
      props.editor
        .chain()
        .focus()
        .insertGallery({ mediaIds: media.map((m) => m.id) })
        .run();
    }
  });
}
function insertSection(): void {
  // Label and anchor are edited inline in the node view — the empty label
  // shows its "SECTION LABEL" placeholder, inviting the user to type.
  props.editor.chain().focus().insertSectionRule({ label: '' }).run();
}
function insertRawHtml(): void {
  props.editor.chain().focus().insertRawHtml({ html: '' }).run();
}
</script>

<template>
  <div class="toolbar">
    <select
      class="tb-select"
      data-testid="tb-block"
      :value="blockType"
      @change="setBlock(($event.target as HTMLSelectElement).value)"
    >
      <option value="paragraph">Paragraph</option>
      <option value="h2">Heading 2</option>
      <option value="h3">Heading 3</option>
      <option value="lead">Lead paragraph</option>
      <option value="quote">Quote</option>
      <option value="pullquote">Pull quote</option>
      <option value="pullquote-underline">Pull quote (underline)</option>
      <option value="code">Code Block</option>
    </select>

    <span class="tb-sep" />

    <div class="tb-group">
      <button
        type="button"
        class="tb-btn"
        :class="{ active: active('bold') }"
        title="Bold"
        @click="editor.chain().focus().toggleBold().run()"
      >
        <b>B</b>
      </button>
      <button
        type="button"
        class="tb-btn"
        :class="{ active: active('italic') }"
        title="Italic"
        @click="editor.chain().focus().toggleItalic().run()"
      >
        <i>I</i>
      </button>
      <button
        type="button"
        class="tb-btn"
        :class="{ active: active('underline') }"
        title="Underline"
        @click="editor.chain().focus().toggleUnderline().run()"
      >
        <u>U</u>
      </button>
      <button
        type="button"
        class="tb-btn strike"
        :class="{ active: active('strike') }"
        title="Strikethrough"
        @click="editor.chain().focus().toggleStrike().run()"
      >
        S
      </button>
    </div>

    <span class="tb-sep" />

    <div class="tb-group">
      <button
        type="button"
        class="tb-btn"
        :class="{ active: active('bulletList') }"
        title="Bullet list"
        @click="editor.chain().focus().toggleBulletList().run()"
      >
        <Icon name="list" :size="15" />
      </button>
      <button
        type="button"
        class="tb-btn"
        :class="{ active: active('orderedList') }"
        title="Numbered list"
        @click="editor.chain().focus().toggleOrderedList().run()"
      >
        <Icon name="list-ordered" :size="15" />
      </button>
      <button
        type="button"
        class="tb-btn"
        :class="{ active: active('blockquote') }"
        title="Blockquote"
        @click="editor.chain().focus().toggleBlockquote().run()"
      >
        <Icon name="quote" :size="15" />
      </button>
    </div>

    <span class="tb-sep" />

    <div class="tb-group">
      <button
        type="button"
        class="tb-btn"
        :class="{ active: alignActive('left') }"
        title="Align left"
        data-testid="tb-align-left"
        @click="setAlign('left')"
      >
        <Icon name="align-left" :size="15" />
      </button>
      <button
        type="button"
        class="tb-btn"
        :class="{ active: alignActive('center') }"
        title="Align center"
        data-testid="tb-align-center"
        @click="setAlign('center')"
      >
        <Icon name="align-center" :size="15" />
      </button>
      <button
        type="button"
        class="tb-btn"
        :class="{ active: alignActive('right') }"
        title="Align right"
        data-testid="tb-align-right"
        @click="setAlign('right')"
      >
        <Icon name="align-right" :size="15" />
      </button>
      <button
        type="button"
        class="tb-btn"
        :class="{ active: alignActive('justify') }"
        title="Justify"
        data-testid="tb-align-justify"
        @click="setAlign('justify')"
      >
        <Icon name="align-justify" :size="15" />
      </button>
    </div>

    <span class="tb-sep" />

    <div class="tb-group tb-color" title="Text colour">
      <span class="tb-color-swatch" :style="{ background: currentColor }" />
      <input
        type="color"
        class="tb-color-input"
        data-testid="tb-color"
        :value="currentColor"
        @input="setColor"
      />
      <button
        type="button"
        class="tb-btn tb-color-clear"
        title="Clear colour"
        data-testid="tb-color-clear"
        @click="clearColor"
      >
        ✕
      </button>
    </div>

    <span class="tb-sep" />

    <div class="tb-group">
      <button
        type="button"
        class="tb-btn"
        :class="{ active: active('link') }"
        :disabled="!canLink"
        :title="canLink ? 'Link' : 'Select text to link'"
        data-testid="tb-link"
        @click="toggleLink"
      >
        <Icon name="link" :size="15" />
      </button>
      <button
        v-if="pickMedia"
        type="button"
        class="tb-btn"
        title="Image"
        data-testid="tb-image"
        @click="insertImage"
      >
        <Icon name="image" :size="15" />
      </button>
      <button
        v-if="pickMedia"
        type="button"
        class="tb-btn"
        title="Gallery"
        data-testid="tb-gallery"
        @click="insertGallery"
      >
        <Icon name="layers" :size="15" />
      </button>
      <button
        type="button"
        class="tb-btn"
        :disabled="inTable"
        :title="inTable ? 'Already inside a table' : 'Table'"
        @click="insertTable"
      >
        <Icon name="table" :size="15" />
      </button>
      <button
        type="button"
        class="tb-btn"
        title="Embed"
        data-testid="tb-embed"
        @click="editor.chain().focus().insertEmbed().run()"
      >
        <Icon name="embed" :size="15" />
      </button>
      <button
        type="button"
        class="tb-btn"
        title="Section rule"
        data-testid="tb-section"
        @click="insertSection"
      >
        <Icon name="section" :size="15" />
      </button>
      <button
        type="button"
        class="tb-btn"
        title="Raw HTML"
        data-testid="tb-rawhtml"
        @click="insertRawHtml"
      >
        <Icon name="braces" :size="15" />
      </button>
      <button
        type="button"
        class="tb-btn"
        title="Divider"
        @click="editor.chain().focus().setHorizontalRule().run()"
      >
        <Icon name="minus" :size="15" />
      </button>
    </div>

    <!-- Contextual table controls — visible only while the caret is inside a
         table; insertTable alone left tables uneditable beyond typing. -->
    <template v-if="inTable">
      <span class="tb-sep" />
      <div class="tb-group tb-table-group" data-testid="tb-table-controls">
        <span class="tb-table-label" aria-hidden="true">
          <Icon name="table" :size="13" />
        </span>
        <button
          type="button"
          class="tb-btn tb-table-btn"
          title="Add row above"
          @click="tableCmd('addRowBefore')"
        >
          +↑
        </button>
        <button
          type="button"
          class="tb-btn tb-table-btn"
          title="Add row below"
          @click="tableCmd('addRowAfter')"
        >
          +↓
        </button>
        <button
          type="button"
          class="tb-btn tb-table-btn"
          title="Add column left"
          @click="tableCmd('addColumnBefore')"
        >
          +←
        </button>
        <button
          type="button"
          class="tb-btn tb-table-btn"
          title="Add column right"
          @click="tableCmd('addColumnAfter')"
        >
          +→
        </button>
        <button
          type="button"
          class="tb-btn tb-table-btn"
          title="Delete row"
          @click="tableCmd('deleteRow')"
        >
          −row
        </button>
        <button
          type="button"
          class="tb-btn tb-table-btn"
          title="Delete column"
          @click="tableCmd('deleteColumn')"
        >
          −col
        </button>
        <button
          type="button"
          class="tb-btn tb-table-btn"
          title="Toggle header row"
          @click="tableCmd('toggleHeaderRow')"
        >
          header
        </button>
        <button
          type="button"
          class="tb-btn tb-table-btn tb-table-delete"
          title="Delete table"
          @click="tableCmd('deleteTable')"
        >
          ✕
        </button>
      </div>
    </template>

    <span class="tb-sep" />

    <div class="tb-group">
      <button
        type="button"
        class="tb-btn"
        title="Undo"
        :disabled="!canUndo"
        @click="editor.chain().focus().undo().run()"
      >
        <Icon name="undo" :size="15" />
      </button>
      <button
        type="button"
        class="tb-btn"
        title="Redo"
        :disabled="!canRedo"
        @click="editor.chain().focus().redo().run()"
      >
        <Icon name="redo" :size="15" />
      </button>
    </div>

    <button
      type="button"
      class="tb-btn focus-btn"
      title="Focus mode"
      @click="emit('toggle-focus')"
    >
      <Icon name="maximize" :size="14" />
      Focus
    </button>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  row-gap: 4px;
  padding: 6px 28px;
  border-bottom: 1px solid var(--border-soft);
  background: var(--surface-2);
  position: sticky;
  top: 0;
  z-index: 10;
}
.tb-group {
  display: flex;
  align-items: center;
  gap: 1px;
}
.tb-sep {
  width: 1px;
  height: 18px;
  background: var(--border);
  margin: 0 6px;
  flex-shrink: 0;
}
.tb-btn {
  height: 28px;
  min-width: 28px;
  padding: 0 6px;
  border: none;
  background: none;
  border-radius: 4px;
  cursor: pointer;
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 600;
}
.tb-btn:hover:not(:disabled) {
  background: var(--bg);
  color: var(--fg);
}
.tb-btn.active {
  background: var(--accent-soft);
  color: var(--fg);
}
.tb-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.tb-btn.strike {
  text-decoration: line-through;
}
.tb-select {
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 3px 7px;
  font-family: inherit;
  font-size: 12px;
  color: var(--muted);
  background: var(--surface);
  cursor: pointer;
  outline: none;
  height: 28px;
}
.tb-color {
  position: relative;
  gap: 3px;
}
.tb-color-swatch {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  border: 1px solid var(--border);
  flex-shrink: 0;
}
.tb-color-input {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: none;
  cursor: pointer;
}
.tb-color-input::-webkit-color-swatch-wrapper {
  padding: 2px;
}
.tb-color-input::-webkit-color-swatch {
  border: none;
  border-radius: 2px;
}
.tb-color-clear {
  font-size: 11px;
}
.tb-table-group {
  gap: 2px;
}
.tb-table-label {
  display: inline-flex;
  align-items: center;
  color: var(--text-tertiary);
  margin-right: 2px;
}
.tb-table-btn {
  font-size: 11px;
  font-weight: 500;
  padding: 0 5px;
}
.tb-table-delete:hover:not(:disabled) {
  color: var(--danger);
}
.focus-btn {
  margin-left: auto;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-tertiary);
}
</style>
