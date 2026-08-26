<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ApiError } from '@/lib/api';
import {
  contentTypesApi,
  RESERVED_FIELD_NAMES,
  readSlugList,
  type FieldDefinition,
  type FieldType,
  type SubFieldDefinition,
  type SubFieldType,
} from '@/api/content-types';
import { contentApi } from '@/api/content';
import { postTemplatesApi, type PostTemplate } from '@/api/post-templates';
import { slugify } from '@/api/taxonomies';
import { useTaxonomyTerms } from '@/composables/useTaxonomyTerms';

const route = useRoute();
const router = useRouter();

const idParam = computed(() =>
  typeof route.params['id'] === 'string' ? route.params['id'] : null,
);
const isEdit = computed(() => idParam.value !== null);

const FIELD_TYPE_OPTIONS: { value: FieldType; label: string }[] = [
  { value: 'short_text', label: 'Short text' },
  { value: 'long_text', label: 'Long text' },
  { value: 'rich_text', label: 'Rich text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'date', label: 'Date' },
  { value: 'datetime', label: 'Date & time' },
  { value: 'media_single', label: 'Media (single)' },
  { value: 'media_gallery', label: 'Media (gallery)' },
  { value: 'taxonomy_relation', label: 'Taxonomy relation' },
  { value: 'content_relation', label: 'Content relation' },
  { value: 'select', label: 'Select' },
  { value: 'repeater', label: 'Repeater' },
  { value: 'json_raw', label: 'Raw JSON' },
];

// Concise badge + glyph per field type for the field rows and the palette.
const FIELD_BADGES: Record<FieldType, string> = {
  short_text: 'text',
  long_text: 'textarea',
  rich_text: 'rich text',
  number: 'number',
  boolean: 'boolean',
  date: 'date',
  datetime: 'datetime',
  media_single: 'media',
  media_gallery: 'gallery',
  taxonomy_relation: 'taxonomy',
  content_relation: 'relation',
  select: 'select',
  repeater: 'repeater',
  json_raw: 'json',
};
const FIELD_GLYPHS: Record<FieldType, string> = {
  short_text: 'T',
  long_text: '¶',
  rich_text: 'R',
  number: '#',
  boolean: '✓',
  date: '▦',
  datetime: '▦',
  media_single: '▣',
  media_gallery: '▣',
  taxonomy_relation: '⌗',
  content_relation: '↗',
  select: '▾',
  repeater: '⟳',
  json_raw: '{}',
};
function fieldBadge(t: FieldType): string {
  return FIELD_BADGES[t] ?? t;
}
function fieldGlyph(t: FieldType): string {
  return FIELD_GLYPHS[t] ?? '•';
}

const SUB_FIELD_TYPE_OPTIONS: { value: SubFieldType; label: string }[] = [
  { value: 'short_text', label: 'Short text' },
  { value: 'long_text', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Select' },
];

const name = ref('');
const slug = ref('');
const slugTouched = ref(false);
const description = ref('');
const icon = ref('');
const previewPath = ref('');
const submissionAccess = ref<'none' | 'authenticated' | 'public'>('none');
// What a submission-enabled type collects: 'information' (form data → a table +
// CSV in the admin) or 'post' (real content → the editor). Only shown when
// submissions are on; persisted as settings.submissionKind.
const submissionKind = ref<'information' | 'post'>('information');
// Opt-in manual (drag) ordering for this type's public listing (settings.manualOrder).
const manualOrder = ref(false);
const fields = ref<FieldDefinition[]>([]);

// Per-content-type taxonomy bindings. Posts of this type will see ONLY the
// terms from these taxonomies in their Categories / Tags sidebar panels.
// Empty selections fall back to "every taxonomy of that kind" — the same
// behaviour the sidebar uses today when settings.taxonomies is unset.
const boundCategorySlugs = ref<string[]>([]);
const boundTagSlugs = ref<string[]>([]);

// Per-content-type default post template ('' = let the theme decide). Editors
// can override it per post. Options come from the dev-shipped post-template list.
const defaultTemplateKey = ref<string>('');
const postTemplates = ref<PostTemplate[]>([]);
const { groups: taxGroups, ensureLoaded: ensureTaxonomiesLoaded } =
  useTaxonomyTerms();
const categoryTaxonomies = computed(() =>
  taxGroups.value.filter((g) => g.taxonomy.kind === 'category'),
);
const tagTaxonomies = computed(() =>
  taxGroups.value.filter((g) => g.taxonomy.kind === 'tag'),
);
function toggleCategoryBinding(s: string): void {
  const i = boundCategorySlugs.value.indexOf(s);
  if (i >= 0) boundCategorySlugs.value.splice(i, 1);
  else boundCategorySlugs.value.push(s);
}
function toggleTagBinding(s: string): void {
  const i = boundTagSlugs.value.indexOf(s);
  if (i >= 0) boundTagSlugs.value.splice(i, 1);
  else boundTagSlugs.value.push(s);
}

// Names present at load time are locked once content entries exist.
const lockedNames = ref<Set<string>>(new Set());
const hasEntries = ref(false);

const loading = ref(false);
const saving = ref(false);
const formError = ref<string | null>(null);

// ─── Field editor panel ─────────────────────────────────────────────────────
const editorOpen = ref(false);
const editorIndex = ref<number | null>(null); // null = adding
const eName = ref('');
const eLabel = ref('');
const eType = ref<FieldType>('short_text');
const eRequired = ref(false);
const eHelp = ref('');
const eOptions = ref(''); // one per line, select only
const eMinLength = ref<number | null>(null);
const eMaxLength = ref<number | null>(null);
const eMin = ref<number | null>(null);
const eMax = ref<number | null>(null);
const eSubFields = ref<SubFieldDefinition[]>([]);
const eNameTouched = ref(false);
const editorError = ref<string | null>(null);

const editingLocked = computed(
  () =>
    editorIndex.value !== null &&
    lockedNames.value.has(fields.value[editorIndex.value]?.name ?? ''),
);
const showTextValidations = computed(
  () => eType.value === 'short_text' || eType.value === 'long_text',
);
const showNumberValidations = computed(() => eType.value === 'number');
const showOptions = computed(() => eType.value === 'select');
const showSubFields = computed(() => eType.value === 'repeater');

watch(name, (v) => {
  if (!slugTouched.value && !isEdit.value) slug.value = slugify(v);
});
// Auto-derive the machine name from the label while adding (snake_case), until
// the user edits the name field directly.
watch(eLabel, (v) => {
  if (!eNameTouched.value) eName.value = snakeCase(v);
});

function snakeCase(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^a-z]+/, '');
}

