/**
 * Generic news sample data for the First Boot Experience and the
 * `seed:examples` script.
 *
 * Seeds a believable multi-type demo: an `article` type (news/editorial) AND a
 * genuinely custom `review` post type, demo posts + reviews, a couple of static
 * pages (About/Contact/Privacy), menus, redirects, and a dynamic home page that
 * showcases both types.
 *
 * Idempotent by design: every insert uses `ON CONFLICT DO NOTHING` on a slug
 * column so a re-run can't corrupt an existing tenant. Counts are reported
 * back as "newly inserted in this run" — zero is the expected steady state.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@cms/db';
import type { FieldDefinition } from '@cms/types';

export interface LoadSampleDataResult {
  contentTypes: number;
  taxonomies: number;
  taxonomyTerms: number;
  posts: number;
  reviews: number;
  menus: number;
  redirects: number;
  pages: number;
  homePage: number;
}

type Block = string | { h2: string };
function body(blocks: Block[]): unknown {
  return {
    type: 'doc',
    content: blocks.map((b) => {
      if (typeof b === 'string') {
        return { type: 'paragraph', content: [{ type: 'text', text: b }] };
      }
      return {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: b.h2 }],
      };
    }),
  };
}

function field(
  name: string,
  label: string,
  type: FieldDefinition['type'],
  order: number,
  extra: Partial<FieldDefinition> = {},
): FieldDefinition {
  return {
    id: randomUUID(),
    name,
    label,
    type,
    required: false,
    order,
    ...extra,
  };
}

const ARTICLE_FIELDS: FieldDefinition[] = [
  field('subtitle', 'Subtitle', 'short_text', 0),
  field('body', 'Body', 'rich_text', 1, { required: true }),
  field('summary', 'Summary', 'long_text', 2, {
    validations: { maxLength: 300 },
  }),
  field('section', 'Section', 'select', 3, {
    validations: { options: ['news', 'opinion', 'review', 'tutorial'] },
  }),
  field('is_featured', 'Featured', 'boolean', 4),
  field('publish_date', 'Publish date', 'date', 5),
];

// The demo custom post type. A genuinely CUSTOM type (distinct from the
// built-in `article`) so "load sample data" shows off the CPT feature — its
// own field set, its own taxonomies, its own /review/{slug} preview path.
const REVIEW_FIELDS: FieldDefinition[] = [
  field('rating', 'Rating (1–5)', 'number', 0, {
    required: true,
    validations: { min: 1, max: 5 },
  }),
  field('verdict', 'One-line verdict', 'short_text', 1, { required: true }),
  field('body', 'Body', 'rich_text', 2, { required: true }),
  field('pros', 'Pros & cons', 'long_text', 3),
  field('recommended', 'Recommended?', 'boolean', 4),
];

// Note: pages live in their own `pages` table (see schema/pages.ts), NOT
// as a "Page" content type. The demo home page is seeded via seedHomePage and
// the About/Contact/Privacy demo pages via seedStaticPages below; no Page CPT
// is ever registered.

interface CategoryDef {
  slug: string;
  name: string;
}
const CATEGORIES: CategoryDef[] = [
  { slug: 'politics', name: 'Politics' },
  { slug: 'business', name: 'Business' },
  { slug: 'sports', name: 'Sports' },
  { slug: 'local', name: 'Local' },
  { slug: 'opinion', name: 'Opinion' },
];

interface TagDef {
  slug: string;
  name: string;
}
const TAGS: TagDef[] = [
  { slug: 'breaking', name: 'Breaking' },
  { slug: 'analysis', name: 'Analysis' },
  { slug: 'feature', name: 'Feature' },
];

// Dedicated taxonomies for the review CPT — shows a custom type carrying its
// OWN category/tag vocabularies rather than reusing the article ones.
const REVIEW_GENRES: CategoryDef[] = [
  { slug: 'tech', name: 'Tech' },
  { slug: 'books', name: 'Books' },
  { slug: 'film', name: 'Film' },
];
const REVIEW_RTAGS: TagDef[] = [
  { slug: 'editors-pick', name: "Editor's Pick" },
  { slug: 'budget', name: 'Budget' },
];

interface PostDef {
  slug: string;
  title: string;
  subtitle: string;
  summary: string;
  section: 'news' | 'opinion' | 'review' | 'tutorial';
  status: 'published' | 'draft' | 'scheduled';
  featured: boolean;
  categorySlug: string;
  tagSlugs: string[];
  blocks: Block[];
  metaTitle: string;
  metaDescription: string;
}

const POSTS: PostDef[] = [
  {
    slug: 'welcome-to-your-new-cms',
    title: 'Welcome to your new CMS',
    subtitle: "What you can do here, and where to start",
    summary:
      "A short tour of the features you'll use most often: writing, organising, publishing, and sharing your work with the world.",
    section: 'news',
    status: 'published',
    featured: true,
    categorySlug: 'local',
    tagSlugs: ['feature'],
    blocks: [
      "Welcome. This article is here so you have something to look at on day one — and so the dashboard isn't empty while you find your footing.",
      'Click "All Content" in the sidebar to see this post in the list. Open it to see the editor. Click "New" to start writing your own.',
      { h2: 'A quick tour' },
      "The sidebar groups everything you can do. Content is where you write. Media is where photos and files live. Taxonomies are how you group posts by topic. Settings is everything else.",
      "Every page has a small “?” button in the top-right that explains what that page does. Use it whenever you're not sure.",
      { h2: "When you're ready" },
      "Delete this post, write your own first one, and publish it. That's the whole job.",
    ],
    metaTitle: 'Welcome to your new CMS',
    metaDescription: 'A short tour of what you can do here, and where to start.',
  },
  {
    slug: 'how-local-elections-work',
    title: 'How local elections work',
    subtitle: 'A plain-language guide for readers new to the process',
    summary:
      'Who runs, who votes, and what the offices actually do. A primer you can adapt for your audience.',
    section: 'news',
    status: 'published',
    featured: false,
    categorySlug: 'politics',
    tagSlugs: ['analysis'],
    blocks: [
      "Local elections decide more than people often realise. The roads on your street, the schools your kids attend, the rules for new buildings near you — all of that is voted on at a level most people never read about.",
      "This piece is a primer. It's deliberately short, and the names have been kept generic so you can rewrite it for your own city or region.",
      { h2: 'Who runs' },
      "Candidates for local office are usually long-time residents, often with a day job. Many run unopposed in smaller wards.",
      { h2: 'Who votes' },
      "Anyone on the electoral roll, registered to a local address, and over the voting age. Registration deadlines matter — they're usually a few weeks before election day.",
      { h2: 'What the offices do' },
      "Council members vote on budgets, zoning, and ordinances. The mayor (or its local equivalent) chairs meetings and acts as the public face of the town.",
    ],
    metaTitle: 'How local elections work',
    metaDescription: 'A plain-language primer on who runs, who votes, and what local offices do.',
  },
  {
    slug: 'community-sports-recap',
    title: 'Weekend recap: who won, who showed up',
    subtitle: 'Scores, highlights, and a few photos from the weekend',
    summary:
      'A short, photo-friendly recap format. Easy to repeat every Monday.',
    section: 'news',
    status: 'published',
    featured: false,
    categorySlug: 'sports',
    tagSlugs: ['breaking'],
    blocks: [
      "The weekend's local matches drew bigger crowds than last week's, even with the rain.",
      "Pick three or four match highlights, write a sentence on each, and add a photo. This format works well as a weekly Monday morning post.",
      { h2: 'The headline match' },
      "Write the headline match in slightly more detail — two short paragraphs is enough.",
      { h2: 'Other matches' },
      "A bulleted list works fine here. Readers scrolling on a phone just want to see if their team is mentioned.",
    ],
    metaTitle: 'Weekend recap: local sports',
    metaDescription: 'Scores, highlights, and photos from the weekend.',
  },
  {
    slug: 'opinion-why-local-journalism-matters',
    title: 'Opinion: why community journalism still matters',
    subtitle: 'A short argument for the value of the work',
    summary:
      'A draft opinion piece — open it in the editor to see how drafts look in the system.',
    section: 'opinion',
    status: 'draft',
    featured: false,
    categorySlug: 'opinion',
    tagSlugs: ['analysis'],
    blocks: [
      "There's a reason every town used to have its own paper.",
      "Local stories are the ones that move when a council meeting moves, when a road closes, when a school changes its admissions policy. National outlets don't cover this. Nobody else will if you don't.",
      { h2: "What's different now" },
      "The tools are cheaper, the audience is reachable, and the bar to publish is lower than it has ever been. The only thing that hasn't changed is that someone still has to do the writing.",
    ],
    metaTitle: 'Why community journalism still matters',
    metaDescription: 'A short argument for the value of community journalism.',
  },
  {
    slug: 'next-weeks-events',
    title: "What's on next week",
    subtitle: 'A scheduled post — will publish automatically next week',
    summary:
      'An example of a scheduled post. Edit the publish date to change when it goes live.',
    section: 'news',
    status: 'scheduled',
    featured: false,
    categorySlug: 'local',
    tagSlugs: ['feature'],
    blocks: [
      "Use scheduled posts for anything that needs to go live at a specific moment — embargoed announcements, weekly recaps, time-sensitive editorials.",
      "This post is set to go live next week. Open it in the editor to change the date, or publish immediately to see how the published list looks.",
    ],
    metaTitle: "What's on next week",
    metaDescription: 'A demonstration of a scheduled post.',
  },
];

interface ReviewDef {
  slug: string;
  title: string;
  verdict: string;
  rating: number;
  recommended: boolean;
  pros: string;
  status: 'published' | 'draft';
  featured: boolean;
  genreSlug: string;
  tagSlugs: string[];
  blocks: Block[];
  metaTitle: string;
  metaDescription: string;
}

const REVIEWS: ReviewDef[] = [
  {
    slug: 'acme-widget-pro-review',
    title: 'Acme Widget Pro — a near-perfect daily driver',
    verdict: 'Excellent build, minor software rough edges.',
    rating: 4,
    recommended: true,
    pros: 'Pros: sturdy, fast, great battery. Cons: pricey, no SD slot.',
    status: 'published',
    featured: true,
    genreSlug: 'tech',
    tagSlugs: ['editors-pick'],
    blocks: [
      'The Acme Widget Pro is the kind of device that quietly gets out of your way. This review is sample data — edit or delete it once you have a real product to write about.',
      { h2: 'What we liked' },
      'Solid hardware, all-day battery, and a bright screen. It handles everyday tasks without a stutter.',
      { h2: 'What could be better' },
      'The companion app is fiddly, and the price sits at the high end of its class.',
    ],
    metaTitle: 'Acme Widget Pro review',
    metaDescription: 'Our hands-on verdict on the Acme Widget Pro.',
  },
  {
    slug: 'paperback-classic-review',
    title: 'Paperback Classic — still worth your shelf space',
    verdict: 'A timeless read at a budget price.',
    rating: 5,
    recommended: true,
    pros: 'Pros: cheap, well-bound. Cons: small font.',
    status: 'published',
    featured: false,
    genreSlug: 'books',
    tagSlugs: ['budget'],
    blocks: [
      'Some books earn their reputation. This one has, and at this price it belongs on every shelf.',
      { h2: 'The verdict' },
      'A confident, generous read. The only knock is a cramped typeface in the budget edition.',
    ],
    metaTitle: 'Paperback Classic review',
    metaDescription: 'Why this budget reprint still earns a spot on your shelf.',
  },
  {
    slug: 'midnight-signal-review',
    title: 'Midnight Signal — ambitious, uneven, worth a look',
    verdict: 'Big ideas, occasionally muddled execution.',
    rating: 3,
    recommended: false,
    pros: 'Pros: striking visuals, strong score. Cons: baggy middle act.',
    status: 'published',
    featured: false,
    genreSlug: 'film',
    tagSlugs: [],
    blocks: [
      'Midnight Signal reaches for something bigger than its runtime can hold — and that is both its charm and its flaw.',
      { h2: 'Worth your time?' },
      'If you like mood over momentum, yes. If you want a tight plot, temper your expectations.',
    ],
    metaTitle: 'Midnight Signal review',
    metaDescription: 'An ambitious, uneven film that is still worth a look.',
  },
];

interface StaticPageDef {
  slug: string;
  title: string;
  html: string;
  css: string;
  metaTitle: string;
  metaDescription: string;
}

const STATIC_PAGES: StaticPageDef[] = [
  {
    slug: 'about',
    title: 'About us',
    html: '<h1>About us</h1><p>This is a sample About page, seeded so your new site has real pages from day one. Edit it under <strong>Pages</strong> in the admin, or delete it and write your own.</p><p>Tell readers who you are, what you cover, and why the work matters.</p>',
    css: 'h1 { margin-bottom: .5rem; } p { line-height: 1.7; max-width: 65ch; }',
    metaTitle: 'About us',
    metaDescription: 'A sample About page seeded with the demo data.',
  },
  {
    slug: 'contact',
    title: 'Contact',
    html: '<h1>Contact</h1><p>A sample Contact page. Replace this with your real details — an address, a form, or an email your readers can use.</p><ul><li>General: hello@example.com</li><li>Newsroom: newsroom@example.com</li></ul>',
    css: 'h1 { margin-bottom: .5rem; } p, li { line-height: 1.7; } ul { max-width: 65ch; }',
    metaTitle: 'Contact us',
    metaDescription: 'A sample Contact page seeded with the demo data.',
  },
  {
    slug: 'privacy',
    title: 'Privacy policy',
    html: '<h1>Privacy policy</h1><p>This is placeholder privacy copy seeded as sample data. Replace it with your own policy before you launch.</p><h2>What we collect</h2><p>Describe the data you collect and why.</p><h2>Contact</h2><p>Say how readers can reach you with privacy questions.</p>',
    css: 'h1, h2 { margin: 1rem 0 .5rem; } p { line-height: 1.7; max-width: 65ch; }',
    metaTitle: 'Privacy policy',
    metaDescription: 'A sample Privacy policy page seeded with the demo data.',
  },
];

interface ResolvedRefs {
  articleTypeId: string;
  categoriesTaxId: string;
  tagsTaxId: string;
  termIdBySlug: Map<string, string>;
}

async function upsertContentTypes(
  tenantId: string,
  result: LoadSampleDataResult,
): Promise<{ articleTypeId: string }> {
  const articleInsert = await db
    .insert(schema.contentTypes)
    .values({
      tenantId,
      name: 'Article',
      slug: 'article',
      description: 'News and editorial articles',
      icon: '\u{1F4F0}',
      fieldDefinitions: { fields: ARTICLE_FIELDS },
      settings: {
        taxonomies: { categories: ['categories'], tags: ['tags'] },
      },
      // Public submissions enabled so the /contact form on the default
      // theme can POST drafts here for editor review.
      submissionAccess: 'public',
      // Matches the public route apps/web/themes/default/app/pages/[slug]/[article].vue
      // (canonical /<category>/<article>). The Preview button substitutes
      // {category} + {slug} at click time. See apps/api/src/lib/preview-routes.ts.
      previewPath: '/{category}/{slug}',
    })
    .onConflictDoNothing({ target: [schema.contentTypes.tenantId, schema.contentTypes.slug] })
    .returning({ id: schema.contentTypes.id });
  if (articleInsert.length > 0) result.contentTypes += 1;

  // Backfill: installs created before previewPath shipped on the seed have
  // NULL preview_path and would otherwise keep failing the Preview button
  // until an editor opens the content-type form. Idempotent — only touches
  // the Article row when it's still NULL.
  await db
    .update(schema.contentTypes)
    .set({ previewPath: '/{category}/{slug}' })
    .where(
      and(
        eq(schema.contentTypes.tenantId, tenantId),
        eq(schema.contentTypes.slug, 'article'),
        isNull(schema.contentTypes.previewPath),
      ),
    );

  const [articleType] = await db
    .select({ id: schema.contentTypes.id })
    .from(schema.contentTypes)
    .where(
      and(
        eq(schema.contentTypes.tenantId, tenantId),
        eq(schema.contentTypes.slug, 'article'),
      ),
    )
    .limit(1);
  if (!articleType) throw new Error('content type resolve failed');
  return { articleTypeId: articleType.id };
}

// The custom `review` post type. Kept separate from upsertContentTypes so the
// demo clearly registers a SECOND, custom type. submissionAccess is omitted so
// it defaults to 'none' (reviews don't accept public submissions).
async function upsertReviewType(
  tenantId: string,
  result: LoadSampleDataResult,
): Promise<{ reviewTypeId: string }> {
  const reviewInsert = await db
    .insert(schema.contentTypes)
    .values({
      tenantId,
      name: 'Review',
      slug: 'review',
      description: 'Product and media reviews — a demo custom post type',
      icon: '\u{2B50}',
      fieldDefinitions: { fields: REVIEW_FIELDS },
      settings: {
        taxonomies: { categories: ['review-genres'], tags: ['review-tags'] },
      },
      previewPath: '/review/{slug}',
    })
    .onConflictDoNothing({ target: [schema.contentTypes.tenantId, schema.contentTypes.slug] })
    .returning({ id: schema.contentTypes.id });
  if (reviewInsert.length > 0) result.contentTypes += 1;

  const [reviewType] = await db
    .select({ id: schema.contentTypes.id })
    .from(schema.contentTypes)
    .where(
      and(
        eq(schema.contentTypes.tenantId, tenantId),
        eq(schema.contentTypes.slug, 'review'),
      ),
    )
    .limit(1);
  if (!reviewType) throw new Error('review content type resolve failed');
  return { reviewTypeId: reviewType.id };
}

async function upsertTaxonomies(
  tenantId: string,
  result: LoadSampleDataResult,
): Promise<{ categoriesTaxId: string; tagsTaxId: string; termIdBySlug: Map<string, string> }> {
  const categoriesInsert = await db
    .insert(schema.taxonomies)
    .values({
      tenantId,
      name: 'Categories',
      slug: 'categories',
      kind: 'category',
      isHierarchical: true,
    })
    .onConflictDoNothing({ target: [schema.taxonomies.tenantId, schema.taxonomies.slug] })
    .returning({ id: schema.taxonomies.id });
  if (categoriesInsert.length > 0) result.taxonomies += 1;

  const tagsInsert = await db
    .insert(schema.taxonomies)
    .values({
      tenantId,
      name: 'Tags',
      slug: 'tags',
      kind: 'tag',
      isHierarchical: false,
    })
    .onConflictDoNothing({ target: [schema.taxonomies.tenantId, schema.taxonomies.slug] })
    .returning({ id: schema.taxonomies.id });
  if (tagsInsert.length > 0) result.taxonomies += 1;

  const [categoriesTax] = await db
    .select({ id: schema.taxonomies.id })
    .from(schema.taxonomies)
    .where(
      and(
        eq(schema.taxonomies.tenantId, tenantId),
        eq(schema.taxonomies.slug, 'categories'),
      ),
    )
    .limit(1);
  const [tagsTax] = await db
    .select({ id: schema.taxonomies.id })
    .from(schema.taxonomies)
    .where(
      and(
        eq(schema.taxonomies.tenantId, tenantId),
        eq(schema.taxonomies.slug, 'tags'),
      ),
    )
    .limit(1);
  if (!categoriesTax || !tagsTax) throw new Error('taxonomy resolve failed');

  // Terms: one insert per term so we can use ON CONFLICT against the
  // (taxonomy_id, slug) unique constraint and stay idempotent without
  // pre-querying. Mild perf cost is fine — five categories, three tags.
  for (const [i, c] of CATEGORIES.entries()) {
    const inserted = await db
      .insert(schema.taxonomyTerms)
      .values({
        tenantId,
        taxonomyId: categoriesTax.id,
        name: c.name,
        slug: c.slug,
        sortOrder: i,
      })
      .onConflictDoNothing({ target: [schema.taxonomyTerms.taxonomyId, schema.taxonomyTerms.slug] })
      .returning({ id: schema.taxonomyTerms.id });
    if (inserted.length > 0) result.taxonomyTerms += 1;
  }
  for (const [i, t] of TAGS.entries()) {
    const inserted = await db
      .insert(schema.taxonomyTerms)
      .values({
        tenantId,
        taxonomyId: tagsTax.id,
        name: t.name,
        slug: t.slug,
        sortOrder: i,
      })
      .onConflictDoNothing({ target: [schema.taxonomyTerms.taxonomyId, schema.taxonomyTerms.slug] })
      .returning({ id: schema.taxonomyTerms.id });
    if (inserted.length > 0) result.taxonomyTerms += 1;
  }

  // Resolve every term id in one query so the post seeder doesn't round-trip.
  const termIdBySlug = new Map<string, string>();
  const allTerms = await db
    .select({
      id: schema.taxonomyTerms.id,
      slug: schema.taxonomyTerms.slug,
      taxonomyId: schema.taxonomyTerms.taxonomyId,
    })
    .from(schema.taxonomyTerms)
    .where(eq(schema.taxonomyTerms.tenantId, tenantId));
  for (const t of allTerms) {
    if (t.taxonomyId === categoriesTax.id) termIdBySlug.set(`category:${t.slug}`, t.id);
    if (t.taxonomyId === tagsTax.id) termIdBySlug.set(`tag:${t.slug}`, t.id);
  }

  return { categoriesTaxId: categoriesTax.id, tagsTaxId: tagsTax.id, termIdBySlug };
}

// The review CPT's own taxonomies (review-genres / review-tags). Mirrors
// upsertTaxonomies. Returns a term map keyed `genre:<slug>` / `rtag:<slug>`.
async function upsertReviewTaxonomies(
  tenantId: string,
  result: LoadSampleDataResult,
): Promise<{ reviewTermIdBySlug: Map<string, string> }> {
  const genresInsert = await db
    .insert(schema.taxonomies)
    .values({
      tenantId,
      name: 'Review Genres',
      slug: 'review-genres',
      kind: 'category',
      isHierarchical: false,
    })
    .onConflictDoNothing({ target: [schema.taxonomies.tenantId, schema.taxonomies.slug] })
    .returning({ id: schema.taxonomies.id });
  if (genresInsert.length > 0) result.taxonomies += 1;

  const rtagsInsert = await db
    .insert(schema.taxonomies)
    .values({
      tenantId,
      name: 'Review Tags',
      slug: 'review-tags',
      kind: 'tag',
      isHierarchical: false,
    })
    .onConflictDoNothing({ target: [schema.taxonomies.tenantId, schema.taxonomies.slug] })
    .returning({ id: schema.taxonomies.id });
  if (rtagsInsert.length > 0) result.taxonomies += 1;

  const [genresTax] = await db
    .select({ id: schema.taxonomies.id })
    .from(schema.taxonomies)
    .where(
      and(
        eq(schema.taxonomies.tenantId, tenantId),
        eq(schema.taxonomies.slug, 'review-genres'),
      ),
    )
    .limit(1);
  const [rtagsTax] = await db
    .select({ id: schema.taxonomies.id })
    .from(schema.taxonomies)
    .where(
      and(
        eq(schema.taxonomies.tenantId, tenantId),
        eq(schema.taxonomies.slug, 'review-tags'),
      ),
    )
    .limit(1);
  if (!genresTax || !rtagsTax) throw new Error('review taxonomy resolve failed');

  for (const [i, g] of REVIEW_GENRES.entries()) {
    const inserted = await db
      .insert(schema.taxonomyTerms)
      .values({
        tenantId,
        taxonomyId: genresTax.id,
        name: g.name,
        slug: g.slug,
        sortOrder: i,
      })
      .onConflictDoNothing({ target: [schema.taxonomyTerms.taxonomyId, schema.taxonomyTerms.slug] })
      .returning({ id: schema.taxonomyTerms.id });
    if (inserted.length > 0) result.taxonomyTerms += 1;
  }
  for (const [i, t] of REVIEW_RTAGS.entries()) {
    const inserted = await db
      .insert(schema.taxonomyTerms)
      .values({
        tenantId,
        taxonomyId: rtagsTax.id,
        name: t.name,
        slug: t.slug,
        sortOrder: i,
      })
      .onConflictDoNothing({ target: [schema.taxonomyTerms.taxonomyId, schema.taxonomyTerms.slug] })
      .returning({ id: schema.taxonomyTerms.id });
    if (inserted.length > 0) result.taxonomyTerms += 1;
  }

  const reviewTermIdBySlug = new Map<string, string>();
  const allTerms = await db
    .select({
      id: schema.taxonomyTerms.id,
      slug: schema.taxonomyTerms.slug,
      taxonomyId: schema.taxonomyTerms.taxonomyId,
    })
    .from(schema.taxonomyTerms)
    .where(eq(schema.taxonomyTerms.tenantId, tenantId));
  for (const t of allTerms) {
    if (t.taxonomyId === genresTax.id) reviewTermIdBySlug.set(`genre:${t.slug}`, t.id);
    if (t.taxonomyId === rtagsTax.id) reviewTermIdBySlug.set(`rtag:${t.slug}`, t.id);
  }

  return { reviewTermIdBySlug };
}

async function seedPosts(
  tenantId: string,
  refs: ResolvedRefs,
  result: LoadSampleDataResult,
): Promise<void> {
  const now = new Date();
  const inAWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  for (const post of POSTS) {
    const publishAt = post.status === 'scheduled' ? inAWeek : null;
    const publishedAt = post.status === 'published' ? now : null;

    const inserted = await db
      .insert(schema.content)
      .values({
        tenantId,
        contentTypeId: refs.articleTypeId,
        title: post.title,
        slug: post.slug,
        status: post.status,
        featured: post.featured,
        publishAt,
        publishedAt,
        customFields: {
          subtitle: post.subtitle,
          body: body(post.blocks),
          summary: post.summary,
          excerpt: post.summary,
          section: post.section,
          is_featured: post.featured,
        },
      })
      .onConflictDoNothing({
        target: [schema.content.tenantId, schema.content.contentTypeId, schema.content.slug],
      })
      .returning({ id: schema.content.id });

    if (inserted.length === 0) continue; // already seeded — skip SEO + taxonomy
    result.posts += 1;
    const contentId = inserted[0]!.id;

    await db.insert(schema.contentSeo).values({
      contentId,
      tenantId,
      metaTitle: post.metaTitle,
      metaDescription: post.metaDescription,
      ogTitle: post.title,
      schemaType: 'Article',
    });

    const termIds: string[] = [];
    const catId = refs.termIdBySlug.get(`category:${post.categorySlug}`);
    if (catId) termIds.push(catId);
    for (const tagSlug of post.tagSlugs) {
      const tagId = refs.termIdBySlug.get(`tag:${tagSlug}`);
      if (tagId) termIds.push(tagId);
    }
    if (termIds.length > 0) {
      await db.insert(schema.contentTaxonomyTerms).values(
        termIds.map((termId) => ({ contentId, termId })),
      );
    }
  }

  // About/Contact/Privacy are NOT content rows — pages are not a content type.
  // They're seeded as `pages` rows in seedStaticPages below.
}

async function seedReviews(
  tenantId: string,
  refs: { reviewTypeId: string; reviewTermIdBySlug: Map<string, string> },
  result: LoadSampleDataResult,
): Promise<void> {
  const now = new Date();

  for (const review of REVIEWS) {
    const publishedAt = review.status === 'published' ? now : null;

    const inserted = await db
      .insert(schema.content)
      .values({
        tenantId,
        contentTypeId: refs.reviewTypeId,
        title: review.title,
        slug: review.slug,
        status: review.status,
        featured: review.featured,
        publishedAt,
        customFields: {
          rating: review.rating,
          verdict: review.verdict,
          body: body(review.blocks),
          pros: review.pros,
          recommended: review.recommended,
        },
      })
      .onConflictDoNothing({
        target: [schema.content.tenantId, schema.content.contentTypeId, schema.content.slug],
      })
      .returning({ id: schema.content.id });

    if (inserted.length === 0) continue; // already seeded — skip SEO + taxonomy
    result.reviews += 1;
    const contentId = inserted[0]!.id;

    await db.insert(schema.contentSeo).values({
      contentId,
      tenantId,
      metaTitle: review.metaTitle,
      metaDescription: review.metaDescription,
      ogTitle: review.title,
      schemaType: 'Review',
    });

    const termIds: string[] = [];
    const genreId = refs.reviewTermIdBySlug.get(`genre:${review.genreSlug}`);
    if (genreId) termIds.push(genreId);
    for (const tagSlug of review.tagSlugs) {
      const rtagId = refs.reviewTermIdBySlug.get(`rtag:${tagSlug}`);
      if (rtagId) termIds.push(rtagId);
    }
    if (termIds.length > 0) {
      await db.insert(schema.contentTaxonomyTerms).values(
        termIds.map((termId) => ({ contentId, termId })),
      );
    }
  }
}

async function seedMenus(
  tenantId: string,
  result: LoadSampleDataResult,
): Promise<void> {
  const mainNavInsert = await db
    .insert(schema.menus)
    .values({ tenantId, name: 'Main Navigation', slug: 'main-nav' })
    .onConflictDoNothing({ target: [schema.menus.tenantId, schema.menus.slug] })
    .returning({ id: schema.menus.id });
  if (mainNavInsert.length > 0) {
    result.menus += 1;
    await db.insert(schema.menuItems).values([
      { tenantId, menuId: mainNavInsert[0]!.id, label: 'Home', url: '/', sortOrder: 0 },
      { tenantId, menuId: mainNavInsert[0]!.id, label: 'Articles', url: '/stories', sortOrder: 1 },
    ]);
  }

  // Footer menu, populated with links to the static pages seeded by
  // seedStaticPages (About / Contact / Privacy). These are plain URL links, so
  // seeding them here (before or after the pages) is fine — they resolve at
  // render time once the pages exist. Operators edit these from /settings/menus.
  const footerInsert = await db
    .insert(schema.menus)
    .values({ tenantId, name: 'Footer', slug: 'footer-nav' })
    .onConflictDoNothing({ target: [schema.menus.tenantId, schema.menus.slug] })
    .returning({ id: schema.menus.id });
  if (footerInsert.length > 0) {
    result.menus += 1;
    await db.insert(schema.menuItems).values([
      { tenantId, menuId: footerInsert[0]!.id, label: 'About', url: '/about', sortOrder: 0 },
      { tenantId, menuId: footerInsert[0]!.id, label: 'Contact', url: '/contact', sortOrder: 1 },
      { tenantId, menuId: footerInsert[0]!.id, label: 'Privacy', url: '/privacy', sortOrder: 2 },
    ]);
  }
}

async function seedRedirects(
  tenantId: string,
  result: LoadSampleDataResult,
): Promise<void> {
  const rows = [
    { tenantId, fromPath: '/old-home', toPath: '/', redirectType: 301 },
    { tenantId, fromPath: '/welcome', toPath: '/welcome-to-your-new-cms', redirectType: 301 },
  ];
  for (const r of rows) {
    const inserted = await db
      .insert(schema.redirects)
      .values(r)
      .onConflictDoNothing({ target: [schema.redirects.tenantId, schema.redirects.fromPath] })
      .returning({ id: schema.redirects.id });
    if (inserted.length > 0) result.redirects += 1;
  }
}

// Seed the About/Contact/Privacy demo pages as `static` rows in the `pages`
// table (raw HTML + CSS). systemManaged:false so the operator can delete them
// once they've written their own — unlike the home page. Idempotent on slug.
async function seedStaticPages(
  tenantId: string,
  result: LoadSampleDataResult,
): Promise<void> {
  const now = new Date();
  for (const page of STATIC_PAGES) {
    const inserted = await db
      .insert(schema.pages)
      .values({
        tenantId,
        slug: page.slug,
        title: page.title,
        type: 'static',
        status: 'published',
        html: page.html,
        css: page.css,
        seo: {
          metaTitle: page.metaTitle,
          metaDescription: page.metaDescription,
          ogImageUrl: null,
          canonicalUrl: null,
          robotsIndex: true,
          robotsFollow: true,
        },
        publishedAt: now,
        systemManaged: false,
      })
      .onConflictDoNothing({
        target: [schema.pages.tenantId, schema.pages.slug],
      })
      .returning({ id: schema.pages.id });
    if (inserted.length > 0) result.pages += 1;
  }
}

// Seed the dynamic `home` page used by the default Nuxt theme. Composed from
// the home-default template's blocks (hero / latest-news for articles /
// latest-news for reviews / impact-stats). Idempotent — re-running is a no-op
// once the row exists.
async function seedHomePage(
  tenantId: string,
  result: LoadSampleDataResult,
): Promise<void> {
  // Look up the welcome post slug so the hero block has a real target.
  const [welcomePost] = await db
    .select({ slug: schema.content.slug })
    .from(schema.content)
    .where(
      and(
        eq(schema.content.tenantId, tenantId),
        eq(schema.content.slug, 'welcome-to-your-new-cms'),
      ),
    )
    .limit(1);

  const heroSlug = welcomePost?.slug ?? '';

  // Stat values computed from the seeded data so they never drift.
  const publishedArticles = POSTS.filter((p) => p.status === 'published').length;
  const publishedReviews = REVIEWS.filter((r) => r.status === 'published').length;

  const blocks = [
    {
      id: randomUUID(),
      block_key: 'hero',
      fields: { badge: 'Featured' },
      options: { content_type: 'article', slug: heroSlug },
    },
    {
      id: randomUUID(),
      block_key: 'latest-news',
      fields: { eyebrow: 'Latest', title: 'Latest articles' },
      options: { content_type: 'article', count: 6 },
    },
    {
      id: randomUUID(),
      block_key: 'latest-news',
      fields: { eyebrow: 'Reviews', title: 'Latest reviews' },
      options: { content_type: 'review', count: 3 },
    },
    {
      id: randomUUID(),
      block_key: 'impact-stats',
      fields: {
        eyebrow: 'By the numbers',
        title: 'A quick snapshot',
        stats: [
          { label: 'Published articles', value: String(publishedArticles) },
          { label: 'Reviews', value: String(publishedReviews) },
          { label: 'Categories', value: String(CATEGORIES.length) },
        ],
      },
      options: {},
    },
  ];

  const inserted = await db
    .insert(schema.pages)
    .values({
      tenantId,
      slug: 'home',
      title: 'Home',
      type: 'dynamic',
      status: 'published',
      templateKey: 'home-default',
      blocks,
      seo: {
        metaTitle: null,
        metaDescription: 'Default theme homepage.',
        ogImageUrl: null,
        canonicalUrl: null,
        robotsIndex: true,
        robotsFollow: true,
      },
      publishedAt: new Date(),
      systemManaged: true,
    })
    .onConflictDoNothing({
      target: [schema.pages.tenantId, schema.pages.slug],
    })
    .returning({ id: schema.pages.id });
  if (inserted.length > 0) result.homePage += 1;
}

/**
 * Seed a generic-news demo dataset into the given tenant. Safe to re-run —
 * existing rows are left untouched. Use during First Boot Experience setup,
 * or from the `seed:examples` script in dev.
 */
export async function loadSampleData(opts: {
  tenantId: string;
}): Promise<LoadSampleDataResult> {
  const result: LoadSampleDataResult = {
    contentTypes: 0,
    taxonomies: 0,
    taxonomyTerms: 0,
    posts: 0,
    reviews: 0,
    menus: 0,
    redirects: 0,
    pages: 0,
    homePage: 0,
  };
  const { articleTypeId } = await upsertContentTypes(opts.tenantId, result);
  const { reviewTypeId } = await upsertReviewType(opts.tenantId, result);
  const { categoriesTaxId, tagsTaxId, termIdBySlug } = await upsertTaxonomies(
    opts.tenantId,
    result,
  );
  const { reviewTermIdBySlug } = await upsertReviewTaxonomies(opts.tenantId, result);
  await seedPosts(
    opts.tenantId,
    { articleTypeId, categoriesTaxId, tagsTaxId, termIdBySlug },
    result,
  );
  await seedReviews(opts.tenantId, { reviewTypeId, reviewTermIdBySlug }, result);
  await seedMenus(opts.tenantId, result);
  await seedRedirects(opts.tenantId, result);
  await seedStaticPages(opts.tenantId, result);
  await seedHomePage(opts.tenantId, result);
  return result;
}
