<script setup lang="ts">
import { cmsFetch } from '~/composables/useCmsFetch';
import { useBlockRegistry } from '~/composables/useBlockRegistry';

// No site chrome — this is an isolated block render (opened in a new tab from
// the library, or iframed by the admin's Block Gallery). The default layout's
// header/footer would clutter the small preview.
definePageMeta({ layout: false });

// Per-block preview page. Powers the "Preview" button on each library card in
// the admin's builder AND the Block Gallery's per-block iframes: it renders a
// block with its default field + option values, on the real public site (same
// theme CSS + same data-fetch path — the site header/footer are stripped via
// layout:false above) instead of an admin-side approximation.
//
// The API endpoint (/api/public/blocks/:key/preview) builds the defaults
// from the block's metadata, runs its load() function against the live
// public tenant context, and returns { key, label, fields, options, data,
// error? }. We resolve the component via the same registry the live page
// renderer uses so the rendered output is identical.

interface BlockPreviewPayload {
  key: string;
  label: string;
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  data: Record<string, unknown> | null;
  error?: 'load_failed';
}

const route = useRoute();
const blockKey = computed(() => {
  const raw = route.params['key'];
  return typeof raw === 'string' ? raw : '';
});

// Embed mode (`?embed=1`): render ONLY the block — no "Preview / name / key"
// header strip. The Block Gallery iframes this route many times over in a
// grid, where the header chrome would dwarf the actual block in each small
// frame. The standalone "open in a new tab" use (the library's Preview
// button) keeps the full header by omitting the flag.
const embed = computed(() => {
  const e = route.query['embed'];
  return e === '1' || e === 'true';
});

// Report the rendered block's height to the gallery parent so each preview
// frame can size itself to the block (no fixed-height white space). Cross-
// origin, so it goes over postMessage; the gallery validates the sender origin
// + message shape before trusting it. Posts on first paint, on full load, and
// whenever the content reflows (lazy images, fonts, async block data).
onMounted(() => {
  if (!embed.value || typeof window === 'undefined') return;
  const measure = (): number => {
    const el = document.querySelector('.block-preview');
    const h = el ? el.scrollHeight : document.documentElement.scrollHeight;
    return Math.max(1, Math.ceil(h));
  };
  const post = (): void => {
    window.parent?.postMessage(
      {
        type: 'cms-block-preview-size',
        key: blockKey.value,
        height: measure(),
      },
      '*',
    );
  };
  requestAnimationFrame(post);
  window.addEventListener('load', post);
  const ro = new ResizeObserver(post);
  ro.observe(document.documentElement);
  onBeforeUnmount(() => {
    ro.disconnect();
    window.removeEventListener('load', post);
  });
});

// Forward ?theme_preview so the block editor's iframe sees the DRAFT override
// (the API verifies the token and applies the draft; without it the published
// default is shown).
const themePreview = computed<string | null>(() => {
  const raw = route.query['theme_preview'];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
});

const { data: preview } = await useAsyncData(
  () => `block-preview:${blockKey.value}:${themePreview.value ?? 'live'}`,
  () =>
    cmsFetch<BlockPreviewPayload>(
      `/api/public/blocks/${encodeURIComponent(blockKey.value)}/preview`,
      themePreview.value ? { theme_preview: themePreview.value } : undefined,
    ),
  { watch: [blockKey, themePreview] },
);

// No throw when the block can't be shown: the API returns 422 for
// field/container/box blocks that can't render in isolation (or when there's
// no sample content), and 404 for an unknown/stale key — cmsFetch surfaces
// both as null. The Block Gallery iframes this route, so render a clean
// "No preview" card instead of a fatal error page either way.
const unavailable = computed(() => preview.value === null);

useHead(() => {
  const p = preview.value;
  return {
    title: p ? `Preview: ${p.label}` : 'Block preview',
    meta: [
      // This is an editor utility — keep it out of search indices entirely.
      { name: 'robots', content: 'noindex,nofollow' },
    ],
  };
});

// Same registry the live page route uses — guarantees the rendered preview
// is byte-identical to what a published page would show, modulo the data.
const registry = useBlockRegistry();
const component = computed(() => {
  const k = preview.value?.key;
  if (!k) return null;
  return registry[k] ?? null;
});
</script>

