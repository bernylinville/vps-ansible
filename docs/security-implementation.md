---
# 安全实施记录

## 安全设计原则

1. **绝不提交明文密码**：所有敏感数据通过 Ansible Vault 加密
2. **最小权限原则**：服务以最小必要权限运行
3. **分层防御**：主机层 + 网络层 + 应用层多重防护
4. **可审计性**：所有变更通过 Git 版本控制

## 敏感数据清单

| 数据类型 | 存储位置 | 加密方式 | 访问控制 |
|---------|---------|---------|---------|
| sudo 密码 | `inventory/prod/group_vars/vps/vault.yml` | Ansible Vault | Vault 密码 |
| Cloudflare API Token | `inventory/prod/group_vars/vps/vault.yml` | Ansible Vault | Vault 密码 |
| Vaultwarden Admin Token | `inventory/prod/group_vars/vps/vault.yml` | Ansible Vault | Vault 密码 |
| SSH 私钥 | GitHub Secrets | GitHub 加密 | Actions 工作流 |
| Vault 密码 | `.vault-password` (本地) / GitHub Secrets (CI) | 文件系统权限 | 600 |

## 加密实施步骤

### 1. 初始化 Vault 密码文件

```bash
# 本地开发
echo "your-secure-vault-password" > .vault-password
chmod 600 .vault-password
```

### 2. 准备敏感变量

复制示例文件并填入真实值：

```bash
cp inventory/prod/group_vars/vps/vault.example.yml inventory/prod/group_vars/vps/vault.yml
```

编辑 `vault.yml`，填入真实值：

```yaml
vault_vps_host_ip: "YOUR_VPS_IP"
vault_domain_name: "your-domain.com"
vault_ansible_become_password: "YOUR_SUDO_PASSWORD"
vault_traefik_cloudflare_dns_api_token: "your-cloudflare-dns-api-token"
vault_vaultwarden_admin_token: "$(openssl rand -base64 48)"
```

### 3. 加密 Vault 文件

```bash
ansible-vault encrypt inventory/prod/group_vars/vps/vault.yml
```

验证加密：

```bash
ansible-vault view inventory/prod/group_vars/vps/vault.yml
```

### 4. GitHub Secrets 配置

在仓库 Settings → Secrets and variables → Actions 中配置：

| Secret Name | Value | 说明 |
|------------|-------|------|
| `ANSIBLE_SSH_KEY` | SSH 私钥内容 | `~/.ssh/id_<YOUR_USER>` 的完整内容 |
| `ANSIBLE_VAULT_PASSWORD` | Vault 密码 | 解密 vault.yml 的密码 |
| `ANSIBLE_SUDO_PASSWORD` | sudo 密码 | 你的 sudo 密码 |

## SSH 安全配置

### 主机层面

- **端口**：<YOUR_SSH_PORT>（非标准端口）
- **认证**：仅密钥认证，禁用密码认证
- **Root**：禁止 root 直接登录
- **Fail2ban**：自动封禁暴力破解尝试

### 客户端配置建议

在 `~/.ssh/config` 中添加：

```
Host rnd-vps
    HostName <YOUR_VPS_IP>
    Port <YOUR_SSH_PORT>
    User <YOUR_USER>
    IdentityFile ~/.ssh/id_<YOUR_USER>
    IdentitiesOnly yes
```

## 网络安全

### 防火墙规则

由 `security` 角色自动管理：

- 允许 <YOUR_SSH_PORT>/TCP (SSH)
- 允许 80/TCP (HTTP → HTTPS 重定向)
- 允许 443/TCP (HTTPS)
- 默认拒绝其他入站连接

### Docker 网络隔离

- `proxy_net` (10.203.57.0/24)：服务间通信
- 容器间通过名称解析，不暴露额外端口
- Traefik 是唯一暴露 80/443 的服务

## 证书安全

### Let's Encrypt

- **验证方式**：DNS-01 Challenge（不暴露 HTTP 端口）
- **提供商**：Cloudflare
- **Token 权限**：仅 Zone:DNS:Edit
- **存储**：`/opt/stacks/traefik/letsencrypt/acme.json` (权限 600)

