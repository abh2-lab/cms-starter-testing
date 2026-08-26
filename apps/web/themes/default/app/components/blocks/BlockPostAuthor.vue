<script setup lang="ts">
// Field block: renders the current post's author byline. Each author with a
// slug links to /author/<slug> (matching the rest of the theme). Style-unaware.
interface Author {
  displayName: string;
  slug: string | null;
}
interface Fields {
  prefix?: string;
}
interface Data {
  authors: Author[] | null;
}

const props = defineProps<{
  fields: Fields;
  options: Record<string, unknown>;
  data: Data | null;
}>();

const authors = computed<Author[]>(() => props.data?.authors ?? []);
</script>

<template>
  <p v-if="authors.length" class="block-post-author">
    <span v-if="fields.prefix" class="prefix">{{ fields.prefix }} </span>
    <template v-for="(a, i) in authors" :key="a.slug ?? a.displayName">
      <NuxtLink v-if="a.slug" :to="`/author/${a.slug}`">{{ a.displayName }}</NuxtLink>
      <span v-else>{{ a.displayName }}</span>
      <span v-if="i < authors.length - 1">, </span>
    </template>
  </p>
</template>
