<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { ApiError } from '@/lib/api';
import {
  taxonomiesApi,
  slugify,
  type TaxonomyKind,
  type TaxonomyTerm,
} from '@/api/taxonomies';
import { useTaxonomyTerms } from '@/composables/useTaxonomyTerms';
import { toast } from '@/composables/useToast';
import { useConfirm } from '@/composables/useConfirm';

const { groups, loading, error, ensureLoaded, reload } = useTaxonomyTerms();
const { confirm } = useConfirm();

const selectedId = ref<string | null>(null);

onMounted(async () => {
  await ensureLoaded();
  if (!selectedId.value) selectedId.value = groups.value[0]?.taxonomy.id ?? null;
});

// Keep the selection valid as the cache reloads.
watch(groups, (g) => {
  if (g.length && !g.some((x) => x.taxonomy.id === selectedId.value)) {
    selectedId.value = g[0]?.taxonomy.id ?? null;
  }
});

const selectedGroup = computed(
  () => groups.value.find((g) => g.taxonomy.id === selectedId.value) ?? null,
);
const hierarchical = computed(
  () => selectedGroup.value?.taxonomy.isHierarchical ?? false,
);
const selectedKind = computed<TaxonomyKind | null>(
  () => selectedGroup.value?.taxonomy.kind ?? null,
);
// Group the side list by kind so admins see Categories vs Tags at a glance.
// Sort within each group alphabetically (matches the existing API order).
const categoryGroups = computed(() =>
  groups.value.filter((g) => g.taxonomy.kind === 'category'),
);
const tagGroups = computed(() =>
  groups.value.filter((g) => g.taxonomy.kind === 'tag'),
);
const termNameById = computed(() => {
  const m = new Map<string, string>();
  for (const t of selectedGroup.value?.terms ?? []) m.set(t.id, t.name);
  return m;
});

// ── Search ──
const search = ref('');
const visibleTerms = computed(() => {
  const terms = selectedGroup.value?.terms ?? [];
  const q = search.value.trim().toLowerCase();
  if (!q) return terms;
  return terms.filter(
    (t) =>
      t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q),
  );
});

function select(id: string): void {
  selectedId.value = id;
  search.value = '';
  cancelAdd();
  editingId.value = null;
}

// ── Add term ──
const addOpen = ref(false);
const nName = ref('');
const nSlug = ref('');
const nParent = ref('');
const nTouched = ref(false);
const adding = ref(false);
watch(nName, (v) => {
  if (!nTouched.value) nSlug.value = slugify(v);
});
function openAdd(): void {
  addOpen.value = true;
}
function cancelAdd(): void {
  addOpen.value = false;
  nName.value = '';
  nSlug.value = '';
  nParent.value = '';
  nTouched.value = false;
}
async function onAdd(): Promise<void> {
  if (!selectedId.value || !nName.value || !nSlug.value) return;
  adding.value = true;
  try {
    await taxonomiesApi.createTerm(selectedId.value, {
      name: nName.value,
      slug: nSlug.value,
      parentId: hierarchical.value && nParent.value ? nParent.value : null,
    });
    cancelAdd();
    await reload();
    toast.success('Term added');
  } catch (e) {
    toast.error(
      e instanceof ApiError && e.status === 409
        ? 'A term with this slug already exists.'
        : `Add failed: ${e instanceof Error ? e.message : 'unknown'}`,
    );
  } finally {
    adding.value = false;
  }
}

