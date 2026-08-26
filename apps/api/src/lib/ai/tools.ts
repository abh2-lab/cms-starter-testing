import type { FastifyInstance } from 'fastify';
import { helpContent, DESTINATIONS_BY_ROUTE } from '@cms/admin-guide';
import type { ToolDefinition, ToolResult } from './types.js';

// Narrow method union (fastify's HTTPMethods includes a loose-string branch
// that light-my-request's inject() rejects).
type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

// ───────────────────────────────────────────────────────────────────────────
// The AI tool layer.
//
// Executory tools wrap EXISTING /api/admin/* endpoints and are dispatched via
// fastify.inject() with the caller's session cookie forwarded — so RBAC,
// tenant scoping, Zod validation, state-machine guards, and audit logging all
// apply unchanged, exactly as if the action came from the UI.
//
// Advisory tools never mutate. They return guidance the model turns into
// Markdown steps for the admin to perform by hand. The executory/advisory
// split IS the v1 safety model: there is deliberately NO executory tool for
// settings, users/roles, deletes, or dynamic-page authoring, so the model
// physically cannot perform them.
// ───────────────────────────────────────────────────────────────────────────

type Args = Record<string, unknown>;
type JSONSchema = Record<string, unknown>;

export interface ToolContext {
  fastify: FastifyInstance;
  cookie: string;
}

export interface AiToolSpec {
  name: string;
  description: string;
  parameters: JSONSchema;
  mode: 'executory' | 'advisory';
  run: (args: Args, ctx: ToolContext) => Promise<ToolResult>;
}

// ── JSON-Schema helpers (kept permissive: additionalProperties:true so the
// model may include any valid endpoint field; the server's Zod schema is the
// real gate and strips unknowns / 400s on bad input). ──
const str = (description?: string): JSONSchema =>
  description ? { type: 'string', description } : { type: 'string' };
const num = (description?: string): JSONSchema =>
  description ? { type: 'number', description } : { type: 'number' };
const bool = (description?: string): JSONSchema =>
  description ? { type: 'boolean', description } : { type: 'boolean' };
const obj = (properties: Record<string, JSONSchema>, required: string[] = []): JSONSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: true,
});
const NO_ARGS: JSONSchema = { type: 'object', properties: {}, additionalProperties: false };

// Coerce a scalar arg to a string for use in a URL path/query; objects, arrays,
// null, and undefined become '' (avoids "[object Object]" in URLs).
function scalar(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') {
    return String(v);
  }
  return '';
}

function str_(a: Args, key: string): string {
  return scalar(a[key]);
}

function omit(a: Args, keys: string[]): Args {
  const out: Args = {};
  for (const k of Object.keys(a)) if (!keys.includes(k)) out[k] = a[k];
  return out;
}

function qs(a: Args, keys: string[]): string {
  const sp = new URLSearchParams();
  for (const k of keys) {
    const s = scalar(a[k]);
    if (s !== '') sp.set(k, s);
  }
  const out = sp.toString();
  return out ? `?${out}` : '';
}

function safeJson(payload: string): unknown {
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return payload;
  }
}

// Pull the created row's id out of a create response so we can hand the model a
// ready-to-open admin link. Create endpoints return either the row directly
// ({ id, … }, e.g. pages) or wrapped ({ data: { id, … } }, e.g. content).
function extractId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;
  if (typeof o['id'] === 'string') return o['id'];
  const data = o['data'];
  if (data && typeof data === 'object') {
    const id = (data as Record<string, unknown>)['id'];
    if (typeof id === 'string') return id;
  }
  return null;
}

// ── executory: a single inject() against an existing admin endpoint. ──
function executory(spec: {
  name: string;
  description: string;
  parameters: JSONSchema;
  method: HttpMethod;
  path: (a: Args) => string;
  body?: (a: Args) => unknown;
  // When set, a successful response's created-row id is substituted into this
  // pattern (":id") and returned as `adminUrl`, so the assistant can give the
  // user a working link to open what it just created.
  linkPattern?: string;
}): AiToolSpec {
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    mode: 'executory',
    run: async (args, ctx) => {
      const url = spec.path(args);
      const payload = spec.body ? spec.body(args) : undefined;
      const res = await ctx.fastify.inject({
        method: spec.method,
        url,
        headers: { cookie: ctx.cookie },
        ...(payload !== undefined ? { payload: payload as object } : {}),
      });
      const ok = res.statusCode < 400;
      const body = safeJson(res.payload);
      let content: unknown = body;
      if (ok && spec.linkPattern) {
        const id = extractId(body);
        if (id) {
          const adminUrl = spec.linkPattern.replace(':id', id);
          content =
            body && typeof body === 'object' && !Array.isArray(body)
              ? { ...(body as Record<string, unknown>), adminUrl }
              : { result: body, adminUrl };
        }
      }
      return {
        ok,
        summary: `${spec.method} ${url.split('?')[0]} → ${res.statusCode}`,
        content,
      };
    },
  };
}

