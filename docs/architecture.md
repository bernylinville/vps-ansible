# 架构文档

## 系统架构

vps-ansible 采用 Ansible-first 的声明式基础设施管理，通过 GitOps 模式自动化部署和维护单台 VPS。

### 架构概览

```
GitHub Repo (vps-ansible)
    │
    ├── GitHub Actions CI (PR / main push：lint + syntax-check + Cumora Molecule)
    │
    └── GitHub Actions Deploy (main CI 成功 / main 手动触发)
            │
            └── SSH (port <YOUR_SSH_PORT>) → VPS (<YOUR_VPS_IP>)
                    │
                    ├── security (SSH 加固)
                    ├── ntp (时间同步)
                    ├── docker (Docker Engine)
                    ├── docker_custom (proxy_net 网络)
                    ├── traefik (443 HTTPS 反向代理)
                    ├── sub2api (AI API 网关)
                    ├── cumora (AI 团队协作；自有 GHCR 镜像)
                    └── vaultwarden (密码库服务)
```

### 网络拓扑

```
Internet
    │
    ▼
443 HTTPS ──→ Traefik (Docker)
                │
                ├── vault.<YOUR_DOMAIN> → Vaultwarden
                ├── api.<YOUR_DOMAIN> → Sub2API (AI API 网关)
                ├── work.<YOUR_DOMAIN> → Cumora (同源 SPA/API/WebSocket，IP 白名单)
                ├── panel.<YOUR_DOMAIN> → Traefik Dashboard (Basic Auth 保护)
                └── *.<YOUR_DOMAIN> → (未来服务)
                │
                └── proxy_net (10.203.57.0/24)
                        ├── Traefik (网关)
                        ├── Sub2API (后端 + PostgreSQL + Redis，不暴露端口)
                        ├── Cumora (server；PostgreSQL + Redis 仅接入专用 internal 网络)
                        └── Vaultwarden (后端)
```

### 组件职责

| 组件 | 角色 | 职责 |
|------|------|------|
| security | Local Role | SSH 加固、防火墙、Fail2ban、自动更新 |
| docker | Local Role | Docker Engine + Compose 插件安装 |
| ntp | Local Role | NTP 时间同步（Debian 13 ntpsec） |
| docker_custom | Custom Role | 创建共享 Docker 网络 proxy_net |
| traefik | Custom Role | 反向代理、自动 HTTPS、路由发现 |
| sub2api | Custom Role | AI API 网关（Sub2API + PostgreSQL + Redis） |
| cumora | Custom Role | AI 团队协作（GHCR 单镜像 + pgvector PostgreSQL 18 + Redis），GitHub OAuth 与 IP 白名单 |
| vaultwarden | Custom Role | 密码库服务部署 |

### 证书管理

- **提供商**：Let's Encrypt
- **验证方式**：DNS-01 Challenge (Cloudflare)
- **通配符支持**：`<YOUR_DOMAIN>` + `*.<YOUR_DOMAIN>`
- **存储**：`/opt/stacks/traefik/letsencrypt/acme.json`

### 数据持久化

| 服务 | 数据路径 | 备份优先级 |
|------|---------|-----------|
| Vaultwarden | `/opt/stacks/vaultwarden/data` | 高 |
| Sub2API | `/opt/stacks/sub2api/{data,postgres,redis}` | 高 |
| Cumora | `/opt/stacks/cumora/{postgres,uploads}` | 高 |
| Multica（已卸载） | `/opt/stacks/multica/{postgres,uploads}`（仅保留旧数据） | 回退保留 |
| Traefik ACME | `/opt/stacks/traefik/letsencrypt/acme.json` | 中 |

### 安全模型

1. **传输层**：所有外部访问通过 HTTPS (TLS 1.3)
2. **主机层**：SSH 密钥认证、非标准端口、Fail2ban
3. **容器层**：Docker 网络隔离、最小权限原则
4. **密钥层**：Ansible Vault 加密、GitHub Secrets 管理
5. **Cumora 入口**：先校验连接来源属于 Cloudflare，再以 X-Forwarded-For 最右端 IP 校验用户白名单；Traefik 只信任 Cloudflare 网段的转发头，阻断直连源站和伪造头

## 部署流程

### 初始化部署 (Wave 0)

1. 准备 VPS：Debian 13 基础系统
2. 配置 SSH 密钥访问
3. 克隆仓库到本地/CI
4. 配置 Ansible Vault 密码
5. 加密敏感变量文件

### 基础设施层 (Wave 1)

1. **安全基线**：`security`
   - 修改 SSH 端口为 <YOUR_SSH_PORT>
   - 禁用密码认证和 root 登录
   - 配置 Fail2ban
   - 启用自动安全更新

2. **时间同步**：`ntp`
   - 配置 Asia/Shanghai 时区
   - 使用 ntpsec（Debian 13 默认）
   - 同步 Cloudflare/Google NTP

3. **容器平台**：`docker`
   - 从官方仓库安装 Docker CE
   - 安装 Docker Compose 插件
   - 将 <YOUR_USER> 用户加入 docker 组

4. **共享网络**：`docker_custom`
   - 创建 proxy_net (10.203.57.0/24)
   - 所有服务容器加入此网络

### 服务层 (Wave 2)

1. **反向代理**：`traefik`
   - 部署 Traefik v3.6.2
   - 配置 Cloudflare DNS-01 Challenge
   - 暴露 80/443 端口
   - 自动发现 Docker 容器路由

