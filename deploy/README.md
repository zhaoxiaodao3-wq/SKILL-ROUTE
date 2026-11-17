# 部署到服务器

一台 Linux（Ubuntu/Debian/CentOS 都行）跑三样东西：nginx（TLS + 登录）、网关（Node）、面板（静态文件）。

## 前置

1. 域名已解析到服务器 IP，例如 `harness.example.com`
2. 服务器上有 **Node ≥ 20**、**nginx**、**git**、**openssl**
3. 80 端口可访问（申请证书用）

## 一条命令

```bash
git clone https://github.com/zhaoxiaodao3-wq/SKILL-ROUTE.git /tmp/harness-skills
cd /tmp/harness-skills

sudo DOMAIN=harness.example.com \
     BASIC_PASS='换成你的密码' \
     GIT_TOKEN=ghp_xxxxxxxx \
     EMAIL=you@example.com \
     bash deploy/install.sh
```

它会依次做：建服务用户 → clone/pull 代码 → 构建面板 → 装 systemd 服务 → 配 nginx + Basic Auth → 申请证书 → 加每日备份。

跑完打开 `https://harness.example.com/`，用 `harness / 你的密码` 登录。

## 关于 GIT_TOKEN

面板点「保存」时，网关要在服务器上 `git commit && git push`。

- **给了 `GIT_TOKEN`**：保存 = 提交 + 推到 GitHub
- **没给**：保存只做本地 commit（服务以 `--no-push` 启动），你回本地 `git pull` 再推

更安全的做法是给仓库配一个 **Deploy Key**（只读+写这一仓），把私钥放到 `~/.ssh/`，再把 remote 换成 SSH：

```bash
sudo -u harness ssh-keygen -t ed25519 -N '' -f /srv/harness/.ssh/id_ed25519
sudo cat /srv/harness/.ssh/id_ed25519.pub     # 贴到 GitHub 仓库 Settings → Deploy keys（勾选 Allow write）
sudo -u harness git -C /srv/harness remote set-url origin git@github.com:zhaoxiaodao3-wq/SKILL-ROUTE.git
```

## 日常

```bash
journalctl -u harness-api -f          # 网关日志
systemctl restart harness-api         # 重启网关
cd /srv/harness && git pull && cd tools/panel && npm run build && systemctl restart harness-api   # 更新
git -C /srv/harness log --oneline -5  # 最近改动
```

回滚：`git -C /srv/harness revert <sha>`，或从 `backups/harness-*.bundle` 恢复。

## 文件

| 文件 | 作用 |
|---|---|
| `install.sh` | 一键部署（幂等，可重复跑） |
| `backup.sh` | 每天把仓库打成 git bundle，保留 14 份 |
