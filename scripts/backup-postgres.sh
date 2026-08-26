#!/usr/bin/env bash
# Take a logical backup of the CMS Postgres database and upload it to S3.
#
# Usage:
#   DATABASE_URL=postgres://... \
#   S3_ENDPOINT=http://minio:9000 S3_BUCKET=cms-media \
#   S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... \
#   ./scripts/backup-postgres.sh
#
# Optional env:
#   BACKUP_S3_PREFIX        default 'backups/postgres' — object key prefix
#   BACKUP_RETENTION_DAYS   default 30 — older dumps are deleted after upload
#
# Designed to be invoked from a Coolify scheduled task (every 24h is plenty
# for a news CMS). Also fine to run by hand from the operator's machine
# against any reachable database — the script writes nothing local.

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${S3_ENDPOINT:?S3_ENDPOINT is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"
: "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID is required}"
: "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY is required}"
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-backups/postgres}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

# Configure mc once per run. The alias is process-local (it ends up in
# /root/.mc/config.json), so concurrent runs in separate containers don't
# step on each other.
mc alias set s3 "$S3_ENDPOINT" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" --api S3v4 >/dev/null

# Path partitioning: backups/postgres/YYYY/MM/DD/cms-HHMMSS.dump
# The compressed custom format (-Fc) is the input pg_restore wants, ~5x smaller
# than plain SQL on real data, and supports parallel restore (-j).
NOW_DATE="$(date -u +%Y/%m/%d)"
NOW_TIME="$(date -u +%H%M%S)"
KEY="${BACKUP_S3_PREFIX}/${NOW_DATE}/cms-${NOW_TIME}.dump"

echo "[backup] pg_dump → mc cp s3/${S3_BUCKET}/${KEY}"

# Pipe straight to S3 so the dump never touches local disk — important on
# tiny backup containers with no scratch space.
pg_dump --format=custom --compress=9 "$DATABASE_URL" \
  | mc pipe "s3/${S3_BUCKET}/${KEY}"

echo "[backup] uploaded ${KEY}"

# Retention sweep. mc rm --recursive --older-than=NNd applies to the prefix.
# Skipped when BACKUP_RETENTION_DAYS=0 so an operator can disable for forensics.
if [ "$BACKUP_RETENTION_DAYS" -gt 0 ]; then
  echo "[backup] sweeping objects older than ${BACKUP_RETENTION_DAYS}d under ${BACKUP_S3_PREFIX}/"
  mc rm --recursive --force --older-than "${BACKUP_RETENTION_DAYS}d" \
    "s3/${S3_BUCKET}/${BACKUP_S3_PREFIX}/" >/dev/null || true
fi

echo "[backup] done"
