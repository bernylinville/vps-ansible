# 排障手册

## SSH 连接问题

### 无法通过 <YOUR_SSH_PORT> 端口连接

```bash
# 检查 VPS 上 SSH 服务状态
ssh -p 22 root@<YOUR_VPS_IP> "systemctl status sshd"

# 检查防火墙规则
ssh root@<YOUR_VPS_IP> "iptables -L -n | grep <YOUR_SSH_PORT>"

# 检查 SSH 配置
ssh root@<YOUR_VPS_IP> "grep Port /etc/ssh/sshd_config"
```

**解决方案**：
1. 通过控制台/VNC 登录 VPS
2. 检查 `/etc/ssh/sshd_config` 中 Port 配置
3. 检查 UFW/iptables 是否放行 <YOUR_SSH_PORT>
4. 重启 SSH 服务：`systemctl restart sshd`

### SSH 密钥认证失败

```bash
# 本地检查密钥权限
ls -la ~/.ssh/id_<YOUR_USER>
# 应为 600

# 检查远程 authorized_keys
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "cat ~/.ssh/authorized_keys"
```

## Ansible 部署问题

### Vault 解密失败

```bash
# 检查 vault 密码文件
ansible-vault view inventory/prod/group_vars/vps/vault.yml

# 重新加密
ansible-vault encrypt inventory/prod/group_vars/vps/vault.yml
```

### Playbook 执行失败

```bash
# 增加详细输出
ansible-playbook -i inventory/prod/hosts.yml playbooks/site.yml -vvv

# 仅运行特定标签
ansible-playbook -i inventory/prod/hosts.yml playbooks/site.yml --tags docker

# 从特定任务开始
ansible-playbook -i inventory/prod/hosts.yml playbooks/site.yml --start-at-task "Create Traefik stack directories"
```

## Docker 问题

### 容器无法启动

```bash
# 查看容器日志
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "docker logs traefik"
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "docker logs vaultwarden"

# 检查 Compose 配置
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "docker compose -f /opt/stacks/traefik/compose.yml config"
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "docker compose -f /opt/stacks/vaultwarden/compose.yml config"
```

### 网络连接问题

```bash
# 检查网络
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "docker network ls"
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "docker network inspect proxy_net"

# 测试容器间连通性
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "docker exec traefik ping -c 3 vaultwarden"
```

## Traefik 问题

### HTTPS 证书获取失败

```bash
# 检查 Traefik 日志
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "docker logs traefik"

# 检查 Cloudflare API Token 权限
# Token 需要 Zone:DNS:Edit 权限

# 检查 DNS 解析
dig <YOUR_DOMAIN>
dig +short <YOUR_DOMAIN>
```

**常见原因**：
1. Cloudflare API Token 权限不足
2. DNS 记录未指向 VPS IP
3. 端口 80/443 被防火墙阻止
4. ACME 速率限制

### 路由不生效

```bash
# 检查 Traefik Dashboard (需配置后访问)
# 查看路由配置
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "docker exec traefik wget -qO- http://127.0.0.1:8080/api/http/routers"

# 检查服务健康状态
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "docker exec traefik wget -qO- http://127.0.0.1:8080/api/http/services"
```

## Vaultwarden 问题

### 无法访问管理后台

```bash
# 检查 Admin Token 配置
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "docker exec vaultwarden env | grep ADMIN"

# 访问管理后台
# https://<YOUR_DOMAIN>/admin
```

### 数据丢失

**恢复步骤**：
1. 停止 Vaultwarden 容器
2. 从备份恢复 `/opt/stacks/vaultwarden/data`
3. 重启容器

```bash
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "docker stop vaultwarden"
# 恢复数据...
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "docker start vaultwarden"
```

## 证书续期问题

### Let's Encrypt 证书过期

```bash
# 强制续期
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "docker restart traefik"

# 检查证书状态
openssl s_client -connect <YOUR_DOMAIN>:443 -servername <YOUR_DOMAIN> < /dev/null 2>/dev/null | openssl x509 -noout -dates
```

## 性能问题

### VPS 资源不足

```bash
# 检查资源使用
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "df -h"
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "free -h"
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "docker system df"

# 清理 Docker
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "docker system prune -f"
```

## 紧急恢复

### 完全重置

```bash
# 停止所有容器
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "docker stop $(docker ps -q)"

# 删除所有容器
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "docker rm $(docker ps -aq)"

# 重新运行 Playbook
ansible-playbook -i inventory/prod/hosts.yml playbooks/site.yml
```

### 回滚到上一个版本

```bash
# 回滚 Git 到上一个提交
git log --oneline
git checkout <commit-hash>

# 重新部署
ansible-playbook -i inventory/prod/hosts.yml playbooks/site.yml
```
