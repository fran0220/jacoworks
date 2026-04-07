# Gateway — Go 管理网关

> gateway (jingao :8847) 作为桌面端/后台管控面，保留 LLM 配置下发、memory/skills/feedback/games/feishu 等能力。oc-gateway (local :18700) 现为 **webchat 完整后端**：认证、会话 CRUD、cron、SPA 托管，以及 Pi VM 管理、Pi WS Wrapper relay、teams/cowork。

## 代码结构

```
cmd/gateway/main.go            入口 (桌面端/后台管控面: 认证 + 会话 CRUD + 管理 API + WS 代理)
cmd/oc-gateway/main.go         入口 (webchat 完整后端: /login + /chat + /static/* + auth/session/cron + Pi relay 路由)
data/chat.html                 webchat SPA 模板 (注入 __GATEWAY_URL__ / __AUTH_TOKEN__ / __PI_TOKEN__ 等, 不含 Mapbox)
data/login.html                独立登录页 (POST /api/auth/login, 写入 auth_token Cookie)
internal/
  config/config.go             YAML + env override, ChatAgentConfig, GitHubConfig, PostHogConfig, VM/relay 配置
  middleware/middleware.go      RequestID + RequestLog + PanicRecovery 中间件
  auth/{middleware,handlers}.go Goth 飞书 SSO + bcrypt + 激活码
  auth/feishu/                 Goth Feishu Provider
  store/                       PostgreSQL (pgx/v5)
    {pg,users,sessions,containers,invites,settings,memory,skills,games,cron}.go
    providers.go               LLM providers + models CRUD (llm_providers, llm_models 表)
    bot_config.go              容器级配置管理 (config JSONB + hash 追踪 + 配对状态)
  proxy/handler.go             ReverseProxy (ChatAgent 代理)
  cowork/handler.go            文件操作 (upload/download/changes)
  agent/types.go               EventCallback 类型定义
  agent/ws_handler.go          Pi WS relay (ticket auth → container lookup → 直连 VM `pi-ws-wrapper` → Pi JSONL / 兼容帧翻译)
  agent/ws_ticket.go           WS ticket 签发/验证 (HMAC-SHA256, 30s TTL, 桌面端/飞书 Bot 用)
  pi/
    manager.go                 管理 VM 内 `pi-ws-wrapper` 与 Pi 运行目录
    translator.go              Pi JSONL ↔ webchat 兼容帧翻译
    config.go                  写入 `pi-config/` 到 VM
  github/client.go             GitHub API 客户端 (Issue 创建 + 图片上传到 feedback-assets 分支)
  docker/                      vm-agent Docker 容器管理 (Docker Go SDK + SSH 传输, oracle ARM64)
    client.go                  Docker SDK 客户端 (SSH dial-stdio 传输, 容器 CRUD, 记忆/技能推拉)
    freezer.go                 两级空闲策略 (pause → stop, 可配前缀)
    adapter.go                 BackendAdapter (兼容层)
  exec/handler.go               WebSocket exec handler (Docker 容器内执行命令, 30s/120s 超时)
  feishubot/{client,handler}.go  飞书 Bot webhook + 消息路由到容器
  games/handler.go             游戏画廊 API (tar.gz 部署 + 静态文件)
  audit/logger.go
```

## API 端点

