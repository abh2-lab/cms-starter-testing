<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router';
import {
  themeApi,
  type BlockDefaultsDetail,
} from '@/api/theme';
import BlockFieldsForm from '@/components/BlockFieldsForm.vue';
import Icon from '@/components/Icon.vue';
import { toast } from '@/composables/useToast';
import { useConfirm } from '@/composables/useConfirm';

// Block-defaults editor (theme engine v2 Phase 5). Opened from the Block
// Gallery's "Edit" for a block that has editable copy/sources. Edits the
// block's DEFAULT fields (copy) + options (sources) and saves them as a DB
// override that applies site-wide, wherever the block is used (per-page/
// template instance edits still win). Same draft → publish → reset lifecycle
// as template/part overrides, with a reload-only iframe preview of the draft.

const route = useRoute();
const router = useRouter();
const { confirm } = useConfirm();

const blockKey = computed(() => String(route.params['key'] ?? ''));

const detail = ref<BlockDefaultsDetail | null>(null);
const fields = ref<Record<string, unknown>>({});
const options = ref<Record<string, unknown>>({});
const loading = ref(true);
const loadError = ref<string | null>(null);
const busy = ref(false);
const dirty = ref(false);

const previewUrl = ref<string | null>(null);
const previewKey = ref(0);

let suppressDirty = false;
function seed(d: BlockDefaultsDetail): void {
  suppressDirty = true;
  // Show the current effective default: draft → published → code, always with
  // every schema key present so each input renders.
  fields.value = {
    ...d.codeFields,
    ...(d.draft?.fields ?? d.published?.fields ?? {}),
  };
  options.value = {
    ...d.codeOptions,
    ...(d.draft?.options ?? d.published?.options ?? {}),
  };
  dirty.value = false;
}

watch(
  [fields, options],
  () => {
    if (suppressDirty) {
      suppressDirty = false;
      return;
    }
    dirty.value = true;
  },
  { deep: true },
);

const statusLabel = computed(() => {
  const d = detail.value;
  if (!d) return '';
  if (d.hasDraft) return 'Draft';
  if (d.customized) return 'Customized';
  return 'Default';
});

const hasOptions = computed(() => (detail.value?.optionsSchema.length ?? 0) > 0);
const hasFields = computed(() => (detail.value?.fieldsSchema.length ?? 0) > 0);

async function refreshPreview(): Promise<void> {
  try {
    const res = await themeApi.blockPreviewToken(blockKey.value);
    previewUrl.value = res.data.previewUrl;
    previewKey.value += 1;
  } catch {
    previewUrl.value = null;
  }
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    const res = await themeApi.blockDefaults(blockKey.value);
    detail.value = res.data;
    seed(res.data);
    await refreshPreview();
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Failed to load block';
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  busy.value = true;
  try {
    await themeApi.saveBlockDefaults(blockKey.value, fields.value, options.value);
    dirty.value = false;
    toast.success('Draft saved');
    const res = await themeApi.blockDefaults(blockKey.value);
    detail.value = res.data;
    await refreshPreview();
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Save failed');
  } finally {
    busy.value = false;
  }
}

async function publish(): Promise<void> {
  if (dirty.value) {
    toast.error('Save the draft first — Publish makes the saved draft live.');
    return;
  }
  if (!detail.value?.hasDraft) {
    toast.error('Nothing to publish — save a draft first.');
    return;
  }
  const ok = await confirm({
    title: 'Publish block default',
    message: `This becomes the default for "${detail.value.label}" wherever it appears on the public site (pages and templates that don't set their own value). Publish now?`,
    confirmLabel: 'Publish',
  });
  if (!ok) return;
  busy.value = true;
  try {
    await themeApi.publishBlockDefaults(blockKey.value);
    toast.success('Published');
    const res = await themeApi.blockDefaults(blockKey.value);
    detail.value = res.data;
    seed(res.data);
    await refreshPreview();
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Publish failed');
  } finally {
    busy.value = false;
  }
}

async function discard(): Promise<void> {
  const ok = await confirm({
    title: 'Discard draft',
    message: 'Discard the saved draft? Unpublished changes are lost.',
    confirmLabel: 'Discard',
    tone: 'danger',
  });
  if (!ok) return;
  busy.value = true;
  try {
    await themeApi.discardBlockDraft(blockKey.value);
    const res = await themeApi.blockDefaults(blockKey.value);
    detail.value = res.data;
    seed(res.data);
    await refreshPreview();
    toast.success('Draft discarded');
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Discard failed');
  } finally {
    busy.value = false;
  }
}

async function reset(): Promise<void> {
  const ok = await confirm({
    title: 'Reset to default',
    message: `Reset "${detail.value?.label ?? blockKey.value}" to its built-in default? The published override and any draft are deleted, reverting it everywhere it's used.`,
    confirmLabel: 'Reset',
    tone: 'danger',
  });
  if (!ok) return;
  busy.value = true;
  try {
    await themeApi.resetBlockDefaults(blockKey.value);
    toast.success('Reset to default');
    const res = await themeApi.blockDefaults(blockKey.value);
    detail.value = res.data;
    seed(res.data);
    await refreshPreview();
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Reset failed');
  } finally {
    busy.value = false;
  }
}

