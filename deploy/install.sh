#!/usr/bin/env bash
# harness 一键部署（支持宝塔 / 原生 nginx）
#
#   DOMAIN=harness.example.com \
#   BASIC_PASS='改成你的密码' \
#   GIT_TOKEN=ghp_xxx \
#   bash deploy/install.sh
#
# 变量：
#   DOMAIN       必填，面板域名（需已解析到本机）
#   BASIC_PASS   必填，面板登录密码
#   GIT_TOKEN    选填；给了才能「保存后自动 push」
#   EMAIL        选填；原生 nginx + certbot 时用
#   APP_DIR      默认 /srv/harness
#   PORT         默认 7001
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
warn() { printf '\033[1;33m[WARN] %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m[FAIL] %s\033[0m\n' "$*" >&2; exit 1; }

# ---------- 环境识别 ----------
BT=0
if [ -d /www/server/panel ] && [ -d /www/server/nginx ]; then BT=1; fi

if [ "$BT" = 1 ]; then
  NGINX_BIN=/www/server/nginx/sbin/nginx
  NGINX_CONF_DIR=/www/server/panel/vhost/nginx
  NGINX_RELOAD="$NGINX_BIN -s reload"
  NGINX_USER=www
else
  NGINX_BIN="$(command -v nginx || true)"
  NGINX_CONF_DIR=/etc/nginx/conf.d
  NGINX_RELOAD="systemctl reload nginx"
  NGINX_USER=www-data
fi

[ "$(id -u)" -eq 0 ] || die "请用 root 运行（sudo -i 后再跑）"
[ -n "$DOMAIN" ] || die "缺少 DOMAIN，例：DOMAIN=harness.example.com"
[ -n "$BASIC_PASS" ] || die "缺少 BASIC_PASS（面板登录密码）"
[ "$BT" = 1 ] && say "检测到宝塔面板" || say "检测到原生 nginx"

for c in git npm openssl curl; do
  command -v "$c" >/dev/null 2>&1 || die "缺少命令：$c"
done
[ -n "$NGINX_BIN" ] || die "找不到 nginx"

# ---------- Node ----------
say "0/7 Node 检查"
need_node=1
if command -v node >/dev/null 2>&1; then
  if node -e 'process.exit(+process.versions.node.split(".")[0] >= 20 ? 0 : 1)'; then need_node=0; fi
fi
if [ "$need_node" = 1 ]; then
  warn "没有 Node 20+，尝试安装"
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    dnf install -y nodejs
  else
    die "请先安装 Node 20+（宝塔可用「Node 版本管理器」装 20.x），装好后再跑本脚本"
  fi
fi
NODE_BIN="$(command -v node)"
echo "node: $($NODE_BIN -v)  ($NODE_BIN)"

# ---------- 1 代码 ----------
say "1/7 服务用户与代码"
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
if [ -d "$APP_DIR/.git" ]; then
  sudo -u "$SERVICE_USER" git -C "$APP_DIR" pull --ff-only
else
  mkdir -p "$(dirname "$APP_DIR")"
  git clone "$REPO_URL" "$APP_DIR"
fi

# ---------- 2 git 身份 ----------
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
  echo "没有 GIT_TOKEN：面板保存只做本地 commit"
fi

# ---------- 3 构建 ----------
say "3/7 构建面板"
cd "$APP_DIR/tools/panel"
sudo -u "$SERVICE_USER" npm ci --no-audit --no-fund || sudo -u "$SERVICE_USER" npm install --no-audit --no-fund
sudo -u "$SERVICE_USER" npm run build
[ -f "$APP_DIR/tools/panel/dist/index.html" ] || die "面板构建失败"
chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR"
# nginx 用户要能读到静态文件
chmod -R o+rX "$APP_DIR/tools/panel/dist"
chmod o+x /srv /srv/harness "$APP_DIR/tools" "$APP_DIR/tools/panel" 2>/dev/null || true

# ---------- 4 systemd ----------
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
systemctl is-active --quiet harness-api || die "harness-api 没起来：journalctl -u harness-api -n 50"
curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null || die "网关健康检查失败"
echo "网关已启动：127.0.0.1:${PORT}"

# ---------- 5 密码 ----------
say "5/7 登录密码"
HASH="$(openssl passwd -apr1 "$BASIC_PASS")"
mkdir -p "$(dirname "$NGINX_CONF_DIR")"
printf '%s:%s\n' "$BASIC_USER" "$HASH" >/etc/nginx/.harness.htpasswd 2>/dev/null \
  || printf '%s:%s\n' "$BASIC_USER" "$HASH" >/www/server/nginx/conf/.harness.htpasswd
