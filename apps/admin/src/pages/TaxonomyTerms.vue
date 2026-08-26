<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ApiError } from '@/lib/api';
import {
  taxonomiesApi,
  slugify,
  type Taxonomy,
  type TaxonomyTerm,
} from '@/api/taxonomies';
import { toast } from '@/composables/useToast';
import { useConfirm } from '@/composables/useConfirm';

const { confirm } = useConfirm();
const route = useRoute();
const taxonomyId = computed(() => route.params['id'] as string);

const taxonomy = ref<Taxonomy | null>(null);
const terms = ref<TaxonomyTerm[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

// Add-term form.
const newName = ref('');
const newSlug = ref('');
const newParentId = ref<string>('');
const slugTouched = ref(false);
const adding = ref(false);

// Inline edit state.
const editingId = ref<string | null>(null);
const editName = ref('');
const editSlug = ref('');
const editDescription = ref('');

watch(newName, (v) => {
  if (!slugTouched.value) newSlug.value = slugify(v);
});

const hierarchical = computed(() => taxonomy.value?.isHierarchical ?? false);

// Flatten terms into render order with depth (tree when hierarchical).
const ordered = computed<{ term: TaxonomyTerm; depth: number }[]>(() => {
  const byParent = new Map<string | null, TaxonomyTerm[]>();
  for (const t of terms.value) {
    const key = hierarchical.value ? t.parentId : null;
    const arr = byParent.get(key) ?? [];
    arr.push(t);
    byParent.set(key, arr);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }
  const out: { term: TaxonomyTerm; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number): void => {
    for (const t of byParent.get(parentId) ?? []) {
      out.push({ term: t, depth });
      if (hierarchical.value) walk(t.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
});

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const [tax, termsRes] = await Promise.all([
      taxonomiesApi.get(taxonomyId.value),
      taxonomiesApi.listTerms(taxonomyId.value),
    ]);
    taxonomy.value = tax.data;
    terms.value = termsRes.data;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load';
  } finally {
    loading.value = false;
  }
}

async function onAdd(): Promise<void> {
  if (!newName.value || !newSlug.value) return;
  adding.value = true;
  error.value = null;
  try {
    const res = await taxonomiesApi.createTerm(taxonomyId.value, {
      name: newName.value,
      slug: newSlug.value,
      parentId: hierarchical.value && newParentId.value ? newParentId.value : null,
    });
    terms.value.push(res.data);
    newName.value = '';
    newSlug.value = '';
    newParentId.value = '';
    slugTouched.value = false;
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      error.value = 'A term with this slug already exists in this taxonomy.';
    } else {
      error.value = e instanceof Error ? e.message : 'Add failed';
    }
  } finally {
    adding.value = false;
  }
}

function startEdit(t: TaxonomyTerm): void {
  editingId.value = t.id;
  editName.value = t.name;
  editSlug.value = t.slug;
  editDescription.value = t.description ?? '';
}

function cancelEdit(): void {
  editingId.value = null;
}

async function saveEdit(t: TaxonomyTerm): Promise<void> {
  try {
    const res = await taxonomiesApi.updateTerm(taxonomyId.value, t.id, {
      name: editName.value,
      slug: editSlug.value,
      description: editDescription.value || null,
    });
    const idx = terms.value.findIndex((x) => x.id === t.id);
    if (idx !== -1) terms.value[idx] = res.data;
    editingId.value = null;
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      error.value = 'A term with this slug already exists in this taxonomy.';
    } else {
      error.value = e instanceof Error ? e.message : 'Save failed';
    }
  }
}