function openAdd(): void {
  editorIndex.value = null;
  eName.value = '';
  eLabel.value = '';
  eType.value = 'short_text';
  eRequired.value = false;
  eHelp.value = '';
  eOptions.value = '';
  eMinLength.value = null;
  eMaxLength.value = null;
  eMin.value = null;
  eMax.value = null;
  eSubFields.value = [];
  eNameTouched.value = false;
  editorError.value = null;
  editorOpen.value = true;
}

// Quick-add from the Field Types palette: open the editor pre-set to a type.
function openAddWithType(t: FieldType): void {
  openAdd();
  eType.value = t;
}

function openEdit(i: number): void {
  const f = fields.value[i];
  if (!f) return;
  editorIndex.value = i;
  eName.value = f.name;
  eLabel.value = f.label;
  eType.value = f.type;
  eRequired.value = f.required;
  eHelp.value = f.helpText ?? '';
  eOptions.value = (f.validations?.options ?? []).join('\n');
  eMinLength.value = f.validations?.minLength ?? null;
  eMaxLength.value = f.validations?.maxLength ?? null;
  eMin.value = f.validations?.min ?? null;
  eMax.value = f.validations?.max ?? null;
  eSubFields.value = (f.subFields ?? []).map((sf) => ({ ...sf }));
  eNameTouched.value = true;
  editorError.value = null;
  editorOpen.value = true;
}

function closeEditor(): void {
  editorOpen.value = false;
}

function buildValidations(): FieldDefinition['validations'] {
  const v: NonNullable<FieldDefinition['validations']> = {};
  if (showTextValidations.value) {
    if (eMinLength.value !== null) v.minLength = eMinLength.value;
    if (eMaxLength.value !== null) v.maxLength = eMaxLength.value;
  }
  if (showNumberValidations.value) {
    if (eMin.value !== null) v.min = eMin.value;
    if (eMax.value !== null) v.max = eMax.value;
  }
  if (showOptions.value) {
    const opts = eOptions.value
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (opts.length > 0) v.options = opts;
  }
  return Object.keys(v).length > 0 ? v : undefined;
}

