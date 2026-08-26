<script setup lang="ts">
// Core stub. The real ThemeCurve — PING's signature hand-drawn curve engine —
// lives in the ping theme layer (apps/web/themes/ping/), together with
// utils/curves.ts and friends, roughly 1,600 lines of brand-specific art.
//
// Two CORE blocks decorate themselves with a curve: BlockContactForm and
// BlockTitleBand. Each does it in a single line. Rather than duplicate those
// blocks per theme (one is 529 lines) or ship the curve engine to every
// publisher, core keeps the call site and renders nothing; a theme that has
// curves overrides this component by filename and the call site lights up.
// That is Nuxt layer overriding doing exactly what it is for.
//
// Props mirror the real component so a call site type-checks against either.
// See docs/phase-3-versioning-and-updates-plan.md.
defineProps<{
  shape: string;
  reveal?: 'left' | 'right' | 'up' | 'down' | 'fade' | 'none';
  trigger?: string;
  sequence?: boolean;
  colour?: string;
}>();
</script>

<template>
  <!-- Intentionally empty: decoration a themeless install simply does without. -->
</template>
