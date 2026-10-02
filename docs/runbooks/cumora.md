# Cumora 运维手册

Cumora 使用自有 fork `bernylinville/cumora` 构建的 GHCR 镜像。单个 server 容器同时提供 SPA、API、uploads 和 WebSocket；Traefik 通过 `https://work.<YOUR_DOMAIN>` 暴露服务。PostgreSQL 18.6 / pgvector 0.8.6 是持久化边界，Redis 7.2.16 不持久化。

## 从本机源码构建迁移到 GHCR

原 `/srv/docker/cumora/docker-compose.yml` 使用 `./src` 作为构建上下文，Dockerfile 为 `server/docker/cumora-server.Dockerfile`。当前源码基线为 `d0dbf160be6533535cf482cc9e6e9f96eb957c3f`。Dockerfile 分阶段安装运行依赖、编译 React SPA、安装 kubectl，最后运行 `npm run server:start`。迁移使用同一镜像执行 `npm run migrate`。

新的发布链路：

1. 在源码 fork 提交 PR，运行 typecheck 和实际 Docker build。
2. CI 通过后合并到 fork 的 `main`，由 GitHub Actions 发布 `ghcr.io/bernylinville/cumora-server`。
3. 首次发布后确认 GHCR package 为 Public，执行匿名 pull 验证。不要将本机 GitHub token 复制到 VPS。
4. 将 workflow summary 中的不可变 `@sha256:...` 引用写入 `roles/cumora/defaults/main.yml` 的 `cumora_image`。Molecule 直接复用该默认值，不单独配置正常测试镜像。
5. 在基础设施仓库运行 lint、语法检查、Molecule 和生产 check，通过 PR 合并到 `main`。`main` 的 CI 成功后触发部署 workflow，检出该次 CI 的 `head_sha`。自动部署取得并发锁后、准备 SSH 和生产凭据前，确认该 SHA 仍是远端 `main` 的最新提交；不一致或查询失败时中止，不改为检出未经 CI 验证的新提交。检查通过后，使用生产 inventory 真正运行 Playbook（不带 `--check`）。功能分支 / PR 只跑 CI，不连接 VPS；手动部署入口仍仅允许 `main`。

VPS 不编译源码。镜像不包含 `.env`；运行配置由 Ansible 渲染，真实凭据只存放在加密 Vault 和 VPS 上权限 `0600` 的 `.env`。

## GitHub OAuth 和首个管理员

GitHub 的公开 API 和 `gh` 不支持直接注册 OAuth App。注册需要在 GitHub 网页完成；注册后的运行变量由 Ansible 管理。

1. 在 <https://github.com/settings/applications/new> 创建 OAuth App。
2. 将 Homepage URL 设置为 `https://work.<YOUR_DOMAIN>`。
3. 将 Authorization callback URL 设置为 `https://work.<YOUR_DOMAIN>/api/auth/callback/github`。
4. 生成 Client Secret，把 Client ID / Secret 写入加密 Vault 的 `vault_cumora_github_client_id` / `vault_cumora_github_client_secret`。不要把它们写入普通 inventory、提交明文文件或贴到日志中。
5. 在 `vault_cumora_admin_emails` 中填写账号由 GitHub OAuth 返回的已验证邮箱。Cumora 默认将非管理员的新账号送入 waitlist；管理员白名单账号可直接完成首次登录。

OAuth App 与原 Multica GitHub App 不是同一种配置。不要使用 App ID、webhook secret 或 PEM 替代 OAuth Client ID / Secret。

本次部署采用 BYOA，`OPENAI_API_KEY` 使用非空占位值满足上游启动检查，不提供直接调用 OpenAI 的云端 LLM 能力。Kubernetes 云端 agent Pods 不在 Compose 部署范围内。

## IP 白名单

`vault_cumora_allowed_ips` 存储允许的公网出口 IP / CIDR。生产白名单来自本机 Mihomo 的两个代理节点，使用 `/32` 地址。使用代理访问时，应用看到的是代理出口 IP，不是本机 LAN IP。节点地址或出口变化后必须更新 Vault 并重新部署；IPv6 出口须另行声明，否则拒绝访问。

Cumora router 在所有路径上串联两层 `IPAllowList`：

1. `cumora-edge` 按 TCP 连接来源校验 Cloudflare 网段，拒绝直连 VPS 源站。
2. `cumora-clients` 使用 Cloudflare `X-Forwarded-For` 最右端 IP（`depth: 1`），校验用户白名单。

