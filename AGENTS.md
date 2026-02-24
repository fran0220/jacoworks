# JAcoworks — 企业 AI 协同办公平台

> 本地优先架构：Tauri 桌面端内嵌 Pi SDK Agent sidecar，直接读写本地文件。
> Go 网关 + PostgreSQL 部署 Railway，提供认证、会话存储和管理 API。
> 通过公司 LLM 中转站统一接入 Claude/GPT/Gemini/Grok 四大模型。

---

## 1. 技术栈

| 层级 | 选型 | 说明 |
|------|------|------|
| AI 引擎 | Pi SDK (`@mariozechner/pi-coding-agent` ^0.54.2) | 轻量 Agent 框架，9MB，< 50MB 内存 |
| Agent 桥接 | vm-agent (TypeScript) | Pi SDK 原生事件流 + **RPC(stdio)**，本地 sidecar 进程 |
| 认证 | Goth + bcrypt (Go 内置) | 飞书 SSO + 激活码 + 邮箱密码，网关内集成 |
| 管理网关 | Go 自建 | 认证 + 会话存储 + 管理 API (Railway 部署) |
| 前端 | Tauri v2 + React 18 (Vite) | 桌面优先，内嵌 sidecar，本地 Agent 直接读写文件 |
| 数据库 | PostgreSQL 17 (Railway) | 网关独用，JSONB 会话存储 |
| LLM | 公司中转站 | `http://67.230.171.248:8317`，4 Provider 10 模型 |
| 容器 | LXD (代码保留，未来扩展) | 非主要路径，网关中保留 LXD 管理代码 |

---

## 2. 代码仓库

**Monorepo**: `github.com/fran0220/jacoworks` (private)

```
JAcoworks/
├── AGENTS.md                        # 本文件
├── .gitignore
├── gateway/                         # Go 管理网关 (Railway 部署)
│   ├── cmd/gateway/main.go          # 入口 (Goth 认证 + 会话 CRUD + 管理 + Agent 配置下发)
│   ├── internal/
│   │   ├── config/config.go         # 配置 (YAML + env override)
│   │   ├── auth/
│   │   │   ├── middleware.go        # Bearer token → auth_sessions 验证
│   │   │   ├── handlers.go          # 登录/注册/飞书 SSO/激活码/登出
│   │   │   └── feishu/              # Goth Feishu Provider 实现
│   │   ├── store/                   # PostgreSQL 数据层 (pgx/v5)
│   │   │   ├── pg.go                # pgxpool 连接池
│   │   │   ├── users.go             # 用户 + auth_sessions + invite_codes CRUD
│   │   │   ├── sessions.go          # chat_sessions CRUD (JSONB)
│   │   │   ├── containers.go        # 容器映射 (保留)
│   │   │   └── invites.go           # 激活码 CRUD
│   │   ├── audit/logger.go          # 审计日志
│   │   ├── proxy/handler.go         # ReverseProxy (保留，LXD 路径)
│   │   ├── cowork/handler.go        # Cowork 文件操作 (保留，LXD 路径)
│   │   └── lxd/                     # LXD 容器生命周期 (保留，未来扩展)
│   ├── Dockerfile
│   ├── gateway.yaml.example
│   ├── Makefile
│   ├── go.mod / go.sum
│   └── ...
├── vm-agent/                        # 本地 Agent sidecar (Pi SDK + RPC 桥接)
│   ├── src/
│   │   ├── index.ts                 # RPC loop (stdin command / stdout JSON line events)
│   │   ├── config.ts                # 配置加载 (.env + 环境变量)
│   │   ├── agent.ts                 # Pi SDK session 池 + 4 Provider + per-session workspace
│   │   ├── extensions/
│   │   │   └── memory.ts            # 记忆系统 Extension
│   │   ├── services/
│   │   │   ├── heartbeat.ts         # 心跳服务
│   │   │   └── cron.ts              # 定时任务
│   │   ├── lib/
│   │   │   ├── daily-log.ts         # 日志 I/O
│   │   │   └── prompt-queue.ts      # Prompt 串行队列
│   │   └── tools/
│   │       └── web.ts               # web_search + web_fetch 自定义工具
│   ├── package.json
│   └── tsconfig.json
├── desktop/                         # Tauri v2 + React 18 桌面客户端
│   ├── src-tauri/
│   │   ├── src/lib.rs               # Tauri 入口 (注册 Rust 命令)
│   │   ├── src/stream.rs            # HTTP 桥接 (http_fetch，仅网关 API)
│   │   ├── src/sidecar.rs           # Agent sidecar 生命周期 + RPC(stdin/stdout)桥接
│   │   ├── src/cowork.rs            # 文件操作 (目录选择/tar，保留兼容)
│   │   ├── Cargo.toml
│   │   └── tauri.conf.json
│   ├── src/
│   │   ├── main.tsx                 # React 入口
│   │   ├── App.tsx                  # 根页面 (Login → Agent 启动 → 会话)
│   │   ├── app.css                  # CSS 变量主题 (Design Token)
│   │   └── react/
│   │       ├── components/          # LoginPanel/Sidebar/NewSessionPanel/ChatView/Composer...
│   │       ├── lib/                 # auth/sessions/agent/transport/cowork
│   │       ├── styles.css           # React 组件样式
│   │       └── types.ts             # 前端类型定义
│   └── package.json
├── deploy/                          # 部署配置
│   ├── sql/
│   │   ├── 001_init_business_tables.sql  # PostgreSQL 全量 schema (Goth auth + 业务表)
│   │   └── 002_seed_test_data.sql
│   └── ...
├── shared/                          # 共享资源
│   ├── skills/                      # 预制技能包
│   └── docs/                        # 企业知识库
├── docs/                            # 设计文档
└── tasks/                           # 任务追踪
```

