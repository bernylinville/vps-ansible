# 架构决策记录

## ADR-001: 选择 Traefik 作为反向代理

**状态**：已接受

**日期**：2026-04-22

**背景**：
需要为 VPS 上的服务提供 HTTPS 访问和自动证书管理，支持通配符域名 `*.<YOUR_DOMAIN>`。

**决策**：
使用 Traefik v3 作为反向代理。

**原因**：
- 原生支持 Docker 标签自动发现服务
- 内置 Let's Encrypt ACME 客户端，自动续期
- 支持 DNS-01 Challenge，适合 wildcard 证书
- 配置简单，无需维护额外的配置文件
- 活跃社区和良好文档

**替代方案**：
- Nginx + Certbot：需要手动配置和证书续期脚本
- Caddy：自动 HTTPS，但 wildcard 需要 DNS 插件
- Cloudflare Tunnel：零信任接入，但增加控制平面复杂度

**后果**：
- 正向：简化配置管理，自动证书处理
- 负向：需要 Cloudflare API Token，依赖外部 DNS

---

## ADR-002: 选择 Ansible Vault 管理敏感数据

**状态**：已接受

**日期**：2026-04-22

**背景**：
仓库托管在 GitHub 上，需要安全地管理密码、API Token 等敏感数据。

**决策**：
使用 Ansible Vault 加密敏感变量文件。

**原因**：
- 与 Ansible 原生集成，无需额外工具
- CI/CD 流程中通过密码文件解密，操作简单
- 支持文件级加密粒度
- 成熟稳定，社区广泛采用

**替代方案**：
- SOPS + age：更现代，但需要额外安装 sops
- GitHub Secrets：不适合大量变量和版本控制
- HashiCorp Vault：过重，单台 VPS 场景不适用

**后果**：
- 正向：简单集成，Git 可审计
- 负向：需要安全分发 Vault 密码

---

## ADR-003: 选择 Docker Compose 而非 Kubernetes

**状态**：已接受

**日期**：2026-04-22

**背景**：
单台 VPS 资源有限，需要轻量级的容器编排方案。

**决策**：
使用 Docker Compose 部署所有服务。

**原因**：
- 单节点场景下 Compose 足够简单
- 无 K8s 控制平面开销
- 易于理解和维护
- 与 Traefik Docker Provider 配合良好
- 适合个人/小型项目

**替代方案**：
- Kubernetes (k3s)：引入不必要的复杂度
- Podman：生态不如 Docker 成熟
- 裸机部署：失去容器化优势

**后果**：
- 正向：简单、轻量、易维护
- 负向：无内置高可用，单点故障

---

## ADR-004: 选择 GitHub Actions 作为 CI/CD

**状态**：已接受

**日期**：2026-04-22

**背景**：
需要自动化部署流程，确保代码质量，简化运维操作。

**决策**：
使用 GitHub Actions 实现 CI/CD。

**原因**：
- 与 GitHub 原生集成
- 免费额度足够个人项目使用
- 丰富的 Actions 生态
- 支持环境保护和审批流程

**替代方案**：
- GitLab CI：需要迁移仓库
- Jenkins：需要额外维护服务器
- 本地脚本：缺乏可审计性和协作

**后果**：
- 正向：自动化、可审计、协作友好
- 负向：依赖 GitHub 服务可用性

---

## ADR-005: 选择 Cloudflare DNS-01 而非 HTTP-01

**状态**：已接受

**日期**：2026-04-22

**背景**：
需要为 `<YOUR_DOMAIN>` 和 `*.<YOUR_DOMAIN>` 获取 Let's Encrypt 证书。

**决策**：
使用 DNS-01 Challenge 通过 Cloudflare API 验证域名所有权。

**原因**：
- 支持通配符证书 (`*.<YOUR_DOMAIN>`)
- 无需暴露 HTTP 端口 80 到公网
- 适合未来添加子域名服务
- 自动化程度高

**替代方案**：
- HTTP-01：不支持 wildcard，需要暴露 80 端口
- TLS-ALPN-01：不支持 wildcard，需要直接暴露 443

**后果**：
- 正向：wildcard 支持，安全
- 负向：需要 Cloudflare API Token，依赖 Cloudflare

---

## ADR-006: 项目目录结构

**状态**：已接受

**日期**：2026-04-22

**背景**：
需要设计清晰、可维护的项目结构。

**决策**：
采用 Ansible-first 布局：

```
vps-ansible/
├── inventory/          # 环境库存
├── playbooks/          # 入口 Playbook
├── roles/              # 自定义角色
├── collections/        # 集合依赖
├── docs/               # 文档
└── .github/workflows/  # CI/CD
```

**原因**：
- 符合 Ansible 社区最佳实践
- 清晰分离配置、代码和文档
- 易于扩展和维护
- 参考 ansible-gitops、nas-gitops 等成熟项目

**后果**：
- 正向：结构清晰，社区熟悉
- 负向：需要遵循约定，灵活性略降
