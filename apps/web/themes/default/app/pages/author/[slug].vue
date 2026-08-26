<script setup lang="ts">
import { cmsFetch, type StoryArchive } from '~/composables/useCmsFetch';
import ScardCard from '~/components/ScardCard.vue';

// Decode author profile page. Layout follows the published mock
// (decode-allfiles-v3/author-adrija.html): a centered beige hero with a
// rounded-square avatar flanked by horizontal dividers above the name,
// role + bio underneath, then a row of square social buttons and a
// "Back to Authors" link. Below the hero, a #faf7f2 "Featured Stories"
// section with a section-heading-row (label + decorative line) and a
// 3-col scard grid of the author's recent articles.
//
// Design-locked: hero structure, colours and section background are
// fixed in code. Editors don't reach in to swap them. Per-author copy
// (name, role, bio, socials) flows in from the Author CPT customFields
// — that's the editor-controlled surface.

const route = useRoute();
const slug = computed(() => {
  const raw = route.params['slug'];
  return typeof raw === 'string' ? raw : '';
});

const contentType = 'author';

// The content detail endpoint returns the full row with customFields raw and
// any media_single key spliced as heroImageUrl. The Author CPT's `photo_key`
// uses the same convention so the resolved URL arrives as customFields.heroImageUrl.
interface AuthorDetail {
  id: string;
  title: string;
  slug: string;
  customFields: {
    role?: unknown;
    bio?: unknown;
    photo_key?: unknown;
    heroImageUrl?: unknown;
    twitter_handle?: unknown;
    instagram_handle?: unknown;
    email?: unknown;
  };
}

const { data: author } = await useAsyncData(
  () => `author:${slug.value}`,
  () =>
    cmsFetch<AuthorDetail>(
      `/api/public/content/${contentType}/${encodeURIComponent(slug.value)}`,
    ),
  { watch: [slug] },
);

if (!author.value) {
  throw createError({
    statusCode: 404,
    statusMessage: 'Author not found',
    fatal: true,
  });
}

// Stories by this author. Backed by the public archive endpoint's
// ?author=<slug> filter (jsonb containment on custom_fields.authors[].slug).
// pageSize 24 is plenty for a single profile page — pagination on the
// author landing is a Phase 8+ nicety if anyone asks for it.
const { data: archive } = await useAsyncData(
  () => `author:${slug.value}:articles`,
  () =>
    cmsFetch<StoryArchive>('/api/public/archive/article', {
      author: slug.value,
      pageSize: 24,
    }),
  { watch: [slug] },
);

const articles = computed(() => archive.value?.items ?? []);

const cf = computed(() => author.value?.customFields ?? {});

const role = computed<string | null>(() => {
  const v = cf.value.role;
  return typeof v === 'string' && v.length > 0 ? v : null;
});

const bio = computed<unknown>(() => cf.value.bio);

// First paragraph of the Tiptap bio doc rendered as plain text — the hero
// row in the mock uses a single bio paragraph, not the whole long-form doc.
// Falls back to null when bio is missing or the doc has no paragraph text.
function tiptapFirstParagraph(doc: unknown): string | null {
  if (!doc || typeof doc !== 'object') return null;
  const root = doc as { content?: unknown };
  if (!Array.isArray(root.content)) return null;
  for (const node of root.content) {
    if (
      node !== null &&
      typeof node === 'object' &&
      'type' in node &&
      (node as { type: unknown }).type === 'paragraph'
    ) {
      const inner = (node as { content?: unknown }).content;
      if (!Array.isArray(inner)) continue;
      const parts: string[] = [];
      for (const child of inner) {
        if (
          child !== null &&
          typeof child === 'object' &&
          'type' in child &&
          (child as { type: unknown }).type === 'text' &&
          typeof (child as { text?: unknown }).text === 'string'
        ) {
          parts.push((child as { text: string }).text);
        }
      }
      const text = parts.join('').trim();
      if (text.length > 0) return text;
    }
  }
  return null;
}

const bioText = computed<string | null>(() => tiptapFirstParagraph(bio.value));