// ── Inline edit term ──
const editingId = ref<string | null>(null);
const eName = ref('');
const eSlug = ref('');
function startEdit(t: TaxonomyTerm): void {
  editingId.value = t.id;
  eName.value = t.name;
  eSlug.value = t.slug;
}
function cancelEdit(): void {
  editingId.value = null;
}
async function saveEdit(t: TaxonomyTerm): Promise<void> {
  if (!selectedId.value) return;
  try {
    await taxonomiesApi.updateTerm(selectedId.value, t.id, {
      name: eName.value,
      slug: eSlug.value,
    });
    editingId.value = null;
    await reload();
    toast.success('Term updated');
  } catch (e) {
    toast.error(
      e instanceof ApiError && e.status === 409
        ? 'A term with this slug already exists.'
        : `Save failed: ${e instanceof Error ? e.message : 'unknown'}`,
    );
  }
}
async function onDeleteTerm(t: TaxonomyTerm): Promise<void> {
  if (!selectedId.value) return;
  const children = (selectedGroup.value?.terms ?? []).filter(
    (x) => x.parentId === t.id,
  ).length;
  const extra = children > 0 ? ` Its ${children} child term(s) will be orphaned.` : '';
  const ok = await confirm({
    title: 'Delete term',
    message: `Delete term "${t.name}"?${extra}`,
    confirmLabel: 'Delete',
    tone: 'danger',
  });
  if (!ok) return;
  try {
    await taxonomiesApi.removeTerm(selectedId.value, t.id);
    await reload();
    toast.success('Term deleted');
  } catch (e) {
    toast.error(`Delete failed: ${e instanceof Error ? e.message : 'unknown'}`);
  }
}

// ── Drag to reorder terms (within the same parent) ──
const dragTermId = ref<string | null>(null);
const overTermId = ref<string | null>(null);
function onTermDragStart(t: TaxonomyTerm, e: DragEvent): void {
  dragTermId.value = t.id;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', t.id);
  }
}
function onTermDragOver(t: TaxonomyTerm): void {
  if (dragTermId.value && dragTermId.value !== t.id) overTermId.value = t.id;
}
function resetTermDrag(): void {
  dragTermId.value = null;
  overTermId.value = null;
}
async function onTermDrop(t: TaxonomyTerm): Promise<void> {
  const fromId = dragTermId.value;
  resetTermDrag();
  const g = selectedGroup.value;
  if (!fromId || fromId === t.id || !g) return;
  const dragged = g.terms.find((x) => x.id === fromId);
  if (!dragged || dragged.parentId !== t.parentId) return; // reorder within siblings
  const sibs = g.terms.filter((x) => x.parentId === dragged.parentId);
  const fromIdx = sibs.findIndex((s) => s.id === fromId);
  const toIdx = sibs.findIndex((s) => s.id === t.id);
  if (fromIdx < 0 || toIdx < 0) return;
  const arr = [...sibs];
  const moved = arr.splice(fromIdx, 1)[0];
  if (!moved) return;
  arr.splice(toIdx, 0, moved);
  const updates: Promise<unknown>[] = [];
  arr.forEach((s, i) => {
    if (s.sortOrder !== i) {
      updates.push(taxonomiesApi.updateTerm(g.taxonomy.id, s.id, { sortOrder: i }));
    }
  });
  try {
    await Promise.all(updates);
    await reload();
  } catch (e) {
    toast.error(`Reorder failed: ${e instanceof Error ? e.message : 'unknown'}`);
  }
}

// ── New / delete taxonomy ──
const newTaxOpen = ref(false);
const tName = ref('');
const tKind = ref<TaxonomyKind>('category');
const tHier = ref(false);
const creatingTax = ref(false);

// Tags are always flat; switching to tag clears the nesting flag so the
// create payload doesn't get rejected by the server's superRefine guard.
watch(tKind, (k) => {
  if (k === 'tag') tHier.value = false;
});

async function onCreateTaxonomy(): Promise<void> {
  if (!tName.value) return;
  creatingTax.value = true;
  try {
    const res = await taxonomiesApi.create({
      name: tName.value,
      slug: slugify(tName.value),
      kind: tKind.value,
      isHierarchical: tKind.value === 'category' ? tHier.value : false,
    });
    await reload();
    selectedId.value = res.data.id;
    newTaxOpen.value = false;
    tName.value = '';
    tKind.value = 'category';
    tHier.value = false;
    toast.success('Taxonomy created');
  } catch (e) {
    toast.error(
      e instanceof ApiError && e.status === 409
        ? 'A taxonomy with this slug already exists.'
        : `Create failed: ${e instanceof Error ? e.message : 'unknown'}`,
    );
  } finally {
    creatingTax.value = false;
  }
}

