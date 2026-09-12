# Multica 运维手册

Multica 自托管实例（AI 项目管理）：单 origin `https://work.<YOUR_DOMAIN>`，三容器 `postgres` / `multica-backend` / `multica-frontend`。

手动配置个人 Workspace、Project、Agent、Skills 与 GitHub 集成，见 [单人使用手册](multica-personal-guide.md)。注册策略已配置为禁止所有新账号；GitHub App 变量已接入角色，仓库安装授权通过工作区设置完成。

## 架构

| 容器 | 镜像（固定 tag） | 网络 | 职责 |
|------|----------------|------|------|
| `multica-postgres` | `pgvector/pgvector:0.8.6-pg17-trixie` | `multica_db`（internal） | 元数据 + 附件引用 |
| `multica-backend` | `ghcr.io/multica-ai/multica-backend:v0.4.43` | `proxy_net` + `multica_db` | API / WS / 迁移 / 本地附件 |
| `multica-frontend` | `ghcr.io/multica-ai/multica-web:v0.4.43` | `proxy_net` | Next.js 页面 + 运行时代理 |

- 数据：`/opt/stacks/multica/postgres`（数据库）、`/opt/stacks/multica/uploads`（本地附件，S3 未配置时的存储）
- `.env`（0600，Ansible 渲染，no_log）承载全部 secrets；`compose.yml` 无明文 secrets（`${POSTGRES_PASSWORD:?}` 插值）
- 升级 = 改 `multica_image_tag` → 部署；**迁移是 forward-only**，升级前先备份

## 路由边界（Traefik，同 Host 按 Path 分流）

直达 backend（priority 200）：

| 路径 | 原因 |
|------|------|
| `/api`、`/api/…` | 含 daemon WS `/api/daemon/ws`（web 镜像不能代理 WS 升级） |
| `/uploads/…`、`/v1/…` | 后端静态文件与公开 API |
| `/health`、`/readyz`、`/healthz` | CLI 探活与升级后健康校验（web 代理仅转发 `/health`） |
| `/ws`、`/ws/…` | 浏览器 realtime WS；用 `Path("/ws")`+`PathPrefix("/ws/")`，裸 `PathPrefix("/ws")` 会误匹配 `/wsfoo` 等 workspace slug |
| `/auth/send-code`、`/auth/verify-code`、`/auth/logout`、`/auth/google` | 登录 API（均为 POST） |

其余（全部页面与 `/auth/callback`）走 frontend（priority 50）。`/auth/callback` 是前端页面，不得整段前缀 `/auth/` 直达 backend。

## 登录与注册

- 注册白名单制：`ALLOW_SIGNUP=false`（渲染时 lower 规范化，防 YAML bool `False` 被后端当作开放）+ `ALLOWED_EMAILS`（vault list `vault_multica_allowed_emails`，**可为空** = 关闭所有新注册；已有账号登录不受影响）+ 显式空 `ALLOWED_EMAIL_DOMAINS`。白名单是允许注册的例外；被邀请的新成员也须先入名单。
- 未配置邮件（Resend/SMTP 均空）：验证码打印在 backend 日志：

  ```bash
  docker logs multica-backend 2>&1 | grep "Verification code"
  # [DEV] Verification code for you@example.com: 123456
  ```

- 验证码 10 分钟有效、一次性；`APP_ENV=production` 时 `MULTICA_DEV_VERIFICATION_CODE` 固定码被忽略（未配置）。

## SSH 执行电脑的 CLI 登录回调

`multica` 命令运行在 SSH 远端、浏览器运行在本地电脑时，回调监听器属于 SSH 远端。已保存 self-host URL 后可用 `multica login` 重新登录，无需重置服务地址。

1. 在执行电脑运行 `multica login`，保持该终端等待，记录新输出的回调端口和完整登录链接。
2. 在浏览器所在电脑的本地终端建立 SSH 隧道。以下 `49123` 仅为示例，两处都替换为本次端口，SSH 地址、端口和跳板参数沿用平时连接执行电脑的配置：

   ```bash
   ssh -N -o ExitOnForwardFailure=yes \
     -L 127.0.0.1:49123:127.0.0.1:49123 \
     <USER>@<EXECUTION_HOST>
   ```

