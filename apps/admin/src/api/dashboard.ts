import { apiFetch } from '@/lib/api';

export interface ContentStatusCount {
  status: string;
  count: number;
}
export interface ScheduledItem {
  id: string;
  title: string;
  publishAt: string | null;
}
export interface ActivityEntry {
  id: string;
  actorType: 'admin' | 'system' | 'api_key';
  actorId: string | null;
  /** From LEFT JOIN admin_users — null for system/api_key actors or deleted admins. */
  actorDisplayName: string | null;
  action: string;
  // Known values: 'content' | 'taxonomy' | 'taxonomy_term' | 'media'. Typed
  // as plain string for forward-compat — the literal union was redundant
  // (typescript-eslint/no-redundant-type-constituents) and forced casts at
  // call sites where the API may return new resource kinds.
  resourceType: string;
  resourceId: string | null;
  beforeSnapshot: unknown;
  afterSnapshot: unknown;
  metadata: Record<string, unknown>;
  createdAt: string;
  /** Resolved via LEFT JOIN content. Null when the row was deleted. */
  contentTitle: string | null;
  /** Resolved via LEFT JOIN taxonomies. Null for non-taxonomy rows. */
  taxonomyName: string | null;
  /** Resolved via LEFT JOIN media.original_filename. Null for non-media rows. */
  mediaFilename: string | null;
}
export interface DashboardStats {
  contentByStatus: ContentStatusCount[];
  scheduledToday: ScheduledItem[];
  recentActivity: ActivityEntry[];
}
export interface DashboardHealth {
  meilisearch: boolean;
  storage: boolean;
  queue: string;
}

export interface ActivityListParams {
  cursor?: string;
  limit?: number;
}

export interface ActivityListResponse {
  data: ActivityEntry[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
    limit: number;
  };
}

function buildActivityQuery(params: ActivityListParams): string {
  const sp = new URLSearchParams();
  if (params.cursor) sp.set('cursor', params.cursor);
  if (params.limit !== undefined) sp.set('limit', String(params.limit));
  return sp.size > 0 ? `?${sp.toString()}` : '';
}

export const dashboardApi = {
  stats: () => apiFetch<{ data: DashboardStats }>('/admin/dashboard'),
  health: () =>
    apiFetch<{ data: DashboardHealth }>('/admin/dashboard/health'),
  // Paginated activity feed. Backs the full /activity page; the dashboard's
  // own widget still uses the embedded recentActivity from /stats so it's
  // a single round-trip on the home page.
  activity: (params: ActivityListParams = {}) =>
    apiFetch<ActivityListResponse>(
      `/admin/dashboard/activity${buildActivityQuery(params)}`,
    ),
};