const photoUrl = computed<string | null>(() => {
  const v = cf.value.heroImageUrl;
  return typeof v === 'string' && v.length > 0 ? v : null;
});

// Initial-letter avatar fallback — used when an author row has no headshot
// uploaded. Two letters where possible (first + last name initial); falls
// back to a single letter for single-word names or `?` when name is empty.
const initials = computed(() => {
  const name = author.value?.title ?? '';
  const parts = name
    .split(/\s+/)
    .map((p) => p.charAt(0))
    .filter((c) => c.length > 0);
  return (parts.slice(0, 2).join('') || '?').toUpperCase();
});

const twitter = computed<string | null>(() => {
  const v = cf.value.twitter_handle;
  return typeof v === 'string' && v.length > 0 ? v : null;
});
const instagram = computed<string | null>(() => {
  const v = cf.value.instagram_handle;
  return typeof v === 'string' && v.length > 0 ? v : null;
});
const email = computed<string | null>(() => {
  const v = cf.value.email;
  return typeof v === 'string' && v.length > 0 ? v : null;
});

useHead(() => ({
  title: author.value ? author.value.title : 'Author',
  meta: [
    {
      name: 'description',
      content:
        bioText.value ??
        (typeof cf.value.role === 'string'
          ? cf.value.role
          : `Profile of ${author.value?.title ?? 'author'}.`),
    },
  ],
}));
</script>

<template>
  <section v-if="author" class="author-page">
    <!-- ─── Beige hero ─────────────────────────────────────────── -->
    <section class="author-hero">
      <div class="container-custom">
        <div class="author-hero-content">
          <img
            v-if="photoUrl"
            :src="photoUrl"
            :alt="author.title"
            class="author-avatar-large"
            loading="eager"
            decoding="async"
          />
          <span
            v-else
            class="author-avatar-large author-avatar-initials"
            aria-hidden="true"
          >
            {{ initials }}
          </span>

          <div class="author-info">
            <div class="author-name-wrapper">
              <div class="name-divider" />
              <h1 class="author-name-large">{{ author.title }}</h1>
              <div class="name-divider" />
            </div>

            <p v-if="role" class="author-role-large">{{ role }}</p>
            <p v-if="bioText" class="author-bio-large">{{ bioText }}</p>

            <div class="divider-line" />

            <div class="author-social-large">
              <a
                v-if="twitter"
                :href="`https://twitter.com/${twitter.replace(/^@/, '')}`"
                class="social-link-large"
                target="_blank"
                rel="noopener"
                aria-label="Twitter"
              >
                <svg class="icon-sm" fill="currentColor" viewBox="0 0 24 24">
                  <path
                    d="M18.244 2H21l-6.553 7.49L22 22h-6.828l-5.35-6.97L3.71 22H1l7.02-8.03L2 2h6.914l4.84 6.285L18.244 2zm-1.195 18h1.892L7.86 3.938H5.83L17.05 20z"
                  />
                </svg>
              </a>
              <a
                v-if="instagram"
                :href="`https://instagram.com/${instagram.replace(/^@/, '')}`"
                class="social-link-large"
                target="_blank"
                rel="noopener"
                aria-label="Instagram"
              >
                <svg class="icon-sm" fill="currentColor" viewBox="0 0 24 24">
                  <path
                    d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"
                  />
                </svg>
              </a>
              <a
                v-if="email"
                :href="`mailto:${email}`"
                class="social-link-large"
                aria-label="Email"
              >
                <svg class="icon-sm" fill="currentColor" viewBox="0 0 24 24">
                  <path
                    d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"
                  />
                </svg>
              </a>
            </div>

            <NuxtLink to="/authors" class="btn-back">
              ← Back to Authors
            </NuxtLink>
          </div>
        </div>
      </div>
    </section>

    <!-- ─── Featured Stories ───────────────────────────────────── -->
    <main class="author-stories-section">
      <div class="container-custom">
        <div class="section-heading-row">
          <h2 class="section-heading-text">Featured Stories</h2>
          <div class="section-heading-line" />
        </div>

        <div v-if="articles.length === 0" class="author-stories-empty">
          <p>No published stories yet.</p>
        </div>

        <div v-else class="stories-grid">
          <ScardCard
            v-for="story in articles"
            :key="story.id"
            :story="story"
          />
        </div>
      </div>
    </main>
  </section>
