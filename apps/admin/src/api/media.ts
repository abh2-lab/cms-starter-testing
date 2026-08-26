import { apiFetch } from '@/lib/api';

export type MediaProcessingStatus =
  | 'pending'
  | 'processing'
  | 'ready'
  | 'failed';

export interface MediaVariant {
  id: string;
  mediaId: string;
  variantKey: string;
  storageKey: string;
  mimeType: string;
  fileSizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  url: string;
}

export interface Media {
  id: string;
  tenantId: string;
  originalFilename: string;
  storageKey: string;
  mimeType: string;
  fileSizeBytes: number;
  width: number | null;
  height: number | null;
  altText: string | null;
  caption: string | null;
  folderId: string | null;
  uploadedBy: string | null;
  processingStatus: MediaProcessingStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  // Display URL (presigned GET or public), added by the API.
  url: string;
  // Fast 200px thumbnail URL, added by the API list endpoint (falls back to
  // `url` for non-images / media still awaiting variants). Not present on the
  // detail endpoint.
  thumbUrl?: string;
}

export interface MediaDetail extends Media {
  variants: MediaVariant[];
}

export interface MediaContentUsageRef {
  id: string;
  title: string;
  status: string;
  contentTypeId: string;
  typeSlug: string | null;
  typeName: string | null;
}

export interface MediaPageUsageRef {
  id: string;
  title: string;
  slug: string;
  status: string;
}

export interface MediaUsageResponse {
  data: {
    contentRefs: MediaContentUsageRef[];
    pageRefs: MediaPageUsageRef[];
  };
}

export interface MediaListResponse {
  data: Media[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
    limit: number;
  };
}

interface PresignResponse {
  data: {
    url: string;
    storageKey: string;
    method: 'PUT';
    headers: Record<string, string>;
  };
}

export interface RegisterMediaInput {
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  width?: number | null;
  height?: number | null;
  altText?: string | null;
  caption?: string | null;
  folderId?: string | null;
}

export interface UpdateMediaInput {
  altText?: string | null;
  caption?: string | null;
  folderId?: string | null;
}

export interface ListMediaParams {
  cursor?: string;
  limit?: number;
  folderId?: string;
  type?: string;
  q?: string;
}

function buildQuery(params: ListMediaParams): string {
  const sp = new URLSearchParams();
  if (params.cursor) sp.set('cursor', params.cursor);
  if (params.limit !== undefined) sp.set('limit', String(params.limit));
  if (params.folderId) sp.set('folderId', params.folderId);
  if (params.type) sp.set('type', params.type);
  if (params.q) sp.set('q', params.q);
  return sp.size > 0 ? `?${sp.toString()}` : '';
}

export const mediaApi = {
  list: (params: ListMediaParams = {}) =>
    apiFetch<MediaListResponse>(`/admin/media${buildQuery(params)}`),
  get: (id: string) => apiFetch<{ data: MediaDetail }>(`/admin/media/${id}`),
  usage: (id: string) =>
    apiFetch<MediaUsageResponse>(`/admin/media/${id}/usage`),
  presign: (filename: string, contentType: string) =>
    apiFetch<PresignResponse>('/admin/media/presign', {
      method: 'POST',
      body: JSON.stringify({ filename, contentType }),
    }),
  register: (input: RegisterMediaInput) =>
    apiFetch<{ data: Media }>('/admin/media', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: UpdateMediaInput) =>
    apiFetch<{ data: Media }>(`/admin/media/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    apiFetch<null>(`/admin/media/${id}`, { method: 'DELETE' }),
};

// Upload bytes straight to S3 via a presigned PUT URL. Uses XHR (not fetch) so
// we get upload progress events.
export function putToS3(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress?: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) {
      xhr.setRequestHeader(k, v);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Upload network error'));
    xhr.send(file);
  });
}

// Best-effort client-side image dimensions; non-images resolve to null.
export function readImageSize(
  file: File,
): Promise<{ width: number; height: number } | null> {
  if (!file.type.startsWith('image/')) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(objectUrl);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(objectUrl);
    };
    img.src = objectUrl;
  });
}

// Orchestrate the full upload: presign → PUT to S3 → register the row.
export async function uploadMedia(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<Media> {
  const { data: signed } = await mediaApi.presign(file.name, file.type);
  await putToS3(signed.url, file, signed.headers, onProgress);
  const size = await readImageSize(file);
  const { data } = await mediaApi.register({
    storageKey: signed.storageKey,
    originalFilename: file.name,
    mimeType: file.type,
    fileSizeBytes: file.size,
    width: size?.width ?? null,
    height: size?.height ?? null,
  });
  return data;
}
