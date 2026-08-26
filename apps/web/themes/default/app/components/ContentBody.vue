<script setup lang="ts">
import { renderTiptap } from '~/utils/tiptap';

// `dropcap` marks this as the MAIN article body so the theme's drop-cap rule
// targets only its first paragraph. ContentBody is also reused by custom-field
// blocks (BlockCustomField), which must NOT get a drop cap — they leave it
// unset (false).
const props = defineProps<{ doc: unknown; dropcap?: boolean }>();

const html = computed(() => renderTiptap(props.doc));
</script>

<template>
  <!-- Source is admin-authored Tiptap JSON, validated server-side by
       buildContentDataSchema before storage, then rendered to HTML via
       @tiptap/html's generateHTML on every request. Treated as trusted. -->
  <!-- eslint-disable vue/no-v-html -->
  <div
    class="article-body"
    :class="{ 'article-body--dropcap': props.dropcap }"
    v-html="html"
  ></div>
  <!-- eslint-enable vue/no-v-html -->
</template>

<style scoped>
.article-body {
  font-size: 17px;
  line-height: 1.85;
  color: var(--text);
  max-width: 720px;
  margin: 0 auto;
}
.article-body :deep(h2) {
  font-size: clamp(22px, 2.6vw, 30px);
  font-weight: 800;
  letter-spacing: -0.5px;
  margin: 48px 0 16px;
  line-height: 1.2;
}
.article-body :deep(h3) {
  font-size: 20px;
  font-weight: 800;
  margin: 32px 0 12px;
  line-height: 1.3;
}
.article-body :deep(p) {
  margin-bottom: 22px;
}
.article-body :deep(p:last-child) {
  margin-bottom: 0;
}
.article-body :deep(blockquote) {
  border-left: 4px solid var(--accent);
  padding: 4px 0 4px 24px;
  margin: 32px 0;
  font-style: italic;
  color: var(--muted);
}
.article-body :deep(ul),
.article-body :deep(ol) {
  margin: 0 0 22px 24px;
}
.article-body :deep(li) {
  margin-bottom: 8px;
}
.article-body :deep(a) {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.article-body :deep(img) {
  border-radius: 16px;
  margin: 32px 0;
}
.article-body :deep(strong) {
  font-weight: 700;
}
.article-body :deep(code) {
  background: rgba(108, 92, 231, 0.08);
  color: var(--accent);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.9em;
  font-family: 'JetBrains Mono', 'Monaco', monospace;
}

/* Embed blocks (hydrated from the editor's embed node by injectEmbedBlocks +
   the useEmbeds composable). :deep is required — the markup is injected via
   v-html / client JS, so it never carries this SFC's scope attribute. */
.article-body :deep(.embed) {
  margin: 32px 0;
}

/* Iframe players / data-viz. Base is a 16:9 responsive frame; variants override
   the aspect for audio bars, tall viz, and portrait (Instagram) embeds. */
.article-body :deep(.embed-frame) {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 12px;
  overflow: hidden;
  background: #000;
}
.article-body :deep(.embed-frame iframe) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
}
.article-body :deep(.embed-frame--audio) {
  aspect-ratio: auto;
  height: 152px;
  background: transparent;
}
.article-body :deep(.embed-frame--audio-tall) {
  aspect-ratio: auto;
  height: 352px;
  background: transparent;
}
.article-body :deep(.embed-frame--viz) {
  aspect-ratio: auto;
  height: 520px;
  background: var(--surface);
}
.article-body :deep(.embed-frame--portrait) {
  aspect-ratio: auto;
  height: 640px;
  max-width: 540px;
  margin: 0 auto;
  background: transparent;
}
.article-body :deep(.embed figcaption) {
  margin-top: 10px;
  font-size: 14px;
  color: var(--muted);
  text-align: center;
}

/* Pasted embed code (iframe mode) + social blockquotes (link/iframe). Center
   them and cap width; min-height limits layout jump before the widget loads. */
.article-body :deep(.embed--code),
.article-body :deep(.embed--social) {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.article-body :deep(.embed--code iframe) {
  max-width: 100%;
  border: 0;
  border-radius: 12px;
}
.article-body :deep(.embed .twitter-tweet),
.article-body :deep(.embed .tiktok-embed),
.article-body :deep(.embed .instagram-media) {
  margin: 0 auto !important;
  min-height: 220px;
}

/* OG link-preview card (card mode + unknown link-mode URLs). The SSR fallback
   is a bordered link; useEmbeds replaces it with image + title + description. */
.article-body :deep(.embed-card),
.article-body :deep(.embed-card__fallback) {
  display: flex;
  text-decoration: none;
  color: inherit;
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  background: var(--surface);
  transition: border-color 0.15s ease;
}
.article-body :deep(.embed-card:hover),
.article-body :deep(.embed-card__fallback:hover) {
  border-color: var(--accent);
}
.article-body :deep(.embed-card__fallback) {
  flex-direction: column;
  padding: 16px 18px;
  font-size: 14px;
  color: var(--muted);
  word-break: break-all;
}
.article-body :deep(.embed-card__media) {
  flex: 0 0 200px;
  max-width: 200px;
  background: var(--surface-2, #f1f1f4);
}
.article-body :deep(.embed-card__media img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.article-body :deep(.embed-card__body) {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px 18px;
  min-width: 0;
}
.article-body :deep(.embed-card__site) {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--accent);
}
.article-body :deep(.embed-card__title) {
  font-size: 16px;
  font-weight: 700;
  line-height: 1.3;
}
.article-body :deep(.embed-card__desc) {
  font-size: 13.5px;
  color: var(--muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
@media (max-width: 560px) {
  .article-body :deep(.embed-card) {
    flex-direction: column;
  }
  .article-body :deep(.embed-card__media) {
    flex-basis: auto;
    max-width: none;
    height: 180px;
  }
}
</style>
