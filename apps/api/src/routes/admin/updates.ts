import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db, schema } from '@cms/db';
import { compareVersions, env, isDevVersion } from '@cms/config';
import { JOB_NAMES, QUEUE_NAMES } from '@cms/queue';

import { producers } from '../../lib/queue.js';
import { requireAdminAuth } from '../../middleware/require-auth.js';
import { requireAdminRole } from '../../middleware/require-role.js';

/**
 * Update status for this install — the read side of the release system.
 * See docs/phase-3-versioning-and-updates-plan.md.
 *
 * This endpoint reports and configures ONLY. It never applies an update:
 * a container cannot rebuild itself, so applying is a separate operator
 * action (the v1.6.0 install workflow).
 *
 * The actual manifest fetch lives in the worker
 * (apps/worker/src/lib/update-check.ts) so there is one implementation. This
 * route reads the row that job writes, and can enqueue the job on demand.
 *
 * super_admin only: which software version the box runs is operator business,
 * and editors have nothing to do with it.
 */

const PatchSchema = z.object({
  checkEnabled: z.boolean(),
});

export const adminUpdatesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdminAuth);
  fastify.addHook('preHandler', requireAdminRole('super_admin'));

  fastify.get('/', async () => {
    const [row] = await db.select().from(schema.updateStatus).limit(1);
    const currentVersion = env.CMS_VERSION;

    // Re-compare rather than trusting that latestVersion is non-null. The
    // worker clears it when up to date, but between an operator upgrading and
    // the next daily check the row still advertises the version they just
    // installed — comparing here stops a banner for an update already applied.
    const latestVersion = row?.latestVersion ?? null;
    const updateAvailable =
      latestVersion !== null &&
      compareVersions(currentVersion, latestVersion) < 0;

    return {
      data: {
        currentVersion,
        // A build made without the CMS_VERSION build arg. The admin shows
        // "dev" instead of a version, and every release reads as newer.
        isDevBuild: isDevVersion(currentVersion),
        updateAvailable,
        latest: updateAvailable
          ? {
              version: latestVersion,
              // 'code' | 'schema' — schema means migrations run, which is
              // what drives the stricter confirmation flow in the admin.
              type: row?.latestType ?? 'code',
              releasedAt: row?.latestReleasedAt ?? null,
              notesUrl: row?.latestNotesUrl ?? null,
              minUpgradeFrom: row?.minUpgradeFrom ?? null,
              requiresBackup: row?.requiresBackup ?? false,
              newEnvVars: (row?.newEnvVars as string[] | null) ?? [],
            }
          : null,
        check: {
          // Null = never run. Distinguishes "no update" from "we have not
          // been able to look", which the admin words differently.
          checkedAt: row?.checkedAt ?? null,
          error: row?.checkError ?? null,
          // Effective state: the env var is a hard override a deploy can
          // enforce, so the toggle below cannot re-enable against it.
          enabled: env.UPDATE_CHECK_ENABLED && (row?.checkEnabled ?? true),
          lockedByEnv: !env.UPDATE_CHECK_ENABLED,
          manifestUrl: env.UPDATE_MANIFEST_URL,
        },
      },
    };
  });

  // Run a check now instead of waiting for the daily sweep. Enqueues the same
  // worker job — no duplicate fetch logic on the API side.
  fastify.post('/check', async (_request, reply) => {
    if (!env.UPDATE_CHECK_ENABLED) {
      return reply.code(409).send({
        error: 'update checks are disabled by UPDATE_CHECK_ENABLED',
      });
    }
    const queue = producers.rawQueues.find(
      (q) => q.name === QUEUE_NAMES.maintenance,
    );
    if (!queue) {
      return reply.code(503).send({ error: 'maintenance queue unavailable' });
    }
    // No jobId — a manual check is an explicit request and should always run,
    // unlike the repeatable which dedupes on a fixed id.
    await queue.add(JOB_NAMES.maintenance.updateCheck, {});
    return reply.code(202).send({ data: { queued: true } });
  });

  // Operator opt-out for the daily outbound call. Upserts the singleton so it
  // works on an install whose first check has not run yet.
  fastify.patch('/', async (request, reply) => {
    const parsed = PatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'checkEnabled (boolean) is required' });
    }
    const { checkEnabled } = parsed.data;
    await db
      .insert(schema.updateStatus)
      .values({ singleton: 'singleton', checkEnabled })
      .onConflictDoUpdate({
        target: schema.updateStatus.singleton,
        set: { checkEnabled, updatedAt: sql`now()` },
      });
    return { data: { checkEnabled } };
  });
};
