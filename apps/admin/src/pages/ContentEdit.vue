<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { ApiError } from '@/lib/api';
import { toast } from '@/composables/useToast';
import { useConfirm } from '@/composables/useConfirm';
import { useAuthStore } from '@/stores/auth';
import { contentApi, type Content, type ContentStatus } from '@/api/content';
import {
  contentTypesApi,
  readSlugList,
  type ContentType,
  type FieldDefinitions,
} from '@/api/content-types';
import { resolvePostFields } from '@/lib/post-fields';
import { useBodyEditor, type BodyStats } from '@/composables/useBodyEditor';
import { useMediaPicker } from '@/composables/useMediaPicker';
import MediaPickerModal from '@/components/MediaPickerModal.vue';
import CustomFieldsEditor from '@/components/CustomFieldsEditor.vue';
import RevisionHistory from '@/components/RevisionHistory.vue';
import StatusTransitions from '@/components/StatusTransitions.vue';
import EditorTopBar from '@/components/editor/EditorTopBar.vue';
import EditorToolbar from '@/components/editor/EditorToolbar.vue';
import EditorWritingSurface from '@/components/editor/EditorWritingSurface.vue';
import EditorContentBody from '@/components/editor/EditorContentBody.vue';
import EditorStatsBar from '@/components/editor/EditorStatsBar.vue';
import EditorSidebar from '@/components/editor/EditorSidebar.vue';
import SidebarPanel from '@/components/editor/SidebarPanel.vue';
import StatusFlow from '@/components/editor/sidebar/StatusFlow.vue';
import CategoryTree from '@/components/editor/sidebar/CategoryTree.vue';
import TagInput from '@/components/editor/sidebar/TagInput.vue';
import { postTemplatesApi, type PostTemplate } from '@/api/post-templates';

type SidebarTab = 'post' | 'seo' | 'revisions';

const route = useRoute();
const router = useRouter();
const { confirm } = useConfirm();
const auth = useAuthStore();

// Client-side button gates; server is the source of truth for authz (the
// transition endpoint requires editor+ via preHandler anyway).
const canEdit = computed(() => auth.hasRole('editor'));
const canAuthor = computed(() => auth.hasRole('author'));

const id = computed(() => route.params['id'] as string);

const content = ref<Content | null>(null);

// New-post mode (/content/new/:typeId): no row exists until the first save
// POSTs it, after which the route swaps to content-edit. Both routes resolve
// to this component at the same depth, so Vue reuses the instance across the
// swap — everything flips reactively and load() never re-runs.
const isNew = computed(
  () => route.name === 'content-create' && !content.value,
);
// EditorTopBar needs a non-null status; an uncreated post is morally a draft.
const status = computed<ContentStatus>(
  () => content.value?.status ?? 'draft',
);
const contentType = ref<ContentType | null>(null);
const loading = ref(true);
const saving = ref(false);
const transitioning = ref(false);
const error = ref<string | null>(null);
const lastSavedAt = ref<string | null>(null);

// UI-only state.
const sidebarTab = ref<SidebarTab>('post');
const focusMode = ref(false);
const bodyStats = ref<BodyStats>({ words: 0, chars: 0, readMin: 1 });

// Validation errors keyed by field path (e.g. 'hero_image_key', 'body'). Populated
// from a 422 `issues[]` payload on save/publish. Cleared at the start of every
// attempt and on successful response. Drives the inline red borders on
// CustomFieldsEditor rows AND the sticky banner at the top of the editor.
const validationErrors = ref<Record<string, string>>({});
const hasValidationErrors = computed(
  () => Object.keys(validationErrors.value).length > 0,
);

// Local editable copies.
const title = ref('');
const slug = ref('');

// New-mode slug assist: mirror the title into the slug until the user edits
// the slug by hand, then stop (same contract as the old /content/new form).
// Output always satisfies the server's /^[a-z0-9][a-z0-9-]*$/.
let lastAutoSlug = '';
function autoSlugFromTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .slice(0, 200)
    .replace(/-+$/, '');
}
function onTitleInput(v: string): void {
  title.value = v;
  if (!isNew.value) return;
  if (slug.value === '' || slug.value === lastAutoSlug) {
    slug.value = autoSlugFromTitle(v);
    lastAutoSlug = slug.value;
  }
}
const customFields = ref<Record<string, unknown>>({});
const taxonomyTermIds = ref<string[]>([]);
const publishAt = ref('');
const unpublishAt = ref('');
const locale = ref('');
const featured = ref(false);
// Per-post template override ('' = use the content type's default). Options come
// from the dev-shipped post-template list.
const templateKey = ref('');
const postTemplates = ref<PostTemplate[]>([]);

// SEO (content_seo).
const metaTitle = ref('');
const metaDescription = ref('');
const metaKeywords = ref(''); // comma-separated in the form
const ogTitle = ref('');
const ogDescription = ref('');
const ogImageKey = ref('');
const ogType = ref('');
const twitterCard = ref('');
const twitterTitle = ref('');
const twitterDescription = ref('');
const twitterImageKey = ref('');
const canonicalUrl = ref('');
const robotsIndex = ref(true);
const robotsFollow = ref(true);
const sitemapInclude = ref(true);
const sitemapPriority = ref('');
const sitemapChangeFreq = ref('');
const schemaType = ref('');
const schemaOverrides = ref(''); // JSON text

