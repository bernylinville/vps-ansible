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

部署并发组使用 `queue: max` 和 `cancel-in-progress: false`，串行执行并保留最多 100 个等待中的 run，避免晚到的旧 CI 取消已等待的新提交部署。队列满时新增 run 会被 GitHub 取消；取得锁后的 SHA 检查仍用于拒绝过期自动部署。队列行为以 [GitHub 官方并发文档](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency) 为准。

VPS 不编译源码。镜像不包含 `.env`；运行配置由 Ansible 渲染，真实凭据只存放在加密 Vault 和 VPS 上权限 `0600` 的 `.env`。

## GitHub OAuth 和首个管理员

GitHub 的公开 API 和 `gh` 不支持直接注册 OAuth App。注册需要在 GitHub 网页完成；注册后的运行变量由 Ansible 管理。

1. 在 <https://github.com/settings/applications/new> 创建 OAuth App。
2. 将 Homepage URL 设置为 `https://work.<YOUR_DOMAIN>`。
3. 将 Authorization callback URL 设置为 `https://work.<YOUR_DOMAIN>/api/auth/callback/github`。
4. 生成 Client Secret，把 Client ID / Secret 写入加密 Vault 的 `vault_cumora_github_client_id` / `vault_cumora_github_client_secret`。不要把它们写入普通 inventory、提交明文文件或贴到日志中。
5. 在 `vault_cumora_admin_emails` 中填写账号由 GitHub OAuth 返回的已验证主邮箱，不要用 GitHub 公开资料邮箱代替，两者可能不同。本仓库显式启用 waitlist，非管理员新用户进入候补名单；管理员邮箱匹配时可以直接完成首次登录。上游默认的 `waitlist_enabled` 为 `false`，不是上游强制禁止注册。

若管理员误入 waitlist，修正加密 Vault 中的邮箱并部署后，从站点根地址重新发起 GitHub 登录；不要只刷新带 `waitlist` 参数的旧回调页。已有候补记录不会阻止匹配的管理员创建账号，无须手工创建 OAuth 身份或关闭 waitlist。移除环境变量中的邮箱不会自动撤销已存在账号的管理员权限；撤权应在管理界面完成。

OAuth App 与原 Multica GitHub App 不是同一种配置。不要使用 App ID、webhook secret 或 PEM 替代 OAuth Client ID / Secret。

本次部署采用 BYOA，`OPENAI_API_KEY` 使用非空占位值满足上游启动检查，不提供直接调用 OpenAI 的云端 LLM 能力。Kubernetes 云端 agent Pods 不在 Compose 部署范围内。

## 公网访问与源站保护

客户端 IP 白名单已移除。任何公网出口都可以通过 `https://work.<YOUR_DOMAIN>` 访问，不再要求浏览器或 BYOA 设备使用指定代理。注册 waitlist 和管理员邮箱是独立的应用层策略，本次保持不变。

`cumora-edge` 仍按 TCP 连接来源校验 Cloudflare 网段，拒绝绕过 Cloudflare 直连 VPS 源站；这不是最终客户端 IP 白名单。Traefik 的 `forwardedHeaders.trustedIPs` 仍仅信任已有 Cloudflare 网段。不要配置 `insecure=true`，也不要直接信任客户端自报的 `CF-Connecting-IP`。Cloudflare 网段变化时，更新 Traefik role 中的可信网段；Cumora 自动复用该配置。

公网可达不等于免登录：受保护 API 仍要求有效会话，未认证请求如 `/api/auth/me` 返回 `401`。但上游的登录入口、部分公开 API 和本地 uploads 附件链接允许匿名读取；知道附件 URL 的人也可能访问附件。本部署不修改 Cumora 业务源码，不能把 GitHub OAuth 或 waitlist 当作所有路径的统一鉴权。

`cumora-no-store` 位于源站保护 middleware 之前，继续将所有响应覆盖为 `Cache-Control: private, no-store`，包括附件、前端静态资源、API、跳转和拒绝响应。它用于避免缓存副本，不代替登录校验或访问授权。

