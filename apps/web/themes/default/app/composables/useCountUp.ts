import { onBeforeUnmount, onMounted, type Ref } from 'vue';

// Counts the site's big stat numbers up from zero the first time they scroll
// into view — the 90px figures in about-intro ("12+"), impact-stats ("202+",
// "1.7L+") and property-showcase ("2M+", "500K+").
//
// The values are STRINGS in the fixtures, never numbers, and they carry
// prefixes and suffixes: "$250K+", "1,000,000+", "1.7L+". So this parses the
// number out of the middle, animates that, and leaves everything around it
// alone.
//
// Two things this deliberately does NOT do:
//   - It does not render the starting value. The component prints the real
//     string in its template, so SSR, crawlers and no-JS visitors always see
//     "1.7L+" — never "0". This only takes over after mount.
//   - It does not try to re-format the final frame. The animation's last step
//     writes back the ORIGINAL string byte for byte, so a value with unusual
//     grouping (Indian "1,00,000+") ends up exactly as the editor typed it.
//
// Same house pattern as useGallerySlider: client-only, rAF,
// explicit teardown.

const DURATION_MS = 1200;
// A beat after the row's reveal has started, so the number isn't ticking while
// it is still fading up.
const START_DELAY_MS = 150;

interface Enhanced {
  el: HTMLElement;
  original: string;
  prefix: string;
  suffix: string;
  target: number;
  decimals: number;
  grouped: boolean;
}

// "$250K+" → { prefix: '$', target: 250, suffix: 'K+' }
// "1.7L+"  → { prefix: '',  target: 1.7, suffix: 'L+', decimals: 1 }
// "Sold"   → null (nothing to count)
function parse(el: HTMLElement): Enhanced | null {
  const original = (el.textContent ?? '').trim();
  const match = /^(\D*)([\d.,]+)(.*)$/.exec(original);
  if (!match) return null;
  const [, prefix = '', raw = '', suffix = ''] = match;
  const target = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(target)) return null;
  const dot = raw.lastIndexOf('.');
  return {
    el,
    original,
    prefix,
    suffix,
    target,
    decimals: dot === -1 ? 0 : raw.length - dot - 1,
    grouped: raw.includes(','),
  };
}

function frameText(item: Enhanced, value: number): string {
  const fixed = value.toFixed(item.decimals);
  const body = item.grouped
    ? Number(fixed).toLocaleString('en-US', {
        minimumFractionDigits: item.decimals,
        maximumFractionDigits: item.decimals,
      })
    : fixed;
  return `${item.prefix}${body}${item.suffix}`;
}

function run(item: Enhanced, rafs: Set<number>): void {
  const start = performance.now() + START_DELAY_MS;
  const step = (now: number): void => {
    const elapsed = now - start;
    if (elapsed < 0) {
      rafs.add(requestAnimationFrame(step));
      return;
    }
    const t = Math.min(1, elapsed / DURATION_MS);
    if (t >= 1) {
      // Restore the editor's exact copy — never our re-formatting of it.
      item.el.textContent = item.original;
      return;
    }
    // easeOutCubic: fast off the mark, settles gently on the number.
    const eased = 1 - Math.pow(1 - t, 3);
    item.el.textContent = frameText(item, item.target * eased);
    rafs.add(requestAnimationFrame(step));
  };
  rafs.add(requestAnimationFrame(step));
}

/**
 * Count up every element matching `selector` inside `root`, once, the first
 * time each scrolls into view. No-ops entirely under `prefers-reduced-motion`.
 */
export function useCountUp(
  root: Ref<HTMLElement | null>,
  selector: string,
): void {
  let io: IntersectionObserver | null = null;
  const rafs = new Set<number>();

  onMounted(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const container = root.value;
    if (!container) return;

    const items = new Map<Element, Enhanced>();
    for (const el of container.querySelectorAll<HTMLElement>(selector)) {
      const item = parse(el);
      if (item) items.set(el, item);
    }
    if (items.size === 0) return;

    io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const item = items.get(entry.target);
          io?.unobserve(entry.target);
          // Blank it only now, at the moment it starts — so a stat that is
          // already on screen at first paint never flickers through zero.
          if (item) run(item, rafs);
        }
      },
      { threshold: 0.4 },
    );
    for (const el of items.keys()) io.observe(el);
  });

  onBeforeUnmount(() => {
    io?.disconnect();
    io = null;
    for (const id of rafs) cancelAnimationFrame(id);
    rafs.clear();
  });
}
