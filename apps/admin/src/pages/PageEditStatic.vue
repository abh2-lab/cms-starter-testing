<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import Icon from '@/components/Icon.vue';
import StaticEditor from '@/components/static/StaticEditor.vue';
import { usePageEditorShell } from '@/composables/usePageEditorShell';

// Static page editor — renders INSIDE AppLayout. The sticky editor topbar
// below extends from edge to edge by negating .content-area's 24px padding,
// matching the mockup's full-width strip. The 2-column body lives in
// StaticEditor.vue.

const shell = usePageEditorShell({
  expectedType: 'static',
  mismatchRedirect: (id) => ({
    name: 'page-edit-dynamic',
    params: { id },
  }),
});

const moreRef = ref<HTMLElement | null>(null);
const moreOpen = ref(false);
function toggleMore(): void {
  moreOpen.value = !moreOpen.value;
}
function closeMore(): void {
  moreOpen.value = false;
}
function onDocClick(e: MouseEvent): void {
  if (!moreRef.value) return;
  if (!moreRef.value.contains(e.target as Node)) moreOpen.value = false;
}
onMounted(() => document.addEventListener('click', onDocClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));

// Map the shell's saveState into mockup-style badge variants. Errors stay
// in the "unsaved" tone with a retry-flavored label rather than a new color.
const saveBadge = computed<{ cls: 'unsaved' | 'saving' | 'saved'; label: string }>(() => {
  const s = shell.saveState.value;
  if (s === 'saving') return { cls: 'saving', label: 'Saving…' };
  if (s === 'error') return { cls: 'unsaved', label: 'Save failed — retry' };
  if (s === 'dirty') return { cls: 'unsaved', label: 'Unsaved changes' };
  return { cls: 'saved', label: 'All changes saved' };
});

const statusKey = computed(() => shell.page.value?.status ?? 'draft');
const canPublish = computed(() => shell.canPublish.value);
const canSendForReview = computed(() =>
  shell.availableTransitions.value.includes('in_review'),
);
const canSchedule = computed(() =>
  shell.availableTransitions.value.includes('scheduled'),
);
const canArchive = computed(() =>
  shell.availableTransitions.value.includes('archived'),
);
const canMoveToDraft = computed(() =>
  shell.availableTransitions.value.includes('draft'),
);
const canApprove = computed(() =>
  shell.availableTransitions.value.includes('approved'),
);
const canDelete = computed(
  () => !!shell.page.value && !shell.page.value.systemManaged,
);
</script>

