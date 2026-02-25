# JAcoworks — 企业 AI 协同办公平台

> Tauri 桌面端内嵌 Pi SDK Agent sidecar 直接读写本地文件。Go 网关 (宿主机 frpc 穿透) 提供认证、会话存储和管理 API。LLM 中转站 (`http://67.230.171.248:8317`) 统一接入 Claude/GPT/Gemini/Grok。

## 1. 代码结构

```
gateway/                         Go 管理网关 (宿主机 :8090, frpc → 67.230.171.248:8090)
  cmd/gateway/main.go            入口 (认证 + 会话 CRUD + 管理 + WS 代理)
  internal/
    config/config.go             YAML + env override, ChatAgentConfig
    auth/{middleware,handlers}.go Goth 飞书 SSO + bcrypt + 激活码
    auth/feishu/                 Goth Feishu Provider
    store/{pg,users,sessions,containers,invites}.go   PostgreSQL (pgx/v5)
    proxy/handler.go             ReverseProxy (OpenClaw HTTP + ChatAgent)
    cowork/handler.go            文件操作 (upload/download/changes)
    openclaw/ws_proxy.go         WebSocket 代理 (Ed25519 设备密钥)
    lxd/{client,ssh_client,freezer}.go  LXD 容器生命周期
    audit/logger.go

vm-agent/                        本地 Agent sidecar (Pi SDK + RPC stdio)
  src/
    index.ts                     RPC 主循环 (stdin/stdout JSON lines)
    config.ts                    .env + 环境变量
    agent.ts                     Session 池 + 4 Provider + per-user 隔离 + title 生成
    prompts/system.ts            系统提示词 (核心身份 + SOUL.md overlay + 动态能力)
    extensions/memory.ts         记忆系统 (per-user 目录)
    services/{heartbeat,cron}.ts 后台服务 (sidecar 模式默认关闭)
    tools/web.ts                 web_search (Tavily) + web_fetch
    lib/{daily-log,prompt-queue}.ts

desktop/                         Tauri v2 + React 18 桌面客户端
  src-tauri/src/
    lib.rs                       Tauri 入口
    sidecar.rs                   Agent 生命周期 + RPC + 记忆管理
    stream.rs                    http_fetch (网关 API)
    cowork.rs                    目录选择/tar (保留兼容)
  src/
    App.tsx                      Login → Agent → 会话 / OpenClaw 切换
    app.css                      Design Token (:root 变量)
    react/
      components/                LoginPanel Sidebar TopBar ChatView Composer
                                 MessageBubble Markdown StreamingMarkdown
                                 ToolStatus NewSessionPanel SettingsModal RpcLogPanel
      hooks/                     use-agent-bootstrap use-chat-stream
                                 use-responsive-sidebar use-session-state
      lib/                       auth sessions agent transport config
                                 cowork recentFolders session-persistence skills
      openclaw/                  完全独立模块 (不复用本地模式组件)
        OpenClawApp.tsx          容器分配 → WS 对话
        lib/{api,sessions,ws}.ts
        components/              OcChatView OcComposer OcMarkdown Provision...
      styles/                    按组件拆分 CSS (chat composer layout sidebar...)
      types.ts                   ChatMessage ChatSession StreamBlock

deploy/
  sql/001_init_business_tables.sql   PostgreSQL 全量 schema
  gateway/{frpc.toml,jacoworks-gateway.service,gateway.yaml.example}
  openclaw/{.env.template,openclaw.json}

shared/skills/                   预制技能包 (待填充)
docs/design-system.md            Design Token 完整规范
tasks/                           lessons.md next-steps.md
```

## 2. 架构概览

```
桌面端 ──登录/会话──→ Go 网关 (:8090, frpc 穿透)
  │                    ├─ Goth 认证 (飞书 SSO / bcrypt / 激活码)
  │                    ├─ chat_sessions CRUD (PostgreSQL Railway)
  │                    ├─ GET /api/agent/config → 下发 LLM 密钥
  │                    ├─ POST /v1/chat/completions → OpenClaw/ChatAgent 代理
  │                    └─ GET /ws/openclaw → WS 代理 → 容器 :18789
  │
  ├─ 本地模式: sidecar RPC (stdin/stdout)
  │    vm-agent → Pi SDK session → LLM 中转站
  │    可选 workspace → Agent 直接读写本地文件
  │
  └─ OpenClaw 模式: WebSocket → 网关 WS 代理 → LXD 容器
       Ed25519 设备认证, JSON framing 协议
```

**双模式**: 本地 `type="chat"` (sidecar RPC) / OpenClaw `type="cowork"` (WebSocket)

## 3. 网关 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 邮箱密码登录 |
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
| * | `/api/admin/...` | 管理: invite-codes, containers, provision |
| GET | `/health` | 健康检查 |

## 4. vm-agent RPC

**命令**: `prompt` `abort` `destroy_session` `generate_title` `health` `list_sessions` `list_skills`

**prompt 字段**: `message` `session_id` `model` `user_id` `workspace?` `restricted` `streaming_behavior`

**事件** (stdout JSON lines): `response` `session_event` `error` `done` `ready` (启动握手, 含技能列表)

**模型**:

| Provider | 模型 |
|----------|------|
| `proxy-claude` (anthropic) | claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5-20251001 |
| `proxy-gpt` (openai) | gpt-5.3-codex, gpt-5.2 |
| `proxy-gemini` (openai) | gemini-3.1-pro-preview, gemini-3-pro-preview, gemini-3-flash-preview |
| `proxy-grok` (openai) | grok-4.20-beta, grok-4.1-fast |

