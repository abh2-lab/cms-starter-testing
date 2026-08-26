<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { updatesApi, type UpdateStatus } from '@/api/updates';
import { useAuthStore } from '@/stores/auth';

/**
 * "A new version is available" banner. Detection only — it never applies
 * anything, because a container cannot rebuild itself. Applying is the
 * separate v1.6.0 operator workflow.
 * See docs/phase-3-versioning-and-updates-plan.md.
 *
 * super_admin only: which software version the box runs is operator business.
 * The API enforces this too; the check here just avoids a guaranteed 403 on
 * every page load for editors.
 *
 * Failure is silent. A release host being unreachable is not the operator's
 * problem in the middle of editing — the error surfaces on the settings page
 * instead, where someone went looking for it.
 */

const auth = useAuthStore();

const status = ref<UpdateStatus | null>(null);
const dismissed = ref(false);

// Dismissal is per-version and stored locally: dismissing 1.4.0 must not hide
// 1.5.0 later. Not a server-side setting — it's a per-person "not now", and a
// second admin should still see the banner.
const DISMISS_KEY = 'cms.updateBanner.dismissedVersion';

const show = computed(
  () => !dismissed.value && status.value?.updateAvailable === true,
);
const latest = computed(() => status.value?.latest ?? null);
const isSchema = computed(() => latest.value?.type === 'schema');

async function load(): Promise<void> {
  if (!auth.isSuperAdmin) return;
  try {
    const res = await updatesApi.get();
    status.value = res.data;
    const seen = localStorage.getItem(DISMISS_KEY);
    dismissed.value = seen !== null && seen === res.data.latest?.version;
  } catch {
    // Silent by design — see the component comment.
  }
}

function dismiss(): void {
  if (latest.value) localStorage.setItem(DISMISS_KEY, latest.value.version);
  dismissed.value = true;
}

onMounted(load);
</script>

<template>
  <div
    v-if="show && latest"
    class="update-banner"
    :class="{ 'is-schema': isSchema }"
    role="status"
  >
    <span class="ub-badge">{{ isSchema ? 'Database update' : 'Update' }}</span>

    <span class="ub-text">
      Version <strong>{{ latest.version }}</strong> is available
      <span class="ub-dim">(you are on {{ status?.currentVersion }})</span>.
      <template v-if="isSchema">
        This one changes the database — take a backup before applying it.
      </template>
      <template v-if="latest.newEnvVars.length">
        Set
        <code v-for="v in latest.newEnvVars" :key="v" class="ub-env">{{ v }}</code>
        before it starts, or it will not boot.
      </template>
    </span>

    <a
      v-if="latest.notesUrl"
      class="ub-link"
      :href="latest.notesUrl"
      target="_blank"
      rel="noopener noreferrer"
      >What's new</a
    >
    <button class="ub-dismiss" type="button" @click="dismiss">Dismiss</button>
  </div>
</template>

<style scoped>
.update-banner {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding: 0.6rem 1rem;
  margin: 0 0 1rem;
  border: 1px solid var(--info);
  border-radius: var(--radius);
  background: var(--info-soft);
  color: var(--fg);
  font-size: 0.875rem;
}
/* A migration-bearing release reads as a caution, not an FYI. */
.update-banner.is-schema {
  border-color: var(--warning);
  background: var(--warning-soft);
}

.ub-badge {
  flex: none;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  background: var(--info);
  color: #fff;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.is-schema .ub-badge {
  background: var(--warning);
}

.ub-text {
  flex: 1 1 20rem;
}
.ub-dim {
  color: var(--muted);
}
.ub-env {
  margin-right: 0.25rem;
  padding: 0.05rem 0.3rem;
  border-radius: 3px;
  background: var(--surface);
  border: 1px solid var(--border);
  font-size: 0.8125rem;
}

.ub-link,
.ub-dismiss {
  flex: none;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.ub-link {
  color: var(--accent);
}
.ub-dismiss {
  padding: 0.25rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: transparent;
  color: var(--muted);
}
.ub-dismiss:hover {
  color: var(--fg);
  border-color: var(--fg);
}
</style>