---

## 3. 系统架构

```
Tauri 桌面端
  │
  ├─ 登录/会话/管理 ──HTTPS──→ Go 网关 (Railway)
  │                              ├─ Goth 飞书 SSO / bcrypt 密码认证
  │                              ├─ auth_sessions 表验证
  │                              ├─ chat_sessions CRUD
  │                              ├─ invite_codes 管理
  │                              └─ GET /api/agent/config (可选) → 下发 LLM 密钥
  │
  ├─ 登录后启动本地 vm-agent sidecar (Node 进程)
  │      └─ start_agent strict ready handshake (RPC)
  │
  └─ 统一会话对话 ──invoke/emit──→ sidecar RPC (stdin/stdout JSON lines)
                                 ├─ Pi SDK sessions (per session_id)
                                 ├─ 默认 restricted=false (开放全部工具)
                                 ├─ workspace 可选 (输入栏选择目录后生效)
                                 └─ LLM 调用 → 中转站 (唯一网络依赖)

Railway:
  ┌──────────────────┐     ┌──────────────┐
  │ Go 网关 (Docker) │────→│ PostgreSQL   │
  │ :8080            │     │ (内网连接)    │
  └──────────────────┘     └──────────────┘
```

### 3.1 认证流程 (Goth + bcrypt)

认证完全由 Go 网关内置处理，无独立认证微服务。

```
激活码注册:
  桌面端 → POST /api/auth/activate {code, username, password}
         → 验证激活码 → bcrypt 哈希 → 创建 users 记录
         → 创建 auth_sessions → 返回 {token, user}

密码登录:
  桌面端 → POST /api/auth/login {email, password}
         → bcrypt 验证 → 创建 auth_sessions → 返回 {token, user}

飞书 SSO:
  桌面端 → GET /api/auth/feishu → Goth 跳转飞书 OAuth
         → 回调 GET /api/auth/feishu/callback
         → Goth FetchUser → FindOrCreate 用户
         → 创建 auth_sessions → 重定向携带 ?token=xxx

业务请求:
  桌面端 → Authorization: Bearer <session_token>
         → middleware 查 auth_sessions JOIN users → 注入 user context
```

### 3.2 数据流 (本地 Agent 单模式 + 可选工作目录)

```
用户登录后:
  桌面端 → 可选 GET /api/agent/config → 获取 {llm_proxy_url, llm_proxy_key}
         → Tauri invoke start_agent(agentDir, envVars?)
         → 启动 Node.js 进程 (vm-agent)
         → sidecar 收到 {"type":"ready"} 后返回成功
         → 若 /api/agent/config 失败，回退 vm-agent 本地 .env 启动

统一会话模式 (restricted: false):
  输入栏可随时选择本地项目文件夹（可选） →
  invoke("agent_rpc_send", {
    id,
    type: "prompt",
    session_id,
    message,
    model,
    workspace?,
    restricted: false
  })
    → vm-agent 创建完整 session (bash/edit/read/grep/find/ls/write + web)
    → 若提供 workspace，Agent 在该目录直接读写本地文件
    → emit("agent-rpc-event", {type:"session_event"|"done"|"error"|"response"})
```