</template>

<style scoped>
.author-page {
  background: transparent;
}
.container-custom {
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 40px;
}

/* ─── Hero ─────────────────────────────────────────────────── */
.author-hero {
  background-color: #f4f3e9;
  color: #121212;
  padding: 40px 0;
}
.author-hero-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  max-width: 800px;
  margin: 0 auto;
}
.author-avatar-large {
  width: 140px;
  height: 140px;
  border-radius: 16px;
  object-fit: cover;
  margin-bottom: 20px;
  display: block;
  background: linear-gradient(135deg, #d34135 0%, #b71c1c 100%);
  color: #fff;
}
.author-avatar-initials {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 48px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.author-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}
.author-name-wrapper {
  display: flex;
  align-items: center;
  gap: 24px;
  justify-content: center;
  margin-bottom: 12px;
  width: 100%;
}
.name-divider {
  flex: 1;
  height: 1px;
  background: #121212;
  opacity: 0.3;
}
.author-name-large {
  font-size: 48px;
  font-weight: 400;
  margin: 0;
  font-family: 'Figtree', sans-serif;
  white-space: nowrap;
  letter-spacing: -0.01em;
}
.author-role-large {
  font-size: 16px;
  font-weight: 500;
  color: #121212;
  text-transform: capitalize;
  letter-spacing: 0;
  margin: 0 0 16px;
}
.author-bio-large {
  font-size: 16px;
  line-height: 1.7;
  color: #666;
  margin: 0 0 20px;
  max-width: 100%;
}
.divider-line {
  width: 100%;
  height: 1px;
  background: #121212;
  opacity: 0.2;
  margin-bottom: 16px;
}

.author-social-large {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
  justify-content: center;
}
.social-link-large {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  background: white;
  border: 1px solid #e5e4da;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
  color: #121212;
}
.social-link-large:hover {
  background: #121212;
  color: white;
  border-color: #121212;
}
.icon-sm {
  width: 16px;
  height: 16px;
}

.btn-back {
  background: transparent;
  color: #121212;
  padding: 12px 28px;
  border-radius: 6px;
  font-weight: 700;
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0.2em;
  transition: all 0.3s ease;
  border: 1px solid #121212;
  display: inline-block;
  text-decoration: none;
}
.btn-back:hover {
  background: #121212;
  color: white;
}

/* ─── Featured Stories grid ────────────────────────────────── */
.author-stories-section {
  background-color: #faf7f2;
  padding: 48px 0 60px;
}
.section-heading-row {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 32px;
}
.section-heading-text {
  font-size: 28px;
  font-weight: 800;
  color: #121212;
  margin: 0;
  white-space: nowrap;
}
.section-heading-line {
  height: 2px;
  flex: 1;
  background: rgba(0, 0, 0, 0.05);
}
.stories-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 28px;
}
.author-stories-empty {
  color: #6b7280;
  padding: 24px 0;
  text-align: center;
}

/* ─── Responsive ──────────────────────────────────────────── */
@media (max-width: 1024px) {
  .author-hero {
    padding: 30px 0;
  }
  .author-avatar-large,
  .author-avatar-initials {
    width: 120px;
    height: 120px;
  }
  .author-avatar-initials {
    font-size: 40px;
  }
}
@media (max-width: 767px) {
  .author-avatar-large,
  .author-avatar-initials {
    width: 100px;
    height: 100px;
  }
  .author-avatar-initials {
    font-size: 32px;
  }
  .author-name-large {
    font-size: 32px;
    white-space: normal;
  }
  .stories-grid {
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 20px;
  }
  .section-heading-text {
    font-size: 22px;
  }
}
</style>
