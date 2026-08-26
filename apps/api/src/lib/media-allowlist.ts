// Allowed upload MIME types and their per-type size caps. Refused at the
// presign step so a rejected file never even gets a presigned URL — the
// register step re-checks because the client is untrusted and can craft a
// register call with a different mimeType than the one it presigned for.
//
// SVG is intentionally excluded. SVG served with `image/svg+xml` can carry
// inline <script> that fires when the public site renders it — i.e. stored
// XSS. Re-enable only with a sanitiser in the pipeline (e.g. DOMPurify on
// the server) and a deliberate env flag.
//
// Caps are bytes. Numbers chosen for a news-CMS dataset; tune per deploy if
// operators routinely upload bigger originals.
export const MEDIA_ALLOWLIST: Record<string, number> = {
  'image/jpeg': 25 * 1024 * 1024,
  'image/png': 25 * 1024 * 1024,
  'image/webp': 25 * 1024 * 1024,
  'image/gif': 10 * 1024 * 1024,
  'image/avif': 25 * 1024 * 1024,
  'application/pdf': 50 * 1024 * 1024,
  'video/mp4': 200 * 1024 * 1024,
};

export const ALLOWED_MIME_TYPES = Object.keys(MEDIA_ALLOWLIST);

export interface AllowlistFailure {
  reason: 'mime_not_allowed' | 'over_size_cap';
  // Human-readable message safe to return to the client (no PII / paths).
  message: string;
}

/**
 * Validate a MIME type (always) and optionally a declared size against the
 * allowlist. Returns null on success or a failure object the route turns
 * into a 415 / 413.
 */
export function checkMediaUpload(
  mimeType: string,
  sizeBytes?: number,
): AllowlistFailure | null {
  const cap = MEDIA_ALLOWLIST[mimeType];
  if (cap === undefined) {
    return {
      reason: 'mime_not_allowed',
      message: `MIME type "${mimeType}" is not on the upload allowlist. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}.`,
    };
  }
  if (sizeBytes !== undefined && sizeBytes > cap) {
    return {
      reason: 'over_size_cap',
      message: `File size ${sizeBytes} bytes exceeds the ${cap}-byte cap for ${mimeType}.`,
    };
  }
  return null;
}
