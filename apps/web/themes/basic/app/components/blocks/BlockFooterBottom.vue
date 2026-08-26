<script setup lang="ts">
import { useSiteSettings } from '../../../../default/app/composables/useCmsFetch';

// Basic theme footer bottom bar: © year + site name. Neutral — ignores the
// Decode copyright/contact fields the shared footer part ships and derives the
// copyright line from the site name instead.
defineProps<{
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  data: Record<string, unknown> | null;
}>();

const { data: settings } = await useSiteSettings();
const siteName = computed(() => settings.value?.siteName || 'Site');
const currentYear = computed(() => new Date().getFullYear());
</script>

<template>
  <div class="footer-bottom">
    <span>&copy; {{ currentYear }} {{ siteName }}. All rights reserved.</span>
  </div>
</template>

<style scoped>
.footer-bottom {
  border-top: 1px solid var(--border);
  padding-top: 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--muted);
  font-size: 12px;
}
@media (min-width: 768px) {
  .footer-bottom {
    flex-direction: row;
    justify-content: space-between;
  }
}
</style>