// ─── Repeater sub-fields ────────────────────────────────────────────────────
function addSubField(): void {
  eSubFields.value.push({
    id: crypto.randomUUID(),
    name: '',
    label: '',
    type: 'short_text',
  });
}
function removeSubField(i: number): void {
  eSubFields.value.splice(i, 1);
}
// Derive the sub-field name from its label until the name is edited directly.
function onSubLabel(sf: SubFieldDefinition, value: string): void {
  const prevAuto = snakeCase(sf.label);
  sf.label = value;
  if (!sf.name || sf.name === prevAuto) sf.name = snakeCase(value);
}
function subOptionsText(sf: SubFieldDefinition): string {
  return (sf.options ?? []).join('\n');
}
function onSubOptions(sf: SubFieldDefinition, value: string): void {
  const opts = value
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (opts.length > 0) sf.options = opts;
  else delete sf.options;
}

// Validate + normalize the repeater sub-fields. Returns null on success or an
// error message to surface.
function buildSubFields(): { ok: true; value: SubFieldDefinition[] } | { ok: false; error: string } {
  const seen = new Set<string>();
  const out: SubFieldDefinition[] = [];
  for (const sf of eSubFields.value) {
    if (!sf.label.trim()) return { ok: false, error: 'Every sub-field needs a label.' };
    if (!/^[a-z][a-z0-9_]*$/.test(sf.name)) {
      return { ok: false, error: `Sub-field "${sf.label}" needs a snake_case name.` };
    }
    if (seen.has(sf.name)) {
      return { ok: false, error: `Duplicate sub-field name "${sf.name}".` };
    }
    seen.add(sf.name);
    const clean: SubFieldDefinition = {
      id: sf.id,
      name: sf.name,
      label: sf.label,
      type: sf.type,
    };
    if (sf.required) clean.required = true;
    if (sf.type === 'select' && sf.options && sf.options.length > 0) {
      clean.options = sf.options;
    }
    out.push(clean);
  }
  return { ok: true, value: out };
}

function saveField(): void {
  editorError.value = null;
  if (!eLabel.value.trim()) {
    editorError.value = 'Label is required.';
    return;
  }
  if (!/^[a-z][a-z0-9_]*$/.test(eName.value)) {
    editorError.value = 'Name must be a snake_case identifier.';
    return;
  }
  if ((RESERVED_FIELD_NAMES as readonly string[]).includes(eName.value)) {
    editorError.value = `"${eName.value}" is a reserved field name.`;
    return;
  }
  const dupe = fields.value.some(
    (f, i) => f.name === eName.value && i !== editorIndex.value,
  );
  if (dupe) {
    editorError.value = `A field named "${eName.value}" already exists.`;
    return;
  }

  let subFields: SubFieldDefinition[] | undefined;
  if (showSubFields.value) {
    const result = buildSubFields();
    if (!result.ok) {
      editorError.value = result.error;
      return;
    }
    subFields = result.value;
  }

  const validations = buildValidations();
  if (editorIndex.value === null) {
    const field: FieldDefinition = {
      id: crypto.randomUUID(),
      name: eName.value,
      label: eLabel.value,
      type: eType.value,
      required: eRequired.value,
      order: fields.value.length,
    };
    if (eHelp.value) field.helpText = eHelp.value;
    if (validations) field.validations = validations;
    if (subFields) field.subFields = subFields;
    fields.value.push(field);
  } else {
    const existing = fields.value[editorIndex.value];
    if (existing) {
      const updated: FieldDefinition = {
        id: existing.id,
        // name stays locked if this field already has content entries
        name: editingLocked.value ? existing.name : eName.value,
        label: eLabel.value,
        type: eType.value,
        required: eRequired.value,
        order: existing.order,
      };
      if (eHelp.value) updated.helpText = eHelp.value;
      if (validations) updated.validations = validations;
      if (subFields) updated.subFields = subFields;
      if (existing.default !== undefined) updated.default = existing.default;
      fields.value[editorIndex.value] = updated;
    }
  }
  editorOpen.value = false;
}

