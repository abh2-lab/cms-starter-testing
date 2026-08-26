<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import Icon from '@/components/Icon.vue';
import {
  themeApi,
  type ThemeMeta,
  type ThemeRoute,
  type ThemeStructureEntry,
} from '@/api/theme';
import { pageTemplatesApi, type PageTemplate } from '@/api/page-templates';
import { toast } from '@/composables/useToast';
import { useConfirm } from '@/composables/useConfirm';
import { useAuthStore } from '@/stores/auth';

// Theme Settings — the single home for everything theme-level (replaces the
// standalone "Templates & Parts" list). Four cards: Active Theme (read-only),
// Templates & Parts (the FSE override list → opens the unified editor),
// Page Templates (the dynamic-editor's reusable layouts), and Theme & System
// Routes (moved here from the Pages list). Lives under STRUCTURE, admin+.

const { confirm } = useConfirm();
const auth = useAuthStore();

const publicOrigin = computed<string | null>(() => {
  const u = auth.publicWebUrl;
  return u && u.length > 0 ? u.replace(/\/$/, '') : null;
});

const meta = ref<ThemeMeta | null>(null);
const entries = ref<ThemeStructureEntry[]>([]);
const pageTemplates = ref<PageTemplate[]>([]);
const routes = ref<ThemeRoute[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const busyKey = ref<string | null>(null);
const viewKey = ref<string | null>(null);

async function loadAll(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const [metaRes, structRes, tplRes, routesRes] = await Promise.all([
      themeApi.meta().catch(() => null),
      themeApi.structure(),
      pageTemplatesApi.list().catch(() => ({ data: [] as PageTemplate[] })),
      themeApi.routes().catch(() => ({ data: [] as ThemeRoute[] })),
    ]);
    meta.value = metaRes?.data ?? null;
    entries.value = structRes.data;
    pageTemplates.value = tplRes.data;
    routes.value = routesRes.data;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load theme settings';
  } finally {
    loading.value = false;
  }
}
onMounted(loadAll);

const templates = computed(() => entries.value.filter((e) => e.kind === 'template'));
const parts = computed(() => entries.value.filter((e) => e.kind === 'part'));

function statusOf(e: ThemeStructureEntry): { label: string; cls: string } {
  if (e.updateAvailable) return { label: 'Update available', cls: 'chip-update' };
  if (e.hasDraft) return { label: 'Draft', cls: 'chip-draft' };
  if (e.customized) return { label: 'Customized', cls: 'chip-custom' };
  return { label: 'Default', cls: 'chip-default' };
}

async function resetEntry(e: ThemeStructureEntry): Promise<void> {
  const ok = await confirm({
    title: 'Reset to default',
    message: `Reset "${e.name}" to the theme default? The published override and any draft are deleted, and the public site reverts immediately.`,
    confirmLabel: 'Reset',
    tone: 'danger',
  });
  if (!ok) return;
  busyKey.value = e.key;
  try {
    await themeApi.reset(e.key);
    toast.success('Reset to default');
    await loadAll();
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Reset failed');
  } finally {
    busyKey.value = null;
  }
}

const starterTemplates = computed(() =>
  pageTemplates.value.filter((t) => t.source === 'code'),
);
const userTemplates = computed(() =>
  pageTemplates.value.filter((t) => t.source === 'user'),
);

async function deleteTemplate(t: PageTemplate): Promise<void> {
  if (!t.id) return;
  const ok = await confirm({
    title: 'Delete template',
    message: `Delete the saved template "${t.name}"? Pages already built from it are unaffected.`,
    confirmLabel: 'Delete',
    tone: 'danger',
  });
  if (!ok) return;
  try {
    await pageTemplatesApi.remove(t.id);
    toast.success('Template deleted');
    await loadAll();
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Delete failed');
  }
}

// Routes whose URL is drawn by an editable template open it in the editor;
// everything else keeps "View on site" / "Manage".
const ROUTE_TEMPLATE: Record<string, string> = {
  '/:category/:article': 'single-article',
  '/:category': 'archive-category',
};
function editableTemplateFor(r: ThemeRoute): string | null {
  return ROUTE_TEMPLATE[r.path] ?? null;
}
function onViewRoute(r: ThemeRoute): void {
  if (!publicOrigin.value) {
    toast.error('Public site URL is not configured — set Site URL in Site Settings.');
    return;
  }
  if (!r.viewPath) return;
  window.open(`${publicOrigin.value}${r.viewPath}`, '_blank', 'noopener,noreferrer');
}

