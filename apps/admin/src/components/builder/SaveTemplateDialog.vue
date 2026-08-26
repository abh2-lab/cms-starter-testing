<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { ApiError } from '@/lib/api';
import {
  pageTemplatesApi,
  type PageTemplate,
} from '@/api/page-templates';
import { toast } from '@/composables/useToast';

// Modal for "Save current arrangement as a Template". Lives inside the dynamic
// builder; opened from BuilderLibrary's "+ Save current" button or the right
// rail's "Save as Template" button. Captures arrangement only (block keys +
// order) per the requirement — field values stay per-page.
//
// The mockup omits the description textarea from earlier iterations; the
// underlying API still accepts `description` as optional but new templates
// from this editor won't carry one.

const props = defineProps<{
  open: boolean;
  blockKeys: readonly string[];
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'saved', template: PageTemplate): void;
}>();

const name = ref('');
const submitting = ref(false);
const nameInput = ref<HTMLInputElement | null>(null);

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return;
    name.value = '';
    submitting.value = false;
    await nextTick();
    nameInput.value?.focus();
  },
);

async function onSubmit(): Promise<void> {
  const trimmed = name.value.trim();
  if (!trimmed) return;
  if (props.blockKeys.length === 0) {
    toast.error('Add some blocks before saving a template.');
    return;
  }
  submitting.value = true;
  try {
    const res = await pageTemplatesApi.create({
      name: trimmed,
      blockKeys: [...props.blockKeys],
    });
    toast.success(`Template "${res.data.name}" saved.`);
    emit('saved', res.data);
    emit('close');
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      toast.error('A template with this name already exists.');
    } else {
      toast.error(e instanceof Error ? e.message : 'Could not save template');
    }
  } finally {
    submitting.value = false;
  }
}

function onCancel(): void {
  if (submitting.value) return;
  emit('close');
}
</script>

<template>
  <div
    v-if="open"
    class="modal-overlay"
    @click.self="onCancel"
  >
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-template-title"
    >
      <div id="save-template-title" class="modal-title">Save as Template</div>
      <div class="modal-sub">
        Saves the current block arrangement as a reusable starting point.
        Only the block order is saved — not the field values.
      </div>
      <form @submit.prevent="onSubmit">
        <input
          ref="nameInput"
          v-model="name"
          type="text"
          maxlength="200"
          required
          class="modal-input"
          placeholder="e.g. Standard Homepage"
        />
        <div class="modal-footer">
          <button
            type="button"
            class="mbtn"
            :disabled="submitting"
            @click="onCancel"
          >Cancel</button>
          <button
            type="submit"
            class="mbtn primary"
            :disabled="submitting || !name.trim()"
          >{{ submitting ? 'Saving…' : 'Save Template' }}</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal {
  background: var(--surface);
  border-radius: var(--radius-lg);
  padding: 24px;
  width: 360px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18);
}
.modal-title {
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 6px;
  color: var(--fg);
}
.modal-sub {
  font-size: 12.5px;
  color: var(--muted);
  margin-bottom: 16px;
  line-height: 1.55;
}
.modal-input {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-family: inherit;
  font-size: 13px;
  color: var(--fg);
  background: var(--surface);
  outline: none;
  margin-bottom: 14px;
}
.modal-input:focus {
  border-color: var(--info);
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.08);
}
.modal-footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.mbtn {
  padding: 7px 16px;
  border-radius: var(--radius);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--fg);
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.mbtn:hover:not(:disabled) {
  background: var(--bg);
}
.mbtn.primary {
  background: var(--purple);
  color: #fff;
  border-color: var(--purple);
}
.mbtn.primary:hover:not(:disabled) {
  background: #6d28d9;
  border-color: #6d28d9;
}
.mbtn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
