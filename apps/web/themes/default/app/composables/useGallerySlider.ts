import { nextTick, onBeforeUnmount, onMounted, watch, type Ref } from 'vue';

// Client-only progressive enhancement for body galleries rendered with the
// `slider` layout. The article body is injected via v-html (see ContentBody),
// so we can't mount a Vue component inside it — instead, after render we find
// each `.gallery--slider`, inject a header (image counter + prev/next arrows),
// and wire scroll-snap navigation, a live counter, arrow disabled-state, and
// ArrowLeft/Right keyboard control. SSR emits no chrome (the gallery is still a
// readable, swipeable strip without JS); everything here runs in the browser
// only — onMounted never fires during SSR.

const PREV_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
const NEXT_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"></polyline></svg>';

interface SliderHandle {
  cleanup: () => void;
}

function initSlider(gallery: HTMLElement): SliderHandle | null {
  const track = gallery.querySelector<HTMLElement>('.gallery-grid');
  if (!track) return null;
  const slides = Array.from(track.querySelectorAll<HTMLElement>('img'));
  if (slides.length === 0) return null;

  gallery.dataset.sliderReady = 'true';
  gallery.setAttribute('tabindex', '0');

  // Header: counter + arrows, inserted before the scroll track.
  const header = document.createElement('div');
  header.className = 'gallery-slider-header';
  const count = document.createElement('span');
  count.className = 'gallery-slider-count';
  count.innerHTML = `<span class="cur">1</span> / <span class="total">${slides.length}</span>`;
  const arrows = document.createElement('div');
  arrows.className = 'gallery-slider-arrows';
  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'gallery-slider-arrow gallery-slider-prev disabled';
  prev.setAttribute('aria-label', 'Previous image');
  prev.innerHTML = PREV_SVG;
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'gallery-slider-arrow gallery-slider-next';
  next.setAttribute('aria-label', 'Next image');
  next.innerHTML = NEXT_SVG;
  arrows.append(prev, next);
  header.append(count, arrows);
  gallery.insertBefore(header, track);

  const cur = count.querySelector<HTMLElement>('.cur');

  // Position of a slide's left edge relative to the track's viewport — robust
  // against the inter-slide gap (so we never rely on index * width math).
  const slideOffset = (s: HTMLElement): number =>
    s.getBoundingClientRect().left - track.getBoundingClientRect().left;

  const current = (): number => {
    let best = 0;
    let bestDist = Infinity;
    slides.forEach((s, i) => {
      const d = Math.abs(slideOffset(s));
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  };

  const update = (): void => {
    const i = current();
    if (cur) cur.textContent = String(i + 1);
    prev.classList.toggle('disabled', i <= 0);
    next.classList.toggle('disabled', i >= slides.length - 1);
  };

  const go = (i: number): void => {
    const clamped = Math.max(0, Math.min(i, slides.length - 1));
    const s = slides[clamped];
    if (s) {
      track.scrollTo({ left: track.scrollLeft + slideOffset(s), behavior: 'smooth' });
    }
  };

  const onPrev = (): void => go(current() - 1);
  const onNext = (): void => go(current() + 1);
  prev.addEventListener('click', onPrev);
  next.addEventListener('click', onNext);

  let raf = 0;
  const onScroll = (): void => {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(update);
  };
  track.addEventListener('scroll', onScroll, { passive: true });

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onPrev();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onNext();
    }
  };
  gallery.addEventListener('keydown', onKey);

  update();

  return {
    cleanup: (): void => {
      prev.removeEventListener('click', onPrev);
      next.removeEventListener('click', onNext);
      track.removeEventListener('scroll', onScroll);
      gallery.removeEventListener('keydown', onKey);
      if (raf) cancelAnimationFrame(raf);
      header.remove();
      delete gallery.dataset.sliderReady;
      gallery.removeAttribute('tabindex');
    },
  };
}

/**
 * Enhance every `.gallery--slider` inside `bodyEl` with mock-style slider
 * chrome. Re-runs when `slug` changes (the article body re-renders on
 * navigation) and tears down on unmount.
 */
export function useGallerySlider(
  bodyEl: Ref<HTMLElement | null>,
  slug: Ref<string>,
): void {
  let handles: SliderHandle[] = [];

  const teardown = (): void => {
    for (const h of handles) h.cleanup();
    handles = [];
  };

  const enhance = (): void => {
    const root = bodyEl.value;
    if (!root) return;
    root
      .querySelectorAll<HTMLElement>('.gallery--slider:not([data-slider-ready])')
      .forEach((g) => {
        const h = initSlider(g);
        if (h) handles.push(h);
      });
  };

  onMounted(() => {
    void nextTick(enhance);
  });

  // Body content is replaced on navigation; drop stale handles and re-enhance
  // the freshly rendered galleries.
  watch(slug, () => {
    teardown();
    void nextTick(enhance);
  });

  onBeforeUnmount(teardown);
}
