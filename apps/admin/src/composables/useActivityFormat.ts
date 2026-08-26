import type { ActivityEntry } from '@/api/dashboard';

/**
 * Render-time helpers for an ActivityEntry. Lifted out of Home.vue so the
 * dashboard widget and the full /activity page render identical text — the
 * two views would otherwise drift over time (different verbs, different
 * fallbacks) and editors would notice.
 *
 * Pure functions; safe to import from any component without a setup() body.
 */

const RESOURCE_LABEL: Record<string, string> = {
  content: 'post',
  content_type: 'content type',
  taxonomy: 'taxonomy',
  taxonomy_term: 'term',
  media: 'media',
};

function humanize(s: string): string {
  return s.replace(/_/g, ' ');
}

/**
 * Past-tense verb for the activity line. Maps the dotted action format
 * (e.g. "content.updated") to the short verb shown in the feed.
 * Transitions look at metadata.to so "published" / "scheduled" / etc.
 * appear instead of the generic "transitioned".
 */
export function activityVerb(a: ActivityEntry): string {
  const action = a.action.toLowerCase();
  if (action.endsWith('.created')) return 'created';
  if (action.endsWith('.updated')) return 'updated';
  if (action.endsWith('.deleted')) return 'deleted';
  if (action.endsWith('.uploaded')) return 'uploaded';
  if (action.endsWith('.transitioned')) {
    const to = (a.metadata?.['to'] as string | undefined) ?? null;
    if (to === 'published') return 'published';
    if (to === 'scheduled') return 'scheduled';
    if (to === 'in_review') return 'sent to review';
    if (to === 'approved') return 'approved';
    if (to === 'archived') return 'archived';
    if (to === 'draft') return 'moved to draft';
    return to ? `moved to ${humanize(to)}` : 'transitioned';
  }
  return humanize(action.split('.').slice(-1)[0] ?? action);
}

export function activityResourceLabel(rt: string): string {
  return RESOURCE_LABEL[rt] ?? humanize(rt);
}

/**
 * Display name for the resource. Joined fields win; falls back to a
 * snapshot title (kept on delete/transition rows where the joined row may
 * have been deleted since); finally the short id tail so the row is
 * never anonymous.
 */
export function activityResourceTitle(a: ActivityEntry): string {
  if (a.resourceType === 'content' && a.contentTitle) return a.contentTitle;
  if (a.resourceType === 'taxonomy' && a.taxonomyName) return a.taxonomyName;
  if (a.resourceType === 'media' && a.mediaFilename) return a.mediaFilename;
  const snap = (a.afterSnapshot ?? a.beforeSnapshot) as
    | { title?: unknown; name?: unknown; filename?: unknown; slug?: unknown }
    | null;
  if (snap && typeof snap === 'object') {
    if (typeof snap.title === 'string') return snap.title;
    if (typeof snap.name === 'string') return snap.name;
    if (typeof snap.filename === 'string') return snap.filename;
    if (typeof snap.slug === 'string') return snap.slug;
  }
  return a.resourceId ? `#${a.resourceId.slice(-6)}` : '(unknown)';
}

export function activityActorName(a: ActivityEntry): string {
  if (a.actorDisplayName) return a.actorDisplayName;
  if (a.actorType === 'system') return 'System';
  if (a.actorType === 'api_key') return 'API key';
  return '(deleted user)';
}

/**
 * Status-coloured dot used in both the widget and the full page so the
 * eye picks out publishes / deletes / status changes at a glance.
 */
export function activityColor(action: string): string {
  const a = action.toLowerCase();
  if (a.includes('publish')) return 'var(--success)';
  if (a.includes('schedul')) return 'var(--purple)';
  if (a.includes('review') || a.includes('submit')) return 'var(--warning)';
  if (a.includes('delete') || a.includes('archiv')) return 'var(--danger)';
  return 'var(--info)';
}

/**
 * Short relative-time label (e.g. "5 minutes ago"). Hand-rolled — the
 * dashboard already inlined this and reusing it here keeps the two views
 * in sync; we can swap to VueUse's useTimeAgo if reactive ticking ever
 * matters more than this single-render simplicity.
 */
export function activityTimeAgo(iso: string | null): string {
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

/**
 * Route target for an activity row, when the underlying resource is
 * still navigable. Returns null when there's nowhere to send the user
 * (e.g. the resource was deleted, or its type has no admin detail view).
 */
export function activityRouteTarget(
  a: ActivityEntry,
):
  | { name: string; params?: Record<string, string> }
  | null {
  if (!a.resourceId) return null;
  if (a.resourceType === 'content' && a.contentTitle) {
    return { name: 'content-edit', params: { id: a.resourceId } };
  }
  if (a.resourceType === 'taxonomy' && a.taxonomyName) {
    return { name: 'taxonomy-terms', params: { id: a.resourceId } };
  }
  // Media has no detail route today; deleted rows go nowhere.
  return null;
}
