# 备份与恢复手册

## 备份策略

### 自动备份 (推荐)

配置 cron 定期备份关键数据：

```bash
# 在 VPS 上创建备份脚本
sudo tee /usr/local/bin/backup-vps.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/backup/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

# 备份 Vaultwarden 数据
tar czf "$BACKUP_DIR/vaultwarden-data.tar.gz" -C /opt/stacks/vaultwarden data

# 备份 Sub2API (PostgreSQL 用 pg_dump 逻辑备份，避免直接 tar 运行中的数据目录)
docker exec sub2api-postgres pg_dump -U sub2api -d sub2api -Fc \
  > "$BACKUP_DIR/sub2api-postgres.dump"
tar czf "$BACKUP_DIR/sub2api-data.tar.gz" -C /opt/stacks/sub2api data

# 备份 Traefik 证书
tar czf "$BACKUP_DIR/traefik-certs.tar.gz" -C /opt/stacks/traefik letsencrypt

# 备份 Ansible 库存 (加密状态)
cp -r /opt/stacks "$BACKUP_DIR/"

echo "Backup completed: $BACKUP_DIR"
EOF

chmod +x /usr/local/bin/backup-vps.sh

# 配置每日备份 cron
echo "0 3 * * * /usr/local/bin/backup-vps.sh >> /var/log/vps-backup.log 2>&1" | sudo crontab -
```

### 手动备份

```bash
# 备份 Vaultwarden
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "sudo tar czf - /opt/stacks/vaultwarden/data" > vaultwarden-backup-$(date +%Y%m%d).tar.gz

# 备份 Sub2API (PostgreSQL 逻辑备份 + 应用数据)
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "docker exec sub2api-postgres pg_dump -U sub2api -d sub2api -Fc" > sub2api-db-$(date +%Y%m%d).dump
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "sudo tar czf - /opt/stacks/sub2api/data" > sub2api-data-$(date +%Y%m%d).tar.gz

# 备份 Traefik 证书
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "sudo tar czf - /opt/stacks/traefik/letsencrypt" > traefik-certs-backup-$(date +%Y%m%d).tar.gz
```

## 恢复流程

### 恢复 Vaultwarden

```bash
# 1. 停止 Vaultwarden
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "docker stop vaultwarden"

# 2. 恢复数据
scp -P <YOUR_SSH_PORT> vaultwarden-backup-*.tar.gz <YOUR_USER>@<YOUR_VPS_IP>:/tmp/
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "sudo rm -rf /opt/stacks/vaultwarden/data && sudo tar xzf /tmp/vaultwarden-backup-*.tar.gz -C /"

# 3. 重启服务
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "docker start vaultwarden"
```

### 恢复 Traefik 证书

```bash
# 1. 停止 Traefik
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "docker stop traefik"

# 2. 恢复证书
scp -P <YOUR_SSH_PORT> traefik-certs-backup-*.tar.gz <YOUR_USER>@<YOUR_VPS_IP>:/tmp/
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "sudo rm -rf /opt/stacks/traefik/letsencrypt && sudo tar xzf /tmp/traefik-certs-backup-*.tar.gz -C /"

# 3. 重启服务
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "docker start traefik"
```

## 灾难恢复

### 完全重建 VPS

1. **重新安装 Debian 13**
2. **配置 SSH 密钥访问**
3. **克隆仓库并运行 Playbook**

```bash
git clone git@github.com:bernylinville/vps-ansible.git
cd vps-ansible
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
ansible-galaxy collection install -r collections/requirements.yml

# 配置 Vault 密码
echo "your-vault-password" > .vault-password

# 运行 Playbook
ansible-playbook -i inventory/prod/hosts.yml playbooks/site.yml
```

4. **恢复数据备份**
5. **验证服务状态**
