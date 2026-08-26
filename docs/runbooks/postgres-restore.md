# Postgres backup & restore runbook

The CMS takes `pg_dump --format=custom` backups to S3 (Garage in prod, MinIO
locally), keyed under `backups/postgres/YYYY/MM/DD/cms-HHMMSS.dump`. This
runbook is how you exercise restores so we know the backups actually work.

## What's in place

- `scripts/backup-postgres.sh` — pg_dump → mc pipe to S3. Retention sweep
  removes objects older than `BACKUP_RETENTION_DAYS` (default 30) after upload.
- `scripts/restore-postgres.sh <s3-key> [target-database-url]` — `mc cat | pg_restore`.
  With no target, derives a `_restore_drill` scratch DB from `DATABASE_URL` so
  a tired operator can't `--clean` over production.
- `scripts/verify-backup.sh` — spins a throwaway `postgres:18-alpine`
  container, restores the most recent backup into it, runs a smoke query
  (`select count(*) from content` > 0), tears the container down.
- `docker-compose.yml` `backup` service (profile-gated) — wraps
  `scripts/backup-postgres.sh` with the right env for a local run against the
  in-compose Postgres + MinIO. Invoke with:

      docker compose --profile backup run --rm backup

## Required env (production)

Set these on the Coolify scheduled-task config — same shape as the running
API/worker, plus the two backup-specific ones:

| Var | Example | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://…/cms` | **Direct** to Postgres, not PgBouncer. |
| `S3_ENDPOINT` | `https://garage.example.com` | Where dumps land. |
| `S3_BUCKET` | `cms-media` | Same bucket as media is fine — `BACKUP_S3_PREFIX` keeps them separate. |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | … | Needs write + list + delete on the prefix. |
| `BACKUP_S3_PREFIX` | `backups/postgres` | Default. Don't reuse a media prefix. |
| `BACKUP_RETENTION_DAYS` | `30` | Set `0` to disable the sweep (e.g. during an incident). |

## Production cron (Coolify)

In Coolify → your CMS application → Scheduled Tasks, add:

- **Command:** `bash /scripts/backup-postgres.sh`
- **Frequency:** `0 3 * * *` (daily at 03:00 UTC — picked because publish queue
  is quiet, replicas have woken up after Dragonfly snapshot)
- **Container:** the `backup` service (or a one-off `docker run` that mounts
  `scripts/`)

Verify the first run by inspecting the S3 bucket — there should be a fresh
`.dump` object under `backups/postgres/YYYY/MM/DD/`.

## The actual restore drill

Run this **at least monthly** in production and **before every major release**:

```sh
# From the host running docker compose
docker compose --profile backup run --rm \
  -e VERIFY_PG_IMAGE=postgres:18-alpine \
  --entrypoint /bin/sh \
  backup -c "apk add --no-cache bash curl >/dev/null && \
    curl -fsSL https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc && \
    chmod +x /usr/local/bin/mc && \
    bash /scripts/verify-backup.sh"
```

Expected last line: `[verify] OK — backup restore verified end-to-end`.

A failure here is **not** a drill failure to ignore — it means today's
backup wouldn't actually rescue you. Investigate before doing anything else
(corrupt dump? IAM denied? schema change broke the smoke query?).

## Restoring after a real incident

1. **Stop the API + worker** so nothing writes mid-restore.

       docker compose stop api worker

2. **Pick the dump** — list and choose the one immediately before the bad event:

       mc alias set s3 $S3_ENDPOINT $S3_ACCESS_KEY_ID $S3_SECRET_ACCESS_KEY --api S3v4
       mc find s3/$S3_BUCKET/backups/postgres/ --name "cms-*.dump" | sort | tail -20

3. **Restore into a scratch DB first**, never directly over the live one. Use
   the script with a derived `_restore_drill` target (omits the second arg):

       ./scripts/restore-postgres.sh backups/postgres/2026/05/27/cms-031500.dump

   Inspect: connect to the scratch DB, run the same queries an editor would,
   confirm the data shape is what you expect.

4. **Cut over** — once the scratch restore looks right, restore into the
   live DB. The `--clean --if-exists` flags in `restore-postgres.sh` drop
   and recreate each object, so the destination ends up an exact copy of
   the dump:

       ./scripts/restore-postgres.sh backups/postgres/2026/05/27/cms-031500.dump \
         postgres://postgres:postgres@postgres:5432/cms

5. **Restart**:

       docker compose start api worker
       curl -fsS http://localhost:3000/health/ready  # all deps green

6. **Re-index Meili** — search drifts from the freshly-restored content
   until the nightly drift sweep runs. Trigger it on demand:

       pnpm --filter @cms/api exec tsx scripts/meili-reindex.ts

7. **Post-incident**: write up what happened in `docs/incidents/` and run the
   monthly drill the next morning to confirm the new state is also backable.

## Known limitations

- **In-flight jobs at backup time**: BullMQ state lives in Dragonfly, not
  Postgres. A restore brings back content + audit_log + sessions but **not**
  the queued/delayed jobs. After a real-incident restore, expect to re-run
  the `meili-drift-sweep` (above) and possibly re-enqueue any scheduled
  publish/unpublish jobs by touching their content rows.
- **Media files (S3 objects)** are not in scope here — they live in the same
  bucket but under a different prefix. Garage / S3 versioning is the right
  protection for those; see Garage's docs.
