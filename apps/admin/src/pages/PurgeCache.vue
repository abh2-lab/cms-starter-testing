<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { cacheApi, type WebPurgeResult } from '@/api/cache';
import { contentTypesApi, type ContentType } from '@/api/content-types';
import { toast } from '@/composables/useToast';
import { useConfirm } from '@/composables/useConfirm';

const { confirm } = useConfirm();

// Content types for the "clear one type" dropdown, loaded live so the list
// always matches what exists in the CMS today.
const types = ref<ContentType[]>([]);
const typesLoading = ref(true);
const typesError = ref<string | null>(null);
const selectedSlug = ref('');

// Which action is running right now ('all' | 'content-type' | 'web'), or null.
// Drives the per-button "Clearing…" label and disables every button while any
// one purge is in flight so a user can't fire two at once.
const busy = ref<string | null>(null);

// Plain-English reason the website page cache didn't clear, for the toast. The
// server reports this so a silent production failure (the common cause of "my
// change still isn't visible") is shown instead of a false success.
type WebFail = Extract<WebPurgeResult, { ok: false }>;
function webFailReason(web: WebFail): string {
  switch (web.reason) {
    case 'disabled':
      return "the purge secret (PURGE_SECRET) isn't set on the API server";
    case 'no_site_url':
      return "the Site URL isn't set (Settings → Site Settings)";
    case 'http_error':
      return web.status === 404
        ? 'the website server has no purge secret set'
        : web.status === 401
          ? "the purge secret doesn't match between the API and the website"
          : `the website returned an error (status ${web.status ?? '?'})`;
    case 'unreachable':
      return "the API couldn't reach the website (check the Site URL / internal URL)";
    default:
      return 'the website page cache could not be cleared';
  }
}

async function loadTypes(): Promise<void> {
  typesLoading.value = true;
  typesError.value = null;
  try {
    const res = await contentTypesApi.list();
    types.value = [...res.data].sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    typesError.value =
      e instanceof Error ? e.message : 'Failed to load content types';
  } finally {
    typesLoading.value = false;
  }
}

async function purgeEverything(): Promise<void> {
  const ok = await confirm({
    title: 'Clear all caches?',
    message:
      'This empties every cached copy for this site — the data cache and the ' +
      'saved website pages. No real content is deleted; pages just rebuild on ' +
      'the next visit, so the site may be slightly slower for a moment.',
    confirmLabel: 'Clear everything',
    tone: 'danger',
  });
  if (!ok) return;
  busy.value = 'all';
  try {
    const res = await cacheApi.purge({ scope: 'all' });
    const web = res.data.web;
    if (web.ok) {
      toast.success('All caches cleared');
    } else {
      toast.warning(
        `Data cache cleared, but the website page cache was NOT: ${webFailReason(web)}. ` +
          'Home, stories and archive pages may stay old for up to 5 minutes.',
        { timeout: 9000 },
      );
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not clear caches');
  } finally {
    busy.value = null;
  }
}

async function purgeType(): Promise<void> {
  if (!selectedSlug.value) return;
  busy.value = 'content-type';
  try {
    const res = await cacheApi.purge({
      scope: 'content-type',
      slug: selectedSlug.value,
    });
    const name =
      types.value.find((t) => t.slug === selectedSlug.value)?.name ??
      selectedSlug.value;
    const web = res.data.web;
    if (web.ok) {
      toast.success(`Cache cleared for "${name}"`);
    } else {
      toast.warning(
        `Data cache cleared for "${name}", but the website page cache was NOT: ` +
          `${webFailReason(web)}.`,
        { timeout: 9000 },
      );
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not clear this type');
  } finally {
    busy.value = null;
  }
}

async function purgeWeb(): Promise<void> {
  busy.value = 'web';
  try {
    const res = await cacheApi.purge({ scope: 'web' });
    const web = res.data.web;
    if (web.ok) {
      toast.success(
        `Website page cache cleared (${web.purged} ${web.purged === 1 ? 'entry' : 'entries'})`,
      );
    } else {
      toast.error(`Website page cache NOT cleared: ${webFailReason(web)}.`, {
        timeout: 9000,
      });
    }
  } catch (e) {
    toast.error(
      e instanceof Error ? e.message : 'Could not clear the page cache',
    );
  } finally {
    busy.value = null;
  }
}

onMounted(loadTypes);
</script>

<template>
  <section>
    <header class="page-header">
      <div>
        <h1 class="page-title">Purge Cache</h1>
        <p class="page-subtitle">
          Clear saved copies so your latest changes show right away. This never
          deletes real content — pages just rebuild on the next visit.
        </p>
      </div>
    </header>

    <div class="tool-grid">
      <!-- 1. Clear everything -->
      <div class="card tool-card">
        <div class="card-title">Clear everything (this site)</div>
        <p class="tool-desc">
          Empties every cached copy for this site: stories, listings, pages,
          menus, theme, search — plus the saved website pages. Use this after a
          big change or a re-seed when you want a clean slate.
        </p>
        <div class="tool-actions">
          <button
            type="button"
            class="btn btn-danger"
            :disabled="busy !== null"
            @click="purgeEverything"
          >
            {{ busy === 'all' ? 'Clearing…' : 'Clear everything' }}
          </button>
        </div>
      </div>

      <!-- 2. Clear one content type -->
      <div class="card tool-card">
        <div class="card-title">Clear one content type</div>
        <p class="tool-desc">
          Clear just one kind of content and its listings — for example after
          editing several stories. Everything else stays cached.
        </p>
        <p v-if="typesError" class="tool-error">{{ typesError }}</p>
        <div class="tool-actions">
          <select
            v-model="selectedSlug"
            class="form-select tool-select"
            :disabled="typesLoading || busy !== null"
          >
            <option value="" disabled>
              {{ typesLoading ? 'Loading types…' : 'Choose a type…' }}
            </option>
            <option v-for="t in types" :key="t.id" :value="t.slug">
              {{ t.name }}
            </option>
          </select>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="!selectedSlug || busy !== null"
            @click="purgeType"
          >
            {{ busy === 'content-type' ? 'Clearing…' : 'Clear this type' }}
          </button>
        </div>
      </div>

      <!-- 3. Clear website page cache -->
      <div class="card tool-card">
        <div class="card-title">Clear website page cache</div>
        <p class="tool-desc">
          Clears only the finished website pages (home, stories, archive) and
          link-preview cards — not the data cache.
        </p>
        <p class="form-hint">
          This needs the site's purge secret configured on the server. If it
          can't clear, the button now tells you exactly why.
        </p>
        <div class="tool-actions">
          <button
            type="button"
            class="btn btn-secondary"
            :disabled="busy !== null"
            @click="purgeWeb"
          >
            {{ busy === 'web' ? 'Clearing…' : 'Clear page cache' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.tool-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 720px;
}
.tool-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.tool-desc {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
  line-height: 1.5;
}
.tool-error {
  margin: 0;
  font-size: 13px;
  color: var(--danger);
}
.tool-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 4px;
}
/* The global .form-select is width:100%; keep it compact next to its button. */
.tool-select {
  width: auto;
  min-width: 220px;
  flex: 0 1 260px;
}
</style>