// ─── Convention-based field resolution (no schema change) ───────────────────
const resolved = computed(() =>
  resolvePostFields(contentType.value?.fieldDefinitions),
);
const restDefs = computed<FieldDefinitions>(() => ({
  fields: resolved.value.rest,
}));
const slugPrefix = computed(() =>
  contentType.value ? `/${contentType.value.slug}/` : '/',
);

// Public-submission provenance, surfaced as a banner so reviewers see who sent
// it. Present only on rows created via the public submission endpoint (which
// stores submitter_* in custom_fields). submitter_user_id distinguishes a
// logged-in reader from an anonymous guest.
const submission = computed(() => {
  const cf = customFields.value;
  const email =
    typeof cf['submitter_email'] === 'string' ? cf['submitter_email'] : null;
  if (!email) return null;
  const name =
    typeof cf['submitter_name'] === 'string' ? cf['submitter_name'] : '';
  const userId =
    typeof cf['submitter_user_id'] === 'string'
      ? cf['submitter_user_id']
      : null;
  return { name, email, userId };
});
// Used by EditorTopBar's `Schedule` button: scheduling requires publish_at,
// otherwise the server returns 400 (`requires_publish_at`). Disabling the
// button up front beats letting the user click and get a toast error.
const hasPublishAt = computed(() => publishAt.value.trim().length > 0);

// Per-content-type taxonomy bindings (settings.taxonomies). Many:many —
// each list may name multiple taxonomies; the sidebar shows the union.
// Empty arrays (or absent settings) fall back to "every taxonomy of that
// kind" in the sidebar components. readSlugList tolerates both the
// canonical array shape and the legacy single-string shape.
const categoryTaxonomySlugs = computed<string[]>(() =>
  readSlugList(contentType.value?.settings?.taxonomies?.categories),
);
const tagTaxonomySlugs = computed<string[]>(() =>
  readSlugList(contentType.value?.settings?.taxonomies?.tags),
);

function getField(name: string): unknown {
  return customFields.value[name];
}
// Replace the object reference so the dirty snapshot + autosave observe it.
function setField(name: string, value: unknown): void {
  customFields.value = { ...customFields.value, [name]: value };
}

// Single shared media picker for the body editor: the toolbar image/gallery
// buttons and the slash-menu image/gallery items call pickMedia(), the modal
// below resolves it. Hosting it here (not in the toolbar) lets the ProseMirror
// slash plugin reach it too.
const {
  open: pickerOpen,
  multiple: pickerMultiple,
  pick: pickMedia,
  resolve: pickerResolve,
  cancel: pickerCancel,
} = useMediaPicker();

const { editor: bodyEditor } = useBodyEditor({
  getValue: () => {
    const f = resolved.value.bodyField;
    return f ? getField(f.name) : null;
  },
  onChange: (v) => {
    const f = resolved.value.bodyField;
    if (f) setField(f.name, v);
  },
  onStats: (s) => {
    bodyStats.value = s;
  },
  pickMedia,
});

// Dirty tracking via a serialized snapshot of all editable state.
const savedSnapshot = ref('');
function snapshot(): string {
  return JSON.stringify({
    title: title.value,
    slug: slug.value,
    customFields: customFields.value,
    taxonomyTermIds: taxonomyTermIds.value,
    publishAt: publishAt.value,
    unpublishAt: unpublishAt.value,
    locale: locale.value,
    featured: featured.value,
    templateKey: templateKey.value,
    metaTitle: metaTitle.value,
    metaDescription: metaDescription.value,
    metaKeywords: metaKeywords.value,
    ogTitle: ogTitle.value,
    ogDescription: ogDescription.value,
    ogImageKey: ogImageKey.value,
    ogType: ogType.value,
    twitterCard: twitterCard.value,
    twitterTitle: twitterTitle.value,
    twitterDescription: twitterDescription.value,
    twitterImageKey: twitterImageKey.value,
    canonicalUrl: canonicalUrl.value,
    robotsIndex: robotsIndex.value,
    robotsFollow: robotsFollow.value,
    sitemapInclude: sitemapInclude.value,
    sitemapPriority: sitemapPriority.value,
    sitemapChangeFreq: sitemapChangeFreq.value,
    schemaType: schemaType.value,
    schemaOverrides: schemaOverrides.value,
  });
}
const dirty = computed(() => snapshot() !== savedSnapshot.value);

function toJsonString(v: unknown): string {
  if (v === undefined || v === null) return '';
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return '';
  }
}

