// Pure, dependency-free helpers shared by the embed renderer (inject-embed.ts)
// and the Link-mode provider registry (embed-providers.ts). Kept in their own
// module so the two can share them without a circular import.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function isHttp(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

// Pull an 11-char video id out of any common YouTube URL shape:
// watch?v=ID, youtu.be/ID, /embed/ID, /shorts/ID, /v/ID (extra params ignored).
const YT_ID = /(?:[?&]v=|youtu\.be\/|\/embed\/|\/shorts\/|\/v\/)([A-Za-z0-9_-]{11})/;

export function youtubeId(url: string): string | null {
  const m = YT_ID.exec(url);
  return m ? (m[1] ?? null) : null;
}

export function captionHtml(caption: string): string {
  return caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : '';
}