### 证书监控

```bash
# 检查证书过期时间
openssl s_client -connect <YOUR_DOMAIN>:443 -servername <YOUR_DOMAIN> < /dev/null 2>/dev/null | openssl x509 -noout -dates
```

## 数据保护

### Vaultwarden

- **Admin Token**：48 字节随机字符串
- **注册**：默认禁用公开注册
- **数据目录**：`/opt/stacks/vaultwarden/data` (权限 700)
- **备份**：定期备份数据目录

### 备份加密

建议对备份文件进行加密：

```bash
# 加密备份
tar czf - /opt/stacks/vaultwarden/data | gpg --symmetric --cipher-algo AES256 > vaultwarden-backup-$(date +%Y%m%d).tar.gz.gpg

# 解密恢复
gpg --decrypt vaultwarden-backup-*.tar.gz.gpg | tar xzf -
```

## 安全审计清单

- [ ] vault.yml 已加密且未提交明文版本
- [ ] .gitignore 包含 .vault-password、.sudo-password、*.pem
- [ ] GitHub Secrets 已配置 ANSIBLE_SSH_KEY、ANSIBLE_VAULT_PASSWORD、ANSIBLE_SUDO_PASSWORD
- [ ] SSH 密钥未提交到仓库
- [ ] Cloudflare API Token 权限最小化 (Zone:DNS:Edit)
- [ ] Vaultwarden Admin Token 为强随机字符串
- [ ] 仓库设置为 Private
- [ ] Branch protection 已启用（main 分支需 PR）

## Vaultwarden 管理

### Admin 面板访问

Vaultwarden 禁用公开注册后，通过 Admin 面板创建用户：

1. 访问 `https://vault.<YOUR_DOMAIN>/admin`
2. 输入 Admin Token（原始 token 或 Argon2 hash 均可登录）
3. 在 **Users** 页面点击 **Invite User**
4. 输入邮箱地址创建用户

### Admin Token 安全加固 (Argon2)

Vaultwarden 推荐使用 Argon2 PHC 格式的 hash 而非明文 token。

**生成 Argon2 Hash：**

```bash
# 在 VPS 上执行
docker exec -it vaultwarden /vaultwarden hash
# 输入你的原始 admin token
# 复制输出的 $argon2id$... 字符串
```

**更新配置：**

```bash
# 编辑 vault.yml
ansible-vault edit inventory/prod/group_vars/vps/vault.yml

# 将 vault_vaultwarden_admin_token 替换为 Argon2 hash
vault_vaultwarden_admin_token: "$argon2id$v=19$m=65536,t=3,p=4$..."

# 重新部署
mise run deploy
```

**注意：**
- 登录时仍使用**原始 token**（非 hash 值）
- Hash 仅用于 Vaultwarden 内部验证，防止明文泄露
- 详见官方文档：https://github.com/dani-garcia/vaultwarden/wiki/Enabling-admin-page#using-argon2

### Admin Token 查看

```bash
# 查看当前 Token/Hash
ansible-vault view inventory/prod/group_vars/vps/vault.yml | grep vault_vaultwarden_admin_token
```

### 重置 Admin Token

```bash
# 生成新 Token
openssl rand -base64 48

# 生成 Argon2 hash（在 VPS 上执行）
docker exec -it vaultwarden /vaultwarden hash

# 编辑 vault.yml 更新
ansible-vault edit inventory/prod/group_vars/vps/vault.yml

# 重新部署
mise run deploy
```

## 应急响应

### 密钥泄露

1. 立即轮换相关密钥
2. 更新 vault.yml 并重新加密
3. 更新 GitHub Secrets
4. 重新部署

### Vault 密码泄露

1. 生成新 Vault 密码
2. 解密所有 vault 文件
3. 重新加密
4. 更新 GitHub Secrets

## 参考

- [Ansible Vault 文档](https://docs.ansible.com/ansible/latest/vault_guide/index.html)
- [Cloudflare API Token 管理](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
- [Vaultwarden 安全最佳实践](https://github.com/dani-garcia/vaultwarden/wiki)
