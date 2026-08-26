<script setup lang="ts">
import { authorUrl } from '~/utils/urls';

// Field block: the "About the author(s)" boxes under the article. Markup +
// styles moved verbatim from the hand-built AuthorBioList.vue (theme engine
// v1.5 re-blocking); the per-author detail fetches moved into the block's
// server loader, so this renderer is pure — avatar (photo or initial),
// linked name, first bio paragraph.
interface BioAuthor {
  slug: string;
  name: string;
  photoUrl: string | null;
  bio: string | null;
}
interface Data {
  authors: BioAuthor[];
}

const props = defineProps<{
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  data: Data | null;
}>();

const authors = computed<BioAuthor[]>(() => props.data?.authors ?? []);

function initial(name: string): string {
  return (name.trim().charAt(0) || '?').toUpperCase();
}
</script>

<template>
  <div v-if="authors.length > 0" class="author-bio-group">
    <div class="author-bio-group-label">
      About the author{{ authors.length > 1 ? 's' : '' }}
    </div>
    <div v-for="a in authors" :key="a.slug" class="author-bio-box">
      <img
        v-if="a.photoUrl"
        :src="a.photoUrl"
        :alt="a.name"
        class="author-bio-avatar author-bio-photo"
        loading="lazy"
        decoding="async"
      />
      <div v-else class="author-bio-avatar" aria-hidden="true">
        {{ initial(a.name) }}
      </div>
      <div class="author-bio-info">
        <NuxtLink :to="authorUrl(a.slug)" class="author-bio-name">
          {{ a.name }}
        </NuxtLink>
        <p v-if="a.bio" class="author-bio-text">{{ a.bio }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.author-bio-group {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 32px;
}
.author-bio-group-label {
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.3em;
  color: rgba(0, 0, 0, 0.5);
  margin-bottom: 2px;
}
.author-bio-box {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  padding: 32px 40px;
  background: #faf7f2;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 32px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}
.author-bio-avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background-color: rgba(0, 0, 0, 0.1);
  color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 900;
  font-size: 20px;
  flex-shrink: 0;
}
.author-bio-photo {
  object-fit: cover;
}
.author-bio-info {
  flex: 1;
  min-width: 0;
}
.author-bio-name {
  font-size: 20px;
  font-weight: 800;
  color: #121212;
  text-decoration: none;
  display: block;
  margin-bottom: 8px;
}
a.author-bio-name:hover {
  color: #d34135;
}
.author-bio-text {
  font-size: 14px;
  line-height: 1.6;
  color: #555;
  margin: 0;
}
@media (max-width: 767px) {
  .author-bio-box {
    padding: 24px;
  }
}
</style>