function deleteField(i: number): void {
  const f = fields.value[i];
  if (!f || lockedNames.value.has(f.name)) return;
  fields.value.splice(i, 1);
  reindex();
}

// ─── Drag-to-reorder fields ──────────────────────────────────────────────────
const dragIndex = ref<number | null>(null);
const overIndex = ref<number | null>(null);
function onFieldDragStart(i: number, e: DragEvent): void {
  dragIndex.value = i;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(i));
  }
}
function onFieldDragOver(i: number): void {
  if (dragIndex.value !== null && i !== dragIndex.value) overIndex.value = i;
}
function onFieldDrop(i: number): void {
  const from = dragIndex.value;
  if (from !== null && from !== i) {
    const arr = [...fields.value];
    const moved = arr.splice(from, 1)[0];
    if (moved) {
      arr.splice(i, 0, moved);
      fields.value = arr;
      reindex();
    }
  }
  resetFieldDrag();
}
function resetFieldDrag(): void {
  dragIndex.value = null;
  overIndex.value = null;
}

function reindex(): void {
  fields.value.forEach((f, i) => {
    f.order = i;
  });
}

async function load(): Promise<void> {
  if (!idParam.value) return;
  loading.value = true;
  formError.value = null;
  try {
    const { data } = await contentTypesApi.get(idParam.value);
    name.value = data.name;
    slug.value = data.slug;
    description.value = data.description ?? '';
    icon.value = data.icon ?? '';
    previewPath.value = data.previewPath ?? '';
    submissionAccess.value = data.submissionAccess ?? 'none';
    fields.value = [...data.fieldDefinitions.fields].sort(
      (a, b) => a.order - b.order,
    );
    // Hydrate taxonomy bindings. Use readSlugList so legacy single-string
    // values (pre-Phase-D seed data) still populate the checkboxes.
    boundCategorySlugs.value = readSlugList(data.settings?.taxonomies?.categories);
    boundTagSlugs.value = readSlugList(data.settings?.taxonomies?.tags);
    defaultTemplateKey.value = data.settings?.templates?.default ?? '';
    submissionKind.value = data.settings?.submissionKind ?? 'information';
    manualOrder.value = data.settings?.manualOrder === true;
    // Detect existing content entries → lock slug + current field names.
    const res = await contentApi.list({ contentTypeId: idParam.value, limit: 1 });
    hasEntries.value = res.data.length > 0;
    if (hasEntries.value) {
      lockedNames.value = new Set(fields.value.map((f) => f.name));
    }
  } catch (e) {
    formError.value = e instanceof Error ? e.message : 'Failed to load';
  } finally {
    loading.value = false;
  }
}

async function onSubmit(): Promise<void> {
  saving.value = true;
  formError.value = null;
  // Always write taxonomies as arrays (the new canonical shape). Empty
  // arrays are kept so the API stores `{ categories: [], tags: [] }`,
  // which the editor sidebar reads as "fall back to all of that kind."
  const payload = {
    name: name.value,
    slug: slug.value,
    description: description.value || null,
    icon: icon.value || null,
    previewPath: previewPath.value.trim() || null,
    fieldDefinitions: { fields: fields.value },
    settings: {
      taxonomies: {
        categories: boundCategorySlugs.value,
        tags: boundTagSlugs.value,
      },
      submissionKind: submissionKind.value,
      manualOrder: manualOrder.value,
      // Only write a default when one is chosen — an explicit `undefined`
      // trips exactOptionalPropertyTypes, and "no default" just means the
      // theme decides.
      ...(defaultTemplateKey.value
        ? { templates: { default: defaultTemplateKey.value } }
        : {}),
    },
    submissionAccess: submissionAccess.value,
  };
  try {
    if (isEdit.value && idParam.value) {
      await contentTypesApi.update(idParam.value, payload);
    } else {
      await contentTypesApi.create(payload);
    }
    await router.push({ name: 'content-types' });
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      formError.value = e.message;
    } else {
      formError.value = e instanceof Error ? e.message : 'Save failed';
    }
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  postTemplatesApi
    .list()
    .then((r) => {
      postTemplates.value = r.data;
    })
    .catch(() => {
      // non-fatal — the picker just shows "Theme default" only
    });
  await Promise.all([load(), ensureTaxonomiesLoaded()]);
});
</script>