HTPASSWD_FILE=/etc/nginx/.harness.htpasswd
[ -f "$HTPASSWD_FILE" ] || HTPASSWD_FILE=/www/server/nginx/conf/.harness.htpasswd
chmod 644 "$HTPASSWD_FILE"

# ---------- 6 nginx ----------
say "6/7 nginx 站点"
mkdir -p "$NGINX_CONF_DIR"
TARGET_CONF="$NGINX_CONF_DIR/${DOMAIN}.conf"
CERT=""
CERT_KEY=""
if [ -f "$TARGET_CONF" ]; then
  BAK="${TARGET_CONF}.bak.$(date +%s)"
  cp "$TARGET_CONF" "$BAK"
  echo "已备份原站点配置：$BAK"
  # 尽量复用已有证书，避免接管后 HTTPS 掉线
  CERT="$(grep -oE 'ssl_certificate[[:space:]]+[^;]+;' "$TARGET_CONF" | head -1 | awk '{print $2}' | tr -d ';')"
  CERT_KEY="$(grep -oE 'ssl_certificate_key[[:space:]]+[^;]+;' "$TARGET_CONF" | head -1 | awk '{print $2}' | tr -d ';')"
  [ -f "${CERT:-/nonexistent}" ] || CERT=""
  [ -f "${CERT_KEY:-/nonexistent}" ] || CERT_KEY=""
  [ -n "$CERT" ] && echo "复用证书：$CERT"
fi

write_server() {
  local listen="$1"
  local ssl_lines="$2"
  cat <<EOF
server {
    listen ${listen};
    server_name ${DOMAIN};
${ssl_lines}
    auth_basic "harness";
    auth_basic_user_file ${HTPASSWD_FILE};

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

    location = /install { proxy_pass http://127.0.0.1:${PORT}; }
    location = /install.ps1 { proxy_pass http://127.0.0.1:${PORT}; }
}
EOF
}

if [ -n "$CERT" ] && [ -n "$CERT_KEY" ]; then
  {
    printf 'server {\n    listen 80;\n    server_name %s;\n    return 301 https://$host$request_uri;\n}\n\n' "$DOMAIN"
    write_server "443 ssl http2" "    ssl_certificate ${CERT};
    ssl_certificate_key ${CERT_KEY};"
  } >"$TARGET_CONF"
else
  write_server "80" "" >"$TARGET_CONF"
fi

"$NGINX_BIN" -t || die "nginx 配置检查失败"
$NGINX_RELOAD || die "nginx reload 失败"
echo "站点已加载：${NGINX_CONF_DIR}/harness.conf"

# ---------- 7 HTTPS / 备份 ----------
say "7/7 HTTPS 与备份"
if [ "$BT" = 1 ]; then
  cat <<EOF
宝塔环境请在面板里开 SSL：
  1. 宝塔面板 → 网站 → 添加站点（域名 ${DOMAIN}，PHP 选「纯静态」）
  2. 站点设置 → SSL → Let's Encrypt → 申请（勾选「强制 HTTPS」）
  ⚠️ 如果刚在面板建了站点，它可能生成同名 conf；用下面的命令把我们的配置指过去：
     cp ${NGINX_CONF_DIR}/harness.conf ${NGINX_CONF_DIR}/${DOMAIN}.conf
     然后宝塔面板里该站点的「配置文件」应包含 auth_basic 与 proxy_pass
EOF
else
  if command -v certbot >/dev/null 2>&1 && [ -n "$EMAIL" ]; then
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect || warn "证书申请失败，稍后手动 certbot --nginx -d $DOMAIN"
  else
    warn "未装 certbot 或没给 EMAIL：先跑 HTTP，之后 certbot --nginx -d $DOMAIN --redirect"
  fi
fi

install -m 755 "$APP_DIR/deploy/backup.sh" /usr/local/bin/harness-backup
mkdir -p "$APP_DIR/backups"
chown "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR/backups"
echo "17 3 * * * root /usr/local/bin/harness-backup ${APP_DIR} >/var/log/harness-backup.log 2>&1" >/etc/cron.d/harness-backup
chmod 644 /etc/cron.d/harness-backup

say "完成"
cat <<EOF
面板:   http${BT:+s}://${DOMAIN}/     用户 ${BASIC_USER}
网关:   http://127.0.0.1:${PORT}
代码:   ${APP_DIR}
日志:   journalctl -u harness-api -f
更新:   cd ${APP_DIR} && git pull && (cd tools/panel && npm run build) && systemctl restart harness-api
EOF
