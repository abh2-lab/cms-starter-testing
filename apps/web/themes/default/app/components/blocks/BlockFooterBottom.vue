<script setup lang="ts">
// Standalone block: the footer's bottom bar — © year + copyright line and a
// contact email. Markup + styles moved verbatim from SiteFooter.vue (theme
// engine v1.5 re-blocking); the copy comes from fields, the year stays
// computed.
const props = defineProps<{
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  data: Record<string, unknown> | null;
}>();

function fieldStr(key: string, fallback: string): string {
  const v = props.fields[key];
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

const copyrightText = computed(() =>
  fieldStr(
    'copyright_text',
    'Ping Digital Broadcast Pvt. Ltd. All rights reserved.',
  ),
);
const contactEmail = computed(() =>
  fieldStr('contact_email', 'partner.support@pingnetwork.in'),
);

const currentYear = computed(() => new Date().getFullYear());
</script>

<template>
  <div class="footer-bottom">
    <span>&copy; {{ currentYear }} {{ copyrightText }}</span>
    <span>{{ contactEmail }}</span>
  </div>
</template>

<style scoped>
.footer-bottom {
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  margin-top: var(--space-7);
  padding-top: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  color: #8ea0cf;
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
@media (min-width: 768px) {
  .footer-bottom {
    flex-direction: row;
    justify-content: space-between;
  }
}
</style>