// ── advisory: never mutates; returns guidance the model renders as steps. ──
function advisory(spec: {
  name: string;
  description: string;
  parameters: JSONSchema;
  guidance: string;
}): AiToolSpec {
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    mode: 'advisory',
    run: async () => ({
      ok: true,
      summary: 'advisory (no change made)',
      content: {
        advisory: true,
        instruction:
          'Do NOT claim you performed this action. Present the guidance below to the admin as clear, numbered Markdown steps they can follow in the admin UI.',
        guidance: spec.guidance,
      },
    }),
  };
}

const CONTENT = '/api/admin/content';
const TYPES = '/api/admin/content-types';
const TAX = '/api/admin/taxonomies';
const PAGES = '/api/admin/pages';
const MENUS = '/api/admin/menus';

// ── describe_cms: the "knows the CMS" tool. Composed from admin-readable GETs
// (NOT admin/docs.ts, which is super-admin-only + POST-shaped). ──
const describeCms: AiToolSpec = {
  name: 'describe_cms',
  description:
    'Get an overview of this CMS: its content types (and their fields), taxonomies, menus, and the blocks available for pages. Call this first when you need to know what exists before creating or editing anything.',
  parameters: NO_ARGS,
  mode: 'advisory',
  run: async (_args, ctx) => {
    const get = async (url: string): Promise<unknown> => {
      const r = await ctx.fastify.inject({
        method: 'GET',
        url,
        headers: { cookie: ctx.cookie },
      });
      return r.statusCode < 400 ? safeJson(r.payload) : null;
    };
    const [contentTypes, taxonomies, menus, blocks] = await Promise.all([
      get(`${TYPES}?limit=100`),
      get(`${TAX}?limit=100`),
      get(MENUS),
      get('/api/admin/blocks'),
    ]);
    return {
      ok: true,
      summary: 'CMS overview',
      content: { contentTypes, taxonomies, menus, blocks },
    };
  },
};

// get_admin_guide: the "knows the admin UI" tool. Returns a page's purpose,
// where it lives in the sidebar (for step-by-step navigation), the role
// required, and per-setting how-tos — sourced from the SHARED @cms/admin-guide
// package (the same operator help the admin's help drawer renders), so it never
// drifts from the real UI.
const getAdminGuide: AiToolSpec = {
  name: 'get_admin_guide',
  description:
    'Look up how a specific admin PAGE works: its purpose, where it lives in the sidebar (for step-by-step navigation), the minimum role required, and a per-setting how-to. Call this before telling the user how to do something in the admin UI, or to answer "what is this page / what does this setting do". `area` is the page key, e.g. settings-infrastructure, settings-email, content-types, pages, menus, taxonomies.',
  parameters: obj({ area: str('admin page key, e.g. settings-email') }, ['area']),
  mode: 'advisory',
  run: async (args) => {
    const area = str_(args, 'area');
    const help = helpContent[area];
    const dest = DESTINATIONS_BY_ROUTE.get(area);
    if (!help && !dest) {
      const validAreas = [
        ...new Set([...Object.keys(helpContent), ...DESTINATIONS_BY_ROUTE.keys()]),
      ].sort();
      return {
        ok: false,
        summary: `no admin guide for "${area}"`,
        content: { error: `No admin guide for "${area}".`, validAreas },
      };
    }
    return {
      ok: true,
      summary: `admin guide: ${area}`,
      content: {
        area,
        navigation: dest
          ? {
              label: dest.label,
              sidebarGroup: dest.group,
              path: dest.path,
              requiredRole: dest.requiredRole,
            }
          : null,
        help: help ?? null,
        instruction:
          'Give the user explicit, step-by-step navigation (sidebar group -> item -> tab -> field -> Save), tailored to their role. Present per-setting how-tos as clear Markdown. The sidebar Structure group needs admin+, and Settings needs super_admin.',
      },
    };
  },
};

