#!/usr/bin/env bash
# harness 一键部署（在服务器上以 root / sudo 运行）
#
#   DOMAIN=harness.example.com \
#   BASIC_PASS='改成你的密码' \
#   GIT_TOKEN=ghp_xxx \
#   bash deploy/install.sh
#
# 变量：
#   DOMAIN       必填，面板域名（需已解析到本机）
#   BASIC_PASS   必填，面板登录密码
#   GIT_TOKEN    选填，GitHub token；给了才能「保存后自动 push」
#   EMAIL        选填，申请证书用（有 certbot 时）
#   APP_DIR      选填，默认 /srv/harness
#   PORT         选填，网关端口，默认 7001
set -euo pipefail

DOMAIN="${DOMAIN:-}"
BASIC_PASS="${BASIC_PASS:-}"
GIT_TOKEN="${GIT_TOKEN:-}"
EMAIL="${EMAIL:-}"
APP_DIR="${APP_DIR:-/srv/harness}"
PORT="${PORT:-7001}"
REPO_URL="${REPO_URL:-https://github.com/zhaoxiaodao3-wq/SKILL-ROUTE.git}"
SERVICE_USER="${SERVICE_USER:-harness}"
BASIC_USER="${BASIC_USER:-harness}"

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m[FAIL] %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 或 sudo 运行"
[ -n "$DOMAIN" ] || die "缺少 DOMAIN，例：DOMAIN=harness.example.com"
[ -n "$BASIC_PASS" ] || die "缺少 BASIC_PASS（面板登录密码）"

for c in git node npm nginx openssl; do
  command -v "$c" >/dev/null 2>&1 || die "缺少命令：$c"
done
NODE_BIN="$(command -v node)"
node -e 'const v=+process.versions.node.split(".")[0]; if(v<20){console.error("需要 Node >= 20，当前 "+process.version);process.exit(1)}'

say "1/7 服务用户与代码"
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
if [ -d "$APP_DIR/.git" ]; then
  sudo -u "$SERVICE_USER" git -C "$APP_DIR" pull --ff-only
else
  mkdir -p "$(dirname "$APP_DIR")"
  git clone "$REPO_URL" "$APP_DIR"
fi

say "2/7 git 身份与推送方式"
sudo -u "$SERVICE_USER" git -C "$APP_DIR" config user.name "harness-bot"
sudo -u "$SERVICE_USER" git -C "$APP_DIR" config user.email "harness-bot@localhost"
PUSH_ARG="--no-push"
if [ -n "$GIT_TOKEN" ]; then
  SLUG="$(printf '%s' "$REPO_URL" | sed -E 's#^https?://[^/]+/##; s#\.git$##')"
  sudo -u "$SERVICE_USER" git -C "$APP_DIR" remote set-url origin "https://x-access-token:${GIT_TOKEN}@github.com/${SLUG}.git"
  PUSH_ARG=""
  echo "已配置 token 推送"
else
  echo "没有 GIT_TOKEN：面板保存只做本地 commit，不会 push"
fi

say "3/7 构建面板"
cd "$APP_DIR/tools/panel"
sudo -u "$SERVICE_USER" npm ci --no-audit --no-fund || sudo -u "$SERVICE_USER" npm install --no-audit --no-fund
sudo -u "$SERVICE_USER" npm run build
[ -f "$APP_DIR/tools/panel/dist/index.html" ] || die "面板构建失败"
chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR"

say "4/7 systemd 服务"
cat >/etc/systemd/system/harness-api.service <<EOF
[Unit]
Description=harness routing gateway
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
ExecStart=${NODE_BIN} ${APP_DIR}/tools/server/server.mjs --repo ${APP_DIR} --port ${PORT} ${PUSH_ARG}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable harness-api >/dev/null
systemctl restart harness-api
sleep 1
systemctl is-active --quiet harness-api || die "harness-api 没起来，看 journalctl -u harness-api -n 50"
curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null || die "网关健康检查失败"

say "5/7 登录密码"
HASH="$(openssl passwd -apr1 "$BASIC_PASS")"
printf '%s:%s\n' "$BASIC_USER" "$HASH" >/etc/nginx/.harness.htpasswd
chmod 640 /etc/nginx/.harness.htpasswd
chown root:www-data /etc/nginx/.harness.htpasswd 2>/dev/null || true

say "6/7 nginx"
cat >/etc/nginx/conf.d/harness.conf <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    auth_basic "harness";
    auth_basic_user_file /etc/nginx/.harness.htpasswd;

    root ${APP_DIR}/tools/panel/dist;
    index index.html;

    location / {
        try_files \$uri /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }

    location /install {
        proxy_pass http://127.0.0.1:${PORT};
    }
    location /install.ps1 {
        proxy_pass http://127.0.0.1:${PORT};
    }
}
EOF
nginx -t
systemctl reload nginx

say "7/7 HTTPS 与备份"
if command -v certbot >/dev/null 2>&1 && [ -n "$EMAIL" ]; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect || echo "证书申请失败，可稍后手动 certbot --nginx -d $DOMAIN"
else
  echo "未安装 certbot 或没给 EMAIL：先跑 HTTP，之后执行："
  echo "  certbot --nginx -d $DOMAIN --redirect"
fi

install -m 755 "$APP_DIR/deploy/backup.sh" /usr/local/bin/harness-backup
mkdir -p "$APP_DIR/backups"
chown "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR/backups"
cat >/etc/cron.d/harness-backup <<EOF
17 3 * * * root /usr/local/bin/harness-backup ${APP_DIR} >/var/log/harness-backup.log 2>&1
EOF

say "完成"
cat <<EOF
面板:   https://${DOMAIN}/        （用户 ${BASIC_USER}）
网关:   http://127.0.0.1:${PORT}  （仅本机）
代码:   ${APP_DIR}
日志:   journalctl -u harness-api -f
备份:   ${APP_DIR}/backups（每天 03:17）
更新:   cd ${APP_DIR} && git pull && (cd tools/panel && npm run build) && systemctl restart harness-api
EOF
