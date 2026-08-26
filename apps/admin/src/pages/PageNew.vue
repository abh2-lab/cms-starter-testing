<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { ApiError } from '@/lib/api';
import { pagesApi, type CreatePageInput } from '@/api/pages';
import { toast } from '@/composables/useToast';

// Type-chooser screen — ONE step now.
//
// Static → create a draft row and route into the static editor.
// Dynamic → create an EMPTY draft and route straight into the unified blocks
//   editor, where the template is chosen from a dropdown (WordPress-style) and
//   blocks are added/edited freely. No separate template-picker step.
//
// Placeholder slug "untitled-<shortid>" avoids the slug-uniqueness constraint
// on rapid taps; on a 409 we retry with a fresh short-id up to three times.

const router = useRouter();
const creating = ref<'static' | 'dynamic' | null>(null);

function shortId(len = 5): string {
  return Math.random()
    .toString(36)
    .slice(2, 2 + len)
    .padEnd(len, '0');
}

// Create a draft row with a unique slug + route into the matching editor.
async function createDraft(
  input: Omit<CreatePageInput, 'slug'>,
  routeName: 'page-edit-static' | 'page-edit-dynamic',
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = `untitled-${shortId()}`;
    try {
      const page = await pagesApi.create({ ...input, slug });
      await router.replace({ name: routeName, params: { id: page.id } });
      return;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && attempt < 2) continue;
      creating.value = null;
      toast.error(e instanceof Error ? e.message : 'Could not create the page');
      return;
    }
  }
  creating.value = null;
  toast.error('Could not allocate a unique slug after 3 attempts');
}

async function pick(type: 'static' | 'dynamic'): Promise<void> {
  if (creating.value) return;
  creating.value = type;
  if (type === 'static') {
    await createDraft(
      { type: 'static', title: 'Untitled page', layoutTemplate: 'default' },
      'page-edit-static',
    );
  } else {
    // Empty dynamic page → the editor's template dropdown seeds the blocks.
    await createDraft(
      { type: 'dynamic', title: 'Untitled page', blocks: [] },
      'page-edit-dynamic',
    );
  }
}
</script>

<template>
  <section class="page-new">
    <div class="page-new-wrap">
      <RouterLink :to="{ name: 'pages' }" class="back-link">
        ← Back to Pages
      </RouterLink>

      <h1 class="page-new-heading">
        What kind of page do you want to create?
      </h1>
      <p class="page-new-sub">
        You cannot change this after the page is created.
      </p>

      <div class="type-grid">
        <button
          type="button"
          class="type-card"
          :disabled="creating !== null"
          :aria-busy="creating === 'static'"
          @click="pick('static')"
        >
          <span class="tc-badge tc-badge--html">HTML</span>
          <div class="tc-icon tc-icon--static">📄</div>
          <div class="tc-name">Static Page</div>
          <div class="tc-desc">
            Write the content yourself — raw HTML or rich text. Good for pages
            that rarely change.
          </div>
          <div class="tc-pills">
            <span class="tc-pill">Privacy Policy</span>
            <span class="tc-pill">Terms</span>
            <span class="tc-pill">About Us</span>
            <span class="tc-pill">Contact</span>
          </div>
          <span v-if="creating === 'static'" class="tc-busy">Creating…</span>
        </button>

        <button
          type="button"
          class="type-card"
          :disabled="creating !== null"
          :aria-busy="creating === 'dynamic'"
          @click="pick('dynamic')"
        >
          <span class="tc-badge tc-badge--builder">Blocks</span>
          <div class="tc-icon tc-icon--dynamic">🧩</div>
          <div class="tc-name">Dynamic Page</div>
          <div class="tc-desc">
            Opens the editor where you pick a template from a dropdown, then add
            and edit each block's text and sources.
          </div>
          <div class="tc-pills">
            <span class="tc-pill">Homepage</span>
            <span class="tc-pill">Topic Hub</span>
            <span class="tc-pill">Author Profile</span>
            <span class="tc-pill">Promo Landing</span>
          </div>
          <span v-if="creating === 'dynamic'" class="tc-busy">Creating…</span>
        </button>
      </div>

      <p class="page-new-foot">
        ℹ️ Raw HTML is published as-is — paste trusted markup only.
      </p>
    </div>
  </section>
</template>

<style scoped>
.page-new {
  display: flex;
  justify-content: center;
}
.page-new-wrap {
  max-width: 44rem;
  width: 100%;
  margin: 2rem 0;
}
.back-link {
  display: inline-block;
  margin-bottom: 1rem;
  color: var(--muted);
  text-decoration: none;
  font-size: 0.8125rem;
}
.back-link:hover {
  color: var(--accent);
}
.page-new-heading {
  font-size: 1.375rem;
  font-weight: 700;
  margin: 0 0 0.375rem;
  color: var(--fg);
}
.page-new-sub {
  font-size: 0.875rem;
  color: var(--muted);
  margin: 0 0 1.75rem;
}
.type-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}
.type-card {
  position: relative;
  text-align: left;
  background: var(--surface);
  border: 2px solid var(--border);
  border-radius: 0.875rem;
  padding: 1.625rem 1.375rem;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
  font-family: inherit;
  color: var(--fg);
  display: block;
  width: 100%;
}
.type-card:not(:disabled):hover {
  border-color: var(--info, #2563eb);
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.07);
  transform: translateY(-2px);
}
.type-card:focus-visible {
  outline: none;
  border-color: var(--info, #2563eb);
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.15);
}
.type-card:disabled {
  opacity: 0.6;
  cursor: progress;
}
.tc-badge {
  position: absolute;
  top: 0.8rem;
  right: 0.8rem;
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.125rem 0.4375rem;
  border-radius: 999px;
}
.tc-badge--html {
  background: var(--warning-soft, #fef3c7);
  color: #92400e;
}
.tc-badge--builder {
  background: var(--purple-soft, #ede9fe);
  color: #5b21b6;
}
.tc-icon {
  width: 2.875rem;
  height: 2.875rem;
  border-radius: 0.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  margin-bottom: 0.75rem;
}
.tc-icon--static {
  background: #eff6ff;
}
.tc-icon--dynamic {
  background: var(--purple-soft, #ede9fe);
}
.tc-name {
  font-size: 1rem;
  font-weight: 700;
  margin-bottom: 0.3125rem;
  color: var(--fg);
}
.tc-desc {
  font-size: 0.78125rem;
  color: var(--muted);
  line-height: 1.55;
}
.tc-pills {
  margin-top: 0.6875rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.tc-pill {
  font-size: 0.65625rem;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--muted);
  padding: 0.125rem 0.4375rem;
  border-radius: 999px;
}
.tc-busy {
  display: inline-block;
  margin-top: 0.75rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--accent);
}
.page-new-foot {
  margin-top: 1rem;
  font-size: 0.75rem;
  color: var(--text-tertiary, var(--muted));
}

@media (max-width: 640px) {
  .type-grid {
    grid-template-columns: 1fr;
  }
}
</style>