**路由**: `"model-id"` (自动匹配) 或 `"provider/model-id"` (显式指定)

## 5. 数据库

PostgreSQL (Railway `trolley.proxy.rlwy.net:28177`)。Schema: `deploy/sql/001_init_business_tables.sql`

| 表 | 关键字段 |
|-----|------|
| `users` | id TEXT PK, name, email, password_hash, role, feishu_open_id |
| `auth_sessions` | token, user_id → users, expires_at |
| `chat_sessions` | user_id, title, type('chat'\|'cowork'), model, workspace_path, messages JSONB |
| `containers` | user_id UNIQUE, container_name, container_ip, status('running'\|'stopped'\|'frozen'\|'creating'\|'error') |
| `invite_codes` | code PK, role, max_uses, used_count |
| `audit_logs` | user_id, action, detail JSONB |

`user_id` 为 TEXT (gen_random_uuid()::text)。`updated_at` 触发器自动更新。

## 6. 环境变量

**gateway.yaml** (宿主机, env override `GATEWAY_*`):
```yaml
server: { port: 8090, host: "0.0.0.0", public_url: "http://api.xiaomao.chat:8090" }
auth: { admin_token, feishu_client_id, feishu_client_secret, session_ttl_hours: 720 }
database: { url: "postgresql://...@trolley.proxy.rlwy.net:28177/railway" }
llm: { proxy_url: "http://67.230.171.248:8317", proxy_key }
lxd: { ssh_target: "local", template: "tpl-openclaw", network: "jaconet", openclaw_port: 18789 }
chat_agent: { url, token }  # 可选外部 ChatAgent
```

**vm-agent** (.env, Tauri 启动时注入):
- `LLM_PROXY_URL` / `LLM_PROXY_KEY` — 中转站 (优先网关下发, 失败回退 .env)
- `WORKSPACE_DIR` — 默认 cwd (可被请求级 workspace 覆盖)
- `MEMORY_ROOT_DIR` — 记忆根目录 (默认 `~/Library/Application Support/JAcoworks/memory`)
- `PRIMARY_MODEL=claude-sonnet-4-6` / `PRIMARY_PROVIDER=proxy-claude`
- `MEMORY_ENABLED=true` / `HEARTBEAT_ENABLED=false` / `CRON_ENABLED=false`
- `SKILLS_PATHS` — 技能目录 (逗号分隔)
- `TOOL_DENY_LIST` / `TAVILY_API_KEY`

**desktop** (config.ts + Vite env):
- `GATEWAY_URL` (`VITE_GATEWAY_URL`) = `http://api.xiaomao.chat:8090`
- `DEFAULT_MODEL` = `proxy-claude/claude-opus-4-6`

## 7. 基础设施

| 服务 | 位置 | 说明 |
|------|------|------|
| Go 网关 | 宿主机 192.168.31.162 | 二进制 + systemd, frpc → 67.230.171.248:8090 |
| PostgreSQL | Railway | trolley.proxy.rlwy.net:28177 |
| LXD 容器 | 宿主机 | Per-User OpenClaw, tpl-openclaw 模板 |
| 宿主机 | 192.168.31.162 | Ubuntu 24.04, Ryzen 5 5600H, 62GB, SSH: `ssh local` |

## 8. 待完成

- [ ] 飞书 SSO 联调 (需飞书开放平台凭证)
- [ ] vm-agent 编译为单二进制 (bun build --compile)
- [ ] 向量记忆系统 (SQLite-vec)
- [ ] TLS (Nginx + Let's Encrypt)
- [ ] 预制技能 (shared/skills/)
- [ ] 移动端 / 语音 / 文件上传
- [ ] 飞书 Bot 消息路由

## 9. 开发规范与约束

**代码风格**: Go 标准 + golangci-lint | TS strict ES2022 NodeNext | React 18 纯 CSS 变量 | Rust Tauri v2 | Conventional Commits

**关键约束**:
- **本地 Agent 优先**: 对话走 sidecar RPC，不经网关
- **网关仅管控面**: 认证、会话 CRUD、LLM 配置下发、WS 代理
- **Session 隔离**: `session_id` + `user_id` 隔离 Pi SDK session 和记忆
- **OpenClaw 前端解耦**: `openclaw/` 不复用本地组件，仅共享 auth/config/transport
- **启动容错**: `fetchAgentConfig()` 失败不阻断 sidecar，回退本地 `.env`
- **CSS 模块化**: 样式拆分到 `react/styles/` 按组件分文件

**Agent 启动排查**:
1. 看 RPC 日志面板 (`agent-rpc-log`)
2. `需要 LLM_PROXY_KEY` → 补 `vm-agent/.env` 或恢复网关 `/api/agent/config`
3. `Agent ready handshake timed out` → 重新构建 `vm-agent/dist/index.js`

### Design Token — 强制约束

> Token 定义: `desktop/src/app.css :root`，完整规范: `docs/design-system.md`

风格: Claude.ai 暖色奶油 — `#F5F0EB` 背景、`#C4724A` 陶土强调、白色卡片、大圆角。

1. **禁止魔法数字**: spacing 用 `--space-*`、font-size 用 `--text-*`、radius 用 `--radius-*`、z-index 用 `--z-*`、transition 用 `--duration-*`
2. **颜色必须用变量**: 禁止硬编码 `#hex` / `rgb()`
3. **白色文字**: 强调色背景用 `var(--text-on-accent)`
4. 例外: `0`/`auto`/%/`1px`/`opacity`/`em`/SVG/`@keyframes`