**关键优势**: 单模式下仍可直接操作本地文件系统，无 tar 打包/上传/下载/容器挂载步骤。

### 3.3 Go 管理网关

Go module: `github.com/fran0220/jacoworks/gateway`

核心依赖:
- `net/http` — 标准库 HTTP server
- `github.com/markbates/goth` — 飞书 SSO (OAuth2)
- `github.com/jackc/pgx/v5` — PostgreSQL 连接池
- `github.com/rs/zerolog` — 结构化日志

**主要 API 端点**:

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 邮箱密码登录 |
| POST | `/api/auth/activate` | 激活码注册 |
| GET | `/api/auth/feishu` | 飞书 SSO 入口 |
| GET | `/api/auth/feishu/callback` | 飞书 SSO 回调 |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/users/me` | 当前用户信息 |
| GET | `/api/agent/config` | **下发 LLM 配置** (proxy_url + proxy_key + 模型列表) |
| GET | `/api/sessions` | 列出用户会话 |
| POST | `/api/sessions` | 创建会话 |
| GET | `/api/sessions/{id}` | 获取会话详情 |
| PUT | `/api/sessions/{id}` | 更新会话 (title/messages) |
| DELETE | `/api/sessions/{id}` | 删除会话 |
| POST | `/api/admin/invite-codes` | 管理: 生成激活码 |
| GET | `/api/admin/invite-codes` | 管理: 列出激活码 |
| GET | `/health` | 健康检查 |

**保留的 LXD 端点** (未来扩展用，当前非主要路径):

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/v1/chat/completions` | 透传 → 远程 vm-agent |
| GET | `/api/cowork/container-status` | 容器状态 |
| POST | `/api/cowork/provision` | 自助分配容器 |
| POST | `/api/cowork/{sid}/upload` | 上传项目 |
| GET | `/api/cowork/{sid}/download` | 下载变更 |
| GET | `/api/admin/containers` | 列出容器 |
| POST | `/api/admin/containers/{id}/start` | 启动容器 |
| POST | `/api/admin/containers/{id}/stop` | 停止容器 |

### 3.4 VM Agent (Pi SDK，本地 Sidecar)

Tauri 桌面端启动时自动 spawn 的 Node.js 进程。

**入口**: `vm-agent/src/index.ts` — RPC stdin/stdout 主循环

**核心组件**:
- `config.ts` — 环境变量加载 (LLM_PROXY_KEY/URL 由 Tauri 注入)
- `agent.ts` — Pi SDK session 池 + 4 Provider 注册 + **per-request workspace（可选）**
- `extensions/memory.ts` — 记忆系统 (daily log + MEMORY.md)
- `services/heartbeat.ts` — 心跳 (本地 sidecar 模式下默认关闭)
- `services/cron.ts` — 定时任务 (本地 sidecar 模式下默认关闭)
- `tools/web.ts` — web_search (Tavily) + web_fetch

**RPC Prompt 字段**:

| 字段 | 说明 |
|------|------|
| `message` | 用户输入 |
| `session_id` | 会话 ID，用于隔离上下文 |
| `model` | 模型路由 (`provider/model` 或 `model`) |
| `restricted` | 默认 `false`（开放全部工具） |
| `workspace` | 可选项目目录路径，提供时 Agent 以此为 cwd |
| `streaming_behavior` | 流中追问策略：`followUp` / `steer` |

**模型注册** (代码内 registerProvider):

| Provider | 协议 | 模型 |
|----------|------|------|
| `proxy-claude` | `anthropic-messages` | claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5-20251001 |
| `proxy-gpt` | `openai-completions` | gpt-5.3-codex, gpt-5.2 |
| `proxy-gemini` | `openai-completions` | gemini-3.1-pro-preview, gemini-3-pro-preview, gemini-3-flash-preview |
| `proxy-grok` | `openai-completions` | grok-4.20-beta, grok-4.1-fast |

**RPC 事件格式** (stdout JSON lines):
- `{"id":"...","type":"response", ...}` — 命令响应
- `{"id":"...","type":"session_event","session_id":"...","event":{...}}` — Pi `AgentSessionEvent`
- `{"id":"...","type":"error", ...}` — 运行错误
- `{"id":"...","type":"done","session_id":"..."}` — 流结束
- `{"type":"ready"}` — sidecar 启动就绪握手

