<script setup lang="ts">
import { RouterLink } from 'vue-router';
import Icon from '@/components/Icon.vue';

// Developer-facing guide for adding a new block to the dynamic page editor.
// Reachable from the Pages listing's "How to add blocks" button. The intent
// is to give a back-end engineer everything they need to ship a new block
// end-to-end without grepping the repo: which files to touch, which order
// to touch them in, what the data contracts are, and how the admin picks
// blocks up from the registry.
//
// This is a static documentation page — no API calls, no dynamic data —
// so it stays loadable even when the API is down.
</script>

<template>
  <section class="dbg">
    <div class="page-header">
      <div>
        <h1 class="page-title">How to add a new block</h1>
        <div class="page-subtitle">
          Developer guide for the dynamic page editor — schema, loader,
          render component, registry.
        </div>
      </div>
      <RouterLink :to="{ name: 'pages' }" class="btn btn-secondary">
        <Icon name="chevron-left" :size="13" />
        Back to Pages
      </RouterLink>
    </div>

    <!-- ─── Concepts ───────────────────────────────────────────────────── -->
    <div class="card dbg-card">
      <h2 class="dbg-h2">Concepts</h2>
      <p class="dbg-p">
        A <strong>block</strong> is one repeatable section on a dynamic page —
        a hero, a list of latest stories, a stat row. Editors drag blocks
        onto a page from the library on the left of the
        <RouterLink :to="{ name: 'pages' }">/pages</RouterLink> builder,
        reorder them, and fill in per-instance fields and bindings. The
        block itself is dev-shipped: there is no "create a block" button in
        the admin. To add one you ship code in two places.
      </p>
      <ul class="dbg-list">
        <li>
          <strong>Server half</strong> —
          <code>packages/blocks/src/blocks/&lt;key&gt;.ts</code> exports a
          <code>Block</code> object: metadata (label, fields, options) plus a
          pure <code>load(ctx, …)</code> function the API runs at request
          time to fetch the block's data.
        </li>
        <li>
          <strong>Render half</strong> —
          <code>apps/web/themes/default/app/components/blocks/Block&lt;Name&gt;.vue</code> is
          the Vue component that receives <code>fields</code>,
          <code>options</code>, and <code>data</code> as props and renders
          the visual.
        </li>
      </ul>
      <p class="dbg-p">
        Both halves are wired into one registry each — same string key. The
        admin auto-picks up the new block from the server registry the next
        time the dev server reloads; the public site picks it up from the
        web registry. Skip one half and the block either renders blank on
        the public site or doesn't show up in the admin library.
      </p>
    </div>

    <!-- ─── File map ────────────────────────────────────────────────────── -->
    <div class="card dbg-card">
      <h2 class="dbg-h2">Files you will touch</h2>
      <table class="dbg-files">
        <thead>
          <tr>
            <th>Step</th>
            <th>File</th>
            <th>What goes there</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><span class="dbg-step">1</span></td>
            <td><code>packages/blocks/src/blocks/&lt;key&gt;.ts</code> <span class="dbg-tag dbg-tag--new">new</span></td>
            <td>Metadata + <code>load()</code> function.</td>
          </tr>
          <tr>
            <td><span class="dbg-step">2</span></td>
            <td><code>packages/blocks/src/registry.ts</code></td>
            <td>Add the import + map entry so the API sees the block.</td>
          </tr>
          <tr>
            <td><span class="dbg-step">3</span></td>
            <td><code>apps/web/themes/default/app/components/blocks/Block&lt;Name&gt;.vue</code> <span class="dbg-tag dbg-tag--new">new</span></td>
            <td>The visual component.</td>
          </tr>
          <tr>
            <td><span class="dbg-step">4</span></td>
            <td><code>apps/web/themes/default/app/composables/useBlockRegistry.ts</code></td>
            <td>Import the component and add it under the same key.</td>
          </tr>
          <tr>
            <td><span class="dbg-step">5</span></td>
            <td>Rebuild + reload</td>
            <td><code>pnpm --filter @cms/blocks build</code>, then restart the API and admin dev servers.</td>
          </tr>
        </tbody>
      </table>
      <p class="dbg-hint">
        <strong>Key rule:</strong> the same lowercase-dashed identifier (e.g.
        <code>hero</code>, <code>impact-stats</code>) is used in
        <code>meta.key</code>, the server registry map, and the web registry
        map. The admin uses this key to match the dragged library card to
        the right Vue component at render time.
      </p>
    </div>

    <!-- ─── Step 1: metadata + loader ──────────────────────────────────── -->
    <div class="card dbg-card">
      <h2 class="dbg-h2">
        <span class="dbg-step dbg-step--lg">1</span>
        Define metadata and the loader
      </h2>
      <p class="dbg-p">
        Open a new file <code>packages/blocks/src/blocks/related-stories.ts</code>
        and export a <code>Block</code>. The shape is:
      </p>
      <pre class="dbg-code"><code>import type { Block } from '../types.js';

