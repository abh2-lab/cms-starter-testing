export interface HelpSection {
  heading: string;
  /** One paragraph (string) or several (string[]). Backticked spans render
   *  as inline <code>. Other HTML is escaped, so the source is safe to write
   *  in plain text. */
  body: string | string[];
  /** Optional bullet list rendered under the body paragraphs. Same inline
   *  backtick → <code> handling. */
  bullets?: string[];
}

export interface HelpEntry {
  title: string;
  intro: string;
  sections: HelpSection[];
  /** When true, HelpDrawer renders a "Take the tour again" button at the
   *  bottom of the panel. Set on the Dashboard entry; can be added to any
   *  other page if it ever helps to surface the tour from there.
   */
  showTourReplay?: boolean;
}

/** Help content keyed by Vue Router `route.name`. Add an entry whenever a new
 *  page is registered in router/index.ts. Missing keys fall back to a generic
 *  message in HelpDrawer.vue.
 *
 *  DIVISION OF RESPONSIBILITY — this help drawer vs the Documentation Hub
 *  (`apps/admin/src/docs/*.md`, rendered by Documentation.vue). Both stay; keep
 *  their lanes distinct:
 *    • Help drawer (here): SHORT, in-context, operator-facing — "what this page
 *      does", a couple of common tasks, one tip, keyed per route. Per-setting
 *      how-to for Infrastructure (e.g. where to get an API key) also lives here.
 *    • Documentation Hub: LONG-FORM developer/theme-author guides with worked
 *      examples (blocks, templates, theme engine, the static-page CSS example).
 *  Keep deep material in exactly ONE place — the Hub — and only POINT to it from
 *  here (see `page-edit-static` → the Page templates guide). Never paste
 *  guide-length content or code examples into a drawer entry.
 */