export const AI_TOOLS: AiToolSpec[] = [
  describeCms,
  getAdminGuide,

  // ── Content ──
  executory({
    name: 'list_content',
    description:
      'List content items, newest first. Optional filters: status (draft|in_review|approved|scheduled|published|archived), contentTypeId, q (full-text search), authorId. Use limit/page to paginate.',
    parameters: obj({
      status: str(),
      contentTypeId: str(),
      authorId: str(),
      q: str('search query'),
      limit: num(),
      page: num(),
    }),
    method: 'GET',
    path: (a) => `${CONTENT}${qs(a, ['status', 'contentTypeId', 'authorId', 'q', 'limit', 'page'])}`,
  }),
  executory({
    name: 'get_content',
    description: 'Fetch a single content item by id, including its custom fields, SEO, and taxonomy terms.',
    parameters: obj({ id: str('content id') }, ['id']),
    method: 'GET',
    path: (a) => `${CONTENT}/${str_(a, 'id')}`,
  }),
  executory({
    name: 'create_content',
    description:
      'Create a draft content item. Provide contentTypeId and title; customFields is an object keyed by the type\'s field names. slug auto-derives from title if omitted. New items always start as draft — use transition_content to publish.',
    parameters: obj(
      {
        contentTypeId: str('the content type id (see describe_cms / list_content_types)'),
        title: str(),
        slug: str(),
        customFields: obj({}),
        locale: str(),
        publishAt: str('ISO timestamp'),
        featured: bool(),
        sortOrder: num(),
      },
      ['contentTypeId', 'title'],
    ),
    method: 'POST',
    path: () => CONTENT,
    body: (a) => omit(a, []),
    linkPattern: '/content/:id',
  }),
  executory({
    name: 'update_content',
    description:
      'Update an existing content item. Pass id plus any fields to change (title, slug, customFields, seo, taxonomyTermIds, publishAt, unpublishAt, featured, sortOrder).',
    parameters: obj(
      {
        id: str('content id'),
        title: str(),
        slug: str(),
        customFields: obj({}),
        seo: obj({}),
        taxonomyTermIds: { type: 'array', items: str() },
        featured: bool(),
        sortOrder: num(),
      },
      ['id'],
    ),
    method: 'PATCH',
    path: (a) => `${CONTENT}/${str_(a, 'id')}`,
    body: (a) => omit(a, ['id']),
  }),
  executory({
    name: 'transition_content',
    description:
      'Move a content item through its workflow. toStatus is one of draft, in_review, approved, scheduled, published, archived. Publishing validates required fields server-side.',
    parameters: obj(
      { id: str('content id'), toStatus: str(), comment: str() },
      ['id', 'toStatus'],
    ),
    method: 'POST',
    path: (a) => `${CONTENT}/${str_(a, 'id')}/transitions`,
    body: (a) => omit(a, ['id']),
  }),

  // ── Content types ──
  executory({
    name: 'list_content_types',
    description: 'List all content types (post types) defined in this CMS.',
    parameters: obj({ limit: num() }),
    method: 'GET',
    path: (a) => `${TYPES}${qs(a, ['limit'])}`,
  }),
  executory({
    name: 'get_content_type',
    description: 'Fetch a single content type by id, including its field definitions.',
    parameters: obj({ id: str('content type id') }, ['id']),
    method: 'GET',
    path: (a) => `${TYPES}/${str_(a, 'id')}`,
  }),
  executory({
    name: 'create_content_type',
    description:
      'Create a content type. name + slug required. fieldDefinitions is an array of field specs (e.g. [{ name, label, type, required }]). Reserved slugs like "pages" are rejected server-side.',
    parameters: obj(
      {
        name: str(),
        slug: str(),
        description: str(),
        icon: str(),
        previewPath: str(),
        fieldDefinitions: { type: 'array', items: obj({}) },
        settings: obj({}),
      },
      ['name', 'slug', 'fieldDefinitions'],
    ),
    method: 'POST',
    path: () => TYPES,
    body: (a) => omit(a, []),
    linkPattern: '/content-types/:id',
  }),
  executory({
    name: 'update_content_type',
    description:
      'Update a content type. Pass id plus fields to change. Note: slug and existing field names are immutable once the type has content.',
    parameters: obj({ id: str('content type id') }, ['id']),
    method: 'PATCH',
    path: (a) => `${TYPES}/${str_(a, 'id')}`,
    body: (a) => omit(a, ['id']),
  }),

  // ── Taxonomies + terms ──
  executory({
    name: 'list_taxonomies',
    description: 'List taxonomies (categories/tags groupings).',
    parameters: obj({ limit: num() }),
    method: 'GET',
    path: (a) => `${TAX}${qs(a, ['limit'])}`,
  }),
  executory({
    name: 'create_taxonomy',
    description:
      'Create a taxonomy. kind is "category" or "tag". Tags cannot be hierarchical.',
    parameters: obj(
      { name: str(), slug: str(), kind: str('category|tag'), isHierarchical: bool() },
      ['name', 'slug'],
    ),
    method: 'POST',
    path: () => TAX,
    body: (a) => omit(a, []),
    linkPattern: '/taxonomies/:id',
  }),
  executory({
    name: 'update_taxonomy',
    description: 'Update a taxonomy. Pass id plus fields to change.',
    parameters: obj({ id: str('taxonomy id') }, ['id']),
    method: 'PATCH',
    path: (a) => `${TAX}/${str_(a, 'id')}`,
    body: (a) => omit(a, ['id']),
  }),
  executory({
    name: 'list_terms',
    description: 'List the terms within a taxonomy.',
    parameters: obj({ taxonomyId: str() }, ['taxonomyId']),
    method: 'GET',
    path: (a) => `${TAX}/${str_(a, 'taxonomyId')}/terms`,
  }),
  executory({
    name: 'create_term',
    description:
      'Create a term inside a taxonomy. parentId only applies to hierarchical (category) taxonomies.',
    parameters: obj(
      {
        taxonomyId: str(),
        name: str(),
        slug: str(),
        description: str(),
        parentId: str(),
        sortOrder: num(),
      },
      ['taxonomyId', 'name', 'slug'],
    ),
    method: 'POST',
    path: (a) => `${TAX}/${str_(a, 'taxonomyId')}/terms`,
    body: (a) => omit(a, ['taxonomyId']),
  }),
  executory({
    name: 'update_term',
    description: 'Update a term within a taxonomy. Pass taxonomyId, termId, and fields to change.',
    parameters: obj({ taxonomyId: str(), termId: str() }, ['taxonomyId', 'termId']),
    method: 'PATCH',
    path: (a) => `${TAX}/${str_(a, 'taxonomyId')}/terms/${str_(a, 'termId')}`,
    body: (a) => omit(a, ['taxonomyId', 'termId']),
  }),

  // ── Pages (static authoring + read-only for dynamic) ──
  executory({
    name: 'list_pages',
    description: 'List pages. Optional filters: type (static|dynamic), status, q (search title/slug).',
    parameters: obj({ type: str(), status: str(), q: str() }),
    method: 'GET',
    path: (a) => `${PAGES}${qs(a, ['type', 'status', 'q'])}`,
  }),
  executory({
    name: 'get_page',
    description:
      'Fetch a single page by id (works for both static and dynamic pages — use this to read a dynamic page, which the assistant cannot author in v1).',
    parameters: obj({ id: str('page id') }, ['id']),
    method: 'GET',
    path: (a) => `${PAGES}/${str_(a, 'id')}`,
  }),
  executory({
    name: 'list_page_layouts',
    description: 'List the theme-provided page layout templates available for static pages.',
    parameters: NO_ARGS,
    method: 'GET',
    path: () => `${PAGES}/layouts`,
  }),
  executory({
    name: 'create_static_page',
    description:
      'Create a STATIC page (raw HTML + scoped CSS). Always scope CSS under a unique container class — never use bare selectors like body, h1, a, or theme classes, or the styles leak into the whole site. Set contentMode:"raw" for HTML/CSS. New pages start as draft.',
    parameters: obj(
      {
        title: str(),
        slug: str(),
        html: str('raw HTML body, scoped under a unique container class'),
        css: str('CSS, every rule scoped under the same unique container class'),
        layoutTemplate: str(),
        contentMode: str('raw|normal'),
        seo: obj({}),
      },
      ['title', 'slug'],
    ),
    method: 'POST',
    path: () => PAGES,
    body: (a) => ({ ...omit(a, []), type: 'static' }),
    linkPattern: '/pages/:id',
  }),
  executory({
    name: 'update_static_page',
    description:
      'Update a static page. Pass id plus fields to change (title, slug, html, css, layoutTemplate, contentMode, seo). Same CSS-scoping rules as create_static_page.',
    parameters: obj({ id: str('page id') }, ['id']),
    method: 'PATCH',
    path: (a) => `${PAGES}/${str_(a, 'id')}`,
    body: (a) => omit(a, ['id']),
  }),
  executory({
    name: 'transition_page',
    description: 'Move a page through its workflow (toStatus: draft, in_review, approved, scheduled, published, archived).',
    parameters: obj({ id: str('page id'), toStatus: str(), comment: str() }, ['id', 'toStatus']),
    method: 'POST',
    path: (a) => `${PAGES}/${str_(a, 'id')}/transitions`,
    body: (a) => omit(a, ['id']),
  }),
  executory({
    name: 'preview_static_page',
    description: 'Render a static-page HTML/CSS preview without saving (returns the echo; no DB write).',
    parameters: obj({ html: str(), css: str(), pageId: str() }, ['html']),
    method: 'POST',
    path: () => `${PAGES}/preview-static`,
    body: (a) => omit(a, []),
  }),

  // ── Menus + items ──
  executory({
    name: 'list_menus',
    description: 'List navigation menus.',
    parameters: NO_ARGS,
    method: 'GET',
    path: () => MENUS,
  }),
  executory({
    name: 'get_menu',
    description: 'Fetch a single menu and its items by id.',
    parameters: obj({ id: str('menu id') }, ['id']),
    method: 'GET',
    path: (a) => `${MENUS}/${str_(a, 'id')}`,
  }),
  executory({
    name: 'create_menu',
    description: 'Create a navigation menu.',
    parameters: obj({ name: str(), slug: str(), description: str(), isActive: bool() }, ['name', 'slug']),
    method: 'POST',
    path: () => MENUS,
    body: (a) => omit(a, []),
    linkPattern: '/menus/:id',
  }),
  executory({
    name: 'update_menu',
    description: 'Update a menu. Pass id plus fields to change.',
    parameters: obj({ id: str('menu id') }, ['id']),
    method: 'PATCH',
    path: (a) => `${MENUS}/${str_(a, 'id')}`,
    body: (a) => omit(a, ['id']),
  }),
  executory({
    name: 'create_menu_item',
    description:
      'Add an item to a menu. Provide a label and either a url (external/internal path) or a contentId. parentId nests it under another item.',
    parameters: obj(
      {
        menuId: str(),
        label: str(),
        url: str(),
        contentId: str(),
        parentId: str(),
        openInNewTab: bool(),
        icon: str(),
        sortOrder: num(),
        isActive: bool(),
      },
      ['menuId', 'label'],
    ),
    method: 'POST',
    path: (a) => `${MENUS}/${str_(a, 'menuId')}/items`,
    body: (a) => omit(a, ['menuId']),
  }),
  executory({
    name: 'update_menu_item',
    description: 'Update a menu item. Pass menuId, itemId, and fields to change.',
    parameters: obj({ menuId: str(), itemId: str() }, ['menuId', 'itemId']),
    method: 'PATCH',
    path: (a) => `${MENUS}/${str_(a, 'menuId')}/items/${str_(a, 'itemId')}`,
    body: (a) => omit(a, ['menuId', 'itemId']),
  }),
  executory({
    name: 'reorder_menu_items',
    description:
      'Reorder / re-parent menu items in one call. items is an array of { id, sortOrder, parentId? }.',
    parameters: obj(
      {
        menuId: str(),
        items: {
          type: 'array',
          items: obj({ id: str(), sortOrder: num(), parentId: str() }, ['id', 'sortOrder']),
        },
      },
      ['menuId', 'items'],
    ),
    method: 'PUT',
    path: (a) => `${MENUS}/${str_(a, 'menuId')}/items/order`,
    body: (a) => omit(a, ['menuId']),
  }),

  // ── Blocks (read-only manifest) ──
  executory({
    name: 'list_blocks',
    description: 'List the blocks shipped by the theme (their keys, names, and configurable props).',
    parameters: NO_ARGS,
    method: 'GET',
    path: () => '/api/admin/blocks',
  }),

  // ── Advisory (never mutate — the model returns Markdown steps) ──
  advisory({
    name: 'advise_settings_change',
    description:
      'Use when the admin asks to change settings/infrastructure (storage/S3, email/SMTP, error monitoring, AI assistant config, system/rate-limits, maintenance mode, site URL/name). You cannot change these — return step-by-step guidance instead.',
    parameters: obj({ topic: str('what they want to change') }),
    guidance:
      'You cannot change settings yourself — give the user step-by-step navigation based on what they want to change (the Settings group in the left sidebar is visible to super-admins only): Site name / Site URL / social links -> sidebar -> Settings -> Site Settings. Outgoing email (SMTP) -> sidebar -> Settings -> Email. Object storage (S3/MinIO), error monitoring (Sentry), the AI assistant, or rate limits & background-job concurrency -> sidebar -> Settings -> Infrastructure, then the matching tab on that page. For the exact fields and how to fill them, call get_admin_guide with the page key (settings-site, settings-email, settings-infrastructure). Note some infrastructure changes need an API/worker restart to take effect.',
  }),
  advisory({
    name: 'advise_user_or_role_change',
    description:
      'Use when the admin asks to add/remove a user or change someone\'s role/permissions. You cannot perform user or role changes — return guidance.',
    parameters: obj({ topic: str() }),
    guidance:
      'You cannot add/remove users or change roles. Guide the user: left sidebar -> Settings group (super-admins only) -> Users & Roles; find the person in the list, open them, set the role (viewer < author < editor < admin < super_admin), then Save. Warn that granting admin/super_admin is a privilege-escalation step and should be deliberate. For field-level help call get_admin_guide with area settings-users.',
  }),
  advisory({
    name: 'advise_delete',
    description:
      'Use when the admin asks to DELETE anything (content, a page, a content type, a taxonomy/term, a menu or item). You cannot delete — return guidance so a wrong call never destroys live data.',
    parameters: obj({ resourceType: str(), resourceId: str() }),
    guidance:
      'You cannot delete anything (a wrong call must never destroy live data) — point the user to the right list and the Delete action there, step by step: Content -> sidebar -> All Content -> open the item -> Delete. Page -> sidebar -> Structure -> Pages -> open the page -> Delete. Content type -> sidebar -> Structure -> Content Types -> open the type -> Delete. Taxonomy or term -> sidebar -> Taxonomy -> Taxonomies (open a taxonomy to reach its terms) -> Delete. Menu or menu item -> sidebar -> Structure -> Menus -> open the menu -> remove the item. Remind them deletes can cascade (deleting a content type is blocked while content references it; deleting a taxonomy removes its terms) and to add redirects first where needed. The Structure group needs admin+; Settings needs super-admin.',
  }),
  advisory({
    name: 'advise_dynamic_page',
    description:
      'Use when the admin wants to create or edit a DYNAMIC (block-based) page. The assistant authors static HTML/CSS pages only in v1 — return guidance for building the dynamic page in the block editor. You may read existing pages with get_page and blocks with list_blocks first.',
    parameters: obj({ goal: str('what the page should contain') }),
    guidance:
      'You can author STATIC pages but NOT dynamic (block-based) pages in v1 — guide the user to build it in the visual editor, step by step: left sidebar -> Structure group (super-admins only) -> Pages -> New Page -> choose Dynamic -> pick a template -> add and arrange blocks -> fill each block -> Publish. Call list_blocks to name the available blocks and their props, and get_page to read an existing page. Offer to DRAFT the text/copy for each block as content the user can copy and paste in.',
  }),
];

const TOOLS_BY_NAME = new Map(AI_TOOLS.map((t) => [t.name, t]));

export function getToolDefinitions(): ToolDefinition[] {
  return AI_TOOLS.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export function getToolMode(name: string): 'executory' | 'advisory' | undefined {
  return TOOLS_BY_NAME.get(name)?.mode;
}

export async function dispatchTool(
  name: string,
  args: Args,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) {
    return {
      ok: false,
      summary: `unknown tool: ${name}`,
      content: {
        error: `No tool named "${name}". This action may be intentionally unavailable (e.g. deletes and settings are advisory only).`,
      },
    };
  }
  return tool.run(args, ctx);
}
