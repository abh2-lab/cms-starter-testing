import type { FastifyPluginAsync } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cms/db';
import { env } from '@cms/config';
import { hashPassword } from '../../services/password.js';
import { createAdminSession } from '../../services/session.js';
import {
  applySessionCookie,
  SESSION_TTL_SEC,
} from '../../services/session-cookie.js';
import { loadSampleData } from '../../services/sample-data.js';

const STATUS_CACHE_TTL_MS = 2_000;
// Postgres advisory-lock key for "First Boot Experience initial setup". A
// fixed magic number scoped to this codebase — collisions with other
// advisory locks elsewhere in the app would need a different fixed number.
const SETUP_ADVISORY_LOCK_KEY = 741200;

let cachedStatus: { needsSetup: boolean; cachedAt: number } | null = null;

async function checkNeedsSetup(): Promise<boolean> {
  const rows = await db
    .select({ id: schema.adminUsers.id })
    .from(schema.adminUsers)
    .where(
      and(
        eq(schema.adminUsers.role, 'super_admin'),
        eq(schema.adminUsers.isActive, true),
      ),
    )
    .limit(1);
  return rows.length === 0;
}

const BootstrapBodySchema = z.object({
  email: z
    .string()
    .email()
    .max(320)
    .transform((s) => s.toLowerCase()),
  displayName: z.string().min(1).max(200),
  siteName: z.string().min(1).max(200),
  // 12-char minimum matches the Setup wizard's client-side rule and is well
  // above NIST's 8-char floor. Login itself has no length check — once a hash
  // is set, the verify pass is what gates entry.
  password: z.string().min(12).max(256),
  loadSampleData: z.boolean(),
});

