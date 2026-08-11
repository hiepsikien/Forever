#!/usr/bin/env bash
# Install daily cron for Forever DB + uploads backup (03:00 Asia/Ho_Chi_Minh).
# Run once on the GCE VM:
#   bash ~/Forever/scripts/install-backup-cron.sh

set -euo pipefail

FOREVER_DIR="${FOREVER_DIR:-$HOME/Forever}"
BACKUP_SCRIPT="${FOREVER_DIR}/scripts/backup-forever.sh"
CRON_LINE="0 3 * * * cd ${FOREVER_DIR} && /bin/bash ${BACKUP_SCRIPT} >> ${HOME}/backups/cron.log 2>&1"

if [[ ! -f "$BACKUP_SCRIPT" ]]; then
  echo "ERROR: missing ${BACKUP_SCRIPT}" >&2
  exit 1
fi

chmod +x "$BACKUP_SCRIPT"
mkdir -p "$HOME/backups"

if [[ -f /usr/share/zoneinfo/Asia/Ho_Chi_Minh ]]; then
  echo "Tip: system timezone should be Asia/Ho_Chi_Minh for 03:00 VN."
  echo "     sudo timedatectl set-timezone Asia/Ho_Chi_Minh"
fi

EXISTING="$(crontab -l 2>/dev/null || true)"
if echo "$EXISTING" | grep -Fq "$BACKUP_SCRIPT"; then
  echo "Cron already installed for ${BACKUP_SCRIPT}"
else
  {
    echo "$EXISTING"
    echo "# Forever DB + uploads backup — daily 03:00"
    echo "$CRON_LINE"
  } | grep -v '^$' | crontab -
  echo "Installed cron:"
  echo "  $CRON_LINE"
fi

echo
echo "Run a backup now:"
echo "  ${BACKUP_SCRIPT}"
echo
echo "Test fail-mail only:"
echo "  BACKUP_FORCE_FAIL=1 ${BACKUP_SCRIPT}"
echo
crontab -l | grep -F "$BACKUP_SCRIPT" || true
