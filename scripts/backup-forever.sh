#!/usr/bin/env bash
# Daily Forever backup on the GCE VM: Postgres dump + uploads mirror → GCS.
# Failures email BACKUP_ALERT_TO via Gmail SMTP (see deploy/.env.prod).
#
# Usage (on VM):
#   ~/Forever/scripts/backup-forever.sh
# Env overrides:
#   FOREVER_DIR, BACKUP_DIR, BACKUP_BUCKET, KEEP_DAYS, PG_CONTAINER,
#   UPLOADS_VOLUME, BACKUP_FORCE_FAIL=1 (test alert mail)

set -euo pipefail

FOREVER_DIR="${FOREVER_DIR:-$HOME/Forever}"
ENV_FILE="${ENV_FILE:-$FOREVER_DIR/deploy/.env.prod}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
BACKUP_BUCKET="${BACKUP_BUCKET:-gs://forever-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
PG_CONTAINER="${PG_CONTAINER:-deploy-postgres-1}"
UPLOADS_VOLUME="${UPLOADS_VOLUME:-forever_forever_uploads}"
LOG="${BACKUP_DIR}/backup.log"
STAMP="$(date +%Y%m%d-%H%M%S)"
HOSTNAME_SHORT="$(hostname -s 2>/dev/null || hostname)"

mkdir -p "$BACKUP_DIR"
touch "$LOG"

log() {
  echo "[$(date -Is)] $*" | tee -a "$LOG"
}

FAIL_REASON=""
ALERT_SENT=0

notify_fail() {
  local reason="${1:-unknown failure}"
  if [[ "$ALERT_SENT" -eq 1 ]]; then
    return 0
  fi
  ALERT_SENT=1

  if [[ -z "${BACKUP_ALERT_TO:-}" || -z "${BACKUP_SMTP_USER:-}" || -z "${BACKUP_SMTP_PASSWORD:-}" ]]; then
    log "WARN: backup failed ($reason) but SMTP alert env incomplete — no email sent"
    return 0
  fi

  local to="${BACKUP_ALERT_TO}"
  local host="${BACKUP_SMTP_HOST:-smtp.gmail.com}"
  local port="${BACKUP_SMTP_PORT:-587}"
  local user="${BACKUP_SMTP_USER}"
  # Strip spaces (Gmail App Passwords are often copied with spaces)
  local pass="${BACKUP_SMTP_PASSWORD// /}"
  local subject="[Forever] backup FAILED on ${HOSTNAME_SHORT} (${STAMP})"
  local tail_log
  tail_log="$(tail -n 40 "$LOG" 2>/dev/null || true)"

  if python3 - "$to" "$host" "$port" "$user" "$pass" "$subject" "$reason" "$HOSTNAME_SHORT" "$STAMP" "$tail_log" <<'PY'
import smtplib
import ssl
import sys
from email.message import EmailMessage

to, host, port_s, user, password, subject, reason, hostname, stamp, tail = sys.argv[1:11]
port = int(port_s)

body = (
    f"Forever backup failed.\n\n"
    f"Host: {hostname}\n"
    f"Time: {stamp}\n"
    f"Reason: {reason}\n\n"
    f"--- last log lines ---\n{tail}\n"
)

msg = EmailMessage()
msg["From"] = user
msg["To"] = to
msg["Subject"] = subject
msg.set_content(body)

context = ssl.create_default_context()
with smtplib.SMTP(host, port, timeout=60) as smtp:
    smtp.starttls(context=context)
    smtp.login(user, password)
    smtp.send_message(msg)
PY
  then
    log "Alert email sent to ${to}"
  else
    log "ERROR: failed to send alert email (backup failure still stands: ${reason})"
  fi
}

on_exit() {
  local code=$?
  trap - EXIT
  if [[ "$code" -ne 0 ]]; then
    notify_fail "${FAIL_REASON:-exit ${code}}"
  fi
}
trap on_exit EXIT

die() {
  FAIL_REASON="$*"
  log "ERROR: $*"
  exit 1
}

