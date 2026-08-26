import { captionHtml, escapeHtml, isHttp, youtubeId } from './embed-util';

// Link-mode provider registry. Pure + synchronous (no network): a pasted URL is
// matched against known providers and turned into a real embed — an <iframe>
// for players/viz, or a platform <blockquote> that the client composable
// (useEmbeds) hydrates with the provider's widget script. No match → null, and
// the caller (inject-embed) falls back to an OG card.

interface FrameOpts {
  variant?: string;
  title?: string;
}

function iframeEmbed(
  src: string,
  caption: string,
  opts: FrameOpts = {},
): string {
  const variant = opts.variant ? ` embed-frame--${opts.variant}` : '';
  const title = escapeHtml(opts.title ?? 'Embedded content');
  return (
    `<figure class="embed embed--iframe">` +
    `<div class="embed-frame${variant}">` +
    `<iframe src="${escapeHtml(src)}" title="${title}" loading="lazy" ` +
    `referrerpolicy="strict-origin-when-cross-origin" ` +
    `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" ` +
    `allowfullscreen></iframe>` +
    `</div>` +
    captionHtml(caption) +
    `</figure>`
  );
}

function socialEmbed(blockquote: string, caption: string): string {
  return `<figure class="embed embed--social">${blockquote}${captionHtml(caption)}</figure>`;
}

function firstGroup(re: RegExp, url: string): string | null {
  return re.exec(url)?.[1] ?? null;
}

type Builder = (url: string, caption: string) => string | null;

const BUILDERS: Builder[] = [
  // YouTube → privacy-mode player.
  (url, cap) => {
    const id = youtubeId(url);
    return id
      ? iframeEmbed(`https://www.youtube-nocookie.com/embed/${id}`, cap, {
          variant: 'video',
          title: 'YouTube video player',
        })
      : null;
  },
  // Vimeo.
  (url, cap) => {
    const id = firstGroup(/vimeo\.com\/(?:video\/)?(\d+)/, url);
    return id
      ? iframeEmbed(`https://player.vimeo.com/video/${id}`, cap, {
          variant: 'video',
          title: 'Vimeo video player',
        })
      : null;
  },
  // Spotify (track/episode are short; album/playlist/show/artist are tall).
  (url, cap) => {
    const m =
      /open\.spotify\.com\/(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/.exec(
        url,
      );
    const kind = m?.[1];
    const id = m?.[2];
    if (!kind || !id) return null;
    const variant =
      kind === 'track' || kind === 'episode' ? 'audio' : 'audio-tall';
    return iframeEmbed(`https://open.spotify.com/embed/${kind}/${id}`, cap, {
      variant,
      title: 'Spotify player',
    });
  },
  // Dailymotion (long and short URL forms).
  (url, cap) => {
    const id =
      firstGroup(/dailymotion\.com\/video\/([A-Za-z0-9]+)/, url) ??
      firstGroup(/dai\.ly\/([A-Za-z0-9]+)/, url);
    return id
      ? iframeEmbed(`https://www.dailymotion.com/embed/video/${id}`, cap, {
          variant: 'video',
          title: 'Dailymotion video player',
        })
      : null;
  },
  // Flourish data-viz / stories.
  (url, cap) => {
    const id = firstGroup(
      /flourish\.studio\/(?:visualisation|story)\/(\d+)/,
      url,
    );
    return id
      ? iframeEmbed(`https://flo.uri.sh/visualisation/${id}/embed`, cap, {
          variant: 'viz',
          title: 'Flourish visualisation',
        })
      : null;
  },
  // Datawrapper charts.
  (url, cap) => {
    const id =
      firstGroup(/datawrapper\.dwcdn\.net\/([A-Za-z0-9]+)/, url) ??
      firstGroup(/datawrapper\.de\/_\/([A-Za-z0-9]+)/, url);
    return id
      ? iframeEmbed(`https://datawrapper.dwcdn.net/${id}/`, cap, {
          variant: 'viz',
          title: 'Datawrapper chart',
        })
      : null;
  },
  // Instagram — token-free /embed iframe (post / reel / IGTV).
  (url, cap) => {
    const m = /instagram\.com\/(p|reel|tv)\/([A-Za-z0-9_-]+)/.exec(url);
    const kind = m?.[1];
    const code = m?.[2];
    if (!kind || !code) return null;
    return iframeEmbed(`https://www.instagram.com/${kind}/${code}/embed`, cap, {
      variant: 'portrait',
      title: 'Instagram post',
    });
  },
  // Twitter / X — blockquote hydrated by widgets.js (the widget reads the href).
  (url, cap) => {
    if (!/(?:twitter|x)\.com\/[^/]+\/status\/\d+/.test(url)) return null;
    return socialEmbed(
      `<blockquote class="twitter-tweet" data-dnt="true"><a href="${escapeHtml(url)}"></a></blockquote>`,
      cap,
    );
  },
  // TikTok — blockquote hydrated by TikTok's embed.js.
  (url, cap) => {
    const id = firstGroup(/tiktok\.com\/@[^/]+\/video\/(\d+)/, url);
    if (!id) return null;
    return socialEmbed(
      `<blockquote class="tiktok-embed" cite="${escapeHtml(url)}" data-video-id="${id}"><a href="${escapeHtml(url)}"></a></blockquote>`,
      cap,
    );
  },
];

/**
 * Render a pasted URL as a known-provider embed, or return null if no provider
 * matches (the caller then shows an OG card).
 */
export function renderLinkEmbed(url: string, caption: string): string | null {
  if (!isHttp(url)) return null;
  for (const build of BUILDERS) {
    const out = build(url, caption);
    if (out) return out;
  }
  return null;
}

// ── Provider hosts (CSP allow-list source of truth) ─────────────────────────
// The social-widget LOADER scripts useEmbeds injects to hydrate the Twitter/X,
// Instagram, and TikTok blockquotes the builders above emit. Kept next to the
// registry so the provider list has a single home: useEmbeds derives its loader
// map from this, and the public-site Content-Security-Policy
// (apps/web/server/middleware/01.security-headers.ts) allow-lists these origins
// in `script-src`. embed-csp.test.ts fails the build if the two ever drift.
export const EMBED_WIDGET_SCRIPTS = {
  twitter: 'https://platform.twitter.com/widgets.js',
  instagram: 'https://www.instagram.com/embed.js',
  tiktok: 'https://www.tiktok.com/embed.js',
} as const;

// The `script-src` allow-list: every loader origin above, PLUS the extra origins
// Twitter's widgets.js pulls into the page itself — the syndication API and its
// CDN (the tweet markup/iframes load same-origin to those hosts). Instagram and
// TikTok do the rest of their work inside the iframe they inject, so their own
// host is enough. Origins only (scheme + host), which is the CSP source format.
export const EMBED_SCRIPT_HOSTS = [
  'https://platform.twitter.com',
  'https://syndication.twitter.com',
  'https://cdn.syndication.twimg.com',
  'https://www.instagram.com',
  'https://www.tiktok.com',
] as const;
