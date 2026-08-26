<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, type RouteLocationRaw } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import {
  dashboardApi,
  type DashboardHealth,
  type DashboardStats,
} from '@/api/dashboard';
import { contentApi, type Content } from '@/api/content';
import { contentTypesApi } from '@/api/content-types';
import { siteSettingsApi, type SiteSettings } from '@/api/site-settings';
import { useConfirm } from '@/composables/useConfirm';
import {
  activityActorName,
  activityColor,
  activityResourceLabel,
  activityResourceTitle,
  activityVerb,
} from '@/composables/useActivityFormat';

const auth = useAuthStore();

const stats = ref<DashboardStats | null>(null);
const health = ref<DashboardHealth | null>(null);
const pending = ref<Content[]>([]);
const typeNames = ref<Record<string, string>>({});
const loading = ref(true);
const error = ref<string | null>(null);
const healthLoading = ref(false);
const approving = ref<Set<string>>(new Set());

const canSeeHealth = computed(() => auth.hasRole('admin'));
// Maintenance toggle is admin+ only — same gate as the Site Settings page that
// would otherwise be the long way to flip this flag.
const canToggleMaintenance = computed(() => auth.hasRole('admin'));

// Maintenance-mode widget state. siteSettings is `null` while loading and on
// fetch failure; the widget shows a muted spinner row in those cases.
const siteSettings = ref<SiteSettings | null>(null);
const maintenanceSaving = ref(false);
const { confirm: confirmModal } = useConfirm();

const GRIP_ICON =
  '<circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>';

// ── Data loaders ──
async function loadStats(): Promise<void> {
  stats.value = (await dashboardApi.stats()).data;
}
async function loadHealth(): Promise<void> {
  if (!canSeeHealth.value) return;
  healthLoading.value = true;
  try {
    health.value = (await dashboardApi.health()).data;
  } catch {
    health.value = null; // best-effort
  } finally {
    healthLoading.value = false;
  }
}
async function loadPending(): Promise<void> {
  const res = await contentApi.list({ status: 'in_review', limit: 6 });
  pending.value = res.data;
}
async function loadTypes(): Promise<void> {
  try {
    const res = await contentTypesApi.list();
    const map: Record<string, string> = {};
    for (const t of res.data) map[t.id] = t.name;
    typeNames.value = map;
  } catch {
    // non-fatal — rows fall back to "Content"
  }
}
async function loadSiteSettings(): Promise<void> {
  if (!canToggleMaintenance.value) return;
  try {
    siteSettings.value = (await siteSettingsApi.get()).data;
  } catch {
    // non-fatal — widget shows a fallback "settings unavailable" state
    siteSettings.value = null;
  }
}

async function toggleMaintenance(): Promise<void> {
  if (!siteSettings.value || maintenanceSaving.value) return;
  const next = !siteSettings.value.maintenanceMode;
  const verbed = next ? 'enable' : 'disable';
  const ok = await confirmModal({
    title: next ? 'Enable maintenance mode?' : 'Take the site live?',
    message: next
      ? 'Visitors will see a maintenance page until you turn this off. You can keep working in the admin.'
      : 'The public site will be reachable to visitors immediately.',
    confirmLabel: next ? 'Enable maintenance' : 'Take site live',
    cancelLabel: 'Cancel',
    tone: next ? 'danger' : 'default',
  });
  if (!ok) return;
  maintenanceSaving.value = true;
  try {
    const res = await siteSettingsApi.put({
      siteName: siteSettings.value.siteName,
      siteUrl: siteSettings.value.siteUrl,
      maintenanceMode: next,
    });
    siteSettings.value = res.data;
    showToast(`Maintenance mode ${next ? 'enabled' : 'disabled'}.`);
  } catch (e) {
    showToast(
      `Failed to ${verbed} maintenance mode: ${e instanceof Error ? e.message : 'unknown error'}`,
    );
  } finally {
    maintenanceSaving.value = false;
  }
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    await Promise.all([loadStats(), loadPending(), loadTypes(), loadSiteSettings()]);
    void loadHealth();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load dashboard';
  } finally {
    loading.value = false;
  }
}

onMounted(load);