// ── Edit the selected taxonomy's kind / hierarchy ──
// Flipping kind issues a PATCH; on tag we also clear isHierarchical in the
// same patch so the server's cross-field rule (tag ⇒ !hierarchical) passes.
const editingKind = ref(false);
async function setSelectedKind(kind: TaxonomyKind): Promise<void> {
  const g = selectedGroup.value;
  if (!g || g.taxonomy.kind === kind) return;

  // Reclassifying moves the taxonomy between the Categories and Tags groups
  // and, for tags, turns nesting off — confirm before the PATCH so it isn't a
  // one-click accident on a populated taxonomy.
  const toTag = kind === 'tag';
  const count = g.terms.length;
  const termLabel = `${count} term${count === 1 ? '' : 's'}`;
  const message = toTag
    ? `Reclassify "${g.taxonomy.name}" from Categories to Tags? Tags are flat, so nesting is turned off and its terms can no longer have parents. The taxonomy and its ${termLabel} move to the Tags group.`
    : `Reclassify "${g.taxonomy.name}" from Tags to Categories? The taxonomy and its ${termLabel} move to the Categories group, and you can enable nested terms afterward.`;
  const ok = await confirm({
    title: toTag ? 'Move to Tags' : 'Move to Categories',
    message,
    confirmLabel: toTag ? 'Move to Tags' : 'Move to Categories',
  });
  if (!ok) return;

  editingKind.value = true;
  try {
    await taxonomiesApi.update(g.taxonomy.id, {
      kind,
      isHierarchical: kind === 'category' ? g.taxonomy.isHierarchical : false,
    });
    await reload();
    toast.success(`Moved to ${kind === 'category' ? 'Categories' : 'Tags'}`);
  } catch (e) {
    toast.error(`Change failed: ${e instanceof Error ? e.message : 'unknown'}`);
  } finally {
    editingKind.value = false;
  }
}
async function toggleSelectedHierarchy(): Promise<void> {
  const g = selectedGroup.value;
  if (!g || g.taxonomy.kind !== 'category') return;
  const next = !g.taxonomy.isHierarchical;
  editingKind.value = true;
  try {
    await taxonomiesApi.update(g.taxonomy.id, { isHierarchical: next });
    await reload();
  } catch (e) {
    toast.error(`Change failed: ${e instanceof Error ? e.message : 'unknown'}`);
  } finally {
    editingKind.value = false;
  }
}
async function onDeleteTaxonomy(): Promise<void> {
  const g = selectedGroup.value;
  if (!g) return;
  const ok = await confirm({
    title: 'Delete taxonomy',
    message: `Delete taxonomy "${g.taxonomy.name}" and all ${g.terms.length} term(s)? This cannot be undone.`,
    confirmLabel: 'Delete',
    tone: 'danger',
  });
  if (!ok) return;
  try {
    await taxonomiesApi.remove(g.taxonomy.id);
    selectedId.value = null;
    await reload();
    toast.success('Taxonomy deleted');
  } catch (e) {
    toast.error(
      e instanceof ApiError && e.status === 409
        ? 'Cannot delete: content references this taxonomy.'
        : `Delete failed: ${e instanceof Error ? e.message : 'unknown'}`,
    );
  }
}
</script>

