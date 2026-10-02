# 备份与恢复手册

## 备份策略

### 自动备份 (推荐)

配置 cron 定期备份关键数据：

```bash
# 在 VPS 上创建备份脚本
sudo tee /usr/local/bin/backup-vps.sh << 'EOF'
#!/bin/bash
set -euo pipefail
umask 077
BACKUP_DIR="/backup/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

# 备份 Vaultwarden 数据
tar czf "$BACKUP_DIR/vaultwarden-data.tar.gz" -C /opt/stacks/vaultwarden data

# 备份 Sub2API (PostgreSQL 用 pg_dump 逻辑备份，避免直接 tar 运行中的数据目录)
docker exec sub2api-postgres pg_dump -U sub2api -d sub2api -Fc \
  > "$BACKUP_DIR/sub2api-postgres.dump"
tar czf "$BACKUP_DIR/sub2api-data.tar.gz" -C /opt/stacks/sub2api data

# 备份 Cumora (一致性要求时先停 server，保留数据库运行)
docker exec cumora-postgres pg_dump -U cumora -d cumora -Fc \
  > "$BACKUP_DIR/cumora-postgres.dump"
tar czf "$BACKUP_DIR/cumora-uploads.tar.gz" -C /opt/stacks/cumora uploads
# Multica 容器已卸载；旧数据保留在 /opt/stacks/multica，不再对旧容器执行 pg_dump。

# 备份 Traefik 证书
tar czf "$BACKUP_DIR/traefik-certs.tar.gz" -C /opt/stacks/traefik letsencrypt

# 归档运行配置 (包含明文 .env，须作为敏感备份加密保存；不是加密 Ansible inventory)
# 运行中的数据库目录副本不能代替上面的 pg_dump。
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

# 备份 Cumora (一致性要求时先停 server；归档相对路径 uploads/ 与恢复目录对应)
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "docker exec cumora-postgres pg_dump -U cumora -d cumora -Fc" > cumora-db-$(date +%Y%m%d).dump
ssh -p <YOUR_SSH_PORT> <YOUR_USER>@<YOUR_VPS_IP> "sudo tar czf - -C /opt/stacks/cumora uploads" > cumora-uploads-$(date +%Y%m%d).tar.gz

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

### 恢复 Cumora

前置：选择与备份 schema 兼容的镜像 digest；镜像回退不会撤销已经执行的数据库迁移。保留原 Vault 密钥，暂停自动部署，保存当前数据库备份。以下恢复会覆盖目标库中的备份同名对象和数据；不要在数据库仍有业务写入时执行。

约定：单个备份文件已上传到 VPS 的 `/tmp/cumora-restore.dump` 与 `/tmp/cumora-uploads-restore.tar.gz`。不要用通配符匹配多份备份。以下命令在 VPS 上执行：

```bash
# 1. 停应用，保留 PostgreSQL/Redis 运行
cd /opt/stacks/cumora
docker compose -f compose.yml stop server

# 2. 确认 PostgreSQL 就绪并恢复；失败时停止，不要启动 server
docker exec cumora-postgres pg_isready -U cumora -d cumora
docker exec -i cumora-postgres pg_restore -U cumora -d cumora \
  --clean --if-exists --exit-on-error < /tmp/cumora-restore.dump

# 3. 检查可信归档只包含 uploads/，保留旧附件后恢复
tar tzf /tmp/cumora-uploads-restore.tar.gz
sudo mv uploads uploads.bak-$(date +%Y%m%d%H%M%S)
sudo mkdir -m 0700 uploads
sudo tar xzf /tmp/cumora-uploads-restore.tar.gz -C /opt/stacks/cumora

# 4. 使下次 Ansible 部署重新校验并运行候选镜像迁移
sudo rm -f /opt/stacks/cumora/.migrated-image
```

确认 Ansible 中的镜像 digest 与恢复方案一致，再执行 Cumora 部署。部署后从允许的代理出口请求 `GET https://work.<YOUR_DOMAIN>/api/health`，预期 `200` 且 JSON `ok: true`；保留证书校验，并验证登录和附件。确认恢复成功后再清理本次生成的旧附件目录，勿用通配符批量删除历史备份。

已卸载的 Multica 仅保留旧数据；如需恢复，先停止 Cumora，按 [Multica 手册](multica.md) 恢复，避免同域名路由冲突。

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
ansible-galaxy install -r requirements.yml

# 配置 Vault 密码
echo "your-vault-password" > .vault-password

# 运行 Playbook
ansible-playbook -i inventory/prod/hosts.yml playbooks/site.yml
```

4. **恢复数据备份**
5. **验证服务状态**