2. **密码库**：`vaultwarden`
   - 部署 Vaultwarden 1.37.2
   - 配置 Traefik 标签实现 HTTPS 路由
   - 禁用公开注册 (`signups_allowed: false`)
   - 启用 WebSocket 支持
   - **Admin 面板**：`https://vault.<YOUR_DOMAIN>/admin`
     - 通过 `vault_vaultwarden_admin_token` 访问
     - 用于手动创建用户账户

3. **AI API 网关**：`sub2api`
   - 部署 Sub2API 0.2.4 (weishaw/sub2api) + PostgreSQL 18.6 + Redis 8.10
   - 三个容器全部接入 proxy_net，数据库/缓存不暴露任何端口
   - 通过 Traefik 标签路由：`https://api.<YOUR_DOMAIN>`
   - 固定 JWT_SECRET / TOTP_ENCRYPTION_KEY / 数据库密码，Ansible Vault 管理
   - 数据持久化：`/opt/stacks/sub2api/{data,postgres,redis}`

4. **AI 团队协作**：`cumora`
   - 源码 fork：`bernylinville/cumora`；GitHub Actions 使用上游 Dockerfile 构建前端 + API 镜像，发布 `ghcr.io/bernylinville/cumora-server`；Ansible 固定 digest，不在 VPS 构建源码
   - 单 origin `https://work.<YOUR_DOMAIN>`：页面、`/api/`、`/runtime/`、uploads 与 WebSocket 统一走 server 的 5181 端口
   - PostgreSQL 18.6 / pgvector 0.8.6 与 Redis 7.2.16 仅接专用 internal 网络；只有 server 接 proxy_net，所有容器均不发布宿主端口
   - 先启动数据库和 Redis，用候选镜像执行一次 `npm run migrate`；成功后记录镜像并启动 server，失败不替换旧 server；应用启动仅校验 schema
   - GitHub OAuth 凭据、PostgreSQL 密码、runtime 签名密钥、管理员邮箱及 IP 白名单由 Vault 管理；非管理员新用户进入 waitlist
   - 仅提供 Compose 服务和 BYOA 接入，不提供依赖 Kubernetes 的云端 agent Pods；默认无云端 LLM 凭据
   - 数据持久化：`/opt/stacks/cumora/{postgres,uploads}`；PG18 挂载 `/var/lib/postgresql` 父目录，Redis 不持久化
   - Multica 已卸载，`site.yml` 中的 role 入口注释禁用；旧配置和数据保留用于回退，原 `work` 域名改由 Cumora 使用

## GitOps 工作流

```
Developer
    │
    ├── 本地修改代码
    ├── ansible-lint / yamllint
    ├── ansible-playbook --check --diff
    │
    └── git push → Pull Request
            │
            └── GitHub Actions CI
                    ├── yamllint
                    ├── ansible-lint
                    ├── syntax-check
                    └── Cumora Molecule (真实 Compose、迁移、持久化、Traefik IP 白名单)
                    │
                    └── ✅ Pass → Merge to main
                            │
                            └── main CI 成功 → GitHub Actions Deploy (检出 CI 的 head_sha)
                                    ├── 安装 Ansible
                                    ├── 配置 SSH 密钥
                                    ├── 解密 Vault
                                    │
                                    └── ansible-playbook site.yml
                                            │
                                            └── VPS (<YOUR_VPS_IP>)
```

## 决策记录

### ADR-001: 选择 Traefik 而非 Nginx

**状态**：已接受

**背景**：需要为 VPS 上的多个服务提供 HTTPS 访问和自动证书管理。

**决策**：使用 Traefik v3 作为反向代理。

**原因**：
- 原生支持 Docker 标签自动发现
- 内置 Let's Encrypt ACME 客户端
- 支持 DNS-01 Challenge（适合 wildcard 证书）
- 配置简单，无需额外维护配置文件

**替代方案**：
- Nginx + Certbot：需要手动配置和证书续期脚本
- Caddy：自动 HTTPS 但 wildcard 需要 DNS 插件支持

### ADR-002: 选择 Ansible Vault 而非 SOPS

**状态**：已接受

**背景**：需要加密仓库中的敏感数据。

**决策**：使用 Ansible Vault 加密敏感变量。

**原因**：
- 与 Ansible 原生集成，无需额外工具
- CI/CD 中通过密码文件解密，流程简单
- 支持 per-file 加密粒度

**替代方案**：
- SOPS + age：更现代但需要额外安装 sops
- GitHub Secrets：不适合大量变量和版本控制

### ADR-003: 选择 Docker Compose 而非 K8s

**状态**：已接受

**背景**：单台 VPS 资源有限，需要轻量级容器编排。

**决策**：使用 Docker Compose 部署所有服务。

**原因**：
- 单节点场景下 Compose 足够简单
- 无需 K8s 控制平面开销
- 易于理解和维护
- 与 Traefik Docker Provider 配合良好

## 已知限制

1. **单点故障**：单台 VPS，无高可用
2. **证书续期**：依赖 Traefik 自动续期，需监控
3. **备份策略**：当前为手动备份，需配置自动化
4. **资源限制**：VPS 资源有限，服务数量受限

## 未来扩展

- [ ] 添加监控栈 (Prometheus + Grafana)
- [ ] 配置自动化备份 (Restic)
- [ ] 添加更多自托管服务
- [ ] 考虑 Cloudflare Tunnel 作为备用访问路径
