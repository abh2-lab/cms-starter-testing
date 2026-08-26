<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { contentApi, type ContentRevision } from '@/api/content';

const props = defineProps<{
  contentId: string;
}>();

const revisions = ref<ContentRevision[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const expanded = ref<Set<string>>(new Set());

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await contentApi.listRevisions(props.contentId);
    revisions.value = res.data;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load revisions';
  } finally {
    loading.value = false;
  }
}

function toggle(id: string): void {
  if (expanded.value.has(id)) {
    expanded.value.delete(id);
  } else {
    expanded.value.add(id);
  }
  // Force reactivity since Set mutations aren't tracked
  expanded.value = new Set(expanded.value);
}

function snapshotTitle(rev: ContentRevision): string {
  const v = rev.snapshot['title'];
  return typeof v === 'string' ? v : '(no title)';
}

function snapshotStatus(rev: ContentRevision): string {
  const v = rev.snapshot['status'];
  return typeof v === 'string' ? v : '?';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function snapshotJson(rev: ContentRevision): string {
  return JSON.stringify(rev.snapshot, null, 2);
}

onMounted(load);
</script>

<template>
  <div class="revisions">
    <p v-if="loading" class="muted">Loading revisions…</p>
    <p v-else-if="error" class="error">{{ error }}</p>
    <p v-else-if="revisions.length === 0" class="muted">
      No revisions yet — every edit creates one.
    </p>

    <ol v-else class="list">
      <li
        v-for="rev in revisions"
        :key="rev.id"
        class="item"
      >
        <button
          type="button"
          class="row"
          :aria-expanded="expanded.has(rev.id)"
          @click="toggle(rev.id)"
        >
          <span class="rev-num">#{{ rev.revisionNumber }}</span>
          <span class="rev-title">{{ snapshotTitle(rev) }}</span>
          <span :class="`status status--${snapshotStatus(rev)}`">
            {{ snapshotStatus(rev) }}
          </span>
          <span class="rev-date">{{ formatDate(rev.createdAt) }}</span>
          <span class="rev-toggle">{{ expanded.has(rev.id) ? '−' : '+' }}</span>
        </button>
        <pre v-if="expanded.has(rev.id)" class="snapshot">{{ snapshotJson(rev) }}</pre>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.revisions {
  margin-top: 0.5rem;
}
.muted {
  color: var(--muted);
  font-size: 0.875rem;
}
.error {
  color: #dc2626;
  font-size: 0.875rem;
}
.list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.row {
  display: grid;
  grid-template-columns: 2.5rem 1fr auto auto 1.5rem;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5rem 0.625rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: transparent;
  color: var(--fg);
  text-align: left;
  cursor: pointer;
  font-size: 0.875rem;
}
.row:hover {
  border-color: var(--accent);
}
.rev-num {
  color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.8125rem;
}
.rev-title {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rev-date {
  color: var(--muted);
  font-size: 0.75rem;
  white-space: nowrap;
}
.rev-toggle {
  color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, monospace;
  text-align: center;
}
.status {
  display: inline-block;
  font-size: 0.6875rem;
  padding: 0.0625rem 0.5rem;
  border-radius: 999px;
  background: var(--border);
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.status--draft     { background: rgba(107,114,128,.15); color: var(--muted); }
.status--in_review { background: rgba(245,158,11,.15);  color: #d97706; }
.status--approved  { background: rgba(59,130,246,.15);  color: var(--accent); }
.status--scheduled { background: rgba(139,92,246,.15);  color: #8b5cf6; }
.status--published { background: rgba(34,197,94,.15);   color: #16a34a; }
.status--archived  { background: rgba(107,114,128,.15); color: var(--muted); opacity: .7; }
.snapshot {
  margin: 0.375rem 0 0;
  padding: 0.625rem 0.75rem;
  background: var(--border);
  border-radius: 0.375rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.75rem;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 24rem;
  overflow-y: auto;
}
</style>