Traefik 的 `forwardedHeaders.trustedIPs` 仅信任已有 Cloudflare 网段。不要配置 `insecure=true`，也不要直接信任客户端自报的 `CF-Connecting-IP`。Cloudflare 网段发生变化时，更新 Traefik role 中的可信网段；Cumora 自动复用该配置。其他服务的 router 不使用这两层 middleware。

拒绝请求返回 `403`，包括登录入口、API、uploads 和 WebSocket。浏览器发起 GitHub OAuth，GitHub 将浏览器重定向回 Cumora；GitHub 本身不需要加入访问白名单。BYOA 设备同样必须通过允许的出口连接。

## 部署与迁移

角色先等待数据库和 Redis 健康，然后使用候选镜像运行一次迁移。只有成功才写 `.migrated-image` 标记并启动 server；迁移失败会中止，保留已运行的旧 server，重试仍会执行迁移。配置、镜像或依赖容器变化时也会重新迁移。server 启动只校验 schema，不执行 DDL。

配置变更或写入失败时，角色在依赖操作前使匹配候选镜像的旧标记失效；依赖变更或准备失败（包括健康等待超时）也会使该标记失效。配置与依赖阶段的 `always` 清理不接管原始错误，失败仍会中止部署。不同镜像的旧成功标记保留；同镜像失败后，即使原参数重试时配置和依赖均未变化，也必须重新迁移。check mode 不删除标记，无变化的成功部署仍保持幂等。

`app_settings.waitlist_enabled` 在数据库中管理，不是环境变量。角色在服务上线前写入声明的策略；默认 `cumora_waitlist_enabled: true`。对已创建的用户，此策略不会撤销访问权限。

```bash
mise run lint
ansible-playbook -i inventory/prod/hosts.yml playbooks/site.yml --syntax-check
mise run test-cumora
ANSIBLE_RUN_TAGS=cumora mise run check
```

check mode 不执行迁移或数据库写入。首次 check 不落盘配置，跳过需要文件的 Compose 校验；真实部署后可完整检查编排。涉及敏感配置的任务禁止 diff 输出。

## 验证

Molecule 使用独立的本机 Docker 网络、容器名和 `/tmp/vps-ansible-cumora-molecule`，不读取生产 Vault。场景覆盖首次 check、真实数据库迁移、幂等、API/SPA/OAuth 入口、真实 Traefik IP 允许/拒绝和伪造头、持久化、迁移失败不替换旧服务、失败后重试。迁移前失败回归还覆盖配置未变时 Docker 不可达、`.env` 已写入后 Compose 渲染失败，以及依赖健康等待超时后原参数重试。超时夹具只临时禁用隔离 Redis 容器中的健康检查程序，并在 `always` 中恢复，不修改生产配置。

create 和 verify 使用 `import_role` 公开 Cumora 默认值，并以 `when: false` 跳过角色任务，避免在这两个阶段意外部署。默认值保留 role defaults 优先级，不覆盖测试 inventory 的目录、容器名和网络配置；verify 中用于失败保护的任务级镜像覆盖仍然生效。

部署后检查 `cumora-server`、`cumora-postgres`、`cumora-redis` 容器健康状态，确认数据库和 Redis 未接入 `proxy_net`，所有容器没有宿主端口映射。

从允许的代理出口对真实域名执行 `GET /api/health`，预期 `200` 且 JSON `ok: true`；根路径预期返回 SPA；`GET /api/auth/providers` 应包含 `github`。保留 TLS 证书校验。从非白名单出口访问相同路径应得到 `403`；直连源站即使伪造转发头也应被拒绝。实际 OAuth 登录需要用自己的账号完成浏览器授权，不能用仅验证 `302` 代替完整登录验收。

## 持久化与回退

- `/opt/stacks/cumora/postgres` 挂载 `/var/lib/postgresql`；PG18 的 PGDATA 是其 `18/docker` 子目录。父目录模式 `0711` 允许 postgres 用户遍历；PGDATA 本身仍为 `0700`，宿主 stack 目录为 `0700`。
- `/opt/stacks/cumora/uploads` 挂载 `/app/server/uploads`。
- 升级前备份 PostgreSQL 和 uploads。镜像回退不等于数据库回退；迁移不可逆或 schema 不兼容时，必须恢复升级前数据库备份，不能只改回镜像。
- Multica 的旧数据保留在 `/opt/stacks/multica`。恢复它之前先停止 Cumora，再恢复原 role 入口和启用条件，避免同域名路由冲突；独立卸载命令见 [Multica 手册](multica.md)。