> 以下表格保留历史全量路由，标注“已迁移至 oc-gateway”的端点由 local :18700 提供。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/login` | 独立登录页 (oc-gateway 提供, webchat 独立部署入口) |
| GET | `/chat` | webchat SPA 页面 (需认证, 模板注入 token/配置变量) |
| GET | `/static/*` | webchat 静态文件服务 (chat.js / assets / 模型资源) |
| POST | `/api/auth/login` | 用户名/密码登录 (oc-gateway 独立提供, username 支持用户名或邮箱) |
| POST | `/api/auth/activate` | 激活码注册 (oc-gateway 独立提供) |
| GET | `/api/auth/feishu[/callback]` | 飞书 SSO |
| POST | `/api/auth/logout` | 登出 (oc-gateway 独立提供) |
| GET | `/api/users/me` | 当前用户 (oc-gateway 独立提供) |
| GET | `/api/agent/config` | 下发 LLM 配置 (proxy_url + proxy_key + 模型列表) |
| GET/POST/PUT/DELETE | `/api/sessions[/{id}]` | 会话 CRUD (oc-gateway 独立提供, title/messages/model/workspace_path) |
| POST | `/v1/chat/completions` | ChatAgent HTTP 代理 |
| GET | `/api/cowork/container-status` | 容器状态（已迁移至 oc-gateway） |
| POST | `/api/cowork/provision` | 自助分配 Pi CLI VM（已迁移至 oc-gateway） |
| POST | `/api/agent/ws-ticket` | 桌面端 WS ticket 签发 (30s TTL, ticket auth 替代 Bearer) |
| GET | `/ws/oc` | Pi WS Wrapper relay (ticket auth → VM :18789 → Pi JSONL / OpenClaw-like 帧翻译；已迁移至 oc-gateway) |
| GET | `/ws/exec` | WebSocket exec (容器内执行命令, 需认证) |
| POST | `/api/cowork/{sid}/upload` | 上传项目（已迁移至 oc-gateway） |
| POST | `/api/memory/sync` | 记忆双向同步 (manifest + push/pull) |
| GET | `/api/memory/stats` | 用户记忆统计 |
| DELETE | `/api/memory` | 清空用户全部记忆 |
| GET | `/api/skills` | 技能列表 (system + user SkillSummary[], 从 DB frontmatter 解析) |
| PUT | `/api/skills/{skillId}` | 创建/更新用户技能 (DB upsert + 容器热推送) |
| DELETE | `/api/skills/{skillId}` | 删除用户技能 (DB 删除 + 容器热推送) |
| POST | `/api/skills/upload` | (旧) 技能上传 (system/user, push-skills.sh 使用) |
| GET | `/api/skills/checksum` | (旧) 技能校验和 (system + user) |
| GET | `/api/skills/pull` | (旧) 拉取 system 技能列表 (ETag 缓存) |
| POST | `/api/games/deploy` | 游戏部署 (tar.gz + metadata) |
| GET | `/api/games` | 游戏列表 (公开) |
| DELETE | `/api/games/{id}` | 删除游戏 (作者或管理员) |
| POST | `/api/feedback` | 提交桌面端反馈并同步 GitHub Issue (支持最多 3 张截图) |
| POST | `/api/feishu/webhook` | 飞书 Bot webhook (无需认证, 通过 HTTP 代理到 oc-gateway) |
| POST | `/api/cron/jobs` | 创建云端定时任务 (oc-gateway 独立提供) |
| GET | `/api/cron/jobs` | 列出用户的定时任务 (oc-gateway 独立提供) |
| DELETE | `/api/cron/jobs/{id}` | 删除定时任务 (oc-gateway 独立提供) |
| POST | `/api/cron/jobs/{id}/run` | 手动触发定时任务 (stub) |
| GET | `/api/cron/jobs/{id}/history` | 查看执行历史 (stub) |
| POST | `/api/cron/announce` | 接收 Pi cron-proxy 定时任务执行结果 → 飞书通知 |
| GET | `/api/teams` | 用户可用团队 (installed + available 模板列表，已迁移至 oc-gateway) |
| POST | `/api/teams/install` | 用户自助安装参考团队模板到自己的 Pi VM（已迁移至 oc-gateway） |
| GET | `/api/admin/containers` | 列出所有容器 (管理员) |
| POST | `/api/admin/containers/{id}/start` | 启动容器 (管理员) |
| POST | `/api/admin/containers/{id}/stop` | 停止容器 (管理员) |
| GET | `/api/admin/settings` | 读取系统设置 (LLM 密钥等) |
| PUT | `/api/admin/settings` | 更新系统设置 + 热重载内存配置 |
| POST | `/api/admin/containers/{id}/restart` | 重启容器 (stop + start) |
| POST | `/api/admin/provision` | 管理员分配容器/VM |
| POST | `/api/admin/invite-codes` | 创建激活码 |
| GET | `/api/admin/invite-codes` | 列出激活码 |
| GET | `/api/admin/logs` | 查询日志 |
| GET | `/api/admin/templates` | 列出可用团队模板 (读取 `openclaw/templates/`，迁移参考) |
| POST | `/api/admin/containers/{id}/install-template` | 安装参考模板到 VM (迁移中，生成 Pi 团队配置) |
| GET | `/health` | 健康检查 |

## 双网关职责对比

| 维度 | gateway (jingao) | oc-gateway (local) |
|------|------------------|--------------------|
| 域名 | `jacoapi.jingao.club` | `chat.jingao.club` |
| 客户端 | 桌面端 + 飞书 Bot + 管理后台 | webchat SPA |
| 认证会话 | 共享 PostgreSQL `auth_sessions` | 共享 PostgreSQL `auth_sessions` |
| 独占功能 | memory / skills / feedback / games / feishu | Incus VM / Pi WS relay / teams / VNC / SPA 托管 |
| 部署入口 | `make deploy-jingao` | `make deploy-local` |

## 环境变量

**gateway.yaml** (jingao, env override `GATEWAY_*`):
```yaml
server: { port: 8847, host: "0.0.0.0", public_url: "https://jacoapi.jingao.club" }
auth: { admin_token, feishu_client_id, feishu_client_secret, session_ttl_hours: 720 }
database: { url: "postgresql://...@127.0.0.1:5432/jacoworks" }
llm: { proxy_url, proxy_key }   # 留空, LLM 配置统一由 DB system_settings 管理
github: { token, repo }         # 反馈同步 GitHub Issues
docker: { ssh_target: "opc@100.94.98.106", image: "jacoworks/vm-agent:latest", network: "agent-net", agent_port: 18789, host_ip: "100.94.98.106", gateway_token: "" }
chat_agent: { url, token }      # 可选外部 ChatAgent
posthog: { api_key, endpoint }  # 留空, 由 DB system_settings 管理
openclaw: { ssh_target: "root@100.97.254.31", image: "openclaw-base", port: 18789, host_ip: "100.97.254.31", base_port: 18800, data_root: "/srv/jacoworks/openclaw" }
```

**oc-gateway.yaml** (local, webchat 独立部署):
```yaml
server:
  port: 18700
  host: "0.0.0.0"
  public_url: "https://chat.jingao.club"
  static_dir: "/opt/jacoworks/www/static"
auth:
  session_ttl_hours: 720
```

- `GATEWAY_GITHUB_TOKEN` / `GATEWAY_GITHUB_REPO` — GitHub 反馈同步配置
- `GATEWAY_POSTHOG_API_KEY` / `GATEWAY_POSTHOG_ENDPOINT` — PostHog 错误追踪 (优先用 DB 配置)
- `GATEWAY_SERVER_PUBLIC_URL` / `GATEWAY_SERVER_STATIC_DIR` — SPA 注入地址与静态目录
- `GATEWAY_AUTH_SESSION_TTL_HOURS` — 登录会话有效期 (小时)

## CORS

- `allowedOrigins` 需包含 `https://chat.jingao.club`（webchat 独立域名）
- 现有 `https://jaco.jingao.club` 与本地开发地址继续保留

## 日志与可观测性

- **zerolog**: 终端 → ConsoleWriter 彩色输出; systemd → JSON 结构化输出 → journald
- **中间件链**: `PanicRecovery → RequestID → RequestLog → CORS → mux`
- **request_id**: 每个请求自动注入, 响应头 `X-Request-ID`, 日志自动携带
- **PostHog**: `posthog-go` 客户端, 通过 `postHogHolder` 支持管理后台热重载
- **WS 事件追踪**: `ws_handler.go` 的 `EventCallback` 上报 `ws_oc_connected` / `ws_oc_disconnected` 到 PostHog
- **journald 查询**: `journalctl -u jacoworks-gateway -o json` (生产) / `-f` (实时)

## 测试

```bash
# Go 单元测试
go test ./...

# Gateway API E2E (从 vm-agent 目录执行, 需要网关运行)
cd ../vm-agent && npm run test:gateway-e2e
```

覆盖: middleware, handlers, config, ws_ticket, docker client (mock), relay/translator 路径, 全部 API 端点。

## 开发规范

- **Go 标准** + golangci-lint
- **配置集中管理**: LLM 密钥统一由 DB `system_settings` 管理，启动加载 + 热重载
- **双网关拆分**: gateway 负责桌面端/后台管控面；oc-gateway 负责 webchat 认证 + 会话 + cron + SPA + Pi WS Wrapper relay
- 本地开发: `make dev-gateway` → localhost:8847
- 本地开发 (Pi relay): `make dev-oc-gateway` → localhost:18700
- 部署: `make deploy-jingao` (gateway + website) / `make deploy-local` (oc-gateway + webchat + pi-config + skills)
- 前端专项部署: `make deploy-webchat` / `make deploy-webchat-static`

## vm-agent 容器管理（已废弃，oracle 主机）

- **Docker Go SDK**: vm-agent 容器 (oracle ARM64) 通过 `github.com/docker/docker/client` SDK, SSH 传输 (`ssh dial-stdio`)
- **两级空闲策略**: Freezer 按前缀 (`agent-`) 管理, pause → stop 两级回收
- **注意**: Docker 路径仅为历史回滚保留；当前生产链路不再依赖 oracle vm-agent

## Incus VM 管理 (Pi CLI, local 主机)

oc-gateway 使用 Incus 管理 Pi CLI VM (每用户一个 Incus 虚拟机):

- **Golden Image**: `pi-ready` — Ubuntu 24.04 + XFCE4 + TigerVNC + noVNC + Pi CLI + `pi-ws-wrapper`
- **构建**: `deploy/incus/build-openclaw-vm.sh --force` (在 local 服务器上构建)
- **每用户 VM**: `incus launch pi-ready oc-{user-hash} --vm` + disk devices (数据持久化), 4 CPU / 4GiB RAM
- **VM 网络**: VM 通过 Incus bridge 自动获取 IP (10.193.112.x)，端口直接暴露，**不使用 proxy device**
- **Systemd 服务**: `pi-ws-wrapper.service` + `vncserver.service` + `novnc.service`
- **两级空闲策略**: Freezer (freeze → stop)
- **配置写入**: `pi-config/` 与 `skills/` 通过 gateway 写入 VM 运行目录
- **VNC 代理**: `/vnc/*` 反代 noVNC 静态文件, `/websockify` 代理 WS 到 VM bridge IP:6080

## 团队模板系统（迁移中）

参考模板仍保存在 `openclaw/templates/`，Gateway 负责把它们转换为 Pi 运行时所需的工作区与团队配置：

1. **读取模板** — 从 `openclaw/templates/{name}/template.json` 加载定义
2. **生成配置** — 渲染 Pi 团队配置 / sessionKey / cron 行为
3. **部署文件** — 复制 prompts/ skills/ workspace/ 到 VM 对应目录
4. **启动运行时** — 确保 `pi-ws-wrapper.service` 可接入并由前端复用现有兼容协议

## 新增 system_settings 配置项 checklist

新增配置项必须同时修改四处，缺一不可：

- [ ] `deploy/sql/0XX_*.sql` 迁移 + 更新 `003_system_settings.sql` 全量 seed
- [ ] `gateway/cmd/gateway/main.go` 启动加载 switch case + `updateSettingsHandler` allowedKeys + 热重载
- [ ] `gateway/internal/config/config.go` 结构体字段 + env override
- [ ] `website/src/routes/admin/settings.rs` `UpdateSettingsForm` 字段 + `is_secret_key()` + 提交处理
- [ ] 线上 DB 执行迁移 SQL (`sudo -u postgres psql -d jacoworks`)
