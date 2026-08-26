<script setup lang="ts">
// BlockSocialShare — render half for the 'social-share' block. A "Share:" label
// plus Facebook / X / LinkedIn buttons. The share links are built from the LIVE
// page URL (request origin + current path) so they always point at the page the
// visitor is on, with the post title carried through as the share text.
interface Fields {
  label?: string;
}
interface Data {
  title: string | null;
}

const props = defineProps<{
  fields: Fields;
  options: Record<string, unknown>;
  data: Data | null;
}>();

const requestUrl = useRequestURL();
const route = useRoute();

const label = computed(() => props.fields.label ?? 'Share:');
const shareUrl = computed(() => `${requestUrl.origin}${route.fullPath}`);
const shareText = computed(() => props.data?.title ?? '');

const enc = (s: string): string => encodeURIComponent(s);
const facebookHref = computed(
  () => `https://www.facebook.com/sharer/sharer.php?u=${enc(shareUrl.value)}`,
);
const xHref = computed(
  () =>
    `https://twitter.com/intent/tweet?url=${enc(shareUrl.value)}&text=${enc(shareText.value)}`,
);
const linkedinHref = computed(
  () =>
    `https://www.linkedin.com/sharing/share-offsite/?url=${enc(shareUrl.value)}`,
);
</script>

<template>
  <div class="block-social-share">
    <span class="block-social-share__label">{{ label }}</span>
    <div class="block-social-share__links">
      <a
        :href="facebookHref"
        class="block-social-share__btn"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share on Facebook"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z"
          />
        </svg>
      </a>
      <a
        :href="xHref"
        class="block-social-share__btn"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share on X"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
          />
        </svg>
      </a>
      <a
        :href="linkedinHref"
        class="block-social-share__btn"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share on LinkedIn"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"
          />
        </svg>
      </a>
    </div>
  </div>
</template>

<style scoped>
.block-social-share {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) 0;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.block-social-share__label {
  font-size: var(--fs-body);
  font-weight: var(--fw-semibold);
  color: #0f2d96;
}
.block-social-share__links {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-left: auto;
}
/* Navy circles with a white glyph, turning orange on hover — the same social
   pills the /contact page uses. */
.block-social-share__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 999px;
  background: #0f2d96;
  color: #fff;
  transition: background var(--motion-fast) var(--ease-out);
}
.block-social-share__btn:hover {
  background: #ff6a4d;
}
</style>