export const adminSetupRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /status — anonymous. Tiny payload, polled by the admin app on boot.
  // The 2-second in-process cache absorbs the rush of new tabs that all
  // boot at once during the first-run window.
  fastify.get('/status', async () => {
    const now = Date.now();
    if (cachedStatus && now - cachedStatus.cachedAt < STATUS_CACHE_TTL_MS) {
      return { needsSetup: cachedStatus.needsSetup };
    }
    const needsSetup = await checkNeedsSetup();
    cachedStatus = { needsSetup, cachedAt: now };
    return { needsSetup };
  });

  // POST /bootstrap — anonymous, one-shot. Rejected once any active
  // super_admin exists. The Postgres advisory lock + intra-tx re-check
  // serialise concurrent attempts so a race can't double-seed the system.
  fastify.post('/bootstrap', async (request, reply) => {
    const parsed = BootstrapBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid request body',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    const { email, displayName, siteName, password, loadSampleData: doLoadSamples } =
      parsed.data;
    const hashed = await hashPassword(password);

    try {
      const result = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(${SETUP_ADVISORY_LOCK_KEY})`,
        );

        // Re-check inside the lock. A concurrent setup attempt that won the
        // lock first will already have inserted the super_admin by now.
        const existing = await tx
          .select({ id: schema.adminUsers.id })
          .from(schema.adminUsers)
          .where(
            and(
              eq(schema.adminUsers.role, 'super_admin'),
              eq(schema.adminUsers.isActive, true),
            ),
          )
          .limit(1);
        if (existing.length > 0) {
          return { status: 'conflict' as const };
        }

        // Tenant. PUBLIC_TENANT_SLUG defaults to 'test-tenant' in env config;
        // we still upsert by slug so a partial earlier setup attempt doesn't
        // wedge the flow.
        const tenantSlug = env.PUBLIC_TENANT_SLUG || 'default';
        if (!env.PUBLIC_TENANT_SLUG) {
          fastify.log.warn(
            'PUBLIC_TENANT_SLUG not set during setup; falling back to "default"',
          );
        }
        await tx
          .insert(schema.tenants)
          .values({ name: siteName, slug: tenantSlug })
          .onConflictDoUpdate({
            target: schema.tenants.slug,
            set: { name: siteName, isActive: true },
          });
        const [tenant] = await tx
          .select({
            id: schema.tenants.id,
            slug: schema.tenants.slug,
            name: schema.tenants.name,
          })
          .from(schema.tenants)
          .where(eq(schema.tenants.slug, tenantSlug))
          .limit(1);
        if (!tenant) throw new Error('Failed to resolve tenant after upsert');

        // Super admin. isProtected=true means delete/deactivate/role-demote
        // are blocked at the API in users.ts. emailVerifiedAt is stamped
        // because the wizard verified the user can read their own email
        // implicitly — there's no separate verification flow at install.
        const insertedUsers = await tx
          .insert(schema.adminUsers)
          .values({
            tenantId: tenant.id,
            email,
            hashedPassword: hashed,
            displayName,
            role: 'super_admin',
            isActive: true,
            isProtected: true,
            emailVerifiedAt: new Date(),
          })
          .onConflictDoNothing({ target: schema.adminUsers.email })
          .returning({
            id: schema.adminUsers.id,
            email: schema.adminUsers.email,
            displayName: schema.adminUsers.displayName,
            role: schema.adminUsers.role,
            tenantId: schema.adminUsers.tenantId,
            isProtected: schema.adminUsers.isProtected,
            tourCompletedAt: schema.adminUsers.tourCompletedAt,
          });
        const user = insertedUsers[0];
        if (!user) {
          // Email already taken by a different (inactive or non-super-admin)
          // account. We surface as 409 so the wizard can show a useful error.
          return { status: 'email_conflict' as const };
        }

        // Site settings: pre-fill with the chosen site name. Use ON CONFLICT
        // so a partial earlier attempt that wrote settings doesn't blow up.
        await tx
          .insert(schema.siteSettings)
          .values({
            tenantId: tenant.id,
            siteName,
            siteUrl: '',
            defaultRobots: 'index,follow',
          })
          .onConflictDoUpdate({
            target: schema.siteSettings.tenantId,
            set: { siteName },
          });

        return { status: 'ok' as const, user, tenant };
      });

      if (result.status === 'conflict') {
        return reply.code(409).send({
          error: 'setup_already_complete',
          message: 'Setup has already been completed. Please sign in.',
        });
      }
      if (result.status === 'email_conflict') {
        return reply.code(409).send({
          error: 'email_taken',
          message: 'An account with this email already exists.',
        });
      }

      // Sample data runs OUTSIDE the bootstrap transaction so a partial seed
      // failure can't wipe the admin we just created. Acceptable trade-off:
      // the admin can re-run /load-samples by running pnpm seed:examples or
      // just live with whatever subset landed.
      if (doLoadSamples) {
        try {
          await loadSampleData({ tenantId: result.tenant.id });
        } catch (err) {
          request.log.error(
            { err, tenantId: result.tenant.id },
            'sample data load failed; admin still created',
          );
        }
      }

      // Status cache must invalidate so the next /status call returns
      // needsSetup:false immediately.
      cachedStatus = { needsSetup: false, cachedAt: Date.now() };

      const session = await createAdminSession({
        userId: result.user.id,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        ttlSec: SESSION_TTL_SEC,
      });

      // last_login_at — same fire-and-forget pattern as /auth/login.
      db.update(schema.adminUsers)
        .set({ lastLoginAt: new Date() })
        .where(eq(schema.adminUsers.id, result.user.id))
        .catch((err: unknown) => {
          fastify.log.error(
            { err, userId: result.user.id },
            'last_login_at update failed',
          );
        });

      return applySessionCookie(reply, session.token).send({
        user: {
          id: result.user.id,
          email: result.user.email,
          displayName: result.user.displayName,
          role: result.user.role,
          tenantId: result.user.tenantId,
          isProtected: result.user.isProtected,
          tourCompletedAt: result.user.tourCompletedAt
            ? result.user.tourCompletedAt.toISOString()
            : null,
        },
        tenant: {
          id: result.tenant.id,
          slug: result.tenant.slug,
          name: result.tenant.name,
        },
        expiresAt: session.expiresAt.toISOString(),
      });
    } catch (err) {
      request.log.error({ err }, 'setup bootstrap failed');
      throw err;
    }
  });
};
