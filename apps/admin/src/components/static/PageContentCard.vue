<script setup lang="ts">
// Page Content card — Card 2 in the static editor stack. A single dark
// code-editor textarea backed by the shell's html/css split logic in
// StaticEditor.vue. Admins can paste a complete chunk of markup including
// inline <style> blocks; the shell extracts them into the css column on
// every keystroke.
//
// This editor is admin-only. There is no sanitization on save and no
// per-page CSS scoping — what you type is what gets stored and what gets
// rendered on the public site.

const markup = defineModel<string>('markup', { required: true });
</script>

<template>
  <div class="card">
    <div class="card-header">
      <span class="card-title">Page Content</span>
      <span class="mode-label">Raw HTML + CSS</span>
    </div>
    <div class="card-body">
      <!-- Warning strip — three things the admin should know about this
           surface. No "JavaScript is stripped" anymore: nothing is stripped.
           Header carries the admin-only signal so the warnings don't read
           as "this is a security feature" — they're caveats, not gates. -->
      <div class="sec-strip">
        <svg
          class="sec-icon"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        <div>
          <strong>Admin-only editor — no sanitization.</strong>
          Raw HTML and CSS are saved as written.
          <ul class="sec-bullets">
            <li>
              <strong>CSS here applies globally</strong> to the rendered
              page, including the site header, footer, and any other chrome.
              Use specific selectors so rules like <code class="sec-code">body { … }</code>
              don't leak.
            </li>
            <li>
              <code class="sec-code">&lt;script&gt;</code> tags in the page
              body will <strong>not execute</strong> (browser security —
              <code class="sec-code">innerHTML</code> never runs scripts).
              Put analytics and tracking scripts in the
              <strong>Extra &lt;head&gt; HTML</strong> field on the right.
            </li>
          </ul>
        </div>
      </div>

      <!-- Combined HTML + CSS editor (dark code style). -->
      <div class="raw-editor">
        <div class="raw-editor-bar">
          <span class="raw-dot raw-dot--red" />
          <span class="raw-dot raw-dot--yellow" />
          <span class="raw-dot raw-dot--green" />
          <span class="raw-lang">HTML + CSS · UTF-8</span>
        </div>
        <textarea
          v-model="markup"
          spellcheck="false"
          class="raw-body"
          placeholder="<style>
  .hero { color: #1e3a8a; }
</style>
<section class=&quot;page-content&quot;>
  <h1 class=&quot;hero&quot;>Page Heading</h1>
  <p>Write your page content here.</p>
</section>"
        />
      </div>
      <div class="below-editor">
        <span class="hint">
          Tip: paste a whole HTML chunk including
          <code>&lt;style&gt;</code> blocks — they're routed into the
          page's <code>css</code> column on save.
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.card-header {
  padding: 14px 20px;
  border-bottom: 1px solid var(--border-soft);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.card-title {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}
.mode-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.card-body {
  padding: 16px;
}

/* ── Warning strip ───────────────────────────────────────────────────── */
.sec-strip {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 13px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: var(--radius);
  margin-bottom: 14px;
  font-size: 12px;
  color: var(--warning);
  line-height: 1.5;
}
[data-theme='dark'] .sec-strip {
  background: rgba(251, 191, 36, 0.1);
  border-color: rgba(251, 191, 36, 0.35);
  color: #fcd34d;
}
.sec-icon {
  flex-shrink: 0;
  margin-top: 1px;
  color: var(--warning);
}
.sec-code {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  background: rgba(0, 0, 0, 0.06);
  border-radius: 4px;
  padding: 0 4px;
}
[data-theme='dark'] .sec-code {
  background: rgba(255, 255, 255, 0.08);
}
.sec-bullets {
  margin: 6px 0 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* ── Raw editor ──────────────────────────────────────────────────────── */
.raw-editor {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  background: #0d1117;
}
.raw-editor-bar {
  background: #1e2330;
  padding: 7px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.raw-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.raw-dot--red { background: #ff5f57; }
.raw-dot--yellow { background: #febc2e; }
.raw-dot--green { background: #28c840; }
.raw-lang {
  font-size: 10.5px;
  font-weight: 600;
  color: #8b949e;
  font-family: ui-monospace, SFMono-Regular, monospace;
  margin-left: auto;
  letter-spacing: 0.04em;
}
.raw-body {
  display: block;
  width: 100%;
  background: #0d1117;
  min-height: 360px;
  padding: 14px 16px;
  font-family: 'Courier New', ui-monospace, SFMono-Regular, monospace;
  font-size: 12.5px;
  line-height: 1.7;
  color: #e6edf3;
  outline: none;
  border: none;
  resize: vertical;
  white-space: pre;
  overflow-x: auto;
}
.raw-body::placeholder {
  color: #5b6478;
}

/* ── Hint row below the editor ──────────────────────────────────────── */
.below-editor {
  display: flex;
  justify-content: flex-end;
  margin-top: 6px;
}
.hint {
  font-size: 11px;
  color: var(--text-tertiary);
}
.hint code {
  background: rgba(0, 0, 0, 0.06);
  border-radius: 4px;
  padding: 0 3px;
  font-family: ui-monospace, SFMono-Regular, monospace;
}
[data-theme='dark'] .hint code {
  background: rgba(255, 255, 255, 0.08);
}
</style>
