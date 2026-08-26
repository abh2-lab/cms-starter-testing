import type { DirectiveBinding } from 'vue';

// The v-reveal directive — the theme's ONE scroll-reveal mechanism.
//
//   v-reveal           → this element fades + rises when it scrolls into view
//   v-reveal.stagger   → each DIRECT CHILD does, 70ms apart
//
// Never hide the OBSERVED element with a clip. There used to be a `.draw`
// variant that hid SVG art with clip-path, and it wedged: a clip shrinks the
// element's visible area to zero, IntersectionObserver measures zero, and the
// callback that would have un-hidden it never fires. The hidden state prevented
// its own reveal.
//
// Hiding with OPACITY is safe, and so is `stroke-dashoffset` — it is paint-only
// and changes no box at all. ThemeCurve uses this same observer to draw a curve
// along its own path, and where it still needs a clip it puts that on an inner
// <g>, so what we observe keeps its full size either way.
//
// Registered on BOTH server and client — deliberately NOT `reveal.client.ts`.
// Vue's SSR renderer throws ("Cannot read properties of undefined (reading
// 'getSSRProps')") the moment a template uses a directive the server doesn't
// know about, so a client-only registration 500s every page that uses v-reveal.
//
// Registering it on the server costs nothing, because only `mounted` does any
// work and `mounted` never fires during SSR. That is also the whole design:
// the hidden state (`data-reveal=""`) is applied at mount, so the
// server-rendered HTML has every section fully visible. A visitor with
// JavaScript off — or a crawler — sees the finished page, never a blank one.
// The matching CSS lives in assets/css/theme.css under "Scroll reveal";
// blocks write no reveal CSS of their own.
//
// Two rules for callers:
//   1. Put it on the INNER container, never on a <section> that carries a
//      coloured band. Fading a whole band in looks cheap and jumps the page.
//   2. Never put it on a hero. Above-the-fold art uses a plain CSS animation
//      that runs at first paint, so it cannot flash visible → hidden → in if
//      hydration is slow.
//
// One shared IntersectionObserver for the whole document rather than one per
// element — same reasoning as the single rAF handle in useGallerySlider.

// Past this many children the stagger stops growing. A 20-item grid would
// otherwise leave the last card waiting 1.4s after the first, which reads as
// broken rather than considered.
const MAX_STAGGER_STEPS = 8;

let observer: IntersectionObserver | null = null;

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function getObserver(): IntersectionObserver {
  if (observer) return observer;
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        (entry.target as HTMLElement).dataset['reveal'] = 'in';
        // Reveal happens ONCE. Without this the section would re-hide and
        // replay every time you scrolled back up past it.
        observer?.unobserve(entry.target);
      }
    },
    {
      // Negative bottom margin: the section starts moving once its top edge
      // is ~12% of the viewport above the fold, so it has finished arriving
      // by the time the reader's eye reaches it.
      rootMargin: '0px 0px -12% 0px',
      threshold: 0.01,
    },
  );
  return observer;
}

// The elements this binding is responsible for: the element itself, or its
// direct children when `.stagger` is used.
function targetsFor(el: HTMLElement, binding: DirectiveBinding): HTMLElement[] {
  if (!binding.modifiers['stagger']) return [el];
  return Array.from(el.children).filter(
    (c): c is HTMLElement => c instanceof HTMLElement,
  );
}

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('reveal', {
    mounted(el: HTMLElement, binding) {
      // Bail BEFORE anything is hidden — never hide what we can't un-hide.
      // Reduced motion: the CSS kill switch would un-hide it anyway, but not
      // observing at all keeps the cost at zero.
      // No IntersectionObserver: nothing would ever set `in`, so the section
      // would stay invisible forever. Leave it alone instead.
      if (!('IntersectionObserver' in window) || prefersReducedMotion()) return;

      const io = getObserver();
      targetsFor(el, binding).forEach((target, i) => {
        // Empty string, not 'out' — the CSS keys off attribute PRESENCE for
        // the hidden state and the 'in' value for the revealed one.
        target.dataset['reveal'] = '';
        if (i > 0) {
          const step = Math.min(i, MAX_STAGGER_STEPS);
          target.style.setProperty(
            '--reveal-delay',
            `calc(var(--reveal-stagger) * ${step})`,
          );
        }
        io.observe(target);
      });
    },

    // Route changes unmount the whole block tree. Anything still waiting to
    // intersect has to be dropped or the observer holds detached nodes alive.
    unmounted(el: HTMLElement, binding) {
      if (!observer) return;
      for (const target of targetsFor(el, binding)) observer.unobserve(target);
    },
  });
});