<template>
  <section class="form-page">
    <header class="page-header">
      <h1>{{ isEdit ? 'Edit content type' : 'New content type' }}</h1>
      <RouterLink :to="{ name: 'content-types' }" class="back-link">
        ← Back to list
      </RouterLink>
    </header>

    <p v-if="loading" class="muted">Loading…</p>

    <form v-else class="form" @submit.prevent="onSubmit">
      <div class="ct-editor-row">
        <div class="ct-editor-main">
      <div class="card ct-basic">
        <div class="card-title">Basic Information</div>
        <div class="grid2">
          <label>
            <span>Name</span>
            <input v-model="name" type="text" required maxlength="100" />
          </label>
          <label>
            <span>
              Slug
              <span v-if="hasEntries" class="lock" title="Locked: content entries exist">🔒</span>
            </span>
            <input
              v-model="slug"
              type="text"
              required
              :disabled="hasEntries"
              pattern="[a-z][a-z0-9\-]*"
              maxlength="100"
              placeholder="e.g. blog-post"
              @input="slugTouched = true"
            />
          </label>
        </div>
        <div class="grid2">
          <label>
            <span>Description</span>
            <input v-model="description" type="text" maxlength="500" />
          </label>
          <label>
            <span>Icon</span>
            <input v-model="icon" type="text" maxlength="50" />
          </label>
        </div>
        <div>
          <label>
            <span>Permalink pattern</span>
            <input
              v-model="previewPath"
              type="text"
              maxlength="200"
              placeholder="/{category}/{slug}"
              pattern="^/.*"
            />
          </label>
          <p class="form-hint">
            Public URL pattern for this type. Use <code>{slug}</code> (required) and
            <code>{category}</code> for the primary category. Leave empty to disable Preview.
          </p>
        </div>
      </div>

      <section class="card fields-block">
        <div class="card-header">
          <div class="card-title">
            Custom Fields
            <span class="dim">({{ fields.length }} {{ fields.length === 1 ? 'field' : 'fields' }})</span>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" @click="openAdd">
            + Add field
          </button>
        </div>

        <div class="field-info">
          <strong>System fields</strong> (title, slug, body, SEO, status, author,
          timestamps) are included automatically on every content type.
        </div>

        <p v-if="fields.length === 0" class="muted">No custom fields yet.</p>

        <ul v-else class="field-list">
          <li
            v-for="(f, i) in fields"
            :key="f.id"
            class="field-item"
            :class="{
              'field-item--drag': dragIndex === i,
              'field-item--over': overIndex === i,
            }"
            draggable="true"
            @dragstart="onFieldDragStart(i, $event)"
            @dragend="resetFieldDrag"
            @dragover.prevent="onFieldDragOver(i)"
            @drop.prevent="onFieldDrop(i)"
          >
            <span class="drag-handle" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="currentColor"
                aria-hidden="true"
              >
                <circle cx="9" cy="6" r="1.5" />
                <circle cx="15" cy="6" r="1.5" />
                <circle cx="9" cy="12" r="1.5" />
                <circle cx="15" cy="12" r="1.5" />
                <circle cx="9" cy="18" r="1.5" />
                <circle cx="15" cy="18" r="1.5" />
              </svg>
            </span>
            <span class="field-type-badge">{{ fieldBadge(f.type) }}</span>
            <span class="field-name-wrap">
              <span class="field-name-main">
                {{ f.label }}
                <span v-if="lockedNames.has(f.name)" class="lock" title="Name locked: content entries exist">🔒</span>
              </span>
              <span class="field-name-key">{{ f.name }}</span>
            </span>
            <span v-if="f.required" class="field-required">Required</span>
            <span class="field-actions">
              <button type="button" class="icon-btn" title="Edit" aria-label="Edit" @click="openEdit(i)"><Icon name="edit" /></button>
              <button
                type="button"
                class="icon-btn icon-btn--danger"
                title="Delete"
                aria-label="Delete"
                :disabled="lockedNames.has(f.name)"
                @click="deleteField(i)"
              >
                <Icon name="trash" />
              </button>
            </span>
          </li>
        </ul>

        <!-- Inline field editor -->
        <div v-if="editorOpen" class="editor">
          <h3>{{ editorIndex === null ? 'Add field' : 'Edit field' }}</h3>
          <div class="grid2">
            <label>
              <span>Label</span>
              <input v-model="eLabel" type="text" maxlength="100" />
            </label>
            <label>
              <span>
                Name (machine)
                <span v-if="editingLocked" class="lock" title="Locked">🔒</span>
              </span>
              <input
                v-model="eName"
                type="text"
                :disabled="editingLocked"
                maxlength="100"
                class="mono"
                @input="eNameTouched = true"
              />
            </label>
          </div>
          <div class="grid2">
            <label>
              <span>Type</span>
              <select v-model="eType">
                <option v-for="o in FIELD_TYPE_OPTIONS" :key="o.value" :value="o.value">
                  {{ o.label }}
                </option>
              </select>
            </label>
            <label class="checkbox">
              <input v-model="eRequired" type="checkbox" />
              <span>Required</span>
            </label>
          </div>
          <label>
            <span>Help text</span>
            <input v-model="eHelp" type="text" maxlength="500" />
          </label>

          <div v-if="showTextValidations" class="grid2">
            <label>
              <span>Min length</span>
              <input v-model.number="eMinLength" type="number" min="0" />
            </label>
            <label>
              <span>Max length</span>
              <input v-model.number="eMaxLength" type="number" min="0" />
            </label>
          </div>
          <div v-if="showNumberValidations" class="grid2">
            <label>
              <span>Min</span>
              <input v-model.number="eMin" type="number" />
            </label>
            <label>
              <span>Max</span>
              <input v-model.number="eMax" type="number" />
            </label>
          </div>
          <label v-if="showOptions">
            <span>Options (one per line)</span>
            <textarea v-model="eOptions" rows="4" />
          </label>

          <div v-if="showSubFields" class="subfields">
            <span class="subfields-title">Repeater sub-fields</span>
            <p v-if="eSubFields.length === 0" class="muted small">
              No sub-fields yet — add at least one column.
            </p>
            <div v-for="(sf, si) in eSubFields" :key="sf.id" class="subfield-row">
              <input
                type="text"
                placeholder="Label"
                :value="sf.label"
                @input="onSubLabel(sf, ($event.target as HTMLInputElement).value)"
              />
              <input v-model="sf.name" type="text" placeholder="name" class="mono" />
              <select v-model="sf.type">
                <option v-for="o in SUB_FIELD_TYPE_OPTIONS" :key="o.value" :value="o.value">
                  {{ o.label }}
                </option>
              </select>
              <label class="sf-req">
                <input v-model="sf.required" type="checkbox" />
                <span>req</span>
              </label>
              <button type="button" class="sf-del" title="Remove" aria-label="Remove" @click="removeSubField(si)"><Icon name="x" :size="12" /></button>
              <textarea
                v-if="sf.type === 'select'"
                class="sf-options"
                rows="2"
                placeholder="Options, one per line"
                :value="subOptionsText(sf)"
                @input="onSubOptions(sf, ($event.target as HTMLTextAreaElement).value)"
              />
            </div>
            <button type="button" class="btn btn--small" @click="addSubField">
              + Add sub-field
            </button>
          </div>

          <p v-if="editorError" class="error">{{ editorError }}</p>
          <div class="editor-actions">
            <button type="button" class="btn" @click="closeEditor">Cancel</button>
            <button type="button" class="btn btn--primary" @click="saveField">
              {{ editorIndex === null ? 'Add' : 'Update' }}
            </button>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <div class="card-title">Default post template</div>
        </div>
        <p class="field-info">
          The layout posts of this type render with. Editors can override it per
          post. Leave as “Theme default” to let the theme decide.
        </p>
        <select
          v-model="defaultTemplateKey"
          style="width: 100%; max-width: 360px; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius); font-family: inherit; font-size: 13px; background: var(--surface); color: var(--fg);"
        >
          <option value="">Theme default</option>
          <option v-for="t in postTemplates" :key="t.key" :value="t.key">
            {{ t.label }}
          </option>
        </select>
      </section>

      <section class="card taxonomies-block">
        <div class="card-header">
          <div class="card-title">Taxonomies</div>
        </div>
        <p class="field-info">
          Pick which taxonomies appear in the post editor's
          <strong>Categories</strong> and <strong>Tags</strong> sidebar
          panels for posts of this type. Leave a list empty to show
          every taxonomy of that kind.
        </p>

        <div class="tax-bind-grid">
          <div class="tax-bind-col">
            <div class="tax-bind-head">
              <Icon name="folder" :size="12" />
              <span>Categories</span>
              <span class="dim">({{ boundCategorySlugs.length }} selected)</span>
            </div>
            <p v-if="categoryTaxonomies.length === 0" class="muted small">
              No category taxonomies yet. Create one on the Taxonomy page.
            </p>
            <label
              v-for="g in categoryTaxonomies"
              :key="g.taxonomy.id"
              class="tax-bind-item"
            >
              <input
                type="checkbox"
                :checked="boundCategorySlugs.includes(g.taxonomy.slug)"
                @change="toggleCategoryBinding(g.taxonomy.slug)"
              />
              <span class="tax-bind-name">{{ g.taxonomy.name }}</span>
              <span class="tax-bind-meta">{{ g.terms.length }} terms</span>
            </label>
          </div>

          <div class="tax-bind-col">
            <div class="tax-bind-head">
              <Icon name="tag" :size="12" />
              <span>Tags</span>
              <span class="dim">({{ boundTagSlugs.length }} selected)</span>
            </div>
            <p v-if="tagTaxonomies.length === 0" class="muted small">
              No tag taxonomies yet. Create one on the Taxonomy page.
            </p>
            <label
              v-for="g in tagTaxonomies"
              :key="g.taxonomy.id"
              class="tax-bind-item"
            >
              <input
                type="checkbox"
                :checked="boundTagSlugs.includes(g.taxonomy.slug)"
                @change="toggleTagBinding(g.taxonomy.slug)"
              />
              <span class="tax-bind-name">{{ g.taxonomy.name }}</span>
              <span class="tax-bind-meta">{{ g.terms.length }} terms</span>
            </label>
          </div>
        </div>
      </section>

      <section class="card submissions-block">
        <div class="card-header">
          <div class="card-title">Public submissions</div>
        </div>
        <p class="field-info">
          Choose who may submit content of this type from the public site.
          Submissions always arrive as <strong>drafts</strong> for review —
          they are never published automatically.
        </p>
        <label class="submission-access-field">
          <span>Who can submit?</span>
          <select v-model="submissionAccess">
            <option value="none">No one (submissions closed)</option>
            <option value="authenticated">Logged-in users only</option>
            <option value="public">Anyone, including guests</option>
          </select>
        </label>
        <div
          v-if="submissionAccess !== 'none'"
          class="submission-kind-field"
          style="margin-top: 14px"
        >
          <span
            style="
              display: block;
              font-size: 13px;
              font-weight: 600;
              margin-bottom: 6px;
            "
            >This collects</span
          >
          <label class="checkbox">
            <input v-model="submissionKind" type="radio" value="information" />
            <span
              >Information — form data, shown in the admin as a table you can
              export to CSV</span
            >
          </label>
          <label class="checkbox">
            <input v-model="submissionKind" type="radio" value="post" />
            <span>Posts — real content you edit and publish</span>
          </label>
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <div class="card-title">Ordering</div>
        </div>
        <p class="field-info">
          Let editors arrange this type's entries by hand (drag to reorder, or
          sort A→Z). Its public listing then follows that order instead of
          newest-first.
        </p>
        <label class="checkbox">
          <input v-model="manualOrder" type="checkbox" />
          <span>Enable manual ordering</span>
        </label>
      </section>
        </div>

        <aside class="ct-palette">
          <div class="card">
            <div class="card-title">Field Types</div>
            <div class="palette-list">
              <button
                v-for="o in FIELD_TYPE_OPTIONS"
                :key="o.value"
                type="button"
                class="palette-item"
                @click="openAddWithType(o.value)"
              >
                <span class="palette-glyph">{{ fieldGlyph(o.value) }}</span>
                {{ o.label }}
              </button>
            </div>
          </div>
        </aside>
      </div>

      <p v-if="formError" class="error">{{ formError }}</p>

      <div class="actions">
        <RouterLink :to="{ name: 'content-types' }" class="btn">Cancel</RouterLink>
        <button type="submit" :disabled="saving" class="btn btn--primary">
          {{ saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create' }}
        </button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}
.back-link {
  color: var(--muted);
  text-decoration: none;
  font-size: 0.875rem;
}
.back-link:hover {
  color: var(--accent);
}
.form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}
.form label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.form label > span {
  font-size: 0.875rem;
  font-weight: 500;
}
.form input,
.form textarea,
.form select {
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: transparent;
  color: var(--fg);
  font-family: inherit;
  font-size: 0.9375rem;
}
.form input:disabled {
  opacity: 0.6;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, monospace;
}
.lock {
  font-size: 0.75rem;
}
.fields-block {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.dim {
  font-weight: 400;
  color: var(--text-tertiary);
}
.ct-basic .card-title {
  margin-bottom: 16px;
}
.ct-basic .grid2 + .grid2 {
  margin-top: 1rem;
}
.fields-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.fields-header h2 {
  margin: 0;
  font-size: 1rem;
}
.field-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.field-item {
  cursor: move;
}
.field-item:active {
  cursor: grabbing;
}
.field-item--drag {
  opacity: 0.45;
}
.field-item--over {
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.required {
  color: var(--danger);
}
.field-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}

/* Two-column editor: main column + Field Types palette */
.ct-editor-row {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
}
.ct-editor-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.ct-palette {
  width: 220px;
  flex-shrink: 0;
}
@media (max-width: 820px) {
  .ct-editor-row {
    flex-direction: column;
  }
  .ct-palette {
    width: 100%;
  }
}
.palette-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}
.palette-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--fg);
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition:
    border-color 0.15s,
    background 0.15s;
}
.palette-item:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.palette-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  font-size: 13px;
  color: var(--accent-hover);
  flex-shrink: 0;
}
.editor {
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  background: rgba(127, 127, 127, 0.04);
}
.editor h3 {
  margin: 0;
  font-size: 0.9375rem;
}
.subfields {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border: 1px dashed var(--border);
  border-radius: 0.5rem;
  padding: 0.75rem;
}
.subfields-title {
  font-size: 0.8125rem;
  font-weight: 600;
}
.subfield-row {
  display: grid;
  grid-template-columns: 1fr 1fr auto auto auto;
  gap: 0.5rem;
  align-items: center;
}
.subfield-row .sf-options {
  grid-column: 1 / -1;
}
.sf-req {
  flex-direction: row !important;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  color: var(--muted);
}
.sf-del {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  border-radius: 0.25rem;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
}
.sf-del:hover {
  color: #dc2626;
  border-color: #dc2626;
}
.small {
  font-size: 0.8125rem;
}
.checkbox {
  flex-direction: row !important;
  align-items: center;
  gap: 0.5rem;
  align-self: end;
}