function onFieldsUpdate(next: Record<string, unknown>): void {
  fields.value = next;
}
function onOptionsUpdate(next: Record<string, unknown>): void {
  options.value = next;
}

onMounted(load);
onBeforeRouteLeave(async () => {
  if (!dirty.value) return true;
  return confirm({
    title: 'Discard changes?',
    message: 'You have unsaved changes. Leave without saving?',
    confirmLabel: 'Discard',
    tone: 'danger',
  });
});
</script>

<template>
  <section class="bde">
    <div class="bde-topbar">
      <button
        type="button"
        class="bde-back"
        @click="router.push({ name: 'block-gallery' })"
      >
        <Icon name="arrow-left" :size="15" /> Block Gallery
      </button>
      <div class="bde-title">
        <span class="bde-name">{{ detail?.label ?? blockKey }}</span>
        <code class="bde-key">{{ blockKey }}</code>
        <span v-if="statusLabel" class="bde-status">{{ statusLabel }}</span>
        <span v-if="dirty" class="bde-dot" title="Unsaved changes">●</span>
      </div>
      <div class="bde-actions">
        <button
          v-if="detail?.hasDraft"
          type="button"
          class="btn-ghost"
          :disabled="busy"
          @click="discard"
        >
          Discard
        </button>
        <button
          v-if="detail?.customized || detail?.hasDraft"
          type="button"
          class="btn-ghost bde-danger"
          :disabled="busy"
          @click="reset"
        >
          Reset
        </button>
        <button
          type="button"
          class="btn-outline"
          :disabled="busy || !dirty"
          @click="save"
        >
          Save draft
        </button>
        <button
          type="button"
          class="btn-primary"
          :disabled="busy || dirty || !detail?.hasDraft"
          @click="publish"
        >
          Publish
        </button>
      </div>
    </div>

    <div v-if="loadError" class="bde-banner bde-banner--error">
      {{ loadError }}
    </div>
    <div v-else-if="loading" class="bde-banner">Loading…</div>

    <div v-else class="bde-body">
      <div class="bde-forms">
        <p class="bde-hint">
          Edit this block's default content. Saved values apply wherever the
          block is used, unless a specific page or template overrides them.
        </p>

        <div v-if="hasFields" class="bde-card">
          <h2 class="bde-card-title">Copy</h2>
          <BlockFieldsForm
            :schema="detail!.fieldsSchema"
            :values="fields"
            @update="onFieldsUpdate"
          />
        </div>

        <div v-if="hasOptions" class="bde-card">
          <h2 class="bde-card-title">Sources</h2>
          <BlockFieldsForm
            :schema="detail!.optionsSchema"
            :values="options"
            @update="onOptionsUpdate"
          />
        </div>

        <p v-if="!hasFields && !hasOptions" class="bde-hint">
          This block has no editable fields.
        </p>
      </div>

      <div class="bde-preview">
        <div class="bde-preview-head">
          <span>Preview</span>
          <span class="bde-preview-note">Reflects the saved draft</span>
        </div>
        <div class="bde-preview-frame">
          <iframe
            v-if="previewUrl"
            :key="previewKey"
            :src="previewUrl"
            title="Block preview"
            class="bde-iframe"
          />
          <div v-else class="bde-preview-empty">
            Set your Site URL in Site Settings to preview.
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.bde {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.bde-topbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.bde-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  color: var(--muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: var(--radius);
}
.bde-back:hover {
  color: var(--fg, #111);
  background: var(--bg);
}
.bde-title {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}
.bde-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--fg, #111);
}
.bde-key {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12px;
  color: var(--text-tertiary);
}
.bde-status {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--muted);
}
.bde-dot {
  color: var(--accent);
  font-size: 12px;
}
.bde-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.bde-danger {
  color: var(--danger);
}
.bde-banner {
  padding: 10px 14px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface);
  font-size: 13px;
  color: var(--muted);
}
.bde-banner--error {
  border-color: #fecaca;
  background: var(--danger-soft);
  color: var(--danger);
}
.bde-body {
  display: grid;
  grid-template-columns: minmax(0, 420px) minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}
@media (max-width: 900px) {
  .bde-body {
    grid-template-columns: 1fr;
  }
}
.bde-forms {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.bde-hint {
  font-size: 12.5px;
  color: var(--muted);
  line-height: 1.5;
  margin: 0;
}
.bde-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  padding: 16px;
}
.bde-card-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  margin: 0 0 12px;
}
.bde-preview {
  position: sticky;
  top: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  overflow: hidden;
}
.bde-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  font-weight: 600;
  color: var(--fg, #111);
}
.bde-preview-note {
  font-weight: 400;
  color: var(--text-tertiary);
}
.bde-preview-frame {
  height: 70vh;
  min-height: 420px;
  background: #fff;
}
.bde-iframe {
  width: 100%;
  height: 100%;
  border: none;
}
.bde-preview-empty {
  padding: 24px;
  font-size: 13px;
  color: var(--muted);
  text-align: center;
}
</style>