<template>
  <section>
    <header class="page-header">
      <div>
        <h1 class="page-title">Taxonomy</h1>
        <p class="page-subtitle">Organise content with categories and tags</p>
      </div>
      <button
        type="button"
        class="btn btn-primary"
        :disabled="!selectedGroup"
        @click="openAdd"
      >
        <Icon name="plus" :size="14" /> New Term
      </button>
    </header>

    <p v-if="loading && !groups.length" class="state-msg">Loading…</p>
    <p v-else-if="error" class="state-msg error">{{ error }}</p>

    <div v-else class="tax-layout">
      <!-- Left: taxonomy selector, grouped by kind -->
      <aside class="card tax-side">
        <div class="card-title">Taxonomies</div>
        <div class="tax-list">
          <div v-if="categoryGroups.length" class="tax-section">
            <div class="tax-section-head">
              <Icon name="folder" :size="11" />
              Categories
            </div>
            <button
              v-for="g in categoryGroups"
              :key="g.taxonomy.id"
              type="button"
              class="tax-item"
              :class="{ 'tax-item--active': g.taxonomy.id === selectedId }"
              @click="select(g.taxonomy.id)"
            >
              <span class="tax-item-name">{{ g.taxonomy.name }}</span>
              <span class="tax-count">{{ g.terms.length }}</span>
            </button>
          </div>
          <div v-if="tagGroups.length" class="tax-section">
            <div class="tax-section-head">
              <Icon name="tag" :size="11" />
              Tags
            </div>
            <button
              v-for="g in tagGroups"
              :key="g.taxonomy.id"
              type="button"
              class="tax-item"
              :class="{ 'tax-item--active': g.taxonomy.id === selectedId }"
              @click="select(g.taxonomy.id)"
            >
              <span class="tax-item-name">{{ g.taxonomy.name }}</span>
              <span class="tax-count">{{ g.terms.length }}</span>
            </button>
          </div>
          <p
            v-if="!categoryGroups.length && !tagGroups.length"
            class="muted-empty"
          >
            No taxonomies yet.
          </p>
        </div>

        <div class="tax-side-foot">
          <button
            v-if="!newTaxOpen"
            type="button"
            class="btn btn-ghost btn-sm"
            @click="newTaxOpen = true"
          >
            <Icon name="plus" :size="13" /> New taxonomy
          </button>
          <form v-else class="new-tax" @submit.prevent="onCreateTaxonomy">
            <input
              v-model="tName"
              type="text"
              class="form-input"
              placeholder="Taxonomy name"
              maxlength="100"
            />
            <div class="kind-radio" role="radiogroup" aria-label="Taxonomy kind">
              <label class="kind-opt">
                <input v-model="tKind" type="radio" value="category" />
                <span>Category</span>
              </label>
              <label class="kind-opt">
                <input v-model="tKind" type="radio" value="tag" />
                <span>Tag</span>
              </label>
            </div>
            <label v-if="tKind === 'category'" class="hier">
              <input v-model="tHier" type="checkbox" />
              <span>Allow nested terms</span>
            </label>
            <div class="new-tax-actions">
              <button type="submit" class="btn btn-primary btn-sm" :disabled="creatingTax">
                {{ creatingTax ? 'Creating…' : 'Create' }}
              </button>
              <button type="button" class="btn btn-ghost btn-sm" @click="newTaxOpen = false">
                Cancel
              </button>
            </div>
          </form>
        </div>
      </aside>

      <!-- Right: terms table -->
      <div class="tax-main">
        <div v-if="!selectedGroup" class="card empty-pane">
          <div class="empty-title">No taxonomy selected</div>
          <p>Create a taxonomy to start adding terms.</p>
        </div>

        <div v-else class="table-wrap">
          <div class="table-toolbar">
            <div class="filter-bar">
              <label class="search-input">
                <svg
                  viewBox="0 0 24 24"
                  width="13"
                  height="13"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  v-model="search"
                  type="search"
                  :placeholder="`Search ${selectedGroup.taxonomy.name.toLowerCase()}…`"
                />
              </label>
            </div>
            <div class="toolbar-actions">
              <!-- Inline kind switch: PATCH on flip. Tags clear hierarchy
                   server-side via the same patch (see setSelectedKind). -->
              <div
                class="kind-switch"
                role="radiogroup"
                aria-label="Change taxonomy kind"
              >
                <button
                  type="button"
                  class="kind-pill"
                  :class="{ active: selectedKind === 'category' }"
                  :disabled="editingKind"
                  title="Mark as a Category"
                  @click="setSelectedKind('category')"
                >
                  <Icon name="folder" :size="11" /> Category
                </button>
                <button
                  type="button"
                  class="kind-pill"
                  :class="{ active: selectedKind === 'tag' }"
                  :disabled="editingKind"
                  title="Mark as a Tag (clears nesting)"
                  @click="setSelectedKind('tag')"
                >
                  <Icon name="tag" :size="11" /> Tag
                </button>
              </div>
              <label
                v-if="selectedKind === 'category'"
                class="hier-inline"
                :title="
                  hierarchical
                    ? 'Terms in this category may have parents'
                    : 'Allow nested (parent/child) terms'
                "
              >
                <input
                  type="checkbox"
                  :checked="hierarchical"
                  :disabled="editingKind"
                  @change="toggleSelectedHierarchy"
                />
                <span>Nested</span>
              </label>
              <button
                type="button"
                class="btn btn-ghost btn-sm danger-text"
                title="Delete this taxonomy"
                @click="onDeleteTaxonomy"
              >
                Delete taxonomy
              </button>
            </div>
          </div>

          <div v-if="addOpen" class="add-term">
            <input
              v-model="nName"
              type="text"
              class="form-input"
              placeholder="Term name"
              maxlength="100"
            />
            <input
              v-model="nSlug"
              type="text"
              class="form-input mono"
              placeholder="slug"
              maxlength="100"
              @input="nTouched = true"
            />
            <select v-if="hierarchical" v-model="nParent" class="form-select">
              <option value="">— top level —</option>
              <option
                v-for="t in selectedGroup.terms"
                :key="t.id"
                :value="t.id"
              >
                {{ t.name }}
              </option>
            </select>
            <button type="button" class="btn btn-primary btn-sm" :disabled="adding" @click="onAdd">
              {{ adding ? 'Adding…' : 'Add term' }}
            </button>
            <button type="button" class="btn btn-ghost btn-sm" @click="cancelAdd">
              Cancel
            </button>
          </div>

          <table class="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Slug</th>
                <th>Parent</th>
                <th>Posts</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="t in visibleTerms"
                :key="t.id"
                class="term-row"
                :class="{
                  dragging: dragTermId === t.id,
                  'drag-over': overTermId === t.id,
                }"
                :draggable="editingId !== t.id && !search.trim()"
                @dragstart="onTermDragStart(t, $event)"
                @dragend="resetTermDrag"
                @dragover.prevent="onTermDragOver(t)"
                @drop.prevent="onTermDrop(t)"
              >
                <template v-if="editingId === t.id">
                  <td><input v-model="eName" type="text" class="form-input" maxlength="100" /></td>
                  <td><input v-model="eSlug" type="text" class="form-input mono" maxlength="100" /></td>
                  <td>{{ t.parentId ? termNameById.get(t.parentId) ?? '—' : '—' }}</td>
                  <td>—</td>
                  <td>
                    <div class="actions">
                      <button type="button" class="btn btn-primary btn-sm" @click="saveEdit(t)">
                        Save
                      </button>
                      <button type="button" class="btn btn-ghost btn-sm" @click="cancelEdit">
                        Cancel
                      </button>
                    </div>
                  </td>
                </template>
                <template v-else>
                  <td>
                    <span
                      class="term-name"
                      :style="{ paddingLeft: t.depth * 1.25 + 'rem' }"
                    >
                      <span v-if="t.depth > 0" class="arrow" aria-hidden="true">→</span>
                      <span :class="{ 'name-strong': t.depth === 0 }">{{ t.name }}</span>
                    </span>
                  </td>
                  <td class="mono cell-muted">{{ t.slug }}</td>
                  <td class="cell-muted">
                    {{ t.parentId ? termNameById.get(t.parentId) ?? '—' : '—' }}
                  </td>
                  <td class="cell-muted">—</td>
                  <td>
                    <div class="actions">
                      <button
                        type="button"
                        class="icon-btn"
                        title="Edit"
                        aria-label="Edit"
                        @click="startEdit(t)"
                      >
                        <Icon name="edit" />
                      </button>
                      <button
                        type="button"
                        class="icon-btn icon-btn--danger"
                        title="Delete"
                        aria-label="Delete"
                        @click="onDeleteTerm(t)"
                      >
                        <Icon name="trash" />
                      </button>
                    </div>
                  </td>
                </template>
              </tr>
            </tbody>
          </table>

          <p v-if="visibleTerms.length === 0" class="state-msg">
            {{ search ? 'No terms match your search.' : 'No terms yet — add one.' }}
          </p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.state-msg {
  padding: 24px 4px;
  color: var(--muted);
  font-size: 0.9rem;
}
.state-msg.error {
  color: var(--danger);
}