/* Taxonomies binding section */
.taxonomies-block {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.submissions-block {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.submission-access-field {
  max-width: 320px;
}
.tax-bind-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}
@media (max-width: 720px) {
  .tax-bind-grid {
    grid-template-columns: 1fr;
  }
}
.tax-bind-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  padding: 0.75rem;
  background: rgba(127, 127, 127, 0.03);
}
.tax-bind-head {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 2px 8px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  border-bottom: 1px solid var(--border-soft);
  margin-bottom: 4px;
}
.tax-bind-head .dim {
  color: var(--text-tertiary);
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
  margin-left: auto;
  font-size: 11px;
}
.tax-bind-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 4px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--fg);
  cursor: pointer;
}
.tax-bind-item:hover {
  background: var(--row-hover);
}
.tax-bind-item input {
  accent-color: var(--accent);
  width: 14px;
  height: 14px;
}
.tax-bind-name {
  flex: 1;
}
.tax-bind-meta {
  font-size: 11px;
  color: var(--text-tertiary);
}
.editor-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}
.actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-top: 0.5rem;
}
.btn {
  display: inline-flex;
  align-items: center;
  padding: 0.5rem 0.875rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: transparent;
  color: var(--fg);
  text-decoration: none;
  font-size: 0.875rem;
  cursor: pointer;
}
.btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.btn--small {
  padding: 0.25rem 0.625rem;
  font-size: 0.8125rem;
}
.btn--primary {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}
.btn--primary:hover {
  background: transparent;
  color: var(--accent);
}
.btn--primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.btn--danger:hover {
  border-color: #dc2626;
  color: #dc2626;
}
.btn--danger:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.muted {
  color: var(--muted);
}
.error {
  color: #dc2626;
  font-size: 0.875rem;
}
</style>
