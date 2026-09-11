# AGENTS.md — Agent 开发指南

> 本文件指导 AI agent (Claude, Copilot 等) 如何理解和维护 vps-ansible 项目。

## 项目概述

这是一个 Ansible-first 的 VPS 基础设施管理仓库，采用 GitOps 模式管理单台 VPS。

核心原则：
- **Configuration over Creation**：优先复用成熟角色，自定义角色处理胶水逻辑
- **安全优先**：所有敏感数据通过 Ansible Vault 加密，绝不提交明文密码
- **声明式管理**：所有基础设施状态通过 YAML 声明，版本控制可审计

## 关键文档

| 文档 | 何时阅读 |
|------|---------|
| [docs/architecture.md](docs/architecture.md) | 理解系统架构、网络拓扑、部署流程 |
| [docs/troubleshooting.md](docs/troubleshooting.md) | 故障诊断、常见问题排查 |
| [docs/runbooks/backup-restore.md](docs/runbooks/backup-restore.md) | 数据备份与恢复操作 |
| [README.md](README.md) | 快速开始、项目结构、使用方式 |

## 目录结构与职责

```
vps-ansible/
├── inventory/prod/             # 生产环境库存
│   ├── hosts.yml               # 主机定义
│   ├── group_vars/             # 组变量
│   │   ├── all.yml             # 全局变量
│   │   └── vps/                # VPS 组变量
│   │       ├── main.yml        # 非敏感变量
│   │       ├── vault.yml       # 加密敏感变量 (Ansible Vault)
│   │       └── vault.example.yml  # 变量示例模板
│   └── host_vars/              # 主机级变量
│       └── <host-name>/        # 单主机覆盖
├── playbooks/
│   └── site.yml                # 主入口 Playbook
├── roles/                      # 自定义角色
│   ├── docker_custom/          # Docker 共享网络
│   ├── traefik/                # Traefik 反向代理
│   └── vaultwarden/            # Vaultwarden 密码库
├── requirements.yml            # Ansible 集合依赖
├── requirements.txt            # Python 依赖
├── ansible.cfg                 # Ansible 配置
├── mise.toml                   # mise 开发环境配置
├── .github/workflows/          # GitHub Actions CI/CD
│   ├── ci.yml                  # 持续集成 (lint + syntax)
│   └── deploy.yml              # 生产部署
└── docs/                       # 项目文档
    ├── architecture.md         # 架构文档
    ├── troubleshooting.md      # 排障手册
    ├── adr/                    # 架构决策记录
    └── runbooks/               # 运维手册
```

## 开发规范

### 新增服务

1. 在 `roles/<name>/` 创建角色目录结构
2. 编写 `defaults/main.yml` 定义默认变量
3. 编写 `tasks/main.yml` 实现部署逻辑
4. 编写 `templates/` 中的模板文件
5. 在 `playbooks/site.yml` 中引入角色
6. 在 `inventory/prod/group_vars/vps/main.yml` 添加变量
7. 更新 `docs/architecture.md` 和 `README.md`

### 修改现有组件

- **角色变量变更**：修改 `roles/<role>/defaults/main.yml`
- **组变量变更**：修改 `inventory/prod/group_vars/vps/main.yml`
- **主机级覆盖**：修改 `inventory/prod/host_vars/<host-name>/main.yml`
- **Playbook 变更**：修改 `playbooks/site.yml`

### Git 提交规范

```
feat: add <component>           # 新增组件
fix: <issue description>        # 修复问题
docs: update <doc name>         # 文档更新
refactor: <change description>  # 重构
chore: <maintenance task>       # 维护任务
```

## 关键约束

### 安全红线

1. **绝不提交明文密码**：所有敏感数据必须存放在 `vault.yml` 中并使用 Ansible Vault 加密
2. **SSH 密钥不进入仓库**：通过 GitHub Actions Secrets 注入
3. **Vault 密码文件在 .gitignore 中**：`.vault-password` 和 `.sudo-password` 不得提交

### 部署流程

1. 本地修改后先运行 `mise run lint`
2. 执行 `mise run check` 进行 Dry Run
3. 提交 PR，CI 通过后方可合并
4. 合并到 main 后通过 GitHub Actions 自动部署到生产环境

### 环境限制

- 单台 VPS (Debian 13)，资源有限
- SSH 端口 <YOUR_SSH_PORT>（非标准 22）
- 所有服务通过 Docker Compose 部署
- 外部访问通过 Traefik 443 HTTPS
- 本地开发使用 mise + uv 管理 Python 环境和依赖

## 验证清单

每次变更后建议验证：

```bash
# 1. 静态检查
mise run lint

# 2. 语法检查
ansible-playbook -i inventory/prod/hosts.yml playbooks/site.yml --syntax-check

# 3. Dry Run
mise run check

# 4. 服务健康检查
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "docker ps"
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "docker network ls"

# 5. HTTPS 端点验证
curl -Ik https://<YOUR_DOMAIN>/alive
curl -Ik https://<YOUR_DOMAIN>
```

## 常用命令

```bash
# 安装 mise 管理的工具（Python 3.13.12 + uv）
mise install

# 安装所有依赖（Python + Ansible 角色/集合）
mise run deps

# 运行 Playbook
mise run deploy

# 带标签运行
ansible-playbook -i inventory/prod/hosts.yml playbooks/site.yml --tags docker
ansible-playbook -i inventory/prod/hosts.yml playbooks/site.yml --tags traefik
ansible-playbook -i inventory/prod/hosts.yml playbooks/site.yml --tags vaultwarden

# 静态检查
mise run lint

# Dry Run
mise run check

# 运行测试
mise run test

# 加密/解密 Vault 文件
mise run vault-encrypt
mise run vault-decrypt
mise run vault-edit
```