interface RelatedStoriesFields &#123;
  heading?: string;
&#125;
interface RelatedStoriesOptions &#123;
  content_type?: string;
  category?: string;
  count?: number;
&#125;

export const relatedStories: Block&lt;RelatedStoriesFields, RelatedStoriesOptions&gt; = &#123;
  meta: &#123;
    // Used as the block_key on every page that places this block AND as the
    // lookup key in the web registry. Lowercase + dashes only.
    key: 'related-stories',
    label: 'Related Stories',
    category: 'lists',                // shows under the Lists tab in the library
    description: 'Latest items from a content type, filtered by category.',

    // Editor-typed text. Surfaces under "Copy — text you write" in the
    // placed-block card. Each field becomes one input in the right rail.
    fields: [
      &#123; key: 'heading', label: 'Section heading', type: 'short_text', default: 'You may also like' &#125;,
    ],

    // Data bindings — pickers, not free text. Surfaces under "Data Bindings".
    options: [
      &#123;
        key: 'content_type',
        label: 'Content type',
        type: 'content_type_slug',   // → ContentTypeSlugField picker
        required: true,
        default: 'article',
      &#125;,
      &#123;
        key: 'category',
        label: 'Category filter',
        type: 'category_slug',       // → CategorySlugField picker
        helpText: 'Optional — leave blank to pull from every category.',
      &#125;,
      &#123;
        key: 'count',
        label: 'How many to show',
        type: 'number',
        default: 4,
        min: 1,
        max: 12,
      &#125;,
    ],
  &#125;,

  // Pure async function. ctx is created by the API for every request — the
  // block CANNOT import @cms/db directly. fetchContent + fetchArchive
  // already apply the published-and-in-window visibility filter, so a block
  // never accidentally surfaces a draft.
  async load(ctx, &#123; options &#125;) &#123;
    const typeSlug = options.content_type ?? 'article';
    const count = Math.max(1, Math.min(12, Number(options.count) || 4));
    const items = await ctx.fetchArchive(&#123;
      typeSlug,
      count,
      ...(options.category ? &#123; category: options.category &#125; : &#123;&#125;),
    &#125;);
    return &#123; items &#125;;
  &#125;,
&#125;;</code></pre>
      <p class="dbg-hint">
        <strong>The <code>load()</code> contract:</strong> return an object,
        or <code>null</code> for "this block has no data to render" (the
        empty-state path). The composer wraps every load in try/catch — a
        thrown error degrades just THAT block to a placeholder; it never
        500s the whole page.
      </p>
    </div>

    <!-- ─── Step 2: register on the server ─────────────────────────────── -->
    <div class="card dbg-card">
      <h2 class="dbg-h2">
        <span class="dbg-step dbg-step--lg">2</span>
        Register the block on the server
      </h2>
      <p class="dbg-p">
        Edit <code>packages/blocks/src/registry.ts</code>. Add an import and
        an entry to <code>blockRegistry</code>:
      </p>
      <pre class="dbg-code"><code>import &#123; relatedStories &#125; from './blocks/related-stories.js';

export const blockRegistry: ReadonlyMap&lt;string, Block&gt; = new Map&lt;string, Block&gt;([
  [hero.meta.key, hero],
  [latestNews.meta.key, latestNews],
  [featuredArticle.meta.key, featuredArticle],
  [impactStats.meta.key, impactStats],
  [relatedStories.meta.key, relatedStories],   // ← new
]);</code></pre>
      <p class="dbg-p">
        This is what the API's <code>GET /admin/blocks</code> endpoint
        iterates — the admin library list comes from this map. The same
        registry also powers the per-block preview endpoint
        <code>GET /api/public/blocks/:key/preview</code>, so the "Preview"
        button on the library card works immediately.
      </p>
    </div>

    <!-- ─── Step 3: render component ───────────────────────────────────── -->
    <div class="card dbg-card">
      <h2 class="dbg-h2">
        <span class="dbg-step dbg-step--lg">3</span>
        Build the render component
      </h2>
      <p class="dbg-p">
        Create
        <code>apps/web/themes/default/app/components/blocks/BlockRelatedStories.vue</code>.
        The component receives three props — the contract is fixed:
      </p>
      <pre class="dbg-code"><code>&lt;script setup lang="ts"&gt;
defineProps&lt;&#123;
  // Editor-typed text from meta.fields. Whatever the page editor entered.
  fields: &#123; heading?: string &#125;;
  // Binding selections from meta.options. Slugs as strings, count as number.
  options: &#123; content_type?: string; category?: string; count?: number &#125;;
  // Loader output — the object your load() returned, or null on degraded state.
  data: &#123; items: Array&lt;&#123; id: string; title: string; slug: string &#125;&gt; &#125; | null;
&#125;&gt;();
&lt;/script&gt;

&lt;template&gt;
  &lt;section v-if="data?.items?.length" class="related-stories"&gt;
    &lt;h2&gt;&#123;&#123; fields.heading ?? 'You may also like' &#125;&#125;&lt;/h2&gt;
    &lt;ul&gt;
      &lt;li v-for="item in data.items" :key="item.id"&gt;
        &lt;NuxtLink :to="`/article/$&#123;item.slug&#125;`"&gt;&#123;&#123; item.title &#125;&#125;&lt;/NuxtLink&gt;
      &lt;/li&gt;
    &lt;/ul&gt;
  &lt;/section&gt;
  &lt;div v-else class="empty"&gt;
    No related stories for the current selection.
  &lt;/div&gt;
&lt;/template&gt;</code></pre>
      <p class="dbg-hint">
        <strong>Always handle the null-data case.</strong> An editor may
        place the block on a page before they've picked a content type, or
        the chosen content type may have no published rows yet. Rendering a
        small inline placeholder is better than rendering nothing — the
        editor knows immediately what's missing.
      </p>
    </div>

    <!-- ─── Step 4: register on the web ────────────────────────────────── -->
    <div class="card dbg-card">
      <h2 class="dbg-h2">
        <span class="dbg-step dbg-step--lg">4</span>
        Register the component on the public site
      </h2>
      <p class="dbg-p">
        Edit
        <code>apps/web/themes/default/app/composables/useBlockRegistry.ts</code> — import
        the component and add it to <code>BLOCK_REGISTRY</code> under the
        same string key as the server side:
      </p>
      <pre class="dbg-code"><code>import BlockRelatedStories from '~/components/blocks/BlockRelatedStories.vue';

export const BLOCK_REGISTRY: Readonly&lt;Record&lt;string, Component&gt;&gt; = &#123;
  hero: BlockHero as Component,
  'latest-news': BlockLatestNews as Component,
  'featured-article': BlockFeaturedArticle as Component,
  'impact-stats': BlockImpactStats as Component,
  'related-stories': BlockRelatedStories as Component,   // ← new
&#125;;</code></pre>
      <p class="dbg-p">
        Mismatched keys are the most common bug — the admin shows the block
        in the library, the page composes fine on the API, and then the
        public render skips it because the registry lookup misses. If a
        block fails to render but no error appears, check that the key here
        exactly matches <code>meta.key</code>.
      </p>
    </div>

    <!-- ─── Step 5: rebuild + reload ───────────────────────────────────── -->
    <div class="card dbg-card">
      <h2 class="dbg-h2">
        <span class="dbg-step dbg-step--lg">5</span>
        Rebuild and reload
      </h2>
      <p class="dbg-p">
        <code>@cms/blocks</code> compiles to <code>dist/</code>; both the
        API and the admin consume the built output. After editing the
        types or adding a new block, rebuild the package:
      </p>
      <pre class="dbg-code"><code>pnpm --filter @cms/blocks build</code></pre>
      <p class="dbg-p">
        Then restart the API and admin dev servers so they pick up the
        rebuilt <code>dist/index.d.ts</code> and <code>dist/index.js</code>.
        The web app picks up its own component change via Nuxt HMR — no
        restart needed.
      </p>
      <p class="dbg-hint">
        <strong>Verify end-to-end:</strong> open
        <RouterLink :to="{ name: 'pages' }">/pages</RouterLink>, edit any
        dynamic page, and confirm the new block appears in the library
        under the category you set. Hover its card and click "Preview" —
        the new tab should render your component with default values.
      </p>
    </div>

    <!-- ─── Where the data comes from ─────────────────────────────────── -->
    <div class="card dbg-card">
      <h2 class="dbg-h2">Where the data comes from</h2>
      <p class="dbg-p">
        Bindings on a block point at rows the admin creates in two other
        places. The admin pickers populate themselves from the same APIs
        the public site reads at render time — no separate sync step.
      </p>
      <table class="dbg-files">
        <thead>
          <tr>
            <th>Field type</th>
            <th>Picker</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>content_type_slug</code></td>
            <td>Live select</td>
            <td>
              <RouterLink :to="{ name: 'content-types' }">/content-types</RouterLink>
              — what kinds of content exist (Article, Story, Event…).
            </td>
          </tr>
          <tr>
            <td><code>content_slug</code></td>
            <td>Live select</td>
            <td>
              <RouterLink :to="{ name: 'content' }">/content</RouterLink>
              — the actual published rows of the resolved content type.
            </td>
          </tr>
          <tr>
            <td><code>category_slug</code></td>
            <td>Live select (optgrouped)</td>
            <td>
              <RouterLink :to="{ name: 'taxonomies' }">/taxonomies</RouterLink>
              — every term across every taxonomy.
            </td>
          </tr>
          <tr>
            <td><code>short_text</code> / <code>long_text</code> / <code>url</code></td>
            <td>Plain input</td>
            <td>What the editor types. Saved verbatim onto the page row.</td>
          </tr>
          <tr>
            <td><code>select</code></td>
            <td>Plain &lt;select&gt;</td>
            <td>Options come from <code>field.options: string[]</code> in the schema.</td>
          </tr>
          <tr>
            <td><code>kv_list</code></td>
            <td>Repeater</td>
            <td>For label/value rows like Impact Stats. Stored as an array.</td>
          </tr>
          <tr>
            <td><code>number</code> / <code>boolean</code></td>
            <td>Number input / checkbox</td>
            <td>Self-explanatory. <code>min</code>/<code>max</code> tighten the input.</td>
          </tr>
        </tbody>
      </table>
      <p class="dbg-p">
        So the path is: an editor creates an Article under
        <RouterLink :to="{ name: 'content' }">/content</RouterLink>, the
        block's <code>content_slug</code> binding lists it in the picker,
        the editor selects it, and at render time the API calls your
        <code>load()</code> which in turn calls
        <code>ctx.fetchContent('article', selectedSlug)</code> to hydrate
        the component's <code>data</code> prop.
      </p>
    </div>

    <!-- ─── Common pitfalls ────────────────────────────────────────────── -->
    <div class="card dbg-card">
      <h2 class="dbg-h2">Common pitfalls</h2>
      <ul class="dbg-list">
        <li>
          <strong>Forgetting to rebuild <code>@cms/blocks</code>.</strong>
          The admin and API import the compiled <code>dist/</code>, not the
          source. Type-check passes locally but the running API still sees
          the old shape. Re-run
          <code>pnpm --filter @cms/blocks build</code>.
        </li>
        <li>
          <strong>Key drift between server and web registries.</strong>
          Same string both sides. The lookup is a literal key match — no
          fuzzy fallback.
        </li>
        <li>
          <strong>Importing <code>@cms/db</code> in a block loader.</strong>
          Don't. Blocks are portable; they only know about
          <code>BlockLoadContext</code>. If you need new data, extend the
          context in
          <code>apps/api/src/lib/block-context.ts</code> with a new helper.
        </li>
        <li>
          <strong>Returning <code>undefined</code> from <code>load()</code>.</strong>
          Return <code>null</code> when there's nothing to render. The
          composer coerces undefined to null defensively, but it's a code
          smell.
        </li>
        <li>
          <strong>Forgetting the null-data branch in the Vue component.</strong>
          A binding-bound block on a fresh page has no chosen slug yet.
          Render an inline placeholder instead of nothing so editors
          notice.
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.dbg {
  padding-bottom: 32px;
}
.dbg-card {
  margin-bottom: 16px;
}
.dbg-h2 {
  font-size: 16px;
  font-weight: 700;
  margin: 0 0 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--fg);
}

.dbg-p {
  font-size: 13.5px;
  line-height: 1.65;
  color: var(--fg);
  margin: 0 0 12px;
}
.dbg-p:last-child {
  margin-bottom: 0;
}
.dbg-p code,
.dbg-list code,
.dbg-files code {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12.5px;
  background: var(--bg);
  border: 1px solid var(--border);
  padding: 1px 5px;
  border-radius: 3px;
  color: var(--fg);
}

.dbg-list {
  margin: 0 0 12px;
  padding-left: 18px;
}
.dbg-list li {
  font-size: 13.5px;
  line-height: 1.65;
  color: var(--fg);
  margin-bottom: 8px;
}
.dbg-list li:last-child {
  margin-bottom: 0;
}

.dbg-hint {
  background: var(--info-soft);
  border: 1px solid #bfdbfe;
  border-radius: var(--radius);
  padding: 10px 12px;
  font-size: 12.5px;
  line-height: 1.6;
  color: #1e3a8a;
  margin: 12px 0 0;
}
.dbg-hint strong {
  color: #1e3a8a;
}
.dbg-hint code {
  background: rgba(255, 255, 255, 0.6);
  border-color: rgba(30, 58, 138, 0.15);
  color: #1e3a8a;
}

.dbg-files {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 12px;
}
.dbg-files th {
  text-align: left;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
  padding: 8px 10px;
  background: var(--table-head);
  border-bottom: 1px solid var(--border);
}
.dbg-files td {
  font-size: 12.5px;
  color: var(--fg);
  padding: 9px 10px;
  border-bottom: 1px solid var(--border-soft);
  vertical-align: top;
  line-height: 1.55;
}
.dbg-files tr:last-child td {
  border-bottom: none;
}
.dbg-files th:first-child,
.dbg-files td:first-child {
  width: 60px;
}

.dbg-step {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--bg);
  color: var(--muted);
  font-size: 11px;
  font-weight: 700;
  border: 1px solid var(--border);
}
.dbg-step--lg {
  width: 28px;
  height: 28px;
  font-size: 13px;
  background: var(--fg);
  color: var(--surface);
  border-color: var(--fg);
}

.dbg-tag {
  display: inline-block;
  font-size: 9.5px;
  font-weight: 700;
  text-transform: uppercase;
  padding: 1px 5px;
  border-radius: 3px;
  margin-left: 4px;
  letter-spacing: 0.04em;
  vertical-align: 1px;
}
.dbg-tag--new {
  background: var(--success-soft);
  color: #065f46;
}

.dbg-code {
  background: #111827;
  color: #f9fafb;
  border-radius: var(--radius);
  padding: 14px 16px;
  overflow-x: auto;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12px;
  line-height: 1.6;
  margin: 0 0 12px;
}
.dbg-code code {
  background: none;
  border: none;
  padding: 0;
  color: inherit;
  font-size: inherit;
  white-space: pre;
}

[data-theme='dark'] .dbg-hint {
  background: rgba(59, 130, 246, 0.12);
  border-color: rgba(96, 165, 250, 0.3);
  color: #93c5fd;
}
[data-theme='dark'] .dbg-hint strong,
[data-theme='dark'] .dbg-hint code {
  color: #bfdbfe;
}
[data-theme='dark'] .dbg-hint code {
  background: rgba(0, 0, 0, 0.3);
  border-color: rgba(147, 197, 253, 0.15);
}
</style>
