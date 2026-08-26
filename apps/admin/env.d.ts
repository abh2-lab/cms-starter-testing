/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<Record<string, never>, Record<string, never>, any>;
  export default component;
}

// No app-specific Vite env vars today. The public site URL is fetched from
// the API (via /admin/auth/me → auth.publicWebUrl) which sources it from
// siteSettings.siteUrl — there's no build-time origin to bake in any more.