export const helpContent: Record<string, HelpEntry> = {
  home: {
    title: 'Dashboard',
    intro: "A quick overview of your site so you can spot what needs attention.",
    sections: [
      {
        heading: 'What this page does',
        body: 'Shows the posts you last edited, recent activity from your team, and shortcuts to the things you do most often.',
      },
      {
        heading: 'Common tasks',
        body: 'Continue a draft from "Recent posts", click a stat card to drill in, or use the sidebar to start something new.',
      },
      {
        heading: 'Tip',
        body: 'You can re-run the welcome tour any time using the button below — handy when a colleague joins.',
      },
    ],
    showTourReplay: true,
  },

  'page-edit-static': {
    title: 'Static page',
    intro: 'A hand-built page: raw HTML with its own CSS, wrapped in a layout.',
    sections: [
      {
        heading: 'What this page does',
        body: 'Write the page body as HTML (with CSS in a `<style>` block). Pick a layout so the site header and footer stay in place. New pages save as a draft — publish when you are ready.',
      },
      {
        heading: 'Keep your CSS from leaking',
        body: 'Page CSS is applied to the WHOLE site, so a bare rule like `body { … }` or `h1 { … }` also restyles the header, footer, and other pages. Wrap your markup in one unique class (e.g. `.sp-about`) and start every rule with it (`.sp-about h1 { … }`).',
      },
      {
        heading: 'Tip',
        body: 'See Documentation → Page templates for a full before/after example of conflict-free page CSS.',
      },
    ],
  },

  content: {
    title: 'All Content',
    intro: 'Every article, page, or post you write lives here.',
    sections: [
      {
        heading: 'What this page does',
        body: 'Lists all your content with status (Draft, Published, Scheduled). Filter by type using the sidebar, or search by title.',
      },
      {
        heading: 'Common tasks',
        body: 'Click "New Content" and pick a content type to start writing — the editor opens immediately. Click any row to open it in the editor. Use the status filter to see only what needs your attention.',
      },
      {
        heading: 'Tip',
        body: 'If a type is missing from the "New Content" picker, ask your admin to add it under Structure → Content Types.',
      },
    ],
  },

  'content-create': {
    title: 'New post',
    intro: 'A fresh editor — your post is created the first time you save.',
    sections: [
      {
        heading: 'What this page does',
        body: 'The same focused editor you use for existing posts, before anything is stored. Type a title (the URL slug fills itself in — click it to override) and write.',
      },
      {
        heading: 'Saving',
        body: 'Nothing exists on the server until you click "Save Draft". After that first save you get the full set of options: publish, categories and tags, SEO, and revision history.',
      },
      {
        heading: 'Tip',
        body: 'Use the / menu inside the body editor to add headings, images, lists, and embeds.',
      },
    ],
  },

  'content-edit': {
    title: 'Editor',
    intro: 'Write here. Changes save when you click "Save".',
    sections: [
      {
        heading: 'What this page does',
        body: 'A focused editor for one post. The title goes at the top; the body and any other fields below. The right sidebar holds publishing options.',
      },
      {
        heading: 'Common tasks',
        body: 'Save as draft while you work, then switch the status to Published when ready. Set a future publish date to schedule.',
      },
      {
        heading: 'Tip',
        body: 'Use the / menu inside the body editor to add headings, images, lists, and embeds.',
      },
    ],
  },

  media: {
    title: 'Media Library',
    intro: 'All your photos, videos, and files in one place.',
    sections: [
      {
        heading: 'What this page does',
        body: 'Browse, search, and organise everything you\'ve uploaded. Drop files anywhere on the page to upload.',
      },
      {
        heading: 'Common tasks',
        body: 'Upload new files, sort into folders, and click any item to copy its URL or edit its alt text.',
      },
    ],
  },

  activity: {
    title: 'Activity',
    intro: 'A log of what your team has been doing.',
    sections: [
      {
        heading: 'What this page does',
        body: 'Shows recent actions across your CMS — content edits, publishes, user changes — with the author and timestamp.',
      },
      {
        heading: 'Common tasks',
        body: 'Look here when you want to know who changed what, or when a scheduled post went live.',
      },
    ],
  },

  taxonomies: {
    title: 'Taxonomies',
    intro: 'Categories and tags for grouping your posts by topic.',
    sections: [
      {
        heading: 'What this page does',
        body: "Lists all your taxonomies. Categories are usually a few broad groups (like 'Politics' or 'Sports'); tags are smaller, free-form labels.",
      },
      {
        heading: 'Common tasks',
        body: 'Click into a taxonomy to add, rename, or remove its terms.',
      },
    ],
  },

  'taxonomy-terms': {
    title: 'Taxonomy Terms',
    intro: 'The actual categories or tags inside a taxonomy.',
    sections: [
      {
        heading: 'What this page does',
        body: 'Add new terms, edit existing ones, and rearrange the order. For hierarchical taxonomies you can also nest terms.',
      },
    ],
  },

  menus: {
    title: 'Menus',
    intro: 'The navigation your readers click — header, footer, anywhere you\'ve set up a menu.',
    sections: [
      {
        heading: 'What this page does',
        body: 'Lists every menu defined for your site. Click a menu to add, remove, or reorder its items.',
      },
      {
        heading: 'Common tasks',
        body: 'Add a link to a new page, change the order of the top nav, or hide an item without deleting it.',
      },
    ],
  },

  'menu-edit': {
    title: 'Edit Menu',
    intro: 'Add, remove, and reorder the items in this menu.',
    sections: [
      {
        heading: 'What this page does',
        body: 'Drag items to reorder. Click an item to change its label, URL, or open-in-new-tab behaviour.',
      },
    ],
  },

  redirects: {
    title: 'Redirects',
    intro: 'Send visitors from an old URL to a new one.',
    sections: [
      {
        heading: 'What this page does',
        body: 'Manage the 301 (permanent) and 302 (temporary) redirects that the public site applies to incoming requests.',
      },
      {
        heading: 'Common tasks',
        body: 'Add a redirect when you rename a post, retire an old section, or move a page.',
      },
    ],
  },

  'content-types': {
    title: 'Content Types',
    intro: 'The shapes of content your site supports.',
    sections: [
      {
        heading: 'What this page does',
        body: 'An Article has a title, body, and hero image. A Page might have just a title and body. A Recipe might have ingredients and a cook time. You define those shapes here.',
      },
      {
        heading: 'Common tasks',
        body: 'Add a new type for a new kind of content (Events, Recipes…), or add a field to an existing type.',
      },
    ],
  },

  'content-type-new': {
    title: 'New Content Type',
    intro: "Define a new shape for content — what fields it has, and what they're called.",
    sections: [
      {
        heading: 'What this page does',
        body: 'Give the type a name, add the fields you want (short text, rich text, image, date…), and save. Authors will see this type in "New Content".',
      },
      {
        heading: 'Permalink pattern',
        body: 'The public URL pattern for this type, e.g. /{category}/{slug}. Two tokens are substituted per post: {slug} (required — the post slug) and {category} (the post\'s primary category slug, or "uncategorized" when none is set). It drives both the Preview button and the public canonical link. Example: /{category}/{slug} → /life/global-warming-a-growing-challenge. Leave it empty to disable Preview for the type.',
      },
    ],
  },

  'content-type-edit': {
    title: 'Edit Content Type',
    intro: 'Add, remove, or reorder fields on this type.',
    sections: [
      {
        heading: 'What this page does',
        body: 'Changes apply to new posts immediately; existing posts keep any data they had until you re-edit them.',
      },
      {
        heading: 'Permalink pattern',
        body: 'The public URL pattern for this type, e.g. /{category}/{slug}. Two tokens are substituted per post: {slug} (required — the post slug) and {category} (the post\'s primary category slug, or "uncategorized" when none is set). It drives both the Preview button and the public canonical link. Example: /{category}/{slug} → /life/global-warming-a-growing-challenge. Leave it empty to disable Preview for the type.',
      },
      {
        heading: 'Tip',
        body: 'Removing a field is irreversible from this UI — existing data in that field is dropped.',
      },
    ],
  },

  'settings-site': {
    title: 'Site Settings',
    intro: 'Site name, description, social links, and other global settings.',
    sections: [
      {
        heading: 'What this page does',
        body: "The values here show up in your site's title, meta tags, and (if your public site uses them) header and footer.",
      },
      {
        heading: 'Common tasks',
        body: 'Update the site name, change the contact email, or paste in analytics IDs.',
      },
    ],
  },

  'settings-infrastructure': {
    title: 'Infrastructure',
    intro:
      "Wires this CMS to three runtime systems: object storage (where uploaded media lives), error monitoring (where caught exceptions go), and system performance (rate limits + background-job concurrency). Storage changes apply live; monitoring and worker concurrency require an API/worker restart to take effect — the save toast tells you when. This guide is written for a Docker-Compose / Coolify deployment.",
    sections: [
      // ─── OBJECT STORAGE ──────────────────────────────────────────────────
      {
        heading: 'Object Storage — Storage Provider',
        body: [
          'Picks the S3-compatible service that stores every uploaded image, video, and file. Switching providers does NOT migrate existing files — change before going live, or plan a re-upload.',
          'Each provider has different cost, egress, and ops trade-offs. Pick what fits your budget and traffic shape:',
        ],
        bullets: [
          '`MinIO` (self-hosted) — runs as the `minio` service in your docker-compose stack. Zero egress fees, you control the data. Recommended for a single-VPS publisher.',
          '`Amazon S3` — cheapest cold storage, but you pay per-GB egress for every read. Put CloudFront in front for cacheable reads.',
          '`Cloudflare R2` — S3-compatible, ZERO egress fees. Best pick if you serve a lot of images and don\'t want to self-host.',
          '`DigitalOcean Spaces` — $5/mo flat for 250GB + 1TB transfer, built-in CDN included. Simple pricing for predictable workloads.',
          '`Google Cloud Storage` — S3-interoperability mode. Cheaper egress to other Google services; pricier per-GB than R2.',
        ],
      },
      {
        heading: 'Object Storage — Bucket Name',
        body: [
          'The exact bucket / container name from your provider\'s console. Must already exist — this page does NOT create buckets.',
          'For Docker installs running the bundled MinIO, the `minio-setup` init container auto-creates a bucket named after the `S3_BUCKET` env var on first boot. The default is `cms-media` — just keep that here unless you changed the env var.',
          'For cloud providers, create the bucket in their console first. Bucket names are globally unique on AWS S3 and per-account on R2 / Spaces / GCS.',
        ],
        bullets: [
          'Examples: `cms-media`, `boomlive-media-prod`, `mysite-uploads-2026`',
        ],
      },
      {
        heading: 'Object Storage — Region',
        body: 'Depends on the provider. Wrong region = SigV4 signing failures.',
        bullets: [
          '`MinIO` — leave blank. MinIO is single-zone and ignores the field (the SDK auto-fills `us-east-1` as a placeholder).',
          '`AWS S3` — the bucket\'s exact region: `us-east-1` (N. Virginia), `us-west-2` (Oregon), `eu-west-1` (Ireland), `ap-south-1` (Mumbai), `ap-southeast-1` (Singapore). Visible on the bucket\'s Properties tab.',
          '`Cloudflare R2` — leave blank or `auto`. R2 is single-region globally; Cloudflare routes to the nearest data center.',
          '`DigitalOcean Spaces` — the region slug: `nyc3`, `sfo3`, `sgp1`, `fra1`, `ams3`, `blr1` (Bangalore), `syd1`, `tor1`.',
          '`Google Cloud Storage` — bucket location: `us-central1`, `europe-west1`, `asia-south1` (Mumbai), `asia-southeast1`, etc.',
        ],
      },
      {
        heading: 'Object Storage — Force path-style URLs',
        body: 'How presigned URLs are built. Wrong toggle = DNS errors on signed uploads.',
        bullets: [
          'ON for `MinIO`, `R2`, `GCS` — they serve path-style: `https://endpoint/bucket/key`',
          'OFF for `AWS S3`, `DO Spaces` — they use virtual-hosted style: `https://bucket.endpoint/key`',
        ],
      },
      {
        heading: 'Object Storage — Access Credentials',
        body: [
          'The Access Key ID + Secret Access Key pair the API uses to read and write to your bucket. The secret is encrypted at rest using the `SECRETS_ENCRYPTION_KEY` env var (set this in .env BEFORE first save — rotating it later requires re-saving every secret).',
          'After saving, the secret field shows bullets. Re-typing replaces the value; leaving bullets in place keeps the current one; saving with an empty field clears it.',
          'Where to obtain them by provider:',
        ],
        bullets: [
          '`MinIO` (Docker, dev) — defaults from .env: `MINIO_ROOT_USER=minioadmin`, `MINIO_ROOT_PASSWORD=minioadmin`.',
          '`MinIO` (Docker, production) — open the MinIO Console (port 9001) → Identity → Users → Create User → attach the `readwrite` policy scoped to your bucket → paste THAT user\'s credentials here. NEVER expose the root user to the public internet.',
          '`AWS S3` — IAM Console → Users → Add user → Programmatic access → attach an inline policy granting `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:ListBucket` on `arn:aws:s3:::<bucket>` and `/.../*`. Secret shown ONCE.',
          '`Cloudflare R2` — Cloudflare Dashboard → R2 → Manage R2 API Tokens → Create API Token → "Object Read & Write" scoped to your bucket. Secret shown on success page.',
          '`DigitalOcean Spaces` — DO Cloud Panel → API (left sidebar) → Spaces Keys → Generate New Key. Secret shown ONCE inline.',
          '`Google Cloud Storage` — Cloud Storage → Settings → Interoperability → "Create a key for a service account" with `roles/storage.objectAdmin`. HMAC key + secret shown ONCE.',
        ],
      },
      {
        heading: 'Object Storage — Public Media URL',
        body: [
          'The URL prefix readers actually hit to load images on your public site. Leave BLANK to fall back to 1-hour-signed URLs (works but invalidates browser caches every hour — bad for repeat visitors). SET to a fast CDN / bucket-origin for permanent, cacheable, public links.',
          'The bucket itself must allow public reads for any of these to work — that\'s a setting in the provider console, not here.',
        ],
        bullets: [
          'AWS CloudFront in front of S3: `https://d1234abcd.cloudfront.net`',
          'R2 public bucket domain (enable on the bucket): `https://pub-abc123.r2.dev`',
          'Custom domain routed to MinIO via your reverse proxy: `https://media.yoursite.com`',
          'DO Spaces built-in CDN: `https://nyc3.cdn.digitaloceanspaces.com/my-space`',
        ],
      },
      {
        heading: 'Object Storage — Public API Endpoint',
        body: [
          'Different from Public Media URL: this is the URL used to SIGN upload + private-download requests the browser hits directly (Media Library uploads, draft asset previews, anything time-limited).',
          'Required for most Docker deployments. The API container talks to MinIO internally as `http://minio:9000` (set via `S3_ENDPOINT` in .env), but the browser cannot resolve the `minio` service name — Docker hostnames only exist inside the compose network. So you set this to the PUBLIC hostname that your reverse proxy (Coolify, Traefik, nginx) routes to the minio container — e.g. `https://minio.yoursite.com`.',
          'Leave BLANK if `S3_ENDPOINT` is already a browser-reachable public URL (local dev where everything is on localhost, or AWS S3 / R2 / GCS where the endpoint is public by default).',
        ],
      },
      {
        heading: 'Object Storage — Test Connection',
        body: 'Runs a `HEAD bucket` request against the saved settings (decrypts the secret server-side, opens an S3 client, head-bucket). Returns success + the bucket name, or the exact underlying error. Run after every credential change to confirm the API can actually reach your storage before relying on uploads.',
      },

      // ─── ERROR MONITORING ────────────────────────────────────────────────
      {
        heading: 'Error Monitoring — Sentry DSN',
        body: [
          'A "Data Source Name" — the URL that tells the Sentry SDK where to ship error events. Format: `https://<public-key>@<host>/<project-id>`.',
          'Leave BLANK to disable error capture entirely (the API still logs to stdout — `docker compose logs api` reaches them). Encrypted at rest like the storage secret.',
          'Where to get a DSN:',
        ],
        bullets: [
          '`Sentry hosted` (sentry.io, free tier = 5k events/mo) — sign up → New Project → pick Node.js → Project Settings → Client Keys → copy the DSN.',
          '`GlitchTip self-hosted` — Sentry-compatible, runs in ~512MB RAM. Add `glitchtip` + a Postgres service to your docker-compose, point a browser at it → New Project → Settings → Keys → copy.',
          '`Sentry self-hosted` — heavy (~8GB RAM, Kafka, ClickHouse). Only worth the ops cost at large scale.',
        ],
      },
      {
        heading: 'Error Monitoring — Environment',
        body: [
          'Tags every captured event with this label so you can filter prod errors from staging in the Sentry dashboard. Pick `production`, `staging`, or `development`. Leave on "Not set" to fall back to the `NODE_ENV` env var of the API container.',
          'If you save a DSN but no environment, the status chip shows "Partial" — events are still captured, but they\'re hard to filter later.',
        ],
      },
      {
        heading: 'Error Monitoring — Release Tag',
        body: [
          'A deploy identifier — typically the git SHA from CI (`git rev-parse HEAD`) or a release tag like `v1.4.2`. When you ship a deploy that introduces a new error, Sentry tags it with this release so you can spot regressions immediately.',
          'For Docker deployments: most pipelines pass the git SHA as a build-arg into the API image (`IMAGE_TAG=$GITHUB_SHA`) and surface it on this page on first boot. Manual entry is fine for local debugging.',
        ],
        bullets: [
          'Examples: `a3f1b2c`, `v1.4.2`, `prod-2026-06-05`',
        ],
      },
      {
        heading: 'Error Monitoring — Traces Sample Rate',
        body: 'Percentage of requests captured for performance tracing (slow request waterfalls, DB query timings). Higher % = more data, higher storage / cost on the Sentry side.',
        bullets: [
          '`0` — off (default). Pick this for local dev.',
          '`100` — full sampling. Fine for low-traffic sites on the Sentry free tier or GlitchTip self-hosted.',
          '`10–20` — typical for sites above ~100k req/day.',
          '`1–5` — very high traffic. Still gives useful samples without overwhelming the receiver.',
        ],
      },
      {
        heading: 'Error Monitoring — Capture unhandled errors',
        body: 'When ON, the SDK auto-reports uncaught exceptions and unhandled promise rejections — anything that would otherwise crash a request without you noticing. Leave ON unless you have a specific reason to suppress (rare).',
      },
      {
        heading: 'Error Monitoring — Include user context',
        body: 'When ON, each captured event includes the admin user\'s UUID (NOT email or other PII). Useful for "user X keeps hitting this bug" patterns in the dashboard. Off by default for privacy-strict deployments.',
      },

      // ─── RATE LIMITING ───────────────────────────────────────────────────
      {
        heading: 'Rate Limiting — Max Requests + Time Window',
        body: [
          'Cap on requests per IP per route prefix on the PUBLIC API (`/api/public/*`) within a rolling time window. After the window elapses, the counter resets and the IP gets a fresh budget. Configurable 1–100,000 requests per 1–86,400 seconds OR 1–1,440 minutes.',
          'What is NOT rate-limited here: the admin UI (`/api/admin/*`) and programmatic `/api/v1/*` routes — those use per-API-key limits configured under Settings → API Keys.',
          'The IP is read from `X-Forwarded-For` when the API trusts an upstream proxy (set `TRUST_PROXY=true` in .env if you deploy behind Coolify, Traefik, nginx, or Cloudflare). Without proxy trust, every request looks like it came from the proxy\'s IP and the limiter becomes useless.',
          'Restart the API container after saving for the new limits to load (Coolify: redeploy the api service; raw compose: `docker compose restart api`).',
        ],
        bullets: [
          '`100 / 1 minute` — sensible default for a typical news site.',
          '`30 / 1 minute` — tight; useful for spam-prone read endpoints.',
          '`1000 / 1 minute` — loose; for a heavily-used public read API or one fronted by a CDN that already absorbs the bulk.',
        ],
      },

      // ─── WORKER CONCURRENCY ──────────────────────────────────────────────
      {
        heading: 'Background Job Concurrency — Image Processing',
        body: [
          'How many image-variant generation jobs run in parallel (Sharp resizing + encoding for every uploaded image). CPU-bound — too high will starve the API of CPU and slow every request.',
          'Restart the worker container after saving (Coolify: redeploy worker; raw compose: `docker compose restart worker`).',
        ],
        bullets: [
          '1 vCPU VPS: `1`',
          '2 vCPU VPS: `1` or `2`',
          '4 vCPU VPS: `3`',
          '8+ vCPU: `4–6` (max 32)',
          'Default: `2`',
        ],
      },
      {
        heading: 'Background Job Concurrency — Webhook Delivery',
        body: 'Outbound HTTP callbacks fired when content changes (rebuild triggers for the public site, search-index updates, third-party integrations like Slack notifications). I/O-bound — can run much higher than CPU count.',
        bullets: [
          'Typical: `16` (fine on 2 vCPU)',
          'Many slow webhook consumers: `32`',
          'Max: `64`',
          'Default: `16`',
        ],
      },
      {
        heading: 'Background Job Concurrency — Search Indexing',
        body: 'Meilisearch upserts fired on publish / unpublish / update. I/O-bound to the Meilisearch container. Raise temporarily during bulk re-indexes; otherwise the default is plenty.',
        bullets: [
          'Default: `8`',
          'Bulk re-index window: `16`',
          'Max: `32`',
        ],
      },
      {
        heading: 'Background Job Concurrency — Email Sending',
        body: [
          'Transactional email dispatch (invites, password resets, publish notifications). I/O-bound to your SMTP / transactional-email provider — but watch the provider\'s rate limits, not just the worker concurrency.',
          'Provider caps to be aware of:',
        ],
        bullets: [
          '`SendGrid` free tier: 100 emails/day total — keep concurrency at `1–2`.',
          '`Postmark`: no hard per-second cap, but server-level throttles kick in around 25/s.',
          '`Resend`: per-second caps on the free tier; check current docs.',
          '`AWS SES`: starts in sandbox mode (200/day, 1/s); request production access before raising concurrency.',
          'Default: `4`. Max: `16`.',
        ],
      },
      {
        heading: 'Background Job Concurrency — Scheduled Publishing',
        body: 'Auto-publishes posts at their `publish_at` time. The worker polls every ~60s and processes due posts in batches; concurrency above `2–4` is rarely useful — the bottleneck is the poll interval, not parallelism.',
        bullets: [
          'Default: `4`. Max: `16`.',
        ],
      },

      // ─── PUBLIC SITE URL ─────────────────────────────────────────────────
      {
        heading: 'Public Site URL',
        body: [
          'The public origin of your Nuxt-rendered site — the URL READERS actually visit, NOT the internal Docker hostname like `nuxt:3000`. Used by the admin Preview buttons (top-right of any post editor) and outbound email links (password resets, publish notifications, comment notifications).',
          'Must start with `http://` or `https://`. No trailing slash. The form validates this inline before letting you save.',
          'Same field as Site Settings → Site URL — editing here updates both. If your `site_settings` row hasn\'t been created yet, set Site Name + Site URL on the Site Settings page first; an error toast will redirect you.',
        ],
        bullets: [
          'Production: `https://news.yoursite.com`',
          'Local dev with Nuxt on host: `http://localhost:3000`',
          'Local dev with Nuxt in Docker, exposed: `http://localhost:3000`',
        ],
      },
    ],
  },

  'settings-email': {
    title: 'Email Settings',
    intro: 'How your CMS sends outbound email — invites, password resets, notifications.',
    sections: [
      {
        heading: 'What this page does',
        body: 'Configure your SMTP server (or transactional email provider) and a from-address.',
      },
      {
        heading: 'Tip',
        body: 'Send a test email after saving to confirm the credentials work.',
      },
    ],
  },

  'settings-users': {
    title: 'Users & Roles',
    intro: 'People who can sign in to the admin.',
    sections: [
      {
        heading: 'What this page does',
        body: 'Invite new admins, change roles, deactivate accounts. Roles range from Viewer (read-only) up to Super Admin (full control).',
      },
      {
        heading: 'Common tasks',
        body: 'Add an editor, demote someone who no longer needs admin access, or reset a forgotten password.',
      },
      {
        heading: 'Note',
        body: 'The very first super admin (the one created during setup) cannot be deleted or demoted. This is on purpose — it guarantees your site always has a working super admin.',
      },
    ],
  },

  'settings-api-keys': {
    title: 'API Keys',
    intro: 'Tokens that let other apps read or write to your CMS.',
    sections: [
      {
        heading: 'What this page does',
        body: 'Create, label, and revoke API keys. Each key is shown only once — copy it immediately.',
      },
      {
        heading: 'Tip',
        body: 'Use one key per consuming app so you can revoke without affecting the others.',
      },
    ],
  },

  'settings-webhooks': {
    title: 'Webhooks',
    intro: 'Tell other systems when content changes here.',
    sections: [
      {
        heading: 'What this page does',
        body: "Configure URLs to call when posts are published, updated, or deleted. Useful for triggering site rebuilds, search re-indexing, or notifications.",
      },
    ],
  },

  'api-docs': {
    title: 'API Docs Generator',
    intro: 'Generate a Markdown reference for your CMS\'s public API.',
    sections: [
      {
        heading: 'What this page does',
        body: 'Pick the sections you want documented, generate a file, and share it with developers building against your CMS.',
      },
    ],
  },

  pages: {
    title: 'Pages',
    intro: 'Standalone pages that live outside your normal posts — About, Contact, landing pages.',
    sections: [
      {
        heading: 'What this page does',
        body: 'Lists every page. There are two kinds: STATIC pages (you write the HTML/CSS yourself) and DYNAMIC pages (assembled from theme blocks in the visual builder). New pages save as a draft — publish when ready.',
      },
      {
        heading: 'Common tasks',
        body: 'Click "New Page" to start one, choose static or dynamic, then build and publish. Open any row to edit it.',
      },
      {
        heading: 'Tip',
        body: 'Use a static page for a one-off hand-coded layout; use a dynamic page when you want to reuse the theme\'s blocks (hero, lists, grids).',
      },
    ],
  },

  'theme-settings': {
    title: 'Theme Settings',
    intro: 'The home for everything theme-level: the active theme, its templates and parts, page templates, and routes.',
    sections: [
      {
        heading: 'What this page does',
        body: 'Switch the active theme and manage the structure it ships — the templates that render posts and archives, the reusable parts (header, footer, sidebar), and the page templates authors can pick from.',
      },
      {
        heading: 'Common tasks',
        body: 'Review the active theme, open a template or part to customise its blocks, or check how a content route is rendered.',
      },
      {
        heading: 'Tip',
        body: 'See Documentation → Theme engine for how templates, parts, and overrides fit together.',
      },
    ],
  },

  'block-gallery': {
    title: 'Block Gallery',
    intro: 'A visual catalogue of every block your theme ships, with a live preview of each.',
    sections: [
      {
        heading: 'What this page does',
        body: 'Browse all available blocks (hero, latest-news lists, grids, custom-field blocks…) to see what they look like and what they are for before you use them on a dynamic page.',
      },
      {
        heading: 'Common tasks',
        body: 'Click a block\'s Edit button to change its site-wide default fields and options, so every use of that block starts from your preferred settings.',
      },
    ],
  },

  documentation: {
    title: 'Documentation',
    intro: 'In-app developer and theme-author guides for working with this CMS.',
    sections: [
      {
        heading: 'What this page does',
        body: 'Long-form guides — the block system, page and post templates, the theme engine, and reading CMS data in the public site. Aimed at developers and theme authors rather than day-to-day editing.',
      },
      {
        heading: 'Tip',
        body: 'For "how do I use this screen?" help, use the help button in the top bar on any page instead — it explains the page you are on.',
      },
    ],
  },
};