// "View on site" for a Templates & Parts row: ask the API for a representative
// live path this template renders (latest article, first category/tag, /authors,
// the homepage for parts, …), then open it. Null = nothing published stands the
// template up yet.
async function onViewTemplate(e: ThemeStructureEntry): Promise<void> {
  if (!publicOrigin.value) {
    toast.error('Public site URL is not configured — set Site URL in Site Settings.');
    return;
  }
  viewKey.value = e.key;
  try {
    const { data } = await themeApi.viewUrl(e.key);
    if (!data.path) {
      toast.error('Publish an article first to preview this template on the site.');
      return;
    }
    window.open(`${publicOrigin.value}${data.path}`, '_blank', 'noopener,noreferrer');
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Could not resolve a page to view.');
  } finally {
    viewKey.value = null;
  }
}
</script>

<template>
  <section class="theme-settings">
    <div class="page-header">
      <div>
        <h1 class="page-title">Theme Settings</h1>
        <div class="page-subtitle">
          Manage your theme — templates, parts, and the routes it serves.
        </div>
      </div>
    </div>

    <div v-if="error" class="ts-banner ts-banner--error">{{ error }}</div>
    <div v-if="loading" class="ts-banner">Loading…</div>

    <template v-else>
      <!-- ── Card 1: Active Theme ─────────────────────────────────────────── -->
      <section class="card ts-card">
        <div class="ts-card-head">
          <h2 class="ts-card-title">Active Theme</h2>
        </div>
        <div class="ts-card-body ts-theme-identity">
          <div class="ts-thumb">Preview</div>
          <div class="ts-theme-meta">
            <div class="ts-theme-name">{{ meta?.name ?? 'Default' }}</div>
            <div class="ts-theme-version">Version {{ meta?.version ?? '1.0.0' }}</div>
            <p class="ts-theme-desc">{{ meta?.description }}</p>
            <p class="ts-theme-note">
              <Icon name="info" :size="12" />
              Themes are installed by your developer.
            </p>
          </div>
        </div>
      </section>

      <!-- ── Card 2: Templates & Parts ────────────────────────────────────── -->
      <section class="card ts-card">
        <div class="ts-card-head">
          <h2 class="ts-card-title">Templates &amp; Parts</h2>
          <p class="ts-card-sub">
            Layouts your theme provides. Edit them to customise how pages and
            articles look.
          </p>
        </div>
        <table class="ts-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>Status</th>
              <th>Last edited by</th>
              <th class="ts-th-actions"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in [...templates, ...parts]" :key="e.key">
              <td>
                <div class="ts-item-name">{{ e.name }}</div>
                <div class="ts-item-meta">{{ e.description }}</div>
              </td>
              <td>
                <span class="chip" :class="e.kind === 'part' ? 'chip-part' : 'chip-template'">
                  {{ e.kind === 'part' ? 'Part' : 'Template' }}
                </span>
              </td>
              <td>
                <span class="chip" :class="statusOf(e).cls">{{ statusOf(e).label }}</span>
              </td>
              <td>
                <template v-if="e.lastEditedBy">
                  <span class="ts-editor">{{ e.lastEditedBy.name ?? '—' }}</span>
                  <span v-if="e.lastEditedBy.at" class="ts-editor-date">
                    {{ new Date(e.lastEditedBy.at).toLocaleDateString() }}
                  </span>
                </template>
                <span v-else class="ts-dash">—</span>
              </td>
              <td>
                <div class="ts-actions">
                  <button
                    type="button"
                    class="btn-sm btn-ghost"
                    :disabled="viewKey === e.key"
                    @click="onViewTemplate(e)"
                  >
                    <Icon name="external" :size="12" /> View on site
                  </button>
                  <RouterLink
                    class="btn-sm btn-ghost"
                    :to="{ name: 'structure-edit', params: { key: e.key } }"
                  >Edit</RouterLink>
                  <button
                    v-if="e.customized || e.hasDraft"
                    type="button"
                    class="btn-sm btn-danger-ghost"
                    :disabled="busyKey === e.key"
                    @click="resetEntry(e)"
                  >Reset</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="ts-footnote">
          Edits override the theme's default. Resetting restores exactly what
          shipped with the theme.
        </div>
      </section>

      <!-- ── Card 3: Page Templates ───────────────────────────────────────── -->
      <section class="card ts-card">
        <div class="ts-card-head">
          <h2 class="ts-card-title">Page Templates</h2>
          <p class="ts-card-sub">
            Reusable layouts the dynamic page editor offers when you create a
            page. Save one from any page in the editor.
          </p>
        </div>
        <div class="ts-card-body ts-rows">
          <div
            v-for="t in [...starterTemplates, ...userTemplates]"
            :key="t.key"
            class="ts-tpl-row"
          >
            <Icon name="layers" :size="16" class="ts-tpl-icon" />
            <div class="ts-tpl-info">
              <div class="ts-tpl-name">{{ t.name }}</div>
              <div class="ts-tpl-meta">
                {{ t.blockKeys.length }} block{{ t.blockKeys.length === 1 ? '' : 's' }}
                · {{ t.source === 'code' ? 'Starter template' : 'Saved by your team' }}
              </div>
            </div>
            <span class="chip" :class="t.source === 'code' ? 'chip-starter' : 'chip-mine'">
              {{ t.source === 'code' ? 'Starter' : 'My template' }}
            </span>
            <button
              v-if="t.source === 'user'"
              type="button"
              class="btn-sm btn-danger-ghost"
              @click="deleteTemplate(t)"
            >Delete</button>
            <button
              v-else
              type="button"
              class="btn-sm btn-ghost"
              disabled
              title="Starter templates ship with the theme and cannot be deleted"
            >Delete</button>
          </div>
          <p v-if="pageTemplates.length === 0" class="ts-empty">
            No page templates available.
          </p>
        </div>
        <div class="ts-footnote">
          Starter templates ship with the theme and cannot be deleted.
        </div>
      </section>

      <!-- ── Card 4: Theme & System Routes (moved from Pages) ─────────────── -->
      <section v-if="routes.length" class="card ts-card">
        <div class="ts-card-head">
          <h2 class="ts-card-title">Theme &amp; System Routes</h2>
          <p class="ts-card-sub">
            URLs your site serves from the theme's code. Where a URL is drawn by
            an editable template you can open it in the editor.
          </p>
        </div>
        <div class="ts-card-body ts-rows">
          <div v-for="r in routes" :key="r.path" class="ts-route-row">
            <div class="ts-route-info">
              <div class="ts-route-name-row">
                <span class="ts-route-name">{{ r.label }}</span>
                <span class="ts-route-kind">
                  {{ r.kind === 'singleton' ? 'page' : 'template' }}
                </span>
                <span class="ts-route-driver">{{ r.drivenBy }}</span>
              </div>
              <code class="ts-route-path">{{ r.path }}</code>
              <div class="ts-route-desc">{{ r.description }}</div>
            </div>
            <div class="ts-actions">
              <RouterLink
                v-if="editableTemplateFor(r)"
                class="btn-sm btn-ghost"
                :to="{ name: 'structure-edit', params: { key: editableTemplateFor(r) } }"
              >Edit</RouterLink>
              <button
                v-if="r.viewPath"
                type="button"
                class="btn-sm btn-ghost"
                @click="onViewRoute(r)"
              >
                <Icon name="external" :size="12" /> View on site
              </button>
              <RouterLink
                v-if="r.manage && !editableTemplateFor(r)"
                :to="{ name: r.manage.routeName }"
                class="ts-route-manage"
              >{{ r.manage.label }} →</RouterLink>
            </div>
          </div>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.theme-settings {
  max-width: 980px;
}
.ts-banner {
  padding: 10px 14px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface);
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 14px;
}
.ts-banner--error {
  border-color: var(--danger);
  background: var(--danger-soft);
  color: var(--danger);
}
.ts-card {
  margin-bottom: 20px;
  overflow: hidden;
}
.ts-card-head {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}
.ts-card-title {
  font-size: 14px;
  font-weight: 700;
  margin: 0;
}
.ts-card-sub {
  font-size: 12px;
  color: var(--text-secondary, var(--muted));
  margin: 3px 0 0;
}
.ts-card-body {
  padding: 18px 20px;
}