**内置工具** (Pi SDK): read, bash, edit, write, grep, find, ls
**自定义工具**: web_search, web_fetch, memory_search, memory_save, cron_manage

### 3.5 Tauri 桌面客户端

**Rust 侧命令** (src-tauri/src/):
- `http_fetch` → 同步 HTTP (认证/会话 API)
- `start_agent` → 启动本地 vm-agent sidecar (spawn Node.js + ready handshake)
- `agent_rpc_send` → 向 sidecar stdin 发送 JSON RPC 命令
- `stop_agent` → 停止 sidecar 进程
- `agent_status` → 检查 sidecar 状态
- `select_directory` → 原生文件夹选择对话框
- `tar_directory` / `extract_tar` / `upload_cowork` / `download_cowork` → 保留兼容

**应用启动流程**:
```
1. 用户登录 (密码/激活码/飞书 SSO)
2. 登录成功 → 尝试 fetchAgentConfig()（失败可回退）
3. invoke start_agent(agentDir, envVars?)
4. sidecar 收到 `{"type":"ready"}` → start_agent 返回
5. Agent 就绪 → 进入主界面
```

**前端数据流 (React)**:
```
用户输入 → messages[] 追加
  → invoke("agent_rpc_send", { id, type:"prompt", model, message, session_id, workspace?, restricted:false })
  → Rust stdin 写入 vm-agent
  → vm-agent 执行并 stdout 输出 JSON 行
  → emit("agent-rpc-event")
  → AgentSessionEvent reducer → 增量 Markdown 渲染 + 工具状态
  → done 后保存到网关会话 API
```

**登录页**: 三种登录方式:
- 密码登录: 邮箱 + 密码 → POST /api/auth/login
- 激活码: 激活码 + 用户名 + 密码 → POST /api/auth/activate
- 飞书 SSO: 跳转 Goth OAuth 流程

**本地目录协作**: 输入栏可选择本地项目文件夹 → Agent 直接读写 → 零同步延迟。

---

## 4. 数据库 Schema

### PostgreSQL (Railway)

连接: `postgresql://postgres:***@trolley.proxy.rlwy.net:28177/railway`

**认证表** (Go 网关 + Goth 管理):

| 表 | 说明 |
|-----|------|
| `users` | 用户 (id TEXT PK, name, email, password_hash, role, feishu_open_id) |
| `auth_sessions` | 登录会话 (token, user_id → users, expires_at, ip_address) |

**业务表**:

| 表 | 说明 |
|-----|------|
| `chat_sessions` | 聊天会话 (user_id TEXT, title, type, model, workspace_path, messages JSONB) |
| `invite_codes` | 激活码 (code TEXT PK, role, max_uses, used_count, expires_at) |
| `invite_code_usages` | 激活码使用记录 |
| `audit_logs` | 审计日志 (user_id, action, resource_type, detail JSONB) |
| `containers` | 容器映射 (保留，未来扩展) |

**关键设计**:
- `user_id` 为 TEXT 类型 (gen_random_uuid()::text)
- `messages` 使用 JSONB + GIN 索引
- `updated_at` 由数据库触发器自动更新
- 完整 schema 见 `deploy/sql/001_init_business_tables.sql`

---

## 5. LLM 中转站

地址: `http://67.230.171.248:8317` (环境变量 `LLM_PROXY_URL`)
密钥: 环境变量 `LLM_PROXY_KEY`

支持 4 种原生协议:
- Claude: `POST /v1/messages` (Anthropic 原生)
- GPT: `POST /v1/chat/completions` (OpenAI 原生)
- Gemini: `POST /v1/chat/completions` (OpenAI 兼容)
- Grok: `POST /v1/chat/completions` (OpenAI 兼容)

全部用同一个 API Key，vm-agent 通过 `registerProvider()` 注入所有 provider。

网关 `GET /api/agent/config` 用于优先下发密钥；若不可用，桌面端允许回退到 vm-agent 本地 `.env`。

---

## 6. 基础设施

### 生产环境 (Railway)

| 服务 | 说明 |
|------|------|
| Go 网关 | Docker 容器，Dockerfile 在 `gateway/`，:8080 |
| PostgreSQL | Railway 托管，内网连接 |