.tax-layout {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}
.tax-side {
  width: 260px;
  flex-shrink: 0;
}
.tax-main {
  flex: 1;
  min-width: 0;
}
@media (max-width: 820px) {
  .tax-layout {
    flex-direction: column;
  }
  .tax-side {
    width: 100%;
  }
}

.tax-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 4px;
}
.tax-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tax-section-head {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}
.muted-empty {
  padding: 8px 10px;
  font-size: 12px;
  color: var(--muted);
}
.tax-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  background: none;
  border-radius: var(--radius);
  cursor: pointer;
  color: var(--fg);
  font-size: 13.5px;
  font-family: inherit;
  text-align: left;
}
.tax-item:hover {
  background: var(--bg);
}
.tax-item--active {
  background: var(--accent-soft);
  color: var(--accent-hover);
  font-weight: 600;
}
.tax-count {
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  background: var(--bg);
  padding: 1px 8px;
  border-radius: 10px;
}
.tax-item--active .tax-count {
  background: var(--surface);
  color: var(--accent-hover);
}

.tax-side-foot {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-soft);
}
.new-tax {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.kind-radio {
  display: flex;
  gap: 10px;
  font-size: 12px;
  color: var(--muted);
}
.kind-opt {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}
.hier {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}
.new-tax-actions {
  display: flex;
  gap: 6px;
}

/* Toolbar inline controls for the selected taxonomy. */
.toolbar-actions {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.kind-switch {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 2px;
  background: var(--bg);
}
.kind-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 0;
  background: transparent;
  font-family: inherit;
  font-size: 12px;
  color: var(--muted);
  padding: 4px 10px;
  border-radius: 999px;
  cursor: pointer;
}
.kind-pill:hover:not(:disabled) {
  color: var(--fg);
}
.kind-pill.active {
  background: var(--surface);
  color: var(--fg);
  box-shadow: 0 1px 0 rgb(0 0 0 / 0.04);
}
.kind-pill:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.hier-inline {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--muted);
  user-select: none;
}

.empty-pane {
  text-align: center;
  color: var(--muted);
}
.empty-pane .empty-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--fg);
  margin-bottom: 4px;
}

.add-term {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border-soft);
  background: var(--bg);
}
.add-term .form-input {
  width: auto;
  flex: 1;
  min-width: 140px;
}
.add-term .form-select {
  width: auto;
}

.term-name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.name-strong {
  font-weight: 600;
}
.arrow {
  color: var(--text-tertiary);
}
.cell-muted {
  color: var(--muted);
}
.danger-text {
  color: var(--danger);
}
.danger-text:hover {
  background: var(--danger-soft);
  color: var(--danger);
}
.term-row[draggable='true'] {
  cursor: move;
}
.term-row.dragging {
  opacity: 0.45;
}
.term-row.drag-over td {
  background: var(--accent-soft);
  box-shadow: inset 0 2px 0 var(--accent);
}
</style>