// ── Derived counts + stat cards ──
const counts = computed<Record<string, number>>(() => {
  const map: Record<string, number> = {};
  for (const row of stats.value?.contentByStatus ?? []) map[row.status] = row.count;
  return map;
});
const totalContent = computed(() =>
  Object.values(counts.value).reduce((a, b) => a + b, 0),
);
const scheduledTodayCount = computed(
  () => stats.value?.scheduledToday.length ?? 0,
);

interface StatCard {
  key: string;
  label: string;
  value: number;
  to: RouteLocationRaw;
  emoji: string;
  iconBg: string;
  sub: string;
  subClass: string;
}
const statCards = computed<StatCard[]>(() => [
  {
    key: 'total',
    label: 'Total Content',
    value: totalContent.value,
    to: { name: 'content' },
    emoji: '📄',
    iconBg: 'var(--surface-2)',
    sub: 'across all types',
    subClass: 'muted',
  },
  {
    key: 'published',
    label: 'Published',
    value: counts.value['published'] ?? 0,
    to: { name: 'content', query: { status: 'published' } },
    emoji: '✅',
    iconBg: 'var(--success-soft)',
    sub: 'live on site',
    subClass: '',
  },
  {
    key: 'in_review',
    label: 'In Review',
    value: counts.value['in_review'] ?? 0,
    to: { name: 'content', query: { status: 'in_review' } },
    emoji: '⏳',
    iconBg: 'var(--warning-soft)',
    sub: 'awaiting approval',
    subClass: 'warn',
  },
  {
    key: 'scheduled',
    label: 'Scheduled',
    value: counts.value['scheduled'] ?? 0,
    to: { name: 'content', query: { status: 'scheduled' } },
    emoji: '🕐',
    iconBg: 'var(--purple-soft)',
    sub: `${scheduledTodayCount.value} publishing today`,
    subClass: '',
  },
]);

// ── Content-by-status bars ──
const STATUS_BARS = [
  { key: 'published', label: 'Published', color: 'var(--success)' },
  { key: 'in_review', label: 'In Review', color: 'var(--warning)' },
  { key: 'draft', label: 'Draft', color: '#9ca3af' },
  { key: 'scheduled', label: 'Scheduled', color: 'var(--purple)' },
  { key: 'approved', label: 'Approved', color: 'var(--info)' },
  { key: 'archived', label: 'Archived', color: 'var(--danger)' },
] as const;
const maxCount = computed(() =>
  Math.max(1, ...STATUS_BARS.map((s) => counts.value[s.key] ?? 0)),
);
function barWidth(key: string): number {
  const c = counts.value[key] ?? 0;
  return c === 0 ? 0 : Math.max(4, (c / maxCount.value) * 100);
}

// ── System health view-model ──
interface HealthRow {
  label: string;
  ok: boolean;
  text: string;
}
const healthRows = computed<HealthRow[]>(() => {
  const h = health.value;
  if (!h) return [];
  const queueOk = !/not|error|down|unreachable|fail/i.test(h.queue);
  return [
    {
      label: 'Search (Meilisearch)',
      ok: h.meilisearch,
      text: h.meilisearch ? 'Healthy' : 'Unreachable',
    },
    {
      label: 'Object storage',
      ok: h.storage,
      text: h.storage ? 'Healthy' : 'Unreachable',
    },
    { label: 'Job queue', ok: queueOk, text: h.queue },
  ];
});

// ── Approve a pending-review item (real status transition) ──
async function approve(item: Content): Promise<void> {
  if (approving.value.has(item.id)) return;
  approving.value = new Set(approving.value).add(item.id);
  try {
    await contentApi.transition(item.id, { toStatus: 'approved' });
    pending.value = pending.value.filter((c) => c.id !== item.id);
    showToast(`Approved "${item.title}"`);
    void loadStats();
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Approve failed');
  } finally {
    const next = new Set(approving.value);
    next.delete(item.id);
    approving.value = next;
  }
}

// ── Formatting helpers ──
// humanize is referenced indirectly via the activity formatters; kept local
// only for the non-activity widgets (Publishing Today / Pending Review)
// that need the "snake_case → snake case" transform inline. Removed
// because nothing in this file uses it directly anymore.
function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const sec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
}
function formatTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}
// activityVerb / activityActorName / activityResourceTitle /
// activityResourceLabel / activityColor live in
// composables/useActivityFormat so the dashboard widget and the full
// /activity page render identical text. Import above.