/* Active theme */
.ts-theme-identity {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}
.ts-thumb {
  width: 80px;
  height: 60px;
  border-radius: 8px;
  background: linear-gradient(135deg, #1e3a5f, #2563eb);
  color: rgba(255, 255, 255, 0.4);
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.ts-theme-name {
  font-size: 16px;
  font-weight: 700;
}
.ts-theme-version {
  font-size: 12px;
  color: var(--text-tertiary);
  margin: 2px 0 6px;
}
.ts-theme-desc {
  font-size: 13px;
  color: var(--muted);
  margin: 0;
}
.ts-theme-note {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-tertiary);
  margin: 10px 0 0;
}

/* Table */
.ts-table {
  width: 100%;
  border-collapse: collapse;
}
.ts-table thead th {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary, var(--muted));
  text-align: left;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
  white-space: nowrap;
}
.ts-th-actions {
  width: 260px;
}
.ts-actions {
  justify-content: flex-end;
}
.ts-table tbody td {
  padding: 12px 16px;
  font-size: 13px;
  vertical-align: middle;
  border-bottom: 1px solid var(--border-soft);
}
.ts-table tbody tr:last-child td {
  border-bottom: none;
}
.ts-item-name {
  font-weight: 600;
}
.ts-item-meta {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 2px;
}
.ts-editor {
  font-size: 13px;
}
.ts-editor-date {
  display: block;
  font-size: 11px;
  color: var(--text-tertiary);
}
.ts-dash {
  color: var(--text-tertiary);
}
.ts-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* Rows (page templates + routes) */
.ts-rows {
  display: flex;
  flex-direction: column;
}
.ts-tpl-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-soft);
}
.ts-tpl-row:last-child {
  border-bottom: none;
}
.ts-tpl-icon {
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.ts-tpl-info {
  flex: 1;
  min-width: 0;
}
.ts-tpl-name {
  font-size: 13px;
  font-weight: 600;
}
.ts-tpl-meta {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 2px;
}
.ts-route-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-soft);
}
.ts-route-row:last-child {
  border-bottom: none;
}
.ts-route-info {
  flex: 1;
  min-width: 0;
}
.ts-route-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ts-route-name {
  font-size: 13px;
  font-weight: 600;
}
.ts-route-kind {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--muted);
}
.ts-route-driver {
  font-size: 11px;
  color: var(--text-tertiary);
}
.ts-route-path {
  display: inline-block;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11.5px;
  color: var(--info);
  background: var(--info-soft);
  padding: 1px 6px;
  border-radius: 4px;
  margin: 4px 0;
}
.ts-route-desc {
  font-size: 12px;
  color: var(--text-secondary, var(--muted));
}
.ts-route-manage {
  font-size: 12px;
  font-weight: 600;
  color: var(--info);
  text-decoration: none;
  white-space: nowrap;
}

