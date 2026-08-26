<script setup lang="ts">
import { computed } from 'vue';
import type { ContentStatus } from '@/api/content';

// Mirror of the server's ALLOWED_TRANSITIONS in
// apps/api/src/routes/admin/content.ts. The server is the source of
// truth; this map just hides buttons that would be rejected anyway.
const ALLOWED_TRANSITIONS: Record<ContentStatus, readonly ContentStatus[]> = {
  draft: ['in_review', 'scheduled', 'published'],
  in_review: ['draft', 'approved'],
  approved: ['draft', 'scheduled', 'published'],
  scheduled: ['draft', 'published'],
  published: ['archived'],
  archived: ['draft'],
};

const props = defineProps<{
  currentStatus: ContentStatus;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  transition: [to: ContentStatus];
}>();

const allowed = computed(() => ALLOWED_TRANSITIONS[props.currentStatus] ?? []);
</script>

<template>
  <div class="transitions">
    <p class="current">
      Status:
      <span :class="`status status--${currentStatus}`">{{ currentStatus }}</span>
    </p>
    <div v-if="allowed.length > 0" class="actions">
      <button
        v-for="to in allowed"
        :key="to"
        type="button"
        class="btn"
        :disabled="disabled"
        @click="emit('transition', to)"
      >
        → {{ to.replace('_', ' ') }}
      </button>
    </div>
    <p v-else class="muted">No allowed transitions from this state.</p>
  </div>
</template>

<style scoped>
.transitions {
  padding: 0.875rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
}
.current {
  margin: 0 0 0.625rem;
  font-size: 0.875rem;
}
.status {
  display: inline-block;
  font-size: 0.6875rem;
  padding: 0.125rem 0.5rem;
  border-radius: 999px;
  background: var(--border);
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 500;
}
.status--draft     { background: rgba(107,114,128,.15); color: var(--muted); }
.status--in_review { background: rgba(245,158,11,.15);  color: #d97706; }
.status--approved  { background: rgba(59,130,246,.15);  color: var(--accent); }
.status--scheduled { background: rgba(139,92,246,.15);  color: #8b5cf6; }
.status--published { background: rgba(34,197,94,.15);   color: #16a34a; }
.status--archived  { background: rgba(107,114,128,.15); color: var(--muted); opacity: .7; }

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.btn {
  padding: 0.375rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
  font-size: 0.8125rem;
}
.btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.muted {
  color: var(--muted);
  font-size: 0.875rem;
}
</style>