async function onDelete(t: TaxonomyTerm): Promise<void> {
  const childCount = terms.value.filter((x) => x.parentId === t.id).length;
  const extra =
    childCount > 0
      ? ` It has ${childCount} child term(s) which will be orphaned.`
      : '';
  const ok = await confirm({
    title: 'Delete term',
    message: `Delete term "${t.name}"?${extra}`,
    confirmLabel: 'Delete',
    tone: 'danger',
  });
  if (!ok) return;
  try {
    await taxonomiesApi.removeTerm(taxonomyId.value, t.id);
    terms.value = terms.value.filter((x) => x.id !== t.id);
    toast.success('Term deleted');
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Delete failed');
  }
}

onMounted(load);
</script>

<template>
  <section class="terms">
    <header class="page-header">
      <RouterLink :to="{ name: 'taxonomies' }" class="back-link">
        ← Back to taxonomies
      </RouterLink>
      <h1 v-if="taxonomy">
        {{ taxonomy.name }}
        <span class="badge">{{ hierarchical ? 'Hierarchical' : 'Flat' }}</span>
      </h1>
    </header>

    <p v-if="loading" class="muted">Loading…</p>
    <p v-else-if="!taxonomy" class="error">{{ error ?? 'Not found' }}</p>

    <template v-else>
      <form class="add" @submit.prevent="onAdd">
        <input v-model="newName" type="text" placeholder="Term name" maxlength="100" />
        <input
          v-model="newSlug"
          type="text"
          placeholder="slug"
          maxlength="100"
          class="mono"
          @input="slugTouched = true"
        />
        <select v-if="hierarchical" v-model="newParentId">
          <option value="">— top level —</option>
          <option v-for="t in terms" :key="t.id" :value="t.id">
            {{ t.name }}
          </option>
        </select>
        <button type="submit" class="btn btn--primary" :disabled="adding">
          {{ adding ? 'Adding…' : 'Add term' }}
        </button>
      </form>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="ordered.length === 0" class="muted">No terms yet.</p>

      <ul v-else class="tree">
        <li
          v-for="{ term, depth } in ordered"
          :key="term.id"
          class="term-row"
          :style="{ paddingLeft: `${depth * 1.5}rem` }"
        >
          <template v-if="editingId === term.id">
            <input v-model="editName" type="text" maxlength="100" class="edit-input" />
            <input v-model="editSlug" type="text" maxlength="100" class="edit-input mono" />
            <input
              v-model="editDescription"
              type="text"
              placeholder="description"
              class="edit-input"
            />
            <button type="button" class="btn btn--small btn--primary" @click="saveEdit(term)">
              Save
            </button>
            <button type="button" class="btn btn--small" @click="cancelEdit">
              Cancel
            </button>
          </template>
          <template v-else>
            <span class="term-name">{{ term.name }}</span>
            <span class="term-slug mono muted">{{ term.slug }}</span>
            <span class="spacer" />
            <button type="button" class="btn btn--small" title="Edit" aria-label="Edit" @click="startEdit(term)">
              <Icon name="edit" />
            </button>
            <button
              type="button"
              class="btn btn--small btn--danger"
              title="Delete"
              aria-label="Delete"
              @click="onDelete(term)"
            >
              <Icon name="trash" />
            </button>
          </template>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.page-header {
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
.page-header h1 {
  margin: 0.5rem 0 0;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.badge {
  font-size: 0.6875rem;
  padding: 0.125rem 0.5rem;
  border-radius: 999px;
  background: var(--border);
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.add {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 1.25rem;
  flex-wrap: wrap;
}
.add input[type='text'],
.add select {
  padding: 0.5rem 0.625rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: transparent;
  color: var(--fg);
  font-size: 0.875rem;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, monospace;
}
.tree {
  list-style: none;
  margin: 0;
  padding: 0;
}
.term-row {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding-top: 0.5rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--border);
}
.term-name {
  font-weight: 500;
}
.term-slug {
  font-size: 0.75rem;
}
.spacer {
  flex: 1;
}
.edit-input {
  padding: 0.375rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: transparent;
  color: var(--fg);
  font-size: 0.8125rem;
}
.muted {
  color: var(--muted);
}
.error {
  color: #dc2626;
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
</style>
