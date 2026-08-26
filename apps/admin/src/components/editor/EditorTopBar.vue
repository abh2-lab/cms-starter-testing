<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import Icon from '@/components/Icon.vue';
import type { ContentStatus } from '@/api/content';

// Status-driven button cluster. Each entry below mirrors a row of the API's
// ALLOWED_TRANSITIONS map (apps/api/src/routes/admin/content.ts:45) so we
// never render a button the server would reject. Labels are explicit about
// whether the click will save-only or change state — the user's complaint
// was that "Save Draft" hid the fact that publish/state-changes happen
// elsewhere. The "Save" button always means "PATCH /content/:id with the
// current edits, no state change."
//
// Roles: 'author' can submit for review; 'editor' can transition forward,
// publish, archive, and restore. 'viewer' sees no action buttons at all.

const props = defineProps<{
  contentTypeName: string | null;
  status: ContentStatus;
  dirty: boolean;
  saving: boolean;
  transitioning: boolean;
  savedLabel: string;
  /** True when the current user's role rank is >= 'editor'. */
  canEdit: boolean;
  /** True when the current user's role rank is >= 'author'. */
  canAuthor: boolean;
  /**
   * True when the post has a publishAt set; required for `scheduled`.
   * The Schedule button stays disabled (with hint) when false so the user
   * doesn't get a 400 from the server.
   */
  hasPublishAt: boolean;
  /**
   * New-post mode: the row doesn't exist yet (created by the first save).
   * Preview and status transitions need a persisted row, so they render
   * disabled with a "save first" hint until then.
   */
  isNew?: boolean;
}>();

const emit = defineEmits<{
  save: [];
  transition: [to: ContentStatus];
  preview: [];
}>();

// "Save Draft" only makes sense on a draft; everywhere else "Save" is more
// accurate (the post already has a non-draft state and the click won't
// change it).
const saveLabel = computed(() =>
  props.status === 'draft' ? 'Save Draft' : 'Save',
);

const busy = computed(() => props.saving || props.transitioning);
</script>

<template>
  <div class="topbar">
    <RouterLink :to="{ name: 'content' }" class="back">
      <Icon name="chevron-left" :size="14" />
      All Content
    </RouterLink>

    <span class="sep" />

    <span v-if="contentTypeName" class="ct-chip">
      <span class="ct-dot" />
      {{ contentTypeName }}
    </span>

    <span class="save-status">
      <span class="save-status-dot" :class="{ dirty }" />
      {{ dirty ? 'Unsaved changes' : savedLabel }}
    </span>

    <div class="right">
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        :disabled="busy || isNew"
        :title="
          isNew
            ? 'Save the draft first'
            : 'Open this post on the public site in a new tab. Unsaved edits are saved first.'
        "
        @click="emit('preview')"
      >
        <Icon name="eye" :size="13" />
        Preview
      </button>

      <!-- ── draft ────────────────────────────────────────────────── -->
      <template v-if="status === 'draft'">
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="busy || !dirty"
          @click="emit('save')"
        >
          {{ saving ? 'Saving…' : saveLabel }}
        </button>
        <button
          v-if="canAuthor"
          type="button"
          class="btn btn-sm btn-review"
          :disabled="busy || isNew"
          :title="isNew ? 'Save the draft first' : undefined"
          @click="emit('transition', 'in_review')"
        >
          <Icon name="send" :size="13" />
          Submit for Review
        </button>
        <button
          v-if="canEdit"
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="busy || isNew"
          :title="isNew ? 'Save the draft first' : undefined"
          @click="emit('transition', 'published')"
        >
          <Icon name="check" :size="13" />
          Publish
        </button>
      </template>

      <!-- ── in_review ───────────────────────────────────────────── -->
      <template v-else-if="status === 'in_review'">
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="busy || !dirty"
          @click="emit('save')"
        >
          {{ saving ? 'Saving…' : saveLabel }}
        </button>
        <button
          v-if="canEdit"
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="busy"
          @click="emit('transition', 'draft')"
        >
          Request Changes
        </button>
        <button
          v-if="canEdit"
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="busy"
          @click="emit('transition', 'approved')"
        >
          <Icon name="check" :size="13" />
          Approve
        </button>
      </template>

      <!-- ── approved ────────────────────────────────────────────── -->
      <template v-else-if="status === 'approved'">
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="busy || !dirty"
          @click="emit('save')"
        >
          {{ saving ? 'Saving…' : saveLabel }}
        </button>
        <button
          v-if="canEdit"
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="busy || !hasPublishAt"
          :title="
            hasPublishAt
              ? 'Schedule auto-publish at the set time'
              : 'Set “Schedule publish” in the sidebar first'
          "
          @click="emit('transition', 'scheduled')"
        >
          <Icon name="clock" :size="13" />
          Schedule
        </button>
        <button
          v-if="canEdit"
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="busy"
          @click="emit('transition', 'published')"
        >
          <Icon name="check" :size="13" />
          Publish
        </button>
      </template>

      <!-- ── scheduled ───────────────────────────────────────────── -->
      <template v-else-if="status === 'scheduled'">
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="busy || !dirty"
          @click="emit('save')"
        >
          {{ saving ? 'Saving…' : saveLabel }}
        </button>
        <button
          v-if="canEdit"
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="busy"
          @click="emit('transition', 'draft')"
        >
          Unschedule
        </button>
        <button
          v-if="canEdit"
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="busy"
          @click="emit('transition', 'published')"
        >
          <Icon name="check" :size="13" />
          Publish Now
        </button>
      </template>

      <!-- ── published ───────────────────────────────────────────── -->
      <!-- Only outgoing edge from `published` is `→ archived` (see API:50).
           "Save" still PATCHes content edits without state change. -->
      <template v-else-if="status === 'published'">
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="busy || !dirty"
          @click="emit('save')"
        >
          {{ saving ? 'Saving…' : saveLabel }}
        </button>
        <button
          v-if="canEdit"
          type="button"
          class="btn btn-danger btn-sm"
          :disabled="busy"
          @click="emit('transition', 'archived')"
        >
          Archive
        </button>
      </template>

      <!-- ── archived ────────────────────────────────────────────── -->
      <template v-else-if="status === 'archived'">
        <button
          v-if="canEdit"
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="busy"
          @click="emit('transition', 'draft')"
        >
          Restore to Draft
        </button>
      </template>

      <span class="sep" />
      <span class="badge" :class="`badge-${status}`">{{
        status.replace('_', ' ')
      }}</span>
    </div>
  </div>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 52px;
  padding: 0 20px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.back {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--muted);
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
  padding: 5px 8px;
  border-radius: var(--radius-sm);
}
.back:hover {
  background: var(--bg);
  color: var(--fg);
}
.sep {
  width: 1px;
  height: 20px;
  background: var(--border);
  flex-shrink: 0;
}
.ct-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--purple-soft);
  border-radius: 20px;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 700;
  color: var(--purple);
  letter-spacing: 0.02em;
}
.ct-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--purple);
}
.save-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-tertiary);
}
.save-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
}
.save-status-dot.dirty {
  background: var(--warning);
}
.right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
.btn-review {
  background: var(--warning-soft);
  color: var(--warning);
  border-color: transparent;
}
.btn-review:hover {
  filter: brightness(0.97);
}
</style>
