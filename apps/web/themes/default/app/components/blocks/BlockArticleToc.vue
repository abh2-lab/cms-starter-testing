<script setup lang="ts">
// Standalone block: the "In this story" quick-navigation card. Logic moved
// verbatim from the hand-built ArticleToc.vue (theme engine v1.5
// re-blocking) — built CLIENT-SIDE from the rendered body's h2/h3 so the
// anchor ids land on the exact heading elements; scroll-spy highlights the
// section in view via IntersectionObserver. Renders nothing until there are
// at least two headings, so SSR output (no items) and the initial client
// render agree.
//
// The body element arrives via provide/inject ('article-body-el', provided
// by ArticleView's body wrapper ref) — composed block data can't carry a DOM
// ref, and the block renders OUTSIDE the scanned wrapper so its own card
// never pollutes the heading scan.
import { inject, type Ref } from 'vue';

const props = defineProps<{
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  data: Record<string, unknown> | null;
}>();

function fieldStr(key: string, fallback: string): string {
  const v = props.fields[key];
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}
const label = computed(() => fieldStr('label', 'In this story'));
const title = computed(() => fieldStr('title', 'Quick navigation'));

const bodyEl = inject<Ref<HTMLElement | null>>(
  'article-body-el',
  ref(null),
);

interface TocItem {
  id: string;
  text: string;
  level: number;
}

const items = ref<TocItem[]>([]);
const activeId = ref<string | null>(null);
let observer: IntersectionObserver | null = null;

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'section'
  );
}

function build(): void {
  const el = bodyEl.value;
  observer?.disconnect();
  if (!el) {
    items.value = [];
    return;
  }
  const heads = Array.from(el.querySelectorAll('h2, h3'));
  const used = new Set<string>();
  const list: TocItem[] = [];
  for (const h of heads) {
    const text = (h.textContent ?? '').trim();
    if (!text) continue;
    let id = h.id || slugify(text);
    let unique = id;
    let n = 2;
    while (used.has(unique)) unique = `${id}-${n++}`;
    id = unique;
    used.add(id);
    h.id = id;
    list.push({ id, text, level: h.tagName === 'H3' ? 3 : 2 });
  }
  items.value = list;

  if (typeof IntersectionObserver === 'undefined' || heads.length === 0) return;
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) activeId.value = (e.target as HTMLElement).id;
      }
    },
    { rootMargin: '0px 0px -70% 0px', threshold: 0 },
  );
  heads.forEach((h) => observer!.observe(h));
}

onMounted(build);
watch(bodyEl, build);
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div v-if="items.length >= 2" class="article-toc">
    <div class="article-toc-header">
      <div>
        <div class="article-toc-label">{{ label }}</div>
        <div class="article-toc-title">{{ title }}</div>
      </div>
    </div>
    <div class="article-toc-links article-toc-grid">
      <a
        v-for="it in items"
        :key="it.id"
        :href="`#${it.id}`"
        :class="['article-toc-link', { active: it.id === activeId }]"
      >{{ it.text }}</a>
    </div>
  </div>
</template>

<style scoped>
.article-toc {
  background: #faf7f2;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 22px;
  padding: 24px 28px;
  margin-bottom: 24px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}
.article-toc-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}
.article-toc-label {
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.3em;
  color: rgba(0, 0, 0, 0.5);
}
.article-toc-title {
  font-size: 18px;
  font-weight: 800;
  color: #121212;
  margin-top: 8px;
}
.article-toc-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.article-toc-link {
  display: block;
  padding: 12px 16px;
  font-size: 13px;
  font-weight: 700;
  color: rgba(0, 0, 0, 0.7);
  text-decoration: none;
  transition: color 0.2s;
  background: rgba(0, 0, 0, 0.03);
  border-radius: 14px;
}
.article-toc-link:hover,
.article-toc-link.active {
  color: #d34135;
}
@media (max-width: 767px) {
  .article-toc-grid {
    grid-template-columns: 1fr;
  }
}
</style>
