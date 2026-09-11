# vps-ansible

基于 Ansible 的 VPS GitOps 基础设施管理，采用 "Configuration over Creation" 原则。

## 项目概述

本项目用于管理个人 VPS 主机 (<YOUR_VPS_IP>)，通过声明式、可审计的方式自动化部署和维护基础设施与服务。

### 核心能力

- **安全基线**：SSH 加固、防火墙配置、自动安全更新
- **容器平台**：Docker Engine + Docker Compose 插件安装
- **反向代理**：Traefik v3 提供自动化 HTTPS (Let's Encrypt DNS-01 Challenge)
- **密码管理**：Vaultwarden 1.35.7 自托管密码库
- **AI API 网关**：Sub2API 0.2.4 (PostgreSQL + Redis)，Traefik 自动 HTTPS
- **GitOps Ready**：GitHub Actions 自动部署，Ansible Vault 保护敏感数据

## 快速开始

### 前置依赖

- [mise](https://mise.jdx.dev/) - 开发环境管理器
- [uv](https://docs.astral.sh/uv/) - Python 包管理器
- 具备访问目标主机的 SSH Key (`~/.ssh/id_<YOUR_USER>`)
- Ansible Vault 密码（用于加密 `inventory/**/vault.yml`）

### 安装

```bash
# 克隆仓库
git clone git@github.com:bernylinville/vps-ansible.git
cd vps-ansible

# 安装 Python 和创建虚拟环境（mise 自动处理）
mise install

# 安装所有依赖（Python + Ansible 集合）
mise run deps
```

### 配置

```bash
# 准备 Vault 密码文件（本地开发）
echo "your-vault-password" > .vault-password
chmod 600 .vault-password

# 准备 Sudo 密码文件
echo "your-sudo-password" > .sudo-password
chmod 600 .sudo-password
```

### 使用

```bash
# 所有命令通过 mise 自动激活虚拟环境
cd vps-ansible

# 静态检查
mise run lint

# Dry Run（检查模式）
mise run check

# 实际执行
mise run deploy

# 运行 Molecule 测试
mise run test

# 编辑 Vault 文件
mise run vault-edit
```

## 项目结构

```text
.
├── inventory/prod/           # 生产环境库存
│   ├── hosts.yml             # 主机定义
│   ├── group_vars/           # 组变量
│   │   ├── all.yml           # 全局变量
│   │   └── vps/              # VPS 组变量
│   │       ├── main.yml      # 非敏感变量
│   │       └── vault.yml     # 加密敏感变量 (Ansible Vault)
│   └── host_vars/            # 主机级变量
│       └── <host-name>/      # 单主机覆盖
├── playbooks/
│   └── site.yml              # 主入口 Playbook
├── roles/
│   ├── docker/               # Docker Engine 安装 (Debian 13)
│   ├── security/             # SSH 加固 + fail2ban + 自动更新 (Debian 13)
│   ├── ntp/                  # NTP 时间同步 (Debian 13)
│   ├── docker_custom/        # Docker 共享网络
│   ├── traefik/              # Traefik 反向代理
│   ├── sub2api/              # Sub2API AI API 网关 (PostgreSQL + Redis)
│   └── vaultwarden/          # Vaultwarden 密码库
├── requirements.yml          # Ansible 集合依赖
├── requirements.txt          # Python 依赖
├── ansible.cfg               # Ansible 配置
└── docs/                     # 项目文档
```

## 本地 Roles

本项目所有 roles 均为本地开发，针对 Debian 13 优化，无第三方 role 依赖：

| Role | 说明 |
|------|------|
| `docker` | 从官方 Docker 仓库安装 Docker Engine，支持自定义 daemon 配置 |
| `security` | SSH 加固、fail2ban 入侵检测、无人值守安全更新 |
| `ntp` | ntpsec 时间同步服务，使用 Debian 13 默认的 ntpsec 替代 ntpd |
| `docker_custom` | 创建共享 Docker 网络 `proxy_net`，供多个服务共用 |
| `traefik` | Traefik v3 反向代理，支持 HTTPS (Let's Encrypt DNS-01)，带 Basic Auth 保护的 Dashboard |
| `sub2api` | Sub2API AI API 网关，三容器接入 proxy_net，数据库/缓存不暴露端口，密钥全部 Vault 管理 |
| `vaultwarden` | Vaultwarden 密码管理器，禁用公开注册，通过 Admin Token 管理 |

**注意**：已移除所有第三方 roles (`geerlingguy.*`)，所有基础功能现在由本地 roles 实现，避免仓库污染。

## 技术栈

- Ansible 13.6.0
- Docker & Docker Compose
- Traefik v3.6.10
- Vaultwarden 1.35.7
- Sub2API 0.2.4 + PostgreSQL 18.6 + Redis 8.10
- Let's Encrypt (Cloudflare DNS-01)
- mise (Python 3.13.12 版本管理)
- uv (Python 包管理)
- Molecule + Docker (测试框架，使用 Debian 13 容器)

## 许可证

保留全部权利。