// Convert a stored UTC ISO timestamp to the local wall-clock string a
// <input type="datetime-local"> expects (YYYY-MM-DDTHH:mm). Slicing the raw
// ISO would show UTC digits in a local-time field, shifting the value by the
// timezone offset on every save round-trip.
function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pullFromServer(c: Content): void {
  title.value = c.title;
  slug.value = c.slug;
  customFields.value = c.customFields ?? {};
  // Keep the current term selection when a response omits the field — a
  // server response without taxonomyTermIds means "unchanged", not "none";
  // resetting to [] here would make the next save wipe the post's terms.
  taxonomyTermIds.value = c.taxonomyTermIds ?? taxonomyTermIds.value;
  publishAt.value = isoToLocalInput(c.publishAt);
  unpublishAt.value = isoToLocalInput(c.unpublishAt);
  locale.value = c.locale;
  featured.value = c.featured;
  templateKey.value = c.templateKey ?? '';

  // Dev-only: warn when a save round-trip surfaces customFields with keys
  // not declared on the content type's field_definitions. Those values are
  // invisible in the editor (no input renders) yet may still be read by
  // public routes — exactly the seed-vs-schema drift that hid the hero
  // image until it was renamed to match the field definition. The initial
  // load triggers this from `load()` after contentType is fetched; here
  // we catch any drift introduced by external writes between saves.
  if (import.meta.env.DEV && contentType.value) warnOnFieldDrift(c);

  const s = c.seo;
  metaTitle.value = s?.metaTitle ?? '';
  metaDescription.value = s?.metaDescription ?? '';
  metaKeywords.value = (s?.metaKeywords ?? []).join(', ');
  ogTitle.value = s?.ogTitle ?? '';
  ogDescription.value = s?.ogDescription ?? '';
  ogImageKey.value = s?.ogImageKey ?? '';
  ogType.value = s?.ogType ?? '';
  twitterCard.value = s?.twitterCard ?? '';
  twitterTitle.value = s?.twitterTitle ?? '';
  twitterDescription.value = s?.twitterDescription ?? '';
  twitterImageKey.value = s?.twitterImageKey ?? '';
  canonicalUrl.value = s?.canonicalUrl ?? '';
  robotsIndex.value = s?.robotsIndex ?? true;
  robotsFollow.value = s?.robotsFollow ?? true;
  sitemapInclude.value = s?.sitemapInclude ?? true;
  sitemapPriority.value = s?.sitemapPriority ?? '';
  sitemapChangeFreq.value = s?.sitemapChangeFreq ?? '';
  schemaType.value = s?.schemaType ?? '';
  schemaOverrides.value = toJsonString(s?.schemaOverrides ?? null);

  lastSavedAt.value = c.updatedAt;
  savedSnapshot.value = snapshot();
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    if (isNew.value) {
      // New-post mode: only the content type to fetch — the row is created
      // by the first save. Snapshot the empty state so dirty starts false.
      const t = await contentTypesApi.get(route.params['typeId'] as string);
      contentType.value = t.data;
      locale.value = 'en';
      savedSnapshot.value = snapshot();
    } else {
      const c = await contentApi.get(id.value);
      content.value = c.data;
      pullFromServer(c.data);
      const t = await contentTypesApi.get(c.data.contentTypeId);
      contentType.value = t.data;
      // The drift check in pullFromServer needs contentType to be loaded;
      // it isn't on the first call above, so re-run it now that both are ready.
      if (import.meta.env.DEV) warnOnFieldDrift(c.data);
    }
    // Fetched here for both modes — load() never re-runs after the
    // create→edit route swap (same component instance).
    postTemplatesApi
      .list()
      .then((r) => {
        postTemplates.value = r.data;
      })
      .catch(() => {
        // non-fatal — the picker falls back to "content type default" only
      });
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load';
  } finally {
    loading.value = false;
  }
}

function warnOnFieldDrift(c: Content): void {
  if (!contentType.value) return;
  const declared = new Set(
    contentType.value.fieldDefinitions.fields.map((f) => f.name),
  );
  const orphans = Object.keys(c.customFields ?? {}).filter(
    (k) => !declared.has(k),
  );
  if (orphans.length > 0) {
    console.warn(
      `[ContentEdit] customFields has keys with no matching FieldDefinition — they won't render in the editor: ${orphans.join(', ')}`,
    );
  }
}

function localToIso(local: string): string | null {
  if (!local) return null;
  return new Date(local).toISOString();
}

function buildSeo() {
  const keywords = metaKeywords.value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  let overrides: unknown = null;
  const raw = schemaOverrides.value.trim();
  if (raw) {
    try {
      overrides = JSON.parse(raw);
    } catch {
      overrides = null;
    }
  }
  return {
    metaTitle: metaTitle.value || null,
    metaDescription: metaDescription.value || null,
    metaKeywords: keywords.length > 0 ? keywords : null,
    ogTitle: ogTitle.value || null,
    ogDescription: ogDescription.value || null,
    ogImageKey: ogImageKey.value || null,
    ogType: ogType.value || null,
    twitterCard: twitterCard.value || null,
    twitterTitle: twitterTitle.value || null,
    twitterDescription: twitterDescription.value || null,
    twitterImageKey: twitterImageKey.value || null,
    canonicalUrl: canonicalUrl.value || null,
    robotsIndex: robotsIndex.value,
    robotsFollow: robotsFollow.value,
    sitemapInclude: sitemapInclude.value,
    sitemapPriority: sitemapPriority.value || null,
    sitemapChangeFreq: sitemapChangeFreq.value || null,
    schemaType: schemaType.value || null,
    schemaOverrides: overrides,
  };
}