3. 打开本次 CLI 输出的完整登录链接，完成网页登录。回调通过隧道抵达远端 CLI；CLI 登录成功后即可关闭隧道。
4. 在执行电脑运行 `multica daemon start` 和 `multica daemon status`，检查运行时与 workspace 接入状态。

每次登录生成新的端口和 state，等待上限为 5 分钟。按 `Ctrl+C` 或超时后旧监听器关闭，旧回调链接不能用于新流程。`--callback-host` 仅适用于浏览器能直接访问执行电脑的地址，会让回调监听器绑定 `0.0.0.0`；SSH 隧道方式保持默认 loopback。

回调监听器不经过 VPS 的 Traefik。共享 HTTPS 入口的 `readTimeout=600s` 限制请求接收阶段，不改变 CLI 的登录等待时间。

## GitHub App 配置

四项值统一保存在加密 Vault，经 role defaults 引用后写入 backend 的 `.env`：

| Vault 变量 | backend 环境变量 |
|---|---|
| `vault_multica_github_app_slug` | `GITHUB_APP_SLUG` |
| `vault_multica_github_app_id` | `GITHUB_APP_ID` |
| `vault_multica_github_webhook_secret` | `GITHUB_WEBHOOK_SECRET` |
| `vault_multica_github_app_private_key` | `GITHUB_APP_PRIVATE_KEY` |

本角色要求四项全空或全部配置，避免误以为 CI/仓库浏览已经启用。PEM 保留真实换行；Webhook secret 的 `$` 在 `.env` 中先转义为 `$$`，再 JSON 双引号引用，Compose 启动容器时还原原值。不要用 `docker compose config` 的转义展示值直接当作容器最终值。

GitHub App 的 Homepage 为本实例入口，Setup URL 为 `/api/github/setup`，Webhook URL 为 `/api/webhooks/github`；OAuth Callback URL 留空，启用 Redirect on update。配置更新后在 **My Lab → Settings → GitHub → Connect GitHub** 安装并授权仓库。服务端配置就绪不等于已经授予仓库权限，是否连接以 installation 状态为准。

应用本角色配置：

```bash
mise exec -- ansible-playbook -i inventory/prod/hosts.yml playbooks/site.yml --limit rnd-vps-01 --tags multica
```

GitHub App 负责 PR/CI 的只读同步；执行电脑上的 Git/gh 负责代码与 PR 操作。`MULTICA_VCS_INTEGRATION_ENABLED` 对应其他自托管 Git 服务，保持 false 不影响 GitHub App。

## 限流事实（v0.4.43 源码）

- **每邮箱验证码冷却**：`/auth/send-code` 每 60 秒最多 1 次（PostgreSQL 实现，未配 Redis 也生效；连续请求返回 429）。
- **公开认证端点 per-IP 限流**依赖 `REDIS_URL`：`/auth/send-code`、`/auth/google` 默认 5 次/min，`/auth/verify-code` 默认 20 次/min。**未配置 Redis 时该层 fail-open（no-op）**，启动日志有 `auth rate limiting disabled` 提示。首期无 Redis，仅有每邮箱冷却兜底。

## 健康检查

```bash
# 升级/重启后用 /readyz (校验 db + migrations)，不用 /health (仅存活)
curl -fsS https://work.<YOUR_DOMAIN>/readyz
# {"status":"ok","checks":{"db":"ok","migrations":"ok"}}
```

backend 容器 healthcheck 即 `/readyz`（启动先跑迁移，start_period 300s）。

## 备份与恢复

见 [backup-restore.md](backup-restore.md)。要点：

```bash
# 逻辑备份 (-Fc 自带压缩, 迁移 forward-only, 升级前必做)
docker exec multica-postgres pg_dump -U multica -d multica -Fc > multica.dump
# 附件
sudo tar czf multica-uploads.tar.gz -C /opt/stacks/multica uploads
```