.ts-footnote {
  font-size: 12px;
  color: var(--text-tertiary);
  padding: 11px 20px;
  border-top: 1px solid var(--border-soft);
  background: var(--bg);
}
.ts-empty {
  font-size: 13px;
  color: var(--text-tertiary);
  padding: 12px 0;
  margin: 0;
}

/* Chips + small buttons */
.chip {
  display: inline-flex;
  align-items: center;
  font-size: 10.5px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 20px;
  white-space: nowrap;
}
/* All chips follow the app's token pattern — soft tint background + the
   matching solid color as text. Both tokens flip per theme, so contrast holds
   in light AND dark (the old hard-coded dark text went unreadable on the
   dark-tinted soft backgrounds). */
.chip-default {
  background: var(--surface-2);
  color: var(--muted);
  box-shadow: inset 0 0 0 1px var(--border);
}
.chip-custom {
  background: var(--info-soft);
  color: var(--info);
}
.chip-draft {
  background: var(--warning-soft);
  color: var(--warning);
}
.chip-update {
  background: var(--danger-soft);
  color: var(--danger);
}
.chip-template {
  background: var(--info-soft);
  color: var(--info);
}
.chip-part {
  background: var(--purple-soft);
  color: var(--purple);
}
.chip-starter {
  background: var(--warning-soft);
  color: var(--warning);
}
.chip-mine {
  background: var(--purple-soft);
  color: var(--purple);
}
.btn-sm {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  cursor: pointer;
  text-decoration: none;
}
.btn-ghost:hover:not(:disabled) {
  color: var(--fg, #111);
  border-color: var(--accent);
}
.btn-danger-ghost {
  color: var(--danger);
  border-color: var(--border);
}
.btn-danger-ghost:hover:not(:disabled) {
  background: var(--danger-soft);
  border-color: var(--danger);
}
.btn-sm:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