// Pre-flight for the first save: the create endpoint requires a title and a
// well-formed slug, and a Zod 400 would surface as an unhelpful generic toast.
function validateNewPost(): boolean {
  if (title.value.trim().length === 0) {
    toast.error('Add a title before saving.');
    document.querySelector<HTMLElement>('.title-input')?.focus();
    return false;
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug.value)) {
    toast.error(
      'Slug must be lowercase letters/numbers separated by hyphens.',
    );
    return false;
  }
  return true;
}

async function onSave(silent = false): Promise<Content | null> {
  if (saving.value) return null;
  if (isNew.value && (!contentType.value || !validateNewPost())) return null;
  saving.value = true;
  validationErrors.value = {};
  try {
    let data: Content;
    if (isNew.value && contentType.value) {
      // First save of a new post — POST creates the row. Categories/tags and
      // SEO are hidden until the row exists (create doesn't accept them and
      // authors lack PATCH rights), so this payload is complete.
      ({ data } = await contentApi.create({
        contentTypeId: contentType.value.id,
        title: title.value,
        slug: slug.value,
        customFields: customFields.value,
        templateKey: templateKey.value || null,
        locale: locale.value || 'en',
        featured: featured.value,
        publishAt: localToIso(publishAt.value),
        unpublishAt: localToIso(unpublishAt.value),
      }));
      content.value = data;
      pullFromServer(data);
      // Swap to the canonical edit URL. Same component instance — no remount.
      // Suppress the leave guard: keystrokes landing between the click and
      // the response can re-dirty state and would trigger the confirm.
      suppressLeaveGuard = true;
      try {
        await router.replace({
          name: 'content-edit',
          params: { id: data.id },
        });
      } finally {
        suppressLeaveGuard = false;
      }
    } else {
      ({ data } = await contentApi.update(id.value, {
        title: title.value,
        slug: slug.value,
        customFields: customFields.value,
        taxonomyTermIds: taxonomyTermIds.value,
        seo: buildSeo(),
        publishAt: localToIso(publishAt.value),
        unpublishAt: localToIso(unpublishAt.value),
        locale: locale.value,
        featured: featured.value,
        templateKey: templateKey.value || null,
      }));
      content.value = data;
      pullFromServer(data);
    }
    if (!silent) toast.success('Draft saved');
    return data;
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      toast.error('Slug already in use for this content type.');
      return null;
    }
    // 422 carries a field-by-field issues array; surface it inline AND as a
    // brief toast header so the author sees both the count (toast) and the
    // detail (sticky banner + red field borders).
    if (e instanceof ApiError && e.status === 422) {
      const summary = applyValidationIssues(parseValidationIssues(e.body));
      if (summary) {
        toast.error(summary, { title: e.message || 'Save failed' });
        return null;
      }
    }
    toast.error(e instanceof Error ? e.message : 'Save failed');
    return null;
  } finally {
    saving.value = false;
  }
}

// Human-friendly past-tense labels for transition success toasts.
const TRANSITION_TOAST: Record<ContentStatus, string> = {
  draft: 'Moved back to draft',
  in_review: 'Submitted for review',
  approved: 'Approved',
  scheduled: 'Scheduled for publish',
  published: 'Published',
  archived: 'Archived',
};

/**
 * Look up a field's human-friendly label from the content type's definitions.
 * Falls back to the raw path so the message is still useful when the path
 * doesn't correspond to a registered field (e.g. nested repeater paths or
 * server-side checks outside customFields).
 */
function labelForPath(path: string): string {
  if (!path) return '';
  const head = path.split('.')[0] ?? path;
  const f = contentType.value?.fieldDefinitions.fields.find(
    (x) => x.name === head,
  );
  return f?.label ?? path;
}

/**
 * Parse a 422 publish-validation body into a list of {path, label, message}.
 * `path` is the raw field name (used as the DOM lookup key); `label` is the
 * human-readable name surfaced in the banner.
 */
interface ValidationIssue {
  path: string;
  label: string;
  message: string;
}

function parseValidationIssues(body: unknown): ValidationIssue[] {
  if (!body || typeof body !== 'object' || !('issues' in body)) return [];
  const issues = body.issues;
  if (!Array.isArray(issues)) return [];
  const out: ValidationIssue[] = [];
  for (const i of issues) {
    if (!i || typeof i !== 'object') continue;
    const p = (i as { path: unknown }).path;
    const m = (i as { message: unknown }).message;
    const path = typeof p === 'string' ? p : '';
    const message = typeof m === 'string' ? m : 'Invalid value';
    out.push({ path, label: labelForPath(path), message });
  }
  return out;
}

/**
 * Populate the reactive `validationErrors` map from a parsed issues list and
 * return a short toast-friendly summary string. Returns null when there are
 * no issues so callers can fall back to a generic toast.
 */
function applyValidationIssues(issues: ValidationIssue[]): string | null {
  validationErrors.value = {};
  if (issues.length === 0) return null;
  for (const i of issues) {
    if (i.path) validationErrors.value[i.path] = i.message;
  }
  return `${issues.length} field${issues.length === 1 ? '' : 's'} need attention`;
}