<template>
  <article v-if="preview" class="block-preview" :class="{ 'is-embed': embed }">
    <!-- Header strip — tells the editor this is a preview, names the block,
         and exposes the key as a copyable monospace token so block authors
         can match it against their registry definition. Hidden in embed mode
         (the Block Gallery's grid frames) so only the block itself shows. -->
    <header v-if="!embed" class="bp-head">
      <div class="bp-head-row">
        <span class="bp-eyebrow">Preview</span>
        <h1 class="bp-title">{{ preview.label }}</h1>
        <code class="bp-key">{{ preview.key }}</code>
      </div>
      <p class="bp-note">
        Rendered with the block's default field and binding values. Real
        pages can override every field per-instance from the page editor.
      </p>
      <div v-if="preview.error === 'load_failed'" class="bp-err">
        Could not load real content for this preview — the block is rendered
        with empty data so you can still see its visual shape.
      </div>
    </header>

    <!-- Block render — same registry the live page renderer uses, so this
         IS the production output (modulo the empty/default values). When
         the block key is missing from the local registry (out-of-sync admin
         + public deploys), show a friendly message instead of a blank slot. -->
    <div class="bp-body">
      <component
        :is="component"
        v-if="component"
        :fields="preview.fields"
        :options="preview.options"
        :data="preview.data"
      />
      <div v-else class="bp-missing">
        <p>
          <strong>Block component not registered.</strong>
          The API knows about <code>{{ preview.key }}</code>, but the public
          site doesn't have a matching Vue component yet. Add it under
          <code>apps/web/app/components/blocks/</code> and register it in
          <code>useBlockRegistry.ts</code>.
        </p>
      </div>
    </div>
  </article>

  <!-- Field/container/box blocks (or a fresh install with no sample content)
       can't render in isolation — the gallery shows this instead. -->
  <div v-else-if="unavailable" class="bp-unavailable">
    <div class="bp-unavailable-icon">▢</div>
    <div class="bp-unavailable-label">No preview</div>
    <p class="bp-unavailable-note">
      This block renders inside a page (it needs surrounding content), or there
      is no sample content to show it with yet.
    </p>
  </div>
</template>

<style scoped>
.block-preview {
  display: block;
  background: #fafafa;
  min-height: 100vh;
}

.bp-head {
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
  padding: 16px 24px;
  position: sticky;
  top: 0;
  z-index: 1;
}
.bp-head-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.bp-eyebrow {
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #6b7280;
}
.bp-title {
  font-size: 18px;
  font-weight: 700;
  margin: 0;
  color: #111827;
}
.bp-key {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12px;
  color: #6b7280;
  background: #f3f4f6;
  padding: 2px 7px;
  border-radius: 4px;
}
.bp-note {
  margin: 6px 0 0;
  font-size: 12.5px;
  color: #6b7280;
  line-height: 1.5;
  max-width: 56rem;
}
.bp-err {
  margin-top: 10px;
  padding: 8px 12px;
  border: 1px solid #fde68a;
  background: #fef3c7;
  border-radius: 6px;
  color: #92400e;
  font-size: 12.5px;
  line-height: 1.5;
}

.bp-body {
  padding: 24px 0;
}

/* Embed mode (gallery frames): no header, white canvas, and a flush body so
   full-bleed blocks (hero, archive hero) reach the frame edges. */
.block-preview.is-embed {
  background: #fff;
  min-height: auto;
}
.block-preview.is-embed .bp-body {
  padding: 0;
}

.bp-missing {
  max-width: 56rem;
  margin: 24px auto;
  padding: 16px 18px;
  background: #fff;
  border: 1px solid #fde68a;
  border-radius: 8px;
  color: #92400e;
  font-size: 13px;
  line-height: 1.55;
}
.bp-missing code {
  background: rgba(0, 0, 0, 0.06);
  padding: 1px 5px;
  border-radius: 3px;
  font-family: ui-monospace, SFMono-Regular, monospace;
}

.bp-unavailable {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  text-align: center;
  background: #fafafa;
  color: #9ca3af;
}
.bp-unavailable-icon {
  font-size: 32px;
  opacity: 0.5;
}
.bp-unavailable-label {
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #6b7280;
}
.bp-unavailable-note {
  margin: 0;
  max-width: 280px;
  font-size: 12px;
  line-height: 1.5;
}
</style>
