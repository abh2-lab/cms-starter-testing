import { readonly, ref } from 'vue';
import { meApi } from '@/api/me';
import { useAuthStore } from '@/stores/auth';

// Module-scope singleton — one OnboardingTour mounted at App.vue, every
// trigger (auto-fire on Home mount, Replay button in HelpDrawer) drives this.
const isActive = ref(false);
const currentStepIndex = ref(0);

function start(): void {
  currentStepIndex.value = 0;
  isActive.value = true;
}

/** Re-trigger the tour from the Help drawer. Same as start() — the function
 *  exists so callers can express intent.
 */
function replay(): void {
  start();
}

function next(total: number): void {
  if (currentStepIndex.value + 1 >= total) {
    void complete();
    return;
  }
  currentStepIndex.value += 1;
}

function back(): void {
  if (currentStepIndex.value > 0) currentStepIndex.value -= 1;
}

/** Finish the tour and persist completion to the server so it doesn't auto-
 *  fire on the next login. Always closes the overlay locally; server failure
 *  is non-fatal — the user can dismiss again next time without harm.
 */
async function complete(): Promise<void> {
  isActive.value = false;
  const auth = useAuthStore();
  // Skip if already marked complete (replay flow doesn't need to re-write).
  if (auth.user?.tourCompletedAt) return;
  try {
    const res = await meApi.completeTour();
    auth.markTourCompleted(res.tourCompletedAt);
  } catch {
    // Non-fatal — log nothing; the user dismissed and the UI is already closed.
  }
}

/** Dismiss without persisting — used by Escape / outside click during a
 *  REPLAY (the user already completed the tour once, we don't want to write
 *  a fresh timestamp). When the user is on their first pass, dismissal IS
 *  completion, so callers pass through complete() instead. The component
 *  decides which to call based on the auth.user.tourCompletedAt state.
 */
function dismiss(): void {
  isActive.value = false;
}

export function useOnboardingTour() {
  return {
    isActive: readonly(isActive),
    currentStepIndex: readonly(currentStepIndex),
    start,
    replay,
    next,
    back,
    complete,
    dismiss,
  };
}
