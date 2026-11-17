#!/usr/bin/env bash
# 一条命令完成部署：curl 下来直接执行，不需要传任何参数
#   curl -fsSL https://raw.githubusercontent.com/zhaoxiaodao3-wq/SKILL-ROUTE/main/deploy/run.sh | sudo bash
set -uo pipefail

LOG=/tmp/harness-run.log
: >"$LOG"
exec > >(tee -a "$LOG") 2>&1

on_exit() {
  for d in /www/wwwroot/*/ /www/wwwroot/*/public/; do
    if [ -d "$d" ]; then cp "$LOG" "${d}deploy.txt" 2>/dev/null && chmod 644 "${d}deploy.txt" 2>/dev/null; fi
  done
}
trap on_exit EXIT

export DOMAIN="${DOMAIN:-route.mia-fly.cn}"
export BASIC_PASS="${BASIC_PASS:-Harness@2026}"
export REPO_URL="${REPO_URL:-https://github.com/zhaoxiaodao3-wq/SKILL-ROUTE.git}"

echo "HARNESS-RUN $(date -Is)  DOMAIN=$DOMAIN"
TMP="$(mktemp -d)"
cd "$TMP"
git clone --depth 1 "$REPO_URL" hs
cd hs
bash deploy/install.sh
echo "EXIT=$?"
