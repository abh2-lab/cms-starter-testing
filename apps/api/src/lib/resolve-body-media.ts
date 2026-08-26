import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@cms/db';
import { objectUrl } from './s3.js';

/**
 * Body images store only a `mediaId` (the editor never writes a URL). The public
 * read path resolves those ids to display URLs here and splices them into a copy
 * of the doc so the renderer can emit a real <img>. This is read-only: the
 * resolved fields are never persisted and never re-validated against the strict
 * save-time body schema.
 *
 * Resolution walks the whole customFields tree (not just `body`) so any
 * rich-text field carrying inlineImage/gallery nodes is covered.
 */

export interface ResolvedImage {
  url: string;
  alt: string;
}

/** Collect every unique inlineImage/gallery media id referenced anywhere. */
export function collectBodyMediaIds(value: unknown): string[] {
  const ids = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    if (v && typeof v === 'object') {
      const node = v as Record<string, unknown>;
      const attrs = node['attrs'] as Record<string, unknown> | undefined;
      if (node['type'] === 'inlineImage') {
        const id = attrs?.['mediaId'];
        if (typeof id === 'string' && id) ids.add(id);
      } else if (node['type'] === 'gallery') {
        const arr = attrs?.['mediaIds'];
        if (Array.isArray(arr)) {
          for (const x of arr) if (typeof x === 'string' && x) ids.add(x);
        }
      }
      for (const key of Object.keys(node)) walk(node[key]);
    }
  };
  walk(value);
  return [...ids];
}

/**
 * Return a deep copy of `value` with resolved image data spliced onto each
 * inlineImage (`src`/`alt`) and gallery (`images: [{src, alt}]`) node. Nodes
 * whose media couldn't be resolved (deleted row) are left bare so the renderer
 * degrades to "no image" rather than a broken doc.
 */
export function injectResolvedMedia(
  value: unknown,
  resolved: Map<string, ResolvedImage>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => injectResolvedMedia(item, resolved));
  }
  if (value && typeof value === 'object') {
    const node = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(node)) {
      out[key] = injectResolvedMedia(node[key], resolved);
    }
    if (out['type'] === 'inlineImage') {
      const attrs = (out['attrs'] as Record<string, unknown> | undefined) ?? {};
      const id = attrs['mediaId'];
      const hit = typeof id === 'string' ? resolved.get(id) : undefined;
      if (hit) out['attrs'] = { ...attrs, src: hit.url, alt: hit.alt };
    } else if (out['type'] === 'gallery') {
      const attrs = (out['attrs'] as Record<string, unknown> | undefined) ?? {};
      const arr = attrs['mediaIds'];
      if (Array.isArray(arr)) {
        const images = arr
          .filter((x): x is string => typeof x === 'string')
          .map((mid) => resolved.get(mid))
          .filter((x): x is ResolvedImage => x !== undefined)
          .map((x) => ({ src: x.url, alt: x.alt }));
        out['attrs'] = { ...attrs, images };
      }
    }
    return out;
  }
  return value;
}

/**
 * Resolve all inlineImage/gallery media ids in a customFields object to display
 * URLs and return a copy with them spliced in. Returns the original reference
 * untouched when there is nothing to resolve.
 */
export async function resolveBodyMedia<T extends Record<string, unknown>>(
  customFields: T,
  tenantId: string,
): Promise<T> {
  const ids = collectBodyMediaIds(customFields);
  if (ids.length === 0) return customFields;

  const rows = await db
    .select({
      id: schema.media.id,
      storageKey: schema.media.storageKey,
      altText: schema.media.altText,
    })
    .from(schema.media)
    .where(and(eq(schema.media.tenantId, tenantId), inArray(schema.media.id, ids)));

  const resolved = new Map<string, ResolvedImage>();
  await Promise.all(
    rows.map(async (r) => {
      const url = await objectUrl(r.storageKey);
      if (url) resolved.set(r.id, { url, alt: r.altText ?? '' });
    }),
  );
  if (resolved.size === 0) return customFields;

  return injectResolvedMedia(customFields, resolved) as T;
}
