// Thin fetch wrapper. credentials:'include' carries the httpOnly session
// cookie automatically. Throws ApiError on non-2xx; treat ApiError.status
// === 401 as "unauthenticated" in calling code.

const BASE_URL = '/api';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /**
     * Parsed JSON response body, when the server returned one. Useful for
     * surfacing structured payloads like 422 validation issues: callers can
     * `if (e instanceof ApiError && e.status === 422) { ... e.body.issues }`.
     * Stays `null` for non-JSON or empty bodies.
     */
    public readonly body: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  // Only declare a JSON content-type when there's actually a body. Fastify
  // rejects an empty body that claims Content-Type: application/json with
  // 400 FST_ERR_CTP_EMPTY_JSON_BODY — which silently broke bodyless requests
  // like POST /logout and DELETE, so the server session outlived "sign out".
  if (init.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers,
  });

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const body: unknown = isJson ? await response.json() : null;

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    if (
      body !== null &&
      typeof body === 'object' &&
      'error' in body &&
      typeof (body).error === 'string'
    ) {
      message = (body as { error: string }).error;
    }
    throw new ApiError(response.status, message, body);
  }

  return body as T;
}

// Pulls a user-facing message out of any thrown value. For ApiError with a
// validation-issues payload (path+message pairs from Zod safeParse on the
// server — see e.g. apps/api/src/routes/admin/setup.ts), folds the issues into
// the message so the user sees "siteUrl: Invalid url" instead of the generic
// "Invalid request body" toast.
export function formatApiError(e: unknown, fallback = 'Request failed'): string {
  if (e instanceof ApiError && e.body && typeof e.body === 'object' && 'issues' in e.body) {
    const issues = (e.body as { issues?: Array<{ path?: string; message: string }> }).issues;
    if (Array.isArray(issues) && issues.length > 0) {
      return issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; ');
    }
  }
  return e instanceof Error ? e.message : fallback;
}