# Load secrets (DB + SMTP). Do not echo values.
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  die "missing env file: $ENV_FILE"
fi

DB_USER="${FOREVER_DB_USER:-forever}"
DB_NAME="${FOREVER_DB_NAME:-forever}"
DB_PASSWORD="${FOREVER_DB_PASSWORD:-}"

[[ -n "$DB_PASSWORD" ]] || die "FOREVER_DB_PASSWORD empty in $ENV_FILE"

if [[ "${BACKUP_FORCE_FAIL:-}" == "1" ]]; then
  die "BACKUP_FORCE_FAIL=1 (alert test)"
fi

command -v docker >/dev/null 2>&1 || die "docker not found"
command -v gcloud >/dev/null 2>&1 || die "gcloud not found"
command -v gzip >/dev/null 2>&1 || die "gzip not found"
command -v python3 >/dev/null 2>&1 || die "python3 not found"

if ! docker inspect "$PG_CONTAINER" >/dev/null 2>&1; then
  die "Postgres container not found: $PG_CONTAINER"
fi
if ! docker volume inspect "$UPLOADS_VOLUME" >/dev/null 2>&1; then
  die "uploads volume not found: $UPLOADS_VOLUME"
fi

DUMP_PATH="${BACKUP_DIR}/forever-${STAMP}.dump.gz"
GCS_DUMP="${BACKUP_BUCKET%/}/postgres/forever-${STAMP}.dump.gz"

log "START backup stamp=${STAMP} bucket=${BACKUP_BUCKET}"

# --- Postgres ---
log "Dumping database ${DB_NAME} from ${PG_CONTAINER}"
if ! docker exec -e PGPASSWORD="$DB_PASSWORD" "$PG_CONTAINER" \
  pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc --no-owner --no-acl \
  | gzip -c >"$DUMP_PATH"; then
  rm -f "$DUMP_PATH"
  die "pg_dump failed"
fi

SIZE="$(du -h "$DUMP_PATH" | awk '{print $1}')"
log "Local dump OK ${DUMP_PATH} (${SIZE})"

log "Uploading dump → ${GCS_DUMP}"
gcloud storage cp "$DUMP_PATH" "$GCS_DUMP" || die "gcloud storage cp dump failed"

# Local retention for dumps only
find "$BACKUP_DIR" -maxdepth 1 -name 'forever-*.dump.gz' -type f -mtime "+${KEEP_DAYS}" -delete || true
KEPT="$(find "$BACKUP_DIR" -maxdepth 1 -name 'forever-*.dump.gz' -type f | wc -l | tr -d ' ')"
log "Local dumps kept: ${KEPT} (KEEP_DAYS=${KEEP_DAYS})"

# --- Uploads mirror (rsync straight from Docker volume — no host staging copy) ---
UPLOADS_SRC="$(docker volume inspect -f '{{.Mountpoint}}' "$UPLOADS_VOLUME")"
[[ -n "$UPLOADS_SRC" ]] || die "empty mountpoint for volume $UPLOADS_VOLUME"

GCS_UPLOADS="${BACKUP_BUCKET%/}/uploads"
log "Rsync uploads ${UPLOADS_SRC} → ${GCS_UPLOADS} (no --delete)"

run_uploads_rsync() {
  if [[ -r "$UPLOADS_SRC" ]]; then
    gcloud storage rsync "$UPLOADS_SRC" "$GCS_UPLOADS" --recursive --project="${CLOUDSDK_CORE_PROJECT:-vstock-prod}"
  elif command -v sudo >/dev/null 2>&1 && sudo test -d "$UPLOADS_SRC"; then
    # Named volumes live under /var/lib/docker (root-only). GCE ADC works as root too.
    sudo gcloud storage rsync "$UPLOADS_SRC" "$GCS_UPLOADS" --recursive --project="${CLOUDSDK_CORE_PROJECT:-vstock-prod}"
  else
    return 1
  fi
}

run_uploads_rsync || die "gcloud storage rsync uploads failed (cannot read ${UPLOADS_SRC}?)"

log "OK backup complete stamp=${STAMP}"