**Railway 环境变量**:
```
GATEWAY_DATABASE_URL=postgresql://...@内网地址/railway
GATEWAY_SERVER_PORT=8080
GATEWAY_AUTH_ADMIN_TOKEN=<token>
GATEWAY_AUTH_FEISHU_CLIENT_ID=<id>
GATEWAY_AUTH_FEISHU_CLIENT_SECRET=<secret>
GATEWAY_AUTH_SESSION_TTL_HOURS=720
GATEWAY_LLM_PROXY_URL=http://67.230.171.248:8317
GATEWAY_LLM_PROXY_KEY=<key>
GATEWAY_SERVER_PUBLIC_URL=https://<railway-domain>
```

### 宿主机 (保留，LXD 未来扩展)

| 项目 | 值 |
|------|-----|
| 地址 | 192.168.31.162 (Ubuntu 24.04, SSH: `ssh local`) |
| 规格 | Ryzen 5 5600H (6C/12T), 62GB RAM, 1.9TB |
| LXD 网络 | `jaconet` (10.10.10.0/24) |
| VM 模板 | `tpl-openclaw` |
| LLM 中转 | http://67.230.171.248:8317 |

---

## 7. 环境变量

### gateway.yaml (本地开发) / Railway 环境变量 (生产)

```yaml
server:
  port: 8080
  host: "0.0.0.0"
  public_url: "https://<domain>"
auth:
  admin_token: "<admin-token>"
  feishu_client_id: ""
  feishu_client_secret: ""
  session_ttl_hours: 720
database:
  url: "postgresql://postgres:xxx@trolley.proxy.rlwy.net:28177/railway"
llm:
  proxy_url: "http://67.230.171.248:8317"
  proxy_key: "<key>"
# LXD 配置保留，本地 sidecar 模式下不使用
lxd:
  ssh_target: "local"
  template: "tpl-openclaw"
  network: "jaconet"
  openclaw_port: 18789
```

### vm-agent (.env，本地 sidecar 由 Tauri 注入)

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LLM_PROXY_URL` | 中转站地址 | `http://67.230.171.248:8317` |
| `LLM_PROXY_KEY` | 中转站密钥 | **优先网关下发，失败时使用本地 .env** |
| `PORT` | 历史兼容字段（RPC 模式不对外监听 HTTP） | `18789` |
| `WORKSPACE_DIR` | 默认工作目录 (可被请求级 workspace 覆盖) | `process.cwd()` |
| `PRIMARY_MODEL` | 默认模型 | `claude-sonnet-4-6` |
| `PRIMARY_PROVIDER` | 默认 Provider | `proxy-claude` |
| `MEMORY_ENABLED` | 记忆系统 | `true` |
| `HEARTBEAT_ENABLED` | 心跳 (sidecar 模式关闭) | `false` |
| `CRON_ENABLED` | 定时任务 (sidecar 模式关闭) | `false` |
| `SKILLS_PATHS` | 技能目录 | `/shared/skills,/workspace/skills` |
| `TOOL_DENY_LIST` | 静态禁用工具 (请求级 restricted 优先) | — |
| `TAVILY_API_KEY` | Web 搜索 (可选) | — |

### desktop (config.ts)

| 常量 | 说明 | 值 |
|------|------|-----|
| `GATEWAY_URL` | 网关地址 | `http://api.xiaomao.chat:8090` (或 Railway 域名) |
| `AGENT_URL` | 已废弃（RPC 模式不再使用） | — |

---

## 8. 已完成 & 待完成

### ✅ 已完成
- [x] vm-agent 全功能 (Pi SDK session + 4 Provider + memory + heartbeat + cron)
- [x] vm-agent 支持 per-request workspace（可选）+ restricted 字段兼容
- [x] Go 网关 Goth 认证 (飞书 SSO + bcrypt 密码 + 激活码 + session 管理)
- [x] Go 网关会话 CRUD + 管理 API + agent/config 端点
- [x] Go 网关 Dockerfile (Railway 部署就绪)
- [x] PostgreSQL schema (Goth auth + 业务表，deploy/sql/)
- [x] Tauri sidecar 管理 (start_agent/stop_agent/agent_status)
- [x] 桌面端登录后自动启动本地 Agent
- [x] 桌面端统一会话请求改为 sidecar RPC (`agent_rpc_send`)
- [x] 输入栏可选本地目录并直接读写文件（无 tar/上传/下载）
- [x] 桌面端核心 UI (登录/聊天/会话管理/模型选择)
- [x] 原生事件流解析 (RPC session_event/done/error + tool/retry/compaction 状态)
- [x] 端到端联调通过 (桌面端 → 本地 agent → LLM)

