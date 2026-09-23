#!/usr/bin/env bash
# Dump the PropWorks Supabase Postgres database to a timestamped SQL file.
#
# REQUIRED (never commit this value):
#   SUPABASE_DB_URL  — Postgres URI from Supabase Dashboard →
#                      Project Settings → Database → Connection string (URI).
#                      Use the "Session" or "Direct" connection, not the
#                      transaction pooler, for pg_dump. Include the DB password.
#
# Usage:
#   export SUPABASE_DB_URL='postgresql://postgres....'
#   ./ops/supabase-backup.sh [output-dir]
#
# Exit codes:
#   0  success
#   2  SUPABASE_DB_URL missing (clear REQUIRED_SECRET signal for CI)
#   1  dump failed

set -euo pipefail

OUT_DIR="${1:-./backup-out}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="${OUT_DIR}/propworks-supabase-${STAMP}.sql.gz"

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  cat >&2 <<'MSG'
REQUIRED_SECRET: SUPABASE_DB_URL is not set.

Jeff must add a GitHub Actions repository secret named SUPABASE_DB_URL with the
Postgres connection URI from:
  Supabase Dashboard → Project Settings → Database → Connection string (URI)

Do NOT use the anon key or service_role key here — this script needs the
database password connection string for pg_dump.

Until that secret exists, automated server backups cannot run. Client-side
Dexie backups (Account → Download backup JSON) still work.
MSG
  exit 2
fi

mkdir -p "${OUT_DIR}"

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump not found. Install postgresql-client." >&2
  exit 1
fi

echo "Dumping Supabase to ${OUT_FILE} …"
# Prefer custom-format-compatible plain SQL gzip for easy restore with psql.
pg_dump \
  --no-owner \
  --no-acl \
  --clean \
  --if-exists \
  --exclude-schema=supabase_migrations \
  "${SUPABASE_DB_URL}" \
  | gzip -c > "${OUT_FILE}"

# Sidecar metadata (no secrets)
{
  echo "created_at_utc=${STAMP}"
  echo "tool=pg_dump"
  echo "format=sql.gz"
  echo "bytes=$(wc -c < "${OUT_FILE}" | tr -d ' ')"
} > "${OUT_FILE}.meta.txt"

echo "OK: ${OUT_FILE}"