/**
 * Map a validation path to the sidebar tab that contains its input, if any.
 * Custom fields and the title/slug/body live in the always-visible main
 * column, so they need no tab switch. SEO field names (mirrored from
 * `SeoBody` in apps/api/src/routes/admin/content.ts) live in the SEO tab.
 * Returns null when no tab switch is needed.
 */
const SEO_PATHS = new Set([
  'metaTitle',
  'metaDescription',
  'metaKeywords',
  'ogTitle',
  'ogDescription',
  'ogImageKey',
  'ogType',
  'twitterCard',
  'twitterTitle',
  'twitterDescription',
  'twitterImageKey',
  'canonicalUrl',
  'sitemapPriority',
  'sitemapChangeFreq',
  'schemaType',
  'schemaOverrides',
]);

function tabForPath(path: string): SidebarTab | null {
  const head = path.split('.')[0] ?? path;
  if (SEO_PATHS.has(head)) return 'seo';
  return null;
}

/**
 * Reveal the offending field's container (switch sidebar tab if needed),
 * scroll it into view, and focus it. Called from the validation banner.
 */
async function goToField(path: string): Promise<void> {
  const tab = tabForPath(path);
  if (tab && sidebarTab.value !== tab) {
    sidebarTab.value = tab;
    await nextTick();
  }
  const el = document.querySelector<HTMLElement>(
    `[data-field-path="${CSS.escape(path)}"]`,
  );
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const focusTarget =
    el.matches('input, textarea, select')
      ? el
      : el.querySelector<HTMLElement>('input, textarea, select, [tabindex]');
  focusTarget?.focus({ preventScroll: true });
}

async function onTransition(toStatus: ContentStatus): Promise<void> {
  // Archiving a published post takes it offline immediately — confirm.
  if (toStatus === 'archived' && content.value?.status === 'published') {
    const ok = await confirm({
      title: 'Archive published post',
      message: `Archive "${title.value}"? It will be removed from the public site immediately.`,
      confirmLabel: 'Archive',
      tone: 'danger',
    });
    if (!ok) return;
  }

  // Save first so any in-flight edits are reflected in the validation the
  // transition endpoint runs (especially for `Publish`, which checks
  // required fields against the stored row).
  const saved = await onSave(true);
  if (!saved) return;
  transitioning.value = true;
  validationErrors.value = {};
  try {
    const { data } = await contentApi.transition(id.value, { toStatus });
    content.value = data;
    pullFromServer(data);
    toast.success(TRANSITION_TOAST[toStatus]);
  } catch (e) {
    // 422 from publish/schedule: required fields are missing. Surface the
    // actual issue list inline so the author can fix and retry without guessing.
    if (e instanceof ApiError && e.status === 422) {
      const summary = applyValidationIssues(parseValidationIssues(e.body));
      if (summary) {
        toast.error(summary, { title: e.message || 'Cannot publish' });
        return;
      }
    }
    toast.error(e instanceof Error ? e.message : 'Transition failed');
  } finally {
    transitioning.value = false;
  }
}

// Opens the public site rendering of this post in a new tab, gated by a
// short-lived signed token so drafts/scheduled/archived rows render too.
// Silent-save first so the preview matches what the editor sees on screen —
// otherwise the editor would have to remember to save, which defeats the
// "preview the live post" mental model. The API returns 422 with
// { error: 'no_public_route' } when the content type has no public page yet
// (see apps/api/src/lib/preview-routes.ts).
async function onPreview(): Promise<void> {
  if (saving.value || transitioning.value) return;
  if (dirty.value) {
    const saved = await onSave(true);
    if (!saved) return;
  }
  try {
    const { data } = await contentApi.previewToken(id.value);
    window.open(data.previewUrl, '_blank', 'noopener');
  } catch (e) {
    if (
      e instanceof ApiError &&
      e.status === 422 &&
      e.body &&
      typeof e.body === 'object' &&
      'error' in e.body &&
      e.body.error === 'no_public_route'
    ) {
      toast.error('Preview is not configured for this content type yet.');
      return;
    }
    toast.error(e instanceof Error ? e.message : 'Preview failed');
  }
}