Cloudflare 必须遵守源站的 `private, no-store`：不得为 Cumora 主机名配置忽略这些指令的 Edge Cache TTL、Cache Rules 或 Worker 缓存逻辑。参见 [Cloudflare 默认缓存行为](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)。若已有历史边缘缓存，必须另行清理；新增响应头不能删除已经缓存的副本。

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

Molecule 使用独立的本机 Docker 网络、容器名和 `/tmp/vps-ansible-cumora-molecule`，不读取生产 Vault。场景覆盖首次 check、真实数据库迁移、幂等、API/SPA/OAuth 入口、任意客户端 IP 经 Cloudflare 访问、直连源站与伪造头拒绝、持久化、迁移失败不替换旧服务、失败后重试。迁移前失败回归还覆盖配置未变时 Docker 不可达、`.env` 已写入后 Compose 渲染失败，以及依赖健康等待超时后原参数重试。超时夹具只临时禁用隔离 Redis 容器中的健康检查程序，并在 `always` 中恢复，不修改生产配置。

create 和 verify 使用 `import_role` 公开 Cumora 默认值，并以 `when: false` 跳过角色任务，避免在这两个阶段意外部署。默认值保留 role defaults 优先级，不覆盖测试 inventory 的目录、容器名和网络配置；verify 中用于失败保护的任务级镜像覆盖仍然生效。

缓存回归在隔离 uploads 卷创建 PNG 附件，经真实 Traefik 检查附件字节、静态 JS、GET/HEAD/范围请求/条件请求及 `private, no-store`；不同 IPv4、IPv6 和空 XFF 不再限制域名访问，非 Cloudflare 直连源站即使伪造转发头也被拒绝。本机场景不连接 Cloudflare，边缘缓存清理和缓存规则须在实际部署时另行核对。

注册回归使用隔离数据库和虚构的已验证 OAuth profile，调用上游 `findOrCreateUserByProfile`：已在候补名单中的匹配管理员可以创建管理员账号及工作区，其他新用户仍进入 waitlist。测试不连接真实 GitHub，不使用生产凭据，也不能代替用户本人完成 OAuth 授权。

`actionlint 1.7.12` 尚不识别 GitHub 已支持的 `concurrency.queue` 键，可能仅对此报告 `unknown key`。这是该版本的有限兼容性问题，不应据此删除 `queue: max` 或忽略其他诊断；使用支持该字段的版本后再复核此项。

部署后检查 `cumora-server`、`cumora-postgres`、`cumora-redis` 容器健康状态，确认数据库和 Redis 未接入 `proxy_net`，所有容器没有宿主端口映射。

从普通公网出口对真实域名执行 `GET /api/health`，预期 `200` 且 JSON `ok: true`；根路径返回 SPA；`GET /api/auth/providers` 包含 `github`；未登录访问 `/api/auth/me` 返回 `401`。保留 TLS 证书校验，确认原来不在客户端白名单中的出口也可正常访问；直连源站即使伪造转发头仍应被拒绝。实际 OAuth 登录需要用自己的账号完成浏览器授权，不能用仅验证 `302` 代替完整登录验收。

## 持久化与回退

- `/opt/stacks/cumora/postgres` 挂载 `/var/lib/postgresql`；PG18 的 PGDATA 是其 `18/docker` 子目录。父目录模式 `0711` 允许 postgres 用户遍历；PGDATA 本身仍为 `0700`，宿主 stack 目录为 `0700`。
- `/opt/stacks/cumora/uploads` 挂载 `/app/server/uploads`。
- 升级前备份 PostgreSQL 和 uploads。镜像回退不等于数据库回退；迁移不可逆或 schema 不兼容时，必须恢复升级前数据库备份，不能只改回镜像。
- Multica 的旧数据保留在 `/opt/stacks/multica`。恢复它之前先停止 Cumora，再恢复原 role 入口和启用条件，避免同域名路由冲突；独立卸载命令见 [Multica 手册](multica.md)。
