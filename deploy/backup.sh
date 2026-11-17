#!/usr/bin/env bash
# 每日备份：把仓库打成 git bundle，保留最近 14 份
set -euo pipefail
APP_DIR="${1:-/srv/harness}"
BACKUP_DIR="${APP_DIR}/backups"
KEEP=14

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
git -C "$APP_DIR" bundle create "${BACKUP_DIR}/harness-${STAMP}.bundle" --all

ls -1t "${BACKUP_DIR}"/harness-*.bundle | tail -n +$((KEEP + 1)) | xargs -r rm -f
echo "backup ok: ${BACKUP_DIR}/harness-${STAMP}.bundle"