完整恢复步骤（停容器 → pg_restore --clean → 解压 uploads → up -d → readyz）见 backup-restore.md。数据库与 uploads 需一致时先停 backend 再备份。

## 本次更新验收

2026-09-12：GitHub App 配置已部署，backend 容器四项环境值与 Vault 一致，PEM 完整换行保留；注册开关为 false，两个注册例外名单为空，既有唯一账号可登录。`/readyz` 与登录页返回 200，新邮箱申请验证码返回 403。

GitHub 连接 API 返回 `configured=true`，仓库浏览配置就绪。无效 webhook 签名返回 401，有效签名 ping 返回 200；通过 GitHub 官方 redelivery 重投创建 App 时的 ping，真实请求返回 200。用户已完成安装授权，GitHub installation 已绑定 My Lab；按用户选择授权 bernylinville 的所有仓库，已通过 Multica 的 App 仓库浏览接口实际读取 vps-ansible。授权范围不会自动变成 Project 的资源范围。

第二次定向部署 `ok=7 changed=0 failed=0`，状态收敛。Molecule 七阶段、lint、语法检查和角色配置正负例均通过。

这次环境更新仅重建 Multica backend；Traefik、frontend、PostgreSQL、Sub2API、Vaultwarden 均保持原容器。

## 常见问题

| 症状 | 处置 |
|------|------|
| `/readyz` 非 200 | `docker logs multica-backend`、`docker logs multica-postgres`；迁移失败时不要引流 |
| 收不到验证码 | 未配邮件属预期，从 backend 日志取；60s 冷却内重复请求返回 429 |
| daemon 连不上 | 确认 CLI `--server-url https://work.<YOUR_DOMAIN>`；`/health` 须 200（直达 backend） |
| 附件 404 | 检查 `/opt/stacks/multica/uploads` 挂载与 `docker inspect multica-backend` 的 Mounts |
| 想加注册邮箱 | 编辑 vault `vault_multica_allowed_emails` 后重新部署（`up -d` 重读 .env） |

## GitHub App 集成

四项配置（`vault_multica_github_app_{slug,id}`、`vault_multica_github_webhook_secret`、`vault_multica_github_app_private_key`，PEM 用 YAML `|` 存）经角色渲染为 `GITHUB_*` 环境变量：

- **全空 = 未启用；部分配置会在部署前置断言失败**（避免误以为已启用）；配置时校验 App ID 为数字、slug 合法、私钥为含换行的 PEM 块
- `.env` 渲染：PEM 经 `to_json`（换行转 `\n`，Compose env_file 解码还原）；webhook secret 经 `replace($, $$) | to_json` 防 Compose 插值（容器实际值与原始 `$literal` 一致）
- 不依赖 `MULTICA_VCS_INTEGRATION_ENABLED`（那是 Forgejo/Gitea/GitLab self-host Git 集成，与 GitHub App 无关）
- App 创建时的 webhook ping 若在部署前发出会 503：部署后到 GitHub App 设置页 **Advanced → Recent deliveries → Redeliver** 重投验签

## 与官方 selfhost Compose 的差异

- 镜像固定 tag（官方默认 `latest` 浮动）；bind mount 替代 named volume
- 显式 `MULTICA_VCS_INTEGRATION_ENABLED=false`（官方 selfhost 默认开启）；GitHub App 通过 Vault 配置；Redis/LLM/邮件/云连接等均未配置
- 注册默认空名单（关闭所有新注册），GitHub App 四项 Vault 化（见上节）
- 单 origin + Traefik 分流替代官方 127.0.0.1 端口 + Caddy 双文件方案；`FRONTEND_ORIGIN`/`MULTICA_APP_URL`/`MULTICA_PUBLIC_URL`/`CORS_ALLOWED_ORIGINS` 全部从 `multica_public_origin` 派生，`COOKIE_DOMAIN` 留空（host-only）
