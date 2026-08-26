<script setup lang="ts">
defineProps<{
  words: number;
  chars: number;
  readMin: number;
  editedAt?: string | null;
}>();

function fmt(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '';
}
</script>

<template>
  <div class="stats">
    <span>📝 <strong>{{ words.toLocaleString() }}</strong> words</span>
    <span>⏱ <strong>~{{ readMin }} min</strong> read</span>
    <span>🔤 <strong>{{ chars.toLocaleString() }}</strong> chars</span>
    <span v-if="editedAt" class="right">Last saved {{ fmt(editedAt) }}</span>
  </div>
</template>

<style scoped>
.stats {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  padding: 14px 0;
  margin-top: 28px;
  border-top: 1px solid var(--border-soft);
  font-size: 11px;
  color: var(--text-tertiary);
}
.stats strong {
  color: var(--muted);
}
.right {
  margin-left: auto;
}
</style>