// Local timeAgo alias — keeps existing template bindings working while the
// shared activity formatters use activityTimeAgo internally.

// ── Greeting ──
const greeting = computed(() => {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const name = auth.user?.displayName?.split(' ')[0] ?? 'there';
  return `${part}, ${name}`;
});
const todayLabel = computed(() =>
  new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }),
);

// ── Live clock widget ── ticks once a second; the interval is cleaned up on
// unmount. Time/date/zone all derive from this single reactive `now`.
const now = ref(new Date());
let clockTimer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  clockTimer = setInterval(() => {
    now.value = new Date();
  }, 1000);
});
onBeforeUnmount(() => clearInterval(clockTimer));

const clockTime = computed(() =>
  now.value.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }),
);
const clockDate = computed(() =>
  now.value.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }),
);
// The admin's own time zone (the browser's resolved IANA zone) + its UTC offset,
// e.g. "Asia/Kolkata · GMT+05:30". Offset is computed from the live date so it
// stays correct across DST.
const clockZone = computed(() => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local';
  const mins = -now.value.getTimezoneOffset();
  const sign = mins >= 0 ? '+' : '-';
  const abs = Math.abs(mins);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${tz} · GMT${sign}${hh}:${mm}`;
});

// ── Toast ──
const toast = ref<string | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function showToast(msg: string): void {
  toast.value = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), 2600);
}

// ── Reorderable widgets (drag-and-drop + localStorage persistence) ──
const DEFAULT_ORDER = [
  'clock',
  'recent-activity',
  'publishing-today',
  'pending-review',
  'maintenance-mode',
  'system-health',
  'content-by-status',
] as const;
type WidgetId = (typeof DEFAULT_ORDER)[number];

function storageKey(): string {
  return `dashboard:widget-order:${auth.user?.email ?? 'default'}`;
}
function loadOrder(): WidgetId[] {
  const fallback = [...DEFAULT_ORDER];
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as string[];
    const known = saved.filter((id): id is WidgetId =>
      (DEFAULT_ORDER as readonly string[]).includes(id),
    );
    for (const id of DEFAULT_ORDER) if (!known.includes(id)) known.push(id);
    return known;
  } catch {
    return fallback;
  }
}
const order = ref<WidgetId[]>(loadOrder());
const isCustomized = computed(
  () => order.value.join(',') !== DEFAULT_ORDER.join(','),
);
function persistOrder(): void {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(order.value));
  } catch {
    // storage unavailable — ordering just won't persist
  }
}
function widgetVisible(id: WidgetId): boolean {
  if (id === 'system-health') return canSeeHealth.value;
  if (id === 'maintenance-mode') return canToggleMaintenance.value;
  return true;
}
const visibleOrder = computed(() => order.value.filter(widgetVisible));

const draggedId = ref<WidgetId | null>(null);
const overId = ref<WidgetId | null>(null);
function onDragStart(id: WidgetId, e: DragEvent): void {
  draggedId.value = id;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  }
}
function onDragOver(id: WidgetId): void {
  if (draggedId.value && id !== draggedId.value) overId.value = id;
}
function onDrop(targetId: WidgetId): void {
  const from = draggedId.value;
  if (from && from !== targetId) {
    const arr = [...order.value];
    const fromIdx = arr.indexOf(from);
    const toIdx = arr.indexOf(targetId);
    if (fromIdx >= 0 && toIdx >= 0) {
      arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, from);
      order.value = arr;
      persistOrder();
    }
  }
  resetDrag();
}
function resetDrag(): void {
  draggedId.value = null;
  overId.value = null;
}
function resetLayout(): void {
  order.value = [...DEFAULT_ORDER];
  persistOrder();
}

const widgetTitles: Record<WidgetId, string> = {
  clock: 'Clock',
  'recent-activity': 'Recent Activity',
  'publishing-today': 'Publishing Today',
  'pending-review': 'Pending Review',
  'maintenance-mode': 'Maintenance Mode',
  'system-health': 'System Health',
  'content-by-status': 'Content by Status',
};
</script>

<template>
  <section class="dashboard">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ greeting }} <span aria-hidden="true">👋</span></h1>
        <p class="page-subtitle">
          {{ todayLabel }} — Here's what's happening today
        </p>
      </div>
      <RouterLink
        :to="{ name: 'content', query: { create: '1' } }"
        class="btn btn-primary"
      >
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        New Content
      </RouterLink>
    </header>

    <p v-if="loading" class="state-msg">Loading…</p>
    <p v-else-if="error" class="state-msg error">{{ error }}</p>

    <template v-else>
      <!-- Stat cards -->
      <div class="stat-grid">
        <RouterLink
          v-for="s in statCards"
          :key="s.key"
          :to="s.to"
          class="stat-card stat-link"
        >
          <span class="stat-icon" :style="{ background: s.iconBg }">{{
            s.emoji
          }}</span>
          <span class="stat-label">{{ s.label }}</span>
          <span class="stat-value">{{ s.value.toLocaleString() }}</span>
          <span class="stat-change" :class="s.subClass">{{ s.sub }}</span>
        </RouterLink>
      </div>

      <div v-if="isCustomized" class="layout-reset">
        <button type="button" class="btn btn-ghost btn-sm" @click="resetLayout">
          Reset layout
        </button>
      </div>

      <!-- Two-column card layout (drag a card's handle to reorder) -->
      <div class="widget-columns">
        <section
          v-for="id in visibleOrder"
          :key="id"
          class="card widget"
          :class="{ dragging: draggedId === id, 'drag-over': overId === id }"
          draggable="true"
          @dragstart="onDragStart(id, $event)"
          @dragend="resetDrag"
          @dragover.prevent="onDragOver(id)"
          @drop.prevent="onDrop(id)"
        >
          <div class="card-header">
            <div class="card-heading">
              <span class="drag-handle" aria-hidden="true" title="Drag to reorder">
                <!-- GRIP_ICON is a dev-controlled, static inline SVG path constant. -->
                <!-- eslint-disable vue/no-v-html -->
                <svg
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="currentColor"
                  aria-hidden="true"
                  v-html="GRIP_ICON"
                ></svg>
                <!-- eslint-enable vue/no-v-html -->
              </span>
              <span class="card-title">{{ widgetTitles[id] }}</span>
            </div>

            <RouterLink
              v-if="id === 'recent-activity'"
              :to="{ name: 'activity' }"
              class="btn btn-ghost btn-sm"
              draggable="false"
            >
              View all →
            </RouterLink>
            <span
              v-else-if="id === 'publishing-today'"
              class="badge badge-scheduled"
            >
              {{ scheduledTodayCount }} scheduled
            </span>
            <span
              v-else-if="id === 'pending-review'"
              class="badge badge-in_review"
            >
              {{ counts['in_review'] ?? 0 }} in review
            </span>
            <button
              v-else-if="id === 'system-health'"
              type="button"
              class="btn btn-ghost btn-sm"
              :disabled="healthLoading"
              @click="loadHealth"
            >
              {{ healthLoading ? 'Refreshing…' : 'Refresh' }}
            </button>
          </div>

          <!-- ── Recent Activity ── -->
          <div v-if="id === 'recent-activity'">
            <template v-if="stats && stats.recentActivity.length">
              <div
                v-for="a in stats.recentActivity"
                :key="a.id"
                class="activity-item"
              >
                <span
                  class="activity-dot"
                  :style="{ background: activityColor(a.action) }"
                />
                <div class="activity-body">
                  <div class="activity-text">
                    <strong>{{ activityActorName(a) }}</strong>
                    {{ activityVerb(a) }}
                    {{ activityResourceLabel(a.resourceType) }}
                    <span class="activity-title">{{ activityResourceTitle(a) }}</span>
                  </div>
                  <div class="activity-time">{{ timeAgo(a.createdAt) }}</div>
                </div>
              </div>
            </template>
            <div v-else class="empty-state">
              <div class="empty-title">No recent activity</div>
              <p class="muted small">
                Edits, publishes, and other admin actions will appear here.
              </p>
            </div>
          </div>

          <!-- ── Publishing Today ── -->
          <div v-else-if="id === 'publishing-today'">
            <template v-if="stats && stats.scheduledToday.length">
              <RouterLink
                v-for="item in stats.scheduledToday"
                :key="item.id"
                :to="{ name: 'content-edit', params: { id: item.id } }"
                class="row-link activity-item"
                draggable="false"
              >
                <div>
                  <div class="row-title">{{ item.title }}</div>
                  <div class="activity-time">
                    {{ formatTime(item.publishAt) }}
                  </div>
                </div>
              </RouterLink>
            </template>
            <div v-else class="empty-state">
              <div class="empty-title">Nothing scheduled for today</div>
            </div>
          </div>

          <!-- ── Pending Review ── -->
          <div v-else-if="id === 'pending-review'">
            <template v-if="pending.length">
              <div v-for="item in pending" :key="item.id" class="activity-item">
                <span class="activity-dot" style="background: var(--warning)" />
                <div class="pending-main">
                  <RouterLink
                    :to="{ name: 'content-edit', params: { id: item.id } }"
                    class="row-title"
                    draggable="false"
                  >
                    {{ item.title }}
                  </RouterLink>
                  <div class="activity-time">
                    {{ typeNames[item.contentTypeId] ?? 'Content' }} ·
                    {{ timeAgo(item.updatedAt) }}
                  </div>
                </div>
                <button
                  type="button"
                  class="btn btn-sm btn-success"
                  :disabled="approving.has(item.id)"
                  @click="approve(item)"
                >
                  {{ approving.has(item.id) ? '…' : 'Approve' }}
                </button>
              </div>
            </template>
            <div v-else class="empty-state">
              <div class="empty-title">Nothing awaiting review</div>
            </div>
          </div>

          <!-- ── Maintenance Mode ── -->
          <div v-else-if="id === 'maintenance-mode'" class="maintenance-widget">
            <template v-if="siteSettings">
              <div
                class="maintenance-status"
                :class="{ 'maintenance-status--on': siteSettings.maintenanceMode }"
              >
                <span class="status-dot" aria-hidden="true" />
                <div class="maintenance-text">
                  <strong>
                    {{ siteSettings.maintenanceMode ? 'Public site is in maintenance' : 'Public site is live' }}
                  </strong>
                  <span class="muted small">
                    {{
                      siteSettings.maintenanceMode
                        ? 'Visitors see a maintenance page until you turn this off.'
                        : 'Visitors can read the site normally.'
                    }}
                  </span>
                </div>
              </div>
              <button
                type="button"
                class="btn"
                :class="siteSettings.maintenanceMode ? 'btn-primary' : 'btn-danger'"
                :disabled="maintenanceSaving"
                @click="toggleMaintenance"
              >
                {{
                  maintenanceSaving
                    ? 'Saving…'
                    : siteSettings.maintenanceMode
                      ? 'Take site live'
                      : 'Enable maintenance mode'
                }}
              </button>
            </template>
            <div v-else class="empty-state">
              <div class="empty-title">Site settings unavailable</div>
              <p class="muted small">
                Configure site settings first to enable maintenance mode.
              </p>
            </div>
          </div>

          <!-- ── System Health ── -->
          <div v-else-if="id === 'system-health'">
            <template v-if="healthRows.length">
              <div
                v-for="row in healthRows"
                :key="row.label"
                class="health-item"
              >
                <div class="health-label">{{ row.label }}</div>
                <div
                  class="health-status"
                  :style="{ color: row.ok ? 'var(--success)' : 'var(--warning)' }"
                >
                  <span
                    class="status-dot"
                    :style="{ background: row.ok ? 'var(--success)' : 'var(--warning)' }"
                  />
                  {{ row.text }}
                </div>
              </div>
            </template>
            <div v-else class="empty-state">
              <div class="empty-title">Health unavailable</div>
            </div>
          </div>

          <!-- ── Content by Status ── -->
          <div v-else-if="id === 'content-by-status'" class="bars">
            <div v-for="b in STATUS_BARS" :key="b.key" class="bar-row">
              <span class="bar-label">{{ b.label }}</span>
              <span class="bar-track">
                <span
                  class="bar-fill"
                  :style="{ width: barWidth(b.key) + '%', background: b.color }"
                />
              </span>
              <span class="bar-value">{{ counts[b.key] ?? 0 }}</span>
            </div>
          </div>

          <!-- ── Clock ── digital readout of the admin's local time/date/zone -->
          <div v-else-if="id === 'clock'" class="clock-widget">
            <div class="clock-time">{{ clockTime }}</div>
            <div class="clock-date">{{ clockDate }}</div>
            <div class="clock-zone">{{ clockZone }}</div>
          </div>
        </section>
      </div>
    </template>

    <Transition name="toast">
      <div v-if="toast" class="toast" role="status">
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
        {{ toast }}
      </div>
    </Transition>
  </section>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.page-title span {
  font-size: 18px;
}
.state-msg {
  color: var(--muted);
  font-size: 0.9rem;
}
.state-msg.error {
  color: var(--danger);
}

/* Stat cards as links */
.stat-icon {
  font-size: 20px;
  line-height: 1;
}
.stat-link {
  display: block;
  text-decoration: none;
  color: inherit;
  transition:
    border-color 0.15s,
    box-shadow 0.15s,
    transform 0.05s;
}
.stat-link:hover {
  border-color: var(--accent);
  box-shadow: var(--shadow-sm);
}
.stat-link:active {
  transform: translateY(1px);
}
@media (max-width: 1100px) {
  .stat-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 560px) {
  .stat-grid {
    grid-template-columns: 1fr;
  }
}

.layout-reset {
  display: flex;
  justify-content: flex-end;
  margin: -12px 0 -8px;
}

/* Two independent stacking columns (newspaper flow) — matches the mockup's
   grid-2 grouping without grid row-alignment gaps. */
.widget-columns {
  column-count: 2;
  column-gap: 20px;
}
@media (max-width: 900px) {
  .widget-columns {
    column-count: 1;
  }
}
.widget {
  break-inside: avoid;
  margin: 0 0 20px;
  cursor: move;
  transition:
    opacity 0.15s,
    box-shadow 0.15s,
    outline-color 0.15s;
}
.widget :is(a, button) {
  cursor: pointer;
}
.widget.dragging {
  opacity: 0.45;
}
.widget.drag-over {
  outline: 2px dashed var(--accent);
  outline-offset: 2px;
}

.card-heading {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
/* Grip is a visual cue — the whole card is the drag target. */
.drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  opacity: 0.5;
  transition: opacity 0.15s;
}
.widget:hover .drag-handle {
  opacity: 1;
}

/* Rows */
.row-title {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--fg);
  text-decoration: none;
  display: block;
}
a.row-title:hover {
  color: var(--accent-hover);
}
.row-link {
  text-decoration: none;
}
.row-link:hover .row-title {
  color: var(--accent-hover);
}
.pending-main {
  flex: 1;
  min-width: 0;
}

/* Content-by-status bars */
.bars {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.bar-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.bar-label {
  width: 84px;
  font-size: 12px;
  color: var(--muted);
  flex-shrink: 0;
}
.bar-track {
  flex: 1;
  height: 6px;
  background: var(--border);
  border-radius: 3px;
  overflow: hidden;
}
.bar-fill {
  display: block;
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}
.bar-value {
  font-size: 12px;
  font-weight: 600;
  width: 40px;
  text-align: right;
  flex-shrink: 0;
}

/* Activity feed text */
.activity-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.activity-title {
  color: var(--accent-hover);
  font-weight: 500;
}

/* Maintenance Mode widget */
.maintenance-widget {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.maintenance-status {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius);
  background: var(--surface-2);
  border: 1px solid var(--border);
}
.maintenance-status .status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--success);
  margin-top: 5px;
  flex-shrink: 0;
}
.maintenance-status--on {
  background: var(--danger-soft);
  border-color: #fecaca;
}
.maintenance-status--on .status-dot {
  background: var(--danger);
}
.maintenance-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

/* Clock widget — a simple digital readout. tabular-nums keeps the digits from
   jittering as the seconds tick. */
.clock-widget {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 6px;
  padding: 10px 0 6px;
}
.clock-time {
  font-family: ui-monospace, 'SFMono-Regular', 'Courier New', monospace;
  font-size: 42px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 1px;
  color: var(--fg);
  font-variant-numeric: tabular-nums;
}
.clock-date {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--muted);
}
.clock-zone {
  font-size: 11.5px;
  color: var(--text-tertiary);
  font-family: ui-monospace, 'SFMono-Regular', monospace;
}

/* Toast */
.toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--fg);
  color: var(--bg);
  padding: 10px 16px;
  border-radius: var(--radius);
  font-size: 13px;
  font-weight: 500;
  box-shadow: var(--shadow);
  z-index: 50;
}
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.25s,
    transform 0.25s;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