### 🔲 待完成
- [ ] Railway 部署 (网关 + PostgreSQL)
- [ ] 飞书 SSO 联调 (需飞书开放平台应用凭证)
- [ ] vm-agent 编译为单二进制 (bun build --compile)，打包进 Tauri
- [ ] 向量记忆系统 (Pi Extension + SQLite-vec)
- [ ] 技能植入 (Pi Extension `context` 事件注入 SKILL.md)
- [ ] system prompt 定制 (AGENTS.md/SOUL.md 注入)
- [ ] TLS + 安全加固 (Railway 自带 HTTPS)
- [ ] LXD 远程容器模式 (保留代码，按需启用)

---

## 9. 开发规范

- Go: 标准风格 + `golangci-lint`
- TypeScript: strict mode, ES2022, NodeNext 模块
- Frontend: React 18 + TypeScript (Vite), 纯 CSS 变量主题, 设计 Token 系统 (见下方)
- Rust: Tauri v2 命令, reqwest + futures-util, serde
- 提交: Conventional Commits (`feat:`, `fix:`, `docs:`)
- 分支: `main` (生产) / `develop` / `feature/*`
- 安全: `.gitignore` 保护所有敏感文件 (`.env`, `gateway.yaml`, `data/`)

### 关键约束
- **本地 Agent 优先**: 统一会话请求打本地 sidecar RPC (stdin/stdout)，不经网关
- **网关仅管控面**: 认证、会话 CRUD、管理 API、LLM 配置下发
- **Goth 认证**: 飞书 SSO + bcrypt 密码 + 激活码，网关内集成，无独立认证服务
- **user_id 为 TEXT**: gen_random_uuid()::text
- **Pi SDK 优先**: 使用 Pi SDK 原生功能，不重建已有能力
- **事件流优先**: 首选 sidecar RPC `session_event`；不维护 SSE 双栈
- **Session 隔离**: 每个会话传 `session_id`，vm-agent 按此隔离 Pi SDK session
- **请求字段约定**: `restricted` 当前固定 `false`（开放工具），`workspace` 可选用于限定工作目录
- **模型路由**: `"model-id"` (自动匹配) 或 `"provider/model-id"` (显式指定)
- **启动容错**: `fetchAgentConfig()` 失败不应阻断 sidecar 启动；回退 vm-agent 本地 `.env`

### Agent 启动失败排查（RPC 单栈）

1. 先看右下角 `RPC 日志` 面板（`agent-rpc-log`）最后 20 行。
2. 若出现 `需要 LLM_PROXY_KEY`：补齐 `vm-agent/.env` 或恢复网关 `/api/agent/config`。
3. 若出现 `Agent ready handshake timed out`：检查 `vm-agent/dist/index.js` 是否为最新构建（含 `{"type":"ready"}` 输出）。
4. 若网关可登录但 `GET /api/agent/config` 返回 404：确认当前网关版本是否包含该路由；桌面端应仍可走本地 `.env` 回退。

### 设计语言 (Design Token System) — 强制约束

> 完整规范见 `docs/design-system.md`，Token 定义在 `desktop/src/app.css` 的 `:root`。

**设计风格**: Claude.ai 暖色奶油主题 — `#F5F0EB` 主背景、`#C4724A` 陶土强调色、白色卡片、柔和阴影、大圆角。

**必须遵守**:
1. **禁止魔法数字**: 所有 `padding`/`margin`/`gap` 必须用 `--space-*`；`font-size` 用 `--text-*`；`font-weight` 用 `--font-*`；`border-radius` 用 `--radius-*`；`z-index` 用 `--z-*`；`transition` 时长用 `--duration-*`
2. **颜色必须使用变量**: 禁止在组件 `<style>` 中硬编码 `#hex` / `rgb()` / `rgba()`
3. **白色文字统一**: 强调色/危险色背景上的白色文字用 `var(--text-on-accent)`
4. **Token 类别不混用**: `--space-*` 仅间距，`--radius-*` 仅圆角
5. **组件尺寸标准化**: 按钮/头像/图标使用 `--size-*` token

**允许的例外**: `0`/`auto`/百分比、`1px` 边框宽度、`opacity` 值、`em` 相对值、SVG 属性、`@keyframes` 参数

**新增 Token**: 优先对齐最近的现有 token → 如确需新值，添加到 `app.css :root` 并同步 `docs/design-system.md`
