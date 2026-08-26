import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import VueDevTools from 'vite-plugin-vue-devtools';

export default defineConfig({
  // The vue-devtools plugin is dev-only — it gates itself to `command === 'serve'`
  // and registers no transforms during `vite build`, so production bundles stay
  // unchanged. Adds a floating Vue button at the top-left of the admin in dev
  // for inspecting the component tree, Pinia stores, router, and the timeline.
  plugins: [vue(), VueDevTools()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // PORT env override lets tooling (e.g. the preview harness) run a second
    // instance on an assigned port; normal `pnpm dev` stays on 5173.
    port: Number(process.env['PORT']) || 5173,
    proxy: {
      // Same-origin in dev: /api/* on :5173 forwards to the Fastify API on :3000
      // so the session cookie's Path=/ and SameSite=Lax work cleanly without
      // CORS preflight on every request.
      //
      // Hard-coded 127.0.0.1 (not "localhost") to dodge a Windows-specific
      // resolution order: Node's getaddrinfo returns ::1 first, but the API
      // binds to 127.0.0.1 only. http-proxy then hits a dead IPv6 socket and
      // the proxy attempt falls through to Vite's SPA index, which surfaces
      // in the browser as "404 Page not found" on every /api/* request —
      // including /api/admin/auth/login, so nobody can sign in.
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
      },
    },
  },
});
