# Cloudflare 前置接入手册

> 目标链路：客户端 → Cloudflare（橙云代理）→ Traefik (443) → sub2api
> 前置条件：域名 DNS 已托管在 Cloudflare（Traefik DNS-01 已在用 CF API Token）

## 一、Cloudflare 控制台操作

> ⚠️ **主机名层级限制（免费版）**：Universal SSL 边缘证书只覆盖 zone 顶域 + **一级**子域
> （如 `example.com`、`*.example.com`）。二级子域（如 `api.rnd.example.com`）开橙云会
> TLS handshake failure，需 ACM（$10/月）或 Total TLS。所以对外域名一律用一级子域。

1. **DNS → 记录点亮橙色云**（Proxy enabled）
   - 至少 `api.<域名>`；`panel.<域名>`（Dashboard）可一并开
   - A 记录继续指向 VPS IP，不需要改
2. **SSL/TLS → Overview → 模式必须选 `Full (strict)`**
   - 源站（Traefik）持有 Let's Encrypt 有效证书（DNS-01 通配符，续期不受橙云影响）
   - ⚠️ 绝对不要选 `Flexible`：CF 会用 HTTP 打源站 80 → Traefik 重定向 443 → 循环重定向
3. WebSocket：默认支持，无需配置
4. （可选）SSL/TLS → Edge Certificates 关闭 Always Use HTTPS 与 API 域名无冲突，保持默认即可

## 二、Traefik 侧（已由 Ansible 完成）

- `traefik_websecure_forwarded_trusted_ips` = Cloudflare 全部网段（IPv4+IPv6）
  - Traefik 信任来自 CF 的 `X-Forwarded-For` → 真实客户端 IP 一路透传到 sub2api 的 usage logs
  - 链路：CF(注入 XFF) → Traefik(信任 CF 段) → sub2api(信任 proxy_net，已配 `SERVER_TRUSTED_PROXIES`)
- 证书：Let's Encrypt DNS-01 通配符继续使用，**无需换 Origin Certificate**

部署：`mise run deploy`（或 `--tags traefik`）

## 三、已知限制（Cloudflare Free 档）

| 限制 | 值 | 影响 |
|------|-----|------|
| 代理读超时 | 100s（不可调，Enterprise 才能改） | 首字节 >100s 报 524；流式响应字节间隔 >100s 断连 |
| 上传体积 | 100MB | 低于 sub2api 的 256MB 上限，文本提示词场景够用 |

**524 风险评估**：sub2api 文本流式 keepalive 默认 10s（`gateway.stream_keepalive_interval`），
流式期间字节间隔远小于 100s，安全；**非流式（`stream:false`）长输出**在整个生成期间无字节下发，
超过 100s 会被 CF 掐断 —— coding agent（Codex/Claude Code）全部走流式，不受影响；
手动 curl 调试时避免对长任务用 `stream:false`。

## 四、可选加固（与"不上防火墙"原则冲突，仅记录）

橙云后源站 IP 仍可被直连绕过 CF。如需收紧：VPS 上仅放行 CF 网段访问 443
（`iptables`/云厂商安全组，IP 列表同 `traefik_websecure_forwarded_trusted_ips`）。
当前按个人使用原则**不做**。

## 五、验证

```bash
# 1. DNS 已走 CF（返回的是 CF 边缘 IP）
dig +short api.<域名>

# 2. HTTPS 正常（经 CF）
curl -Ik https://api.<域名>/health

# 3. 真实 IP 透传：sub2api 后台 usage logs 里应出现你的真实出口 IP 而非 CF/Traefik 内网 IP

# 4. 证书续期不受影响（DNS-01 不依赖 80/443）
```

## 维护事项

- CF 网段偶有变更，更新来源 `https://www.cloudflare.com/ips/`，同步改 `roles/traefik/defaults/main.yml`
