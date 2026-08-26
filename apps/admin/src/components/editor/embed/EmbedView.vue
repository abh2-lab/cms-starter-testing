<script setup lang="ts">
import { computed } from 'vue';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/vue-3';
import Icon from '@/components/Icon.vue';

// NodeViewProps is Tiptap's NodeView contract — its HTMLAttributes field is
// PascalCase by Tiptap's design and is what the runtime actually passes.
// eslint-disable-next-line vue/prop-name-casing
const props = defineProps<NodeViewProps>();

// The three journalist-facing modes. The admin only CAPTURES the input — all
// rendering (provider detection, iframes, the Twitter script, OG cards) happens
// on the public site, so there is deliberately no live preview here.
const MODES = [
  {
    key: 'link',
    label: 'Link',
    icon: 'link',
    placeholder: 'Paste a URL — YouTube, X/Twitter, Instagram, Vimeo, TikTok…',
    hint: 'The site auto-detects the platform and renders it (or shows a card).',
  },
  {
    key: 'iframe',
    label: 'Embed code',
    icon: 'code',
    placeholder: 'Paste embed code — an <iframe> or a platform snippet (e.g. publish.x.com)',
    hint: 'Shown as-is. Widget scripts (tweets, etc.) are added safely on the public site.',
  },
  {
    key: 'card',
    label: 'Card',
    icon: 'image',
    placeholder: 'Paste a URL to show as a link-preview card',
    hint: 'Shows a preview box with the page image, title and description.',
  },
] as const;

// node.attrs values are typed `any`; read them through `unknown` to keep the
// narrowing type-safe (mirrors GalleryView/InlineImageView).
function attrStr(key: string): string {
  const v: unknown = props.node.attrs[key];
  return typeof v === 'string' ? v : '';
}

// Legacy fallback: pre-{type,value} embeds carry `url`/`provider`. Read them so
// an old block opens cleanly; it's rewritten to the new shape on first edit.
const type = computed(() => attrStr('type') || 'link');
const value = computed(() => attrStr('value') || attrStr('url'));
const caption = computed(() => attrStr('caption'));

const mode = computed(() => MODES.find((m) => m.key === type.value) ?? MODES[0]);

function onValue(e: Event): void {
  const t = e.target as HTMLInputElement | HTMLTextAreaElement;
  // Writing a value also clears the legacy `url`, migrating an old embed onto
  // the new shape so the url fallback no longer applies.
  props.updateAttributes({ value: t.value, url: null });
}
function onCaption(e: Event): void {
  props.updateAttributes({
    caption: (e.target as HTMLInputElement).value || null,
  });
}
</script>

<template>
  <NodeViewWrapper
    class="embed-block"
    :class="{ selected }"
    data-testid="ni-embed-block"
  >
    <div class="embed-head">
      <Icon :name="mode.icon" :size="15" />
      <span class="embed-label">Embed · {{ mode.label }}</span>
    </div>

    <div class="embed-controls" contenteditable="false">
      <!-- Mode picker. Switching mode keeps the current value so a journalist
           can paste once and toggle. -->
      <div class="gc-group" role="group" aria-label="Embed type">
        <button
          v-for="m in MODES"
          :key="m.key"
          type="button"
          class="gc-btn"
          :class="{ active: type === m.key }"
          :data-testid="`ni-embed-mode-${m.key}`"
          @click="props.updateAttributes({ type: m.key })"
        >
          <Icon :name="m.icon" :size="13" />
          {{ m.label }}
        </button>
      </div>

      <!-- Value: a textarea for embed code, a single-line input otherwise. -->
      <textarea
        v-if="type === 'iframe'"
        class="gc-input embed-code"
        rows="3"
        :value="value"
        :placeholder="mode.placeholder"
        data-testid="ni-embed-value"
        @input="onValue"
      />
      <input
        v-else
        class="gc-input"
        type="text"
        :value="value"
        :placeholder="mode.placeholder"
        data-testid="ni-embed-value"
        @input="onValue"
      />

      <p class="embed-hint">{{ mode.hint }}</p>

      <div class="embed-row">
        <input
          class="gc-input embed-caption"
          type="text"
          :value="caption"
          placeholder="Caption (optional)"
          @input="onCaption"
        />
        <button
          type="button"
          class="gc-btn danger"
          @click="props.deleteNode()"
        >
          Remove
        </button>
      </div>
    </div>
  </NodeViewWrapper>
</template>

<style scoped>
.embed-block {
  margin: 24px 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  overflow: hidden;
}
.embed-block.selected {
  border-color: var(--accent);
  box-shadow: var(--ring);
}
.embed-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
  border-bottom: 1px solid var(--border-soft);
}
.embed-controls {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}
.embed-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.embed-caption {
  flex: 1;
  min-width: 160px;
}
.gc-group {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.gc-group .gc-btn {
  border: none;
  border-radius: 0;
}
.gc-group .gc-btn + .gc-btn {
  border-left: 1px solid var(--border);
}
.gc-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: var(--radius-sm);
  padding: 5px 10px;
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
  font-family: inherit;
}
.gc-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.gc-btn.active {
  background: var(--accent-soft);
  color: var(--fg);
}
.gc-btn.danger:hover {
  border-color: var(--danger);
  color: var(--danger);
}
.gc-input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 7px 10px;
  font-size: 13px;
  font-family: inherit;
  background: var(--surface);
  color: var(--fg);
}
.gc-input:focus {
  outline: none;
  border-color: var(--accent);
}
textarea.embed-code {
  font-family: 'JetBrains Mono', 'Monaco', monospace;
  font-size: 12px;
  resize: vertical;
  min-height: 64px;
}
.embed-hint {
  margin: 0;
  font-size: 11.5px;
  color: var(--text-tertiary);
}
</style>
