import { nextTick, onBeforeUnmount, onMounted, watch, type Ref } from 'vue';
import { EMBED_WIDGET_SCRIPTS } from '../utils/embed-providers';

// Client-only enhancement of embeds inside the v-html'd article body — same
// pattern as useGallerySlider (the body is a static HTML string, so we can't
// mount a child component into it). Two idempotent jobs, both re-run on
// navigation:
//   1. Social blockquotes (Twitter/X, Instagram, TikTok) — load the provider's
//      widget script ONCE, then ask it to (re)process the body.
//   2. Card placeholders — fetch OG metadata from /api/embed/card and fill them.
// onMounted never fires during SSR, so none of this runs server-side; the SSR'd
// fallbacks (a readable <a> for cards, a bare blockquote for socials) degrade
// gracefully without JS.

interface OgMeta {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

// Loader URLs live in the provider registry (embed-providers) so the public
// site's CSP `script-src` allow-list can be derived from the same source — see
// EMBED_SCRIPT_HOSTS there.
const SCRIPTS = EMBED_WIDGET_SCRIPTS;

// Scripts are appended at most once per page load.
const loaded = new Set<string>();

function loadScript(src: string): Promise<void> {
  return new Promise((resolve) => {
    if (loaded.has(src)) {
      resolve();
      return;
    }
    loaded.add(src);
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = (): void => resolve();
    // Fail open: if a widget script is blocked, the fallback markup stays.
    s.onerror = (): void => resolve();
    document.body.appendChild(s);
  });
}

function processSocials(root: HTMLElement): void {
  if (root.querySelector('.twitter-tweet')) {
    void loadScript(SCRIPTS.twitter).then(() => {
      (
        window as unknown as {
          twttr?: { widgets: { load: (el?: HTMLElement) => void } };
        }
      ).twttr?.widgets.load(root);
    });
  }
  if (root.querySelector('.instagram-media')) {
    void loadScript(SCRIPTS.instagram).then(() => {
      (
        window as unknown as { instgrm?: { Embeds: { process: () => void } } }
      ).instgrm?.Embeds.process();
    });
  }
  if (root.querySelector('.tiktok-embed')) {
    // TikTok's embed.js scans on load; re-injecting it re-scans after nav.
    loaded.delete(SCRIPTS.tiktok);
    void loadScript(SCRIPTS.tiktok);
  }
}

// Build the rich card from fetched metadata using textContent/img.src ONLY —
// never innerHTML of remote data.
function renderCard(card: HTMLElement, meta: OgMeta): void {
  if (!meta.title && !meta.image && !meta.description) return; // nothing useful
  const url = card.getAttribute('data-embed-url') ?? meta.url;

  const a = document.createElement('a');
  a.className = 'embed-card';
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';

  if (meta.image) {
    const media = document.createElement('div');
    media.className = 'embed-card__media';
    const img = document.createElement('img');
    img.src = meta.image;
    img.alt = '';
    img.loading = 'lazy';
    media.appendChild(img);
    a.appendChild(media);
  }

  const body = document.createElement('div');
  body.className = 'embed-card__body';
  if (meta.siteName) {
    const site = document.createElement('span');
    site.className = 'embed-card__site';
    site.textContent = meta.siteName;
    body.appendChild(site);
  }
  const title = document.createElement('span');
  title.className = 'embed-card__title';
  title.textContent = meta.title ?? url;
  body.appendChild(title);
  if (meta.description) {
    const desc = document.createElement('span');
    desc.className = 'embed-card__desc';
    desc.textContent = meta.description;
    body.appendChild(desc);
  }
  a.appendChild(body);

  const fallback = card.querySelector('.embed-card__fallback');
  if (fallback) fallback.replaceWith(a);
  else card.insertBefore(a, card.firstChild);
}

async function fillCards(root: HTMLElement, signal: AbortSignal): Promise<void> {
  const cards = Array.from(
    root.querySelectorAll<HTMLElement>(
      '.embed--card[data-embed-card]:not([data-embed-ready])',
    ),
  );
  await Promise.all(
    cards.map(async (card) => {
      const url = card.getAttribute('data-embed-url');
      if (!url) return;
      card.setAttribute('data-embed-ready', '');
      try {
        const res = await fetch(
          `/api/embed/card?url=${encodeURIComponent(url)}`,
          { signal },
        );
        if (!res.ok) return;
        renderCard(card, (await res.json()) as OgMeta);
      } catch {
        // aborted (navigation) or network error — keep the fallback link
      }
    }),
  );
}

/**
 * Enhance embeds inside `bodyEl`: load social widget scripts and fill OG cards.
 * Re-runs when `slug` changes (the body re-renders on navigation) and aborts
 * in-flight card fetches on teardown.
 */
export function useEmbeds(
  bodyEl: Ref<HTMLElement | null>,
  slug: Ref<string>,
): void {
  let controller: AbortController | null = null;

  const enhance = (): void => {
    const root = bodyEl.value;
    if (!root) return;
    processSocials(root);
    controller?.abort();
    controller = new AbortController();
    void fillCards(root, controller.signal);
  };

  const teardown = (): void => {
    controller?.abort();
    controller = null;
  };

  onMounted(() => {
    void nextTick(enhance);
  });

  watch(slug, () => {
    teardown();
    void nextTick(enhance);
  });

  onBeforeUnmount(teardown);
}
