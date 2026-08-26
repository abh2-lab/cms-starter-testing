<script setup lang="ts">
import { computed } from 'vue';
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import xml from 'highlight.js/lib/languages/xml';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import 'highlight.js/styles/github-dark.css';
import { toast } from '@/composables/useToast';

// Renders a Markdown string as formatted, syntax-highlighted, SANITIZED HTML.
//
// Pipeline: markdown-it (with an hljs highlight hook for fenced code) →
// DOMPurify.sanitize → v-html. The sanitize step is mandatory: even though
// these docs are in-repo, the renderer is generic and v-html would otherwise
// be an XSS sink. DOMPurify keeps hljs's <span class> tokens (class is
// allowed by default) while stripping <script>, event handlers, etc.
//
// Only the languages we actually use in docs are registered, keeping the
// hljs payload small (this whole page is route-split + lazy anyway).

hljs.registerLanguage('typescript', typescript); // aliases: ts
hljs.registerLanguage('javascript', javascript); // aliases: js, jsx
hljs.registerLanguage('xml', xml); // aliases: html, vue→mapped below
hljs.registerLanguage('bash', bash); // aliases: sh, shell
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);

// Wrap a highlighted <pre> with a Copy button. The button is always emitted but
// only shown when the renderer is mounted with `copyable` (see the
// .md-prose--copyable CSS), so doc pages are visually unchanged. Clicks are
// handled by delegation on the root (onCopyClick) — an inline handler would not
// survive DOMPurify anyway.
function codeBlock(inner: string): string {
  return `<div class="md-code"><button class="md-copy" type="button" aria-label="Copy code">Copy</button>${inner}</div>`;
}

const md: MarkdownIt = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight(str, lang): string {
    // .vue / SFC snippets highlight cleanly as XML/HTML.
    const language = lang === 'vue' ? 'xml' : lang;
    if (language && hljs.getLanguage(language)) {
      try {
        const out = hljs.highlight(str, {
          language,
          ignoreIllegals: true,
        }).value;
        return codeBlock(`<pre class="hljs"><code>${out}</code></pre>`);
      } catch {
        // fall through to escaped plain rendering
      }
    }
    return codeBlock(`<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`);
  },
});

const props = defineProps<{ source: string; copyable?: boolean }>();

const html = computed<string>(() =>
  DOMPurify.sanitize(md.render(props.source ?? '')),
);

// Delegated copy handler: only active when `copyable`. Reads the clicked block's
// <code> text and writes it to the clipboard — used by the AI chat so the user
// can paste generated content/snippets (e.g. a post body) into the editor.
async function onCopyClick(e: MouseEvent): Promise<void> {
  if (!props.copyable) return;
  const target = e.target as HTMLElement | null;
  const btn = target?.closest('.md-copy');
  if (!btn) return;
  const text =
    btn.closest('.md-code')?.querySelector('code')?.textContent ?? '';
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  } catch {
    toast.error('Copy failed — your browser blocked clipboard access.');
  }
}
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html — output is sanitized via DOMPurify above -->
  <div class="md-prose" :class="{ 'md-prose--copyable': copyable }" @click="onCopyClick" v-html="html"></div>
</template>

<style scoped>
.md-prose {
  font-size: 14px;
  line-height: 1.7;
  color: var(--fg);
  max-width: 52rem;
}

.md-prose :deep(h1),
.md-prose :deep(h2),
.md-prose :deep(h3),
.md-prose :deep(h4) {
  font-weight: 700;
  color: var(--fg);
  line-height: 1.3;
  margin: 1.6em 0 0.6em;
}
.md-prose :deep(h1) {
  font-size: 24px;
  margin-top: 0;
}
.md-prose :deep(h2) {
  font-size: 19px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-soft);
}
.md-prose :deep(h3) {
  font-size: 16px;
}
.md-prose :deep(h4) {
  font-size: 14px;
}

.md-prose :deep(p),
.md-prose :deep(li) {
  margin: 0 0 0.85em;
}
.md-prose :deep(ul),
.md-prose :deep(ol) {
  margin: 0 0 0.85em;
  padding-left: 1.4em;
}
.md-prose :deep(li) {
  margin-bottom: 0.35em;
}
.md-prose :deep(li > ul),
.md-prose :deep(li > ol) {
  margin-top: 0.35em;
}

.md-prose :deep(a) {
  color: var(--info);
  text-decoration: none;
}
.md-prose :deep(a:hover) {
  text-decoration: underline;
}

.md-prose :deep(strong) {
  font-weight: 700;
  color: var(--fg);
}

/* Inline code — bordered chip (matches the rest of the admin). */
.md-prose :deep(:not(pre) > code) {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12.5px;
  background: var(--bg);
  border: 1px solid var(--border);
  padding: 1px 5px;
  border-radius: 3px;
  color: var(--fg);
}

/* Fenced code blocks — always dark (matches the DynamicBlocksGuide style),
   github-dark.css colours the hljs tokens. */
.md-prose :deep(pre.hljs) {
  border-radius: var(--radius);
  padding: 14px 16px;
  overflow-x: auto;
  font-size: 12.5px;
  line-height: 1.6;
  margin: 0 0 1em;
}
.md-prose :deep(pre.hljs code) {
  font-family: ui-monospace, SFMono-Regular, monospace;
  background: none;
  border: none;
  padding: 0;
  white-space: pre;
}

/* Copy button on fenced code blocks — only shown when `copyable` is set. */
.md-prose :deep(.md-code) {
  position: relative;
}
.md-prose :deep(.md-copy) {
  position: absolute;
  top: 8px;
  right: 8px;
  display: none;
  font-family: inherit;
  font-size: 11px;
  color: #fff;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 6px;
  padding: 3px 8px;
  cursor: pointer;
}
.md-prose--copyable :deep(.md-copy) {
  display: inline-flex;
}
.md-prose :deep(.md-copy):hover {
  background: rgba(255, 255, 255, 0.26);
}

.md-prose :deep(blockquote) {
  margin: 0 0 1em;
  padding: 6px 14px;
  border-left: 3px solid var(--border);
  background: var(--bg);
  border-radius: 0 var(--radius) var(--radius) 0;
  color: var(--muted);
}
.md-prose :deep(blockquote p:last-child) {
  margin-bottom: 0;
}

.md-prose :deep(hr) {
  border: none;
  border-top: 1px solid var(--border-soft);
  margin: 1.8em 0;
}

.md-prose :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 1em;
  font-size: 13px;
}
.md-prose :deep(th) {
  text-align: left;
  font-weight: 700;
  color: var(--muted);
  padding: 8px 10px;
  background: var(--table-head);
  border-bottom: 1px solid var(--border);
}
.md-prose :deep(td) {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-soft);
  vertical-align: top;
}

.md-prose :deep(img) {
  max-width: 100%;
  border-radius: var(--radius);
}
</style>