async function onDelete(): Promise<void> {
  const ok = await confirm({
    title: 'Delete post',
    message: `Delete "${title.value}"? This cannot be undone.`,
    confirmLabel: 'Delete',
    tone: 'danger',
  });
  if (!ok) return;
  try {
    await contentApi.remove(id.value);
    savedSnapshot.value = snapshot(); // suppress the unsaved-changes guard
    toast.success('Post deleted');
    await router.push({ name: 'content' });
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Delete failed');
  }
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

function relativeSaved(iso: string | null): string {
  if (!iso) return 'Not saved yet';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Saved just now';
  if (mins < 60) return `Saved ${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Saved ${hrs} hr ago`;
  return `Saved ${new Date(iso).toLocaleDateString()}`;
}
const savedLabel = computed(() => relativeSaved(lastSavedAt.value));

// ─── Unsaved-changes guards (no autosave — saves are explicit) ──────────────
// Saving happens only on an explicit action (the Save button, or a silent
// save when minting a Preview token / running a status transition). We keep
// the guards below so unsaved work isn't lost on navigation or tab close.
// Set around the create→edit router.replace so the route-leave confirm
// doesn't fire on our own navigation.
let suppressLeaveGuard = false;

function beforeUnload(e: BeforeUnloadEvent): void {
  if (dirty.value) {
    e.preventDefault();
    e.returnValue = '';
  }
}

onMounted(async () => {
  await load();
  window.addEventListener('beforeunload', beforeUnload);
});

onUnmounted(() => {
  window.removeEventListener('beforeunload', beforeUnload);
});

onBeforeRouteLeave(async () => {
  if (suppressLeaveGuard) return true;
  if (dirty.value) {
    return await confirm({
      title: 'Unsaved changes',
      message: 'You have unsaved changes. Leave without saving?',
      confirmLabel: 'Leave',
      cancelLabel: 'Stay',
    });
  }
  return true;
});
</script>

<template>
  <section class="post-editor" :class="{ 'post-editor--focus': focusMode }">
    <p v-if="loading" class="pe-state muted">Loading…</p>
    <p v-else-if="error || (!isNew && !content)" class="pe-state error">
      {{ error ?? 'Not found' }}
    </p>

    <template v-else>
      <div class="pe-topbar">
        <EditorTopBar
          :content-type-name="contentType?.name ?? null"
          :status="status"
          :dirty="dirty"
          :saving="saving"
          :transitioning="transitioning"
          :saved-label="savedLabel"
          :can-edit="canEdit"
          :can-author="canAuthor"
          :has-publish-at="hasPublishAt"
          :is-new="isNew"
          @save="onSave"
          @transition="onTransition"
          @preview="onPreview"
        />
      </div>

      <div
        v-if="submission"
        class="submission-banner"
        style="display: flex; align-items: center; gap: 10px; padding: 10px 14px; margin: 0 0 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--accent-soft, rgba(127, 127, 127, 0.06)); font-size: 13px; color: var(--fg)"
      >
        <span aria-hidden="true">📥</span>
        <span>
          Submitted by
          <strong>{{ submission.name || 'Anonymous' }}</strong>
          &lt;{{ submission.email }}&gt;
        </span>
        <span
          style="margin-left: auto; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted)"
        >
          {{ submission.userId ? 'logged-in user' : 'guest' }}
        </span>
      </div>

      <div
        v-if="hasValidationErrors"
        class="validation-banner"
        role="alert"
        aria-live="polite"
      >
        <div class="vb-head">
          <Icon name="alert-triangle" :size="16" />
          <strong>
            {{ Object.keys(validationErrors).length }} field{{
              Object.keys(validationErrors).length === 1 ? '' : 's'
            }}
            need attention before publish
          </strong>
        </div>
        <ul class="vb-list">
          <li v-for="(message, path) in validationErrors" :key="path">
            <button
              type="button"
              class="vb-link"
              @click="goToField(String(path))"
            >
              {{ labelForPath(String(path)) }}
            </button>
            <span class="vb-msg">— {{ message }}</span>
          </li>
        </ul>
      </div>

      <div class="editor-grid">
        <div class="editor-main">
          <EditorToolbar
            v-if="bodyEditor && resolved.bodyField"
            :editor="bodyEditor"
            :pick-media="pickMedia"
            @toggle-focus="focusMode = !focusMode"
          />

          <div class="writing-area">
            <div class="writing-inner">
              <EditorWritingSurface
                :title="title"
                :slug="slug"
                :slug-prefix="slugPrefix"
                :excerpt-field="resolved.excerptField"
                :featured-image-field="resolved.featuredImageField"
                :get-field="getField"
                :set-field="setField"
                :validation-errors="validationErrors"
                @update:title="onTitleInput($event)"
                @update:slug="slug = $event"
              >
                <div
                  v-if="bodyEditor && resolved.bodyField"
                  :class="{
                    'body-wrap': true,
                    'body-wrap--invalid':
                      !!validationErrors[resolved.bodyField.name],
                  }"
                  :data-field-path="resolved.bodyField.name"
                >
                  <EditorContentBody :editor="bodyEditor" />
                  <p
                    v-if="validationErrors[resolved.bodyField.name]"
                    class="body-error"
                    role="alert"
                  >
                    {{ validationErrors[resolved.bodyField.name] }}
                  </p>
                </div>
                <p v-else class="muted body-empty">
                  This content type has no rich-text body field.
                </p>
              </EditorWritingSurface>

              <section v-if="resolved.rest.length" class="custom-fields">
                <header class="cf-head">
                  <h2 class="cf-title">{{ contentType?.name }} Fields</h2>
                  <span class="cf-sub">Content-type metadata</span>
                </header>
                <CustomFieldsEditor
                  v-model="customFields"
                  :field-definitions="restDefs"
                  :validation-errors="validationErrors"
                />
              </section>

              <EditorStatsBar
                :words="bodyStats.words"
                :chars="bodyStats.chars"
                :read-min="bodyStats.readMin"
                :edited-at="lastSavedAt"
              />
            </div>
          </div>
        </div>

        <EditorSidebar
          v-if="!focusMode"
          class="pe-sidebar"
          :tab="sidebarTab"
          :hide-tabs="isNew ? ['seo', 'revisions'] : []"
          @update:tab="sidebarTab = $event"
        >
          <template #post>
            <SidebarPanel title="Status & Publishing" icon="clock">
              <template v-if="content">
                <StatusFlow :status="content.status" />
                <StatusTransitions
                  :current-status="content.status"
                  :disabled="transitioning || saving"
                  @transition="onTransition"
                />
              </template>
              <p v-else class="sf-new-hint">
                Draft — created when you first save.
              </p>
              <div class="sf-field">
                <label class="form-label">Schedule publish</label>
                <input
                  v-model="publishAt"
                  type="datetime-local"
                  class="form-input"
                />
              </div>
              <div class="sf-field">
                <label class="form-label">Unpublish at</label>
                <input
                  v-model="unpublishAt"
                  type="datetime-local"
                  class="form-input"
                />
              </div>
              <div class="sf-field">
                <label class="form-label">Locale</label>
                <input
                  v-model="locale"
                  type="text"
                  maxlength="10"
                  class="form-input"
                />
              </div>
              <div class="sf-field">
                <label class="form-label">Template</label>
                <select v-model="templateKey" class="form-input">
                  <option value="">Use content type default</option>
                  <option
                    v-for="t in postTemplates"
                    :key="t.key"
                    :value="t.key"
                  >
                    {{ t.label }}
                  </option>
                </select>
              </div>
              <label class="toggle-row">
                <span>Featured</span>
                <input v-model="featured" type="checkbox" />
              </label>
            </SidebarPanel>

            <SidebarPanel v-if="content" title="Details" icon="user">
              <dl class="meta">
                <div><dt>Type</dt><dd>{{ contentType?.name ?? '—' }}</dd></div>
                <div>
                  <dt>Created</dt>
                  <dd>{{ formatDate(content.createdAt) }}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{{ formatDate(content.updatedAt) }}</dd>
                </div>
                <div>
                  <dt>Published</dt>
                  <dd>{{ formatDate(content.publishedAt) }}</dd>
                </div>
                <div><dt>Views</dt><dd>{{ content.viewCount }}</dd></div>
              </dl>
            </SidebarPanel>

            <!-- Categories/tags need a persisted row: the create endpoint
                 doesn't accept taxonomyTermIds, so they appear after the
                 first save (alongside SEO and Revisions). -->
            <SidebarPanel v-if="content" title="Categories" icon="folder">
              <CategoryTree
                v-model="taxonomyTermIds"
                :taxonomy-slugs="categoryTaxonomySlugs"
              />
            </SidebarPanel>

            <SidebarPanel v-if="content" title="Tags" icon="tag">
              <TagInput
                v-model="taxonomyTermIds"
                :taxonomy-slugs="tagTaxonomySlugs"
              />
            </SidebarPanel>

            <div v-if="content" class="danger-zone">
              <button type="button" class="btn btn-danger" @click="onDelete">
                <Icon name="trash" :size="14" /> Delete
              </button>
            </div>
          </template>

          <template #seo>
            <SidebarPanel title="Meta">
              <div class="sf-field">
                <label class="form-label">Meta title</label>
                <input
                  v-model="metaTitle"
                  type="text"
                  maxlength="500"
                  class="form-input"
                />
              </div>
              <div class="sf-field">
                <label class="form-label">Meta description</label>
                <textarea
                  v-model="metaDescription"
                  rows="3"
                  maxlength="1000"
                  class="form-textarea"
                />
              </div>
              <div class="sf-field">
                <label class="form-label">Keywords (comma-separated)</label>
                <input v-model="metaKeywords" type="text" class="form-input" />
              </div>
            </SidebarPanel>

            <SidebarPanel title="Open Graph" :default-open="false">
              <div class="sf-field">
                <label class="form-label">OG title</label>
                <input
                  v-model="ogTitle"
                  type="text"
                  maxlength="500"
                  class="form-input"
                />
              </div>
              <div class="sf-field">
                <label class="form-label">OG description</label>
                <textarea
                  v-model="ogDescription"
                  rows="2"
                  maxlength="1000"
                  class="form-textarea"
                />
              </div>
              <div class="sf-field">
                <label class="form-label">OG image key</label>
                <input v-model="ogImageKey" type="text" class="form-input" />
              </div>
              <div class="sf-field">
                <label class="form-label">OG type</label>
                <input
                  v-model="ogType"
                  type="text"
                  placeholder="article"
                  class="form-input"
                />
              </div>
            </SidebarPanel>

            <SidebarPanel title="Twitter" :default-open="false">
              <div class="sf-field">
                <label class="form-label">Card</label>
                <input
                  v-model="twitterCard"
                  type="text"
                  placeholder="summary_large_image"
                  class="form-input"
                />
              </div>
              <div class="sf-field">
                <label class="form-label">Title</label>
                <input
                  v-model="twitterTitle"
                  type="text"
                  maxlength="500"
                  class="form-input"
                />
              </div>
              <div class="sf-field">
                <label class="form-label">Description</label>
                <textarea
                  v-model="twitterDescription"
                  rows="2"
                  maxlength="1000"
                  class="form-textarea"
                />
              </div>
              <div class="sf-field">
                <label class="form-label">Image key</label>
                <input
                  v-model="twitterImageKey"
                  type="text"
                  class="form-input"
                />
              </div>
            </SidebarPanel>

            <SidebarPanel title="Technical" :default-open="false">
              <div class="sf-field">
                <label class="form-label">Canonical URL</label>
                <input v-model="canonicalUrl" type="url" class="form-input" />
              </div>
              <label class="toggle-row">
                <span>Index (robots)</span>
                <input v-model="robotsIndex" type="checkbox" />
              </label>
              <label class="toggle-row">
                <span>Follow (robots)</span>
                <input v-model="robotsFollow" type="checkbox" />
              </label>
              <label class="toggle-row">
                <span>Include in sitemap</span>
                <input v-model="sitemapInclude" type="checkbox" />
              </label>
              <div class="sf-field">
                <label class="form-label">Sitemap priority (0.0–1.0)</label>
                <input
                  v-model="sitemapPriority"
                  type="text"
                  placeholder="0.5"
                  class="form-input"
                />
              </div>
              <div class="sf-field">
                <label class="form-label">Sitemap change frequency</label>
                <input
                  v-model="sitemapChangeFreq"
                  type="text"
                  placeholder="weekly"
                  class="form-input"
                />
              </div>
            </SidebarPanel>

            <SidebarPanel title="Structured data" :default-open="false">
              <div class="sf-field">
                <label class="form-label">Schema type</label>
                <input
                  v-model="schemaType"
                  type="text"
                  placeholder="Article"
                  class="form-input"
                />
              </div>
              <div class="sf-field">
                <label class="form-label">Schema overrides (JSON-LD)</label>
                <textarea
                  v-model="schemaOverrides"
                  rows="4"
                  spellcheck="false"
                  class="form-textarea code"
                />
              </div>
            </SidebarPanel>
          </template>

          <template #revisions>
            <div class="revisions-tab">
              <RevisionHistory :content-id="id" />
            </div>
          </template>
        </EditorSidebar>
      </div>

      <MediaPickerModal
        v-if="pickerOpen"
        :multiple="pickerMultiple"
        @select="pickerResolve"
        @close="pickerCancel"
      />
    </template>
  </section>
