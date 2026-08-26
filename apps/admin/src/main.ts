import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router, setSetupStatus } from './router';
import { useAuthStore } from './stores/auth';
import { initTheme } from './composables/useTheme';
import { setupApi } from './api/setup';
import './styles.css';

// Hard cap on how long a single bootstrap probe can hold up the initial paint.
// If the API is rate-limited, restarting, or otherwise slow, both fetches still
// time out cleanly so the user reaches /login (where a clearer error surfaces)
// instead of staring at a blank page while fetch hangs without a default
// timeout. 5s is roomy on a healthy local API (which responds in <50ms) and
// faster than a user will reasonably wait for the admin to come up.
const BOOTSTRAP_PROBE_TIMEOUT_MS = 5000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`bootstrap probe timed out after ${ms}ms`)),
        ms,
      ),
    ),
  ]);
}

async function bootstrap(): Promise<void> {
  // Apply the saved/system theme before first paint to avoid a flash.
  initTheme();

  const app = createApp(App);

  // Pinia must be installed before useAuthStore() can be called outside
  // of a component setup function.
  const pinia = createPinia();
  app.use(pinia);

  // First-boot probe. Cheap (in-process cached on the API) and gives the
  // router guard the answer to "should we redirect everything to /setup?".
  // Failing closed (assume setup is done) is preferable to a redirect loop
  // if the network is flaky during boot — the user will just see /login,
  // hit the login itself, and surface a clearer error there.
  let needsSetup = false;
  try {
    const status = await withTimeout(
      setupApi.status(),
      BOOTSTRAP_PROBE_TIMEOUT_MS,
    );
    needsSetup = status.needsSetup;
  } catch {
    // Keep needsSetup at false — failing closed lets the user reach /login,
    // where any real network problem surfaces with a clearer error than a
    // redirect loop would.
  }
  setSetupStatus(needsSetup);

  // Skip the /auth/me call when needsSetup is true — there can't be a session
  // because there's no user. This also avoids a 401 toast on first boot.
  if (!needsSetup) {
    const auth = useAuthStore();
    try {
      await withTimeout(auth.fetchMe(), BOOTSTRAP_PROBE_TIMEOUT_MS);
    } catch {
      // fetchMe already absorbs ApiError; a thrown error here means the
      // probe timed out. The auth store stays in its initial logged-out
      // state and the router guard sends the user to /login.
    }
  }

  app.use(router);
  app.mount('#app');
}

void bootstrap();
