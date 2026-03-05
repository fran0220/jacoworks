# Gateway — Go 管理网关

> jingao :8847, OpenResty 反代 jacoapi.jingao.club。提供认证、会话 CRUD、LLM 配置下发、WS 代理和管理 API。

## 代码结构

```
cmd/gateway/main.go            入口 (认证 + 会话 CRUD + 管理 + WS 代理)
internal/
  config/config.go             YAML + env override, ChatAgentConfig, GitHubConfig
  auth/{middleware,handlers}.go Goth 飞书 SSO + bcrypt + 激活码
  auth/feishu/                 Goth Feishu Provider
  store/{pg,users,sessions,containers,invites,settings,memory,skills,games}.go  PostgreSQL (pgx/v5)
  proxy/handler.go             ReverseProxy (OpenClaw HTTP + ChatAgent)
  cowork/handler.go            文件操作 (upload/download/changes)
  openclaw/ws_proxy.go         WebSocket 代理 (Ed25519 设备密钥)
  openclaw/ws_handler.go       新 WS 传输 (ticket auth + 容器健康管理)
  openclaw/ws_ticket.go        WS ticket 签发/验证 (HMAC-SHA256, 30s TTL)
  github/client.go             GitHub API 客户端 (Issue 创建 + 图片上传到 feedback-assets 分支)
  lxd/{client,ssh_client,freezer.go}  LXD 容器生命周期 + 记忆/技能推拉 + 健康检查
  feishubot/{client,handler}.go  飞书 Bot webhook + 消息路由到容器
  games/handler.go             游戏画廊 API (tar.gz 部署 + 静态文件)
  audit/logger.go
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 用户名/密码登录 (username 支持用户名或邮箱) |
| POST | `/api/auth/activate` | 激活码注册 |
| GET | `/api/auth/feishu[/callback]` | 飞书 SSO |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/users/me` | 当前用户 |
| GET | `/api/agent/config` | 下发 LLM 配置 (proxy_url + proxy_key + 模型列表) |
| CRUD | `/api/sessions[/{id}]` | 会话 (title/messages/model/workspace_path) |
| POST | `/v1/chat/completions` | OpenClaw/ChatAgent HTTP 代理 |
| GET | `/api/cowork/container-status` | 容器状态 |
| POST | `/api/cowork/provision` | 自助分配 LXD 容器 |
| GET | `/ws/openclaw` | WebSocket 代理 → 容器 :18789 |
| POST | `/api/cowork/{sid}/upload` | 上传项目 |
| POST | `/api/memory/sync` | 记忆双向同步 (manifest + push/pull) |
| POST | `/api/skills/upload` | 技能文件上传 |
| GET | `/api/skills/checksum` | 技能文件校验和 |
| POST | `/api/games/deploy` | 游戏部署 (tar.gz + metadata) |
| GET | `/api/games` | 游戏列表 (公开) |
| DELETE | `/api/games/{id}` | 删除游戏 (作者或管理员) |
| POST | `/api/feedback` | 提交桌面端反馈并同步 GitHub Issue (支持最多 3 张截图) |
| POST | `/api/feishu/webhook` | 飞书 Bot webhook (无需认证) |
| GET | `/api/admin/settings` | 读取系统设置 (LLM 密钥等) |
| PUT | `/api/admin/settings` | 更新系统设置 + 热重载内存配置 |
| * | `/api/admin/...` | 管理: invite-codes, containers, provision |
| GET | `/health` | 健康检查 |

## 环境变量

**gateway.yaml** (env override `GATEWAY_*`):
```yaml
server: { port: 8847, host: "0.0.0.0", public_url: "https://jacoapi.jingao.club" }
auth: { admin_token, feishu_client_id, feishu_client_secret, session_ttl_hours: 720 }
database: { url: "postgresql://...@127.0.0.1:5432/jacoworks" }
llm: { proxy_url, proxy_key }   # 留空, LLM 配置统一由 DB system_settings 管理
github: { token, repo }         # 反馈同步 GitHub Issues
lxd: { ssh_target: "opc@10.0.1.3", template: "tpl-openclaw", network: "jaconet", openclaw_port: 18789 }
chat_agent: { url, token }      # 可选外部 ChatAgent
```

- `GATEWAY_GITHUB_TOKEN` / `GATEWAY_GITHUB_REPO` — GitHub 反馈同步配置

## 测试

```bash
# Go 单元测试
go test ./...

# Gateway API E2E (从 vm-agent 目录执行, 需要网关运行)
cd ../vm-agent && npm run test:gateway-e2e
```

覆盖: middleware, handlers, config, ws_ticket, 全部 API 端点。

## 开发规范

- **Go 标准** + golangci-lint
- **配置集中管理**: LLM 密钥统一由 DB `system_settings` 管理，启动加载 + 热重载
- **网关仅管控面**: 认证、会话 CRUD、LLM 配置下发、WS 代理，不处理对话逻辑
- 本地开发: `make dev-gateway` → localhost:8847
- 部署: `make deploy-gateway` → SSH jingao 远程编译 + 重启