</template>

<style scoped>
.post-editor {
  /* Standalone full-screen layout (rendered outside the admin shell). Owns the
     whole viewport and manages its own internal scrolling, like the mockup. */
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface);
}
.pe-state {
  padding: 24px;
}
.pe-topbar {
  flex-shrink: 0;
}
.editor-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  overflow: hidden;
}
.post-editor--focus .editor-grid {
  grid-template-columns: 1fr;
}
.editor-main {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.writing-area {
  padding: 40px 24px 24px;
}
.writing-inner {
  max-width: 760px;
  margin: 0 auto;
}
.body-empty {
  padding: 24px 0;
}

/* Custom fields block */
.custom-fields {
  margin-top: 36px;
  border-top: 2px dashed var(--border);
  padding-top: 24px;
}
.cf-head {
  margin-bottom: 16px;
}
.cf-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--fg);
}
.cf-sub {
  font-size: 11px;
  color: var(--text-tertiary);
}

/* Sidebar scrolls independently within the fixed-height grid. */
.pe-sidebar {
  min-height: 0;
  height: 100%;
  overflow-y: auto;
}

/* Sidebar field rows */
.sf-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sf-new-hint {
  margin: 0;
  font-size: 12.5px;
  color: var(--muted);
}
.sf-field .form-label {
  margin-bottom: 0;
}
.form-textarea.code {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12px;
}
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: var(--muted);
}
.meta {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12.5px;
}
.meta > div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.meta dt {
  color: var(--text-tertiary);
}
.meta dd {
  margin: 0;
  color: var(--fg);
  text-align: right;
}
.danger-zone {
  padding: 16px;
}
.danger-zone .btn {
  width: 100%;
  justify-content: center;
}
.revisions-tab {
  padding: 16px;
}
.muted {
  color: var(--muted);
}
.error {
  color: var(--danger);
}

.validation-banner {
  position: sticky;
  top: 0;
  z-index: 4;
  margin: 0 0 14px;
  padding: 12px 16px;
  border-radius: 8px;
  border: 1px solid var(--danger, #dc2626);
  background: color-mix(in srgb, var(--danger, #dc2626) 12%, var(--surface));
  color: var(--fg);
  font-size: 13px;
  line-height: 1.5;
}
.validation-banner .vb-head {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--danger, #dc2626);
  margin-bottom: 6px;
}
.validation-banner .vb-list {
  margin: 0;
  padding: 0 0 0 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.validation-banner .vb-link {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: var(--accent, var(--fg));
  text-decoration: underline;
  cursor: pointer;
}
.validation-banner .vb-link:hover {
  text-decoration: none;
}
.validation-banner .vb-msg {
  color: var(--muted);
}

.body-wrap--invalid {
  outline: 1px solid var(--danger, #dc2626);
  outline-offset: 6px;
  border-radius: 4px;
}
.body-error {
  margin: 0.5rem 0 0;
  color: var(--danger, #dc2626);
  font-size: 0.8125rem;
  font-weight: 500;
}
</style>
