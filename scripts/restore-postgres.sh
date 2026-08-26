#!/usr/bin/env bash
# Restore a Postgres dump from S3 into a target database.
#
# Usage:
#   ./scripts/restore-postgres.sh <s3-key> [target-database-url]
#
# Examples:
#   ./scripts/restore-postgres.sh backups/postgres/2026/05/27/cms-031500.dump
#   ./scripts/restore-postgres.sh backups/postgres/2026/05/27/cms-031500.dump \
#     postgres://postgres:postgres@localhost:5432/cms_restore
#
# When no target URL is given, restores into $RESTORE_DATABASE_URL — which
# defaults to a *throwaway* scratch DB on the same host as $DATABASE_URL with
# a `_restore_drill` suffix. This guard exists so a tired operator can't
# `--clean` over production by typing the wrong arg order.
#
# Required env:  S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
# Optional env:  DATABASE_URL (only used to derive the default scratch target)

set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <s3-key> [target-database-url]" >&2
  exit 2
fi
S3_KEY="$1"
TARGET="${2:-${RESTORE_DATABASE_URL:-}}"

: "${S3_ENDPOINT:?S3_ENDPOINT is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"
: "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID is required}"
: "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY is required}"

if [ -z "$TARGET" ]; then
  # Derive a safe scratch URL by suffixing _restore_drill onto $DATABASE_URL's
  # database name. Requires $DATABASE_URL. If both are absent, fail loudly —
  # silently picking a database is exactly the foot-gun this script avoids.
  : "${DATABASE_URL:?Either pass target-database-url or set RESTORE_DATABASE_URL / DATABASE_URL}"
  # Replace the path component (e.g. /cms) with /cms_restore_drill.
  TARGET="$(echo "$DATABASE_URL" | sed -E 's,(/[^/?]+)([?].*)?$,\1_restore_drill\2,')"
  echo "[restore] no target given; using derived scratch DB: $TARGET" >&2
fi

mc alias set s3 "$S3_ENDPOINT" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" --api S3v4 >/dev/null

echo "[restore] mc cat s3/${S3_BUCKET}/${S3_KEY} | pg_restore → $TARGET"

# --clean --if-exists drops + recreates each object so a repeat restore lands
# cleanly. -j 4 parallelises by table — fine for the CMS schema's ~20 tables.
# Suppressing the WARNING noise that --clean throws on first-restore (objects
# don't exist yet) — exit code is still preserved.
mc cat "s3/${S3_BUCKET}/${S3_KEY}" \
  | pg_restore --clean --if-exists --no-owner --no-privileges -j 4 \
      --dbname="$TARGET" 2> >(grep -v "does not exist, skipping" >&2 || true)

echo "[restore] done"
