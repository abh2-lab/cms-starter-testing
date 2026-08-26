<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import Icon from '@/components/Icon.vue';
import {
  dashboardApi,
  type ActivityEntry,
} from '@/api/dashboard';
import {
  activityActorName,
  activityColor,
  activityResourceLabel,
  activityResourceTitle,
  activityRouteTarget,
  activityTimeAgo,
  activityVerb,
} from '@/composables/useActivityFormat';

// Paginated activity feed. Cursor-based — each "Load more" click sends the
// last-seen id back as `cursor`, so paging stays O(log n) even as the
// audit_log fills its 30-day retention window.

const items = ref<ActivityEntry[]>([]);
const cursor = ref<string | null>(null);
const hasMore = ref(false);
const loading = ref(true);
const loadingMore = ref(false);
const error = ref<string | null>(null);

// Client-side filters. The endpoint returns everything; small enough at
// 30-day retention that filtering in-page beats round-tripping per click.
type ResourceFilter = 'all' | 'content' | 'taxonomy' | 'taxonomy_term' | 'media';
type ActionFilter = 'all' | 'created' | 'updated' | 'deleted' | 'transitioned' | 'uploaded';
const resourceFilter = ref<ResourceFilter>('all');
const actionFilter = ref<ActionFilter>('all');

const filtered = computed(() => {
  return items.value.filter((a) => {
    if (resourceFilter.value !== 'all' && a.resourceType !== resourceFilter.value)
      return false;
    if (actionFilter.value !== 'all' && !a.action.endsWith(`.${actionFilter.value}`))
      return false;
    return true;
  });
});

const groupedByDay = computed(() => {
  const groups = new Map<string, ActivityEntry[]>();
  for (const a of filtered.value) {
    const day = dayKey(a.createdAt);
    const bucket = groups.get(day);
    if (bucket) bucket.push(a);
    else groups.set(day, [a]);
  }
  return [...groups.entries()].map(([day, entries]) => ({ day, entries }));
});

function dayKey(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const dayStart = new Date(d);
  dayStart.setHours(0, 0, 0, 0);
  if (dayStart.getTime() === today.getTime()) return 'Today';
  if (dayStart.getTime() === yesterday.getTime()) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: dayStart.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

async function loadInitial(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await dashboardApi.activity({ limit: 50 });
    items.value = res.data;
    cursor.value = res.pagination.nextCursor;
    hasMore.value = res.pagination.hasMore;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load activity';
  } finally {
    loading.value = false;
  }
}

async function loadMore(): Promise<void> {
  if (!cursor.value || loadingMore.value) return;
  loadingMore.value = true;
  try {
    const res = await dashboardApi.activity({
      cursor: cursor.value,
      limit: 50,
    });
    items.value.push(...res.data);
    cursor.value = res.pagination.nextCursor;
    hasMore.value = res.pagination.hasMore;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load more';
  } finally {
    loadingMore.value = false;
  }
}

onMounted(loadInitial);
</script>

<template>
  <section class="activity-page">
    <header class="page-header">
      <div>
        <h1 class="page-title">Activity</h1>
        <p class="page-subtitle">
          Who's been doing what across the CMS. Retained for 30 days.
        </p>
      </div>
      <RouterLink :to="{ name: 'home' }" class="btn btn-ghost btn-sm">
        ← Back to dashboard
      </RouterLink>
    </header>

    <div class="filters">
      <label class="filter">
        <span>Resource</span>
        <select v-model="resourceFilter" class="form-select">
          <option value="all">All resources</option>
          <option value="content">Posts</option>
          <option value="taxonomy">Taxonomies</option>
          <option value="taxonomy_term">Terms</option>
          <option value="media">Media</option>
        </select>
      </label>
      <label class="filter">
        <span>Action</span>
        <select v-model="actionFilter" class="form-select">
          <option value="all">All actions</option>
          <option value="created">Created</option>
          <option value="updated">Updated</option>
          <option value="transitioned">State changes</option>
          <option value="uploaded">Uploaded</option>
          <option value="deleted">Deleted</option>
        </select>
      </label>
      <span class="filter-meta">
        Showing {{ filtered.length }} of {{ items.length }} loaded
      </span>
    </div>

    <p v-if="loading" class="state-msg">Loading…</p>
    <p v-else-if="error" class="state-msg error">{{ error }}</p>

    <template v-else>
      <p v-if="items.length === 0" class="state-msg empty">
        No activity yet. Edits, publishes, and other admin actions will
        appear here once someone takes them.
      </p>
      <p v-else-if="filtered.length === 0" class="state-msg empty">
        No activity matches the current filters.
      </p>

      <div v-else class="day-stack">
        <section
          v-for="group in groupedByDay"
          :key="group.day"
          class="day-group"
        >
          <div class="day-header">{{ group.day }}</div>
          <ul class="entries">
            <li v-for="a in group.entries" :key="a.id" class="entry">
              <span
                class="entry-dot"
                :style="{ background: activityColor(a.action) }"
                :title="a.action"
              />
              <div class="entry-body">
                <div class="entry-text">
                  <strong>{{ activityActorName(a) }}</strong>
                  {{ activityVerb(a) }}
                  {{ activityResourceLabel(a.resourceType) }}
                  <component
                    :is="activityRouteTarget(a) ? 'RouterLink' : 'span'"
                    :to="activityRouteTarget(a) ?? undefined"
                    class="entry-title"
                  >
                    {{ activityResourceTitle(a) }}
                  </component>
                </div>
                <div class="entry-meta">
                  <span class="entry-time">{{ activityTimeAgo(a.createdAt) }}</span>
                </div>
              </div>
            </li>
          </ul>
        </section>

        <div v-if="hasMore" class="load-more">
          <button
            type="button"
            class="btn btn-secondary"
            :disabled="loadingMore"
            @click="loadMore"
          >
            <Icon name="chevron-down" :size="13" />
            {{ loadingMore ? 'Loading…' : 'Load more' }}
          </button>
        </div>
        <p v-else class="state-msg muted">
          Reached the start of the retained window.
        </p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.activity-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.filters {
  display: flex;
  align-items: end;
  gap: 12px;
  padding: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.filter {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.filter .form-select {
  width: auto;
  min-width: 160px;
  font-size: 13px;
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
  color: var(--fg);
}
.filter-meta {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-tertiary);
}

.state-msg {
  padding: 16px;
  color: var(--muted);
  font-size: 13px;
}
.state-msg.error {
  color: var(--danger);
}
.state-msg.empty {
  text-align: center;
  padding: 48px 16px;
}
.state-msg.muted {
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12px;
  padding: 16px 0 24px;
}

.day-stack {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.day-group {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}
.day-header {
  padding: 10px 16px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  background: var(--bg);
  border-bottom: 1px solid var(--border-soft);
}
.entries {
  list-style: none;
  margin: 0;
  padding: 0;
}
.entry {
  display: flex;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-soft);
}
.entry:last-child {
  border-bottom: 0;
}
.entry-dot {
  width: 8px;
  height: 8px;
  margin-top: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.entry-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.entry-text {
  font-size: 13.5px;
  color: var(--fg);
  word-break: break-word;
}
.entry-text strong {
  font-weight: 600;
}
.entry-title {
  color: var(--accent-hover);
  font-weight: 500;
  text-decoration: none;
}
a.entry-title:hover {
  text-decoration: underline;
}
.entry-meta {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.load-more {
  display: flex;
  justify-content: center;
  padding: 8px 0 24px;
}
</style>
