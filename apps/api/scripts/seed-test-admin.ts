/**
 * Local-dev convenience: create or update a known test super_admin AND
 * a demo content type with a representative set of custom fields so the
 * editor (Tiptap richtext + other field types) renders something useful
 * out of the box.
 *
 * Run from this package: `pnpm run seed:test-admin`
 * Credentials produced:
 *   email:    admin@test.com
 *   password: test1234
 *
 * Idempotent: re-running rotates the password hash, reactivates the user,
 * and refreshes the demo content type's field_definitions.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cms/db';
import { hashPassword } from '../src/services/password.js';

const EMAIL = 'admin@test.com';
const PLAIN_PASSWORD = 'test1234';
const TENANT_SLUG = 'test-tenant';

// Demo content type with one of each commonly-used field type so the editor
// has a richtext (Tiptap) area, plus text / number / boolean / date / select
// to demonstrate the dispatch in CustomFieldsEditor.vue.
const DEMO_CONTENT_TYPE = {
  name: 'Article',
  slug: 'article',
  fieldDefinitions: {
    fields: [
      {
        id: randomUUID(),
        name: 'subtitle',
        label: 'Subtitle',
        type: 'short_text' as const,
        required: false,
        order: 0,
      },
      {
        id: randomUUID(),
        name: 'body',
        label: 'Body',
        type: 'rich_text' as const,
        required: true,
        order: 1,
      },
      {
        id: randomUUID(),
        name: 'rating',
        label: 'Rating',
        type: 'number' as const,
        required: false,
        order: 2,
        validations: { min: 0, max: 5 },
      },
      {
        id: randomUUID(),
        name: 'category',
        label: 'Category',
        type: 'select' as const,
        required: false,
        order: 3,
        validations: { options: ['news', 'opinion', 'review', 'tutorial'] },
      },
      {
        id: randomUUID(),
        name: 'featured',
        label: 'Featured',
        type: 'boolean' as const,
        required: false,
        order: 4,
      },
      {
        id: randomUUID(),
        name: 'publish_date',
        label: 'Publish date',
        type: 'date' as const,
        required: false,
        order: 5,
      },
    ],
  },
};

async function main(): Promise<void> {
  const hashedPassword = await hashPassword(PLAIN_PASSWORD);

  // Upsert tenant by slug.
  await db
    .insert(schema.tenants)
    .values({ name: 'Test Tenant', slug: TENANT_SLUG })
    .onConflictDoNothing();

  const [tenant] = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, TENANT_SLUG))
    .limit(1);

  if (!tenant) throw new Error('Failed to find tenant after upsert');

  // Upsert admin by email.
  const [user] = await db
    .insert(schema.adminUsers)
    .values({
      email: EMAIL,
      hashedPassword,
      displayName: 'Test Admin',
      role: 'super_admin',
      tenantId: tenant.id,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: schema.adminUsers.email,
      set: { hashedPassword, isActive: true },
    })
    .returning({
      id: schema.adminUsers.id,
      email: schema.adminUsers.email,
      role: schema.adminUsers.role,
    });

  if (!user) throw new Error('Failed to upsert admin user');

  // Upsert demo content type (refreshes field_definitions on re-run).
  const [contentType] = await db
    .insert(schema.contentTypes)
    .values({
      tenantId: tenant.id,
      name: DEMO_CONTENT_TYPE.name,
      slug: DEMO_CONTENT_TYPE.slug,
      fieldDefinitions: DEMO_CONTENT_TYPE.fieldDefinitions,
    })
    .onConflictDoUpdate({
      target: [schema.contentTypes.tenantId, schema.contentTypes.slug],
      set: {
        fieldDefinitions: DEMO_CONTENT_TYPE.fieldDefinitions,
        name: DEMO_CONTENT_TYPE.name,
      },
    })
    .returning({
      id: schema.contentTypes.id,
      slug: schema.contentTypes.slug,
    });

  if (!contentType) throw new Error('Failed to upsert demo content type');

  console.log(`Seeded admin:
  id    : ${user.id}
  email : ${user.email}
  role  : ${user.role}
  tenant: ${tenant.id}
Password: ${PLAIN_PASSWORD}

Seeded demo content type:
  id   : ${contentType.id}
  slug : ${contentType.slug}
  fields: subtitle (text), body (richtext), rating (number),
          category (select), featured (boolean), publish_date (date)`);

  process.exit(0);
}

void main().catch((err: unknown) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
