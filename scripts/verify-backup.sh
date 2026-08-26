#!/usr/bin/env bash
# Restore the most recent S3 backup into a throwaway Postgres container and
# run a smoke query. This is the "tested" half of "Postgres backups + tested
# restore" — backups that have never been restored from are not backups.
#
# Usage:
#   ./scripts/verify-backup.sh
#
# Required env:  S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
# Optional env:  BACKUP_S3_PREFIX (default 'backups/postgres')
#                VERIFY_PG_IMAGE  (default 'postgres:18-alpine')
#                VERIFY_PORT      (default 55432 — host port for the scratch container)
#
# Exits non-zero if no backup is found, restore fails, or the smoke query
# returns zero rows from a known-non-empty table. Run from CI weekly and
# from an operator's machine ad-hoc.

set -euo pipefail

: "${S3_ENDPOINT:?S3_ENDPOINT is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"
: "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID is required}"
: "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY is required}"
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-backups/postgres}"
VERIFY_PG_IMAGE="${VERIFY_PG_IMAGE:-postgres:18-alpine}"
VERIFY_PORT="${VERIFY_PORT:-55432}"
CONTAINER="cms-restore-drill-$$"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

mc alias set s3 "$S3_ENDPOINT" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" --api S3v4 >/dev/null

# Most recent .dump under the prefix. `mc find` walks the partitioned date
# subdirs; `tail -1` picks the lexicographically-last which matches the
# YYYY/MM/DD/HHMMSS naming used by backup-postgres.sh.
LATEST="$(mc find "s3/${S3_BUCKET}/${BACKUP_S3_PREFIX}/" --name "cms-*.dump" 2>/dev/null \
  | sort | tail -1 | sed -E "s,^s3/${S3_BUCKET}/,,")"
if [ -z "$LATEST" ]; then
  echo "[verify] no backup found under ${BACKUP_S3_PREFIX}/" >&2
  exit 1
fi
echo "[verify] latest backup: $LATEST"

echo "[verify] starting scratch postgres on host port ${VERIFY_PORT}"
docker run --rm -d \
  --name "$CONTAINER" \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=cms_restore_drill \
  -p "${VERIFY_PORT}:5432" \
  "$VERIFY_PG_IMAGE" >/dev/null

# Wait for the container to accept connections. pg_isready exits 0 when ready.
for i in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres -d cms_restore_drill >/dev/null 2>&1; then
    break
  fi
  sleep 1
  if [ "$i" = "30" ]; then
    echo "[verify] scratch postgres failed to become ready" >&2
    exit 1
  fi
done

TARGET="postgres://postgres:postgres@localhost:${VERIFY_PORT}/cms_restore_drill"

echo "[verify] restoring $LATEST → scratch db"
"$(dirname "$0")/restore-postgres.sh" "$LATEST" "$TARGET"

# Smoke query. `content` is the table the editor lives in — if a backup
# restores into something without content rows, it's a bad backup. The check
# is intentionally crude; deeper schema validation belongs in CI tests.
echo "[verify] smoke query: select count(*) from content"
COUNT="$(docker exec "$CONTAINER" psql -U postgres -d cms_restore_drill -tAc 'select count(*) from content')"
echo "[verify] content row count: $COUNT"
if [ "${COUNT:-0}" -le 0 ]; then
  echo "[verify] FAIL — restored DB has zero content rows (corrupt or empty backup?)" >&2
  exit 1
fi

echo "[verify] OK — backup restore verified end-to-end"