<template>
  <section class="static-edit">
    <!-- ── Sticky editor topbar ───────────────────────────────────────── -->
    <header class="editor-topbar">
      <div class="et-left">
        <RouterLink :to="{ name: 'pages' }" class="et-back">
          <Icon name="chevron-left" :size="13" />
          Pages
        </RouterLink>
        <span class="et-divider" aria-hidden="true" />
        <div class="et-identity">
          <div class="et-name" :title="shell.title.value">
            {{ shell.title.value || 'Untitled page' }}
          </div>
          <div class="et-slug">/{{ shell.slug.value || '…' }}</div>
        </div>
      </div>

      <div class="et-center">
        <span :class="['save-badge', `save-badge--${saveBadge.cls}`]">
          <span class="save-dot" aria-hidden="true" />
          <span>{{ saveBadge.label }}</span>
        </span>
      </div>

      <div class="et-right">
        <span :class="['status-pill', `status-pill--${statusKey}`]">
          {{ shell.statusLabel.value }}
        </span>

        <button
          type="button"
          class="et-btn"
          :disabled="!shell.page.value"
          @click="shell.onPreviewInNewTab"
        >
          <Icon name="eye" :size="13" />
          Preview
        </button>

        <button
          v-if="canSendForReview"
          type="button"
          class="et-btn"
          :disabled="shell.transitioning.value"
          @click="shell.onTransition('in_review')"
        >
          <Icon name="send" :size="13" />
          Send for review
        </button>

        <div ref="moreRef" class="et-more-wrap">
          <button
            type="button"
            class="et-more"
            title="More actions"
            aria-label="More actions"
            @click.stop="toggleMore"
          >
            <svg
              width="4"
              height="14"
              fill="currentColor"
              viewBox="0 0 4 18"
              aria-hidden="true"
            >
              <circle cx="2" cy="2" r="2" />
              <circle cx="2" cy="9" r="2" />
              <circle cx="2" cy="16" r="2" />
            </svg>
          </button>
          <div v-if="moreOpen" class="et-more-menu" @click="closeMore">
            <button
              v-if="canSchedule"
              type="button"
              class="et-more-item"
              :disabled="shell.transitioning.value"
              @click="shell.onTransition('scheduled')"
            >
              <Icon name="clock" :size="13" />
              Schedule
            </button>
            <button
              v-if="canApprove"
              type="button"
              class="et-more-item"
              :disabled="shell.transitioning.value"
              @click="shell.onTransition('approved')"
            >
              <Icon name="check" :size="13" />
              Approve
            </button>
            <button
              type="button"
              class="et-more-item"
              :disabled="!shell.page.value"
              @click="shell.onDuplicate"
            >
              <Icon name="copy" :size="13" />
              Duplicate
            </button>
            <button
              v-if="canMoveToDraft"
              type="button"
              class="et-more-item"
              :disabled="shell.transitioning.value"
              @click="shell.onTransition('draft')"
            >
              Move to draft
            </button>
            <button
              v-if="canArchive"
              type="button"
              class="et-more-item"
              :disabled="shell.transitioning.value"
              @click="shell.onTransition('archived')"
            >
              Archive
            </button>
            <div v-if="canDelete" class="et-more-sep" />
            <button
              v-if="canDelete"
              type="button"
              class="et-more-item et-more-item--danger"
              @click="shell.onDelete"
            >
              <Icon name="trash" :size="13" />
              Delete page
            </button>
          </div>
        </div>

        <button
          v-if="canPublish"
          type="button"
          class="et-publish"
          :disabled="shell.transitioning.value || !shell.page.value"
          @click="shell.onTransition('published')"
        >
          <Icon name="check" :size="13" />
          Publish
        </button>
        <button
          v-else
          type="button"
          class="et-publish et-publish--neutral"
          :disabled="shell.saving.value || !shell.page.value"
          @click="shell.onSave"
        >
          <Icon name="check" :size="13" />
          {{ shell.saving.value ? 'Saving…' : 'Save Draft' }}
        </button>
      </div>
    </header>

    <!-- ── Body ───────────────────────────────────────────────────────── -->
    <div v-if="shell.page.value" class="editor-body">
      <StaticEditor
        v-model:title="shell.title.value"
        v-model:slug="shell.slug.value"
        v-model:html="shell.htmlInput.value"
        v-model:css="shell.cssInput.value"
        v-model:layout-template="shell.layoutTemplate.value"
        v-model:content-mode="shell.contentMode.value"
        v-model:body="shell.bodyInput.value"
        v-model:locale="shell.locale.value"
        v-model:seo="shell.seoState.value"
        :layout-options="shell.layoutOptions.value"
        :status="statusKey"
        :status-label="shell.statusLabel.value"
        :saving="shell.saving.value"
        :transitioning="shell.transitioning.value"
        :can-publish="canPublish"
        @save="shell.onSave"
        @publish="shell.onTransition('published')"
        @preview="shell.onPreviewInNewTab"
      />
    </div>
    <p v-else-if="shell.loading.value" class="muted center pad">Loading…</p>
    <p v-else-if="shell.loadError.value" class="error center pad">
      {{ shell.loadError.value }}
    </p>
  </section>
</template>

<style scoped>
/* Escape AppLayout's .content-area 24px padding so the topbar can stretch
   edge-to-edge while the body keeps its own 24px gutter. The .editor-topbar
   primitive lives in styles.css; sticky positioning is local because only the
   AppLayout-embedded static editor needs it — the full-screen dynamic editor
   sits inside a flex column and stays put without sticky. */
.static-edit {
  margin: -24px;
}
.editor-topbar {
  position: sticky;
  top: -24px;
  z-index: 5;
}

/* Restore 24px gutter the .static-edit margin took away. */
.editor-body {
  padding: 24px;
}

.muted {
  color: var(--muted);
}
.error {
  color: var(--danger);
}
.center {
  text-align: center;
}
.pad {
  padding: 2rem 24px;
}
</style>
