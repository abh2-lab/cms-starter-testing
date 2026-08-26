<script setup lang="ts">
import { RouterView } from 'vue-router';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import LinkDialog from '@/components/LinkDialog.vue';
import ToastHost from '@/components/ToastHost.vue';
import HelpDrawer from '@/components/HelpDrawer.vue';
import OnboardingTour from '@/components/OnboardingTour.vue';
import AiAssistant from '@/components/AiAssistant.vue';
</script>

<template>
  <RouterView />
  <ConfirmDialog />
  <LinkDialog />
  <ToastHost />
  <HelpDrawer />
  <OnboardingTour />
  <AiAssistant />
</template>
