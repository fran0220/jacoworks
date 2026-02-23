# JAcoworks — 企业 AI 协同办公平台

> 每人一个独立 LXD 容器，运行 Pi SDK 轻量 Agent 服务。
> 通过公司 LLM 中转站统一接入 Claude/GPT/Gemini/Grok 四大模型。

---

## 1. 技术栈

| 层级 | 选型 | 说明 |
|------|------|------|
| AI 引擎 | Pi SDK (`@mariozechner/pi-coding-agent` ^0.54.2) | 轻量 Agent 框架，9MB，< 50MB 内存 |
| HTTP 桥接 | vm-agent (TypeScript) | Pi SDK → OpenAI 兼容 SSE 端点 (:18789) |
| 认证服务 | Better Auth (TypeScript) | 独立微服务 (:3100)，飞书 SSO + 激活码 + 邮箱密码 |
| 管理网关 | Go 自建 | 会话验证 + 用户路由 + 会话管理 + Cowork + LXD 生命周期 (宿主机运行) |
| 前端 | Tauri v2 + Svelte 5 | 桌面优先，轻量 (~10MB)，支持 Cowork 模式 |
| 数据库 | PostgreSQL 17 (Railway) | Better Auth + Go 网关共用，JSONB 会话存储 |
| LLM | 公司中转站 | `http://67.230.171.248:8317`，4 Provider 11 模型 |
| 容器 | LXD Per-User VM | 克隆自 `tpl-openclaw`，1CPU/1GB/5GB |

---

## 2. 代码仓库

**Monorepo**: `github.com/fran0220/jacoworks` (private)

```
JAcoworks/
├── AGENTS.md                        # 本文件
├── .gitignore
├── auth-service/                    # Better Auth 认证微服务
│   ├── src/
│   │   ├── index.ts                 # Express server (:3100, CORS + BA handler + 激活码)
│   │   ├── auth.ts                  # Better Auth 配置 (PostgreSQL + 飞书 SSO + admin 插件)
│   │   └── invite.ts                # 激活码验证 → BA 创建用户
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
├── gateway/                         # Go 管理网关
│   ├── cmd/gateway/main.go          # 入口 (HTTP server + 会话/Cowork/管理/激活码 API)
│   ├── internal/
│   │   ├── config/config.go         # 配置 (YAML + env override, database.url + auth.auth_service_url)
│   │   ├── auth/middleware.go       # BA session 验证中间件 (调 BA /api/auth/get-session)
│   │   ├── proxy/handler.go         # httputil.ReverseProxy → VM Agent (SSE 透传)
│   │   ├── cowork/handler.go        # Cowork 文件上传/下载/变更检测
│   │   ├── store/                   # PostgreSQL 数据层 (pgx/v5)
│   │   │   ├── pg.go                # pgxpool 连接池 + Store 结构体
│   │   │   ├── containers.go        # 容器映射 CRUD
│   │   │   ├── sessions.go          # 聊天会话 CRUD (chat_sessions 表, JSONB)
│   │   │   └── invites.go           # 激活码 CRUD
│   │   ├── audit/logger.go          # 审计日志 (PostgreSQL)
│   │   └── lxd/                     # LXD 容器生命周期 (克隆/启停/冻结/唤醒/磁盘挂载)
│   ├── go.mod / go.sum
│   ├── gateway.yaml.example
│   ├── Makefile
│   └── Dockerfile
├── vm-agent/                        # Per-VM Agent 服务 (Pi SDK + HTTP 桥接)
│   ├── src/
│   │   ├── index.ts                 # HTTP server (:18789, SSE 流式 + compaction/retry 事件)
│   │   ├── config.ts                # 配置加载 (.env + 环境变量)
│   │   ├── agent.ts                 # Pi SDK session 池 + 4 Provider 模型注册
│   │   ├── extensions/
│   │   │   └── memory.ts            # 记忆系统 Extension (context/agent_end/session_before_compact)
│   │   ├── services/
│   │   │   ├── heartbeat.ts         # 心跳服务 (定时 Agent 自检)
│   │   │   └── cron.ts              # 定时任务 (cron 表达式 + Agent 工具)
│   │   ├── lib/
│   │   │   ├── daily-log.ts         # 日志读写工具 (memory/YYYY-MM-DD.md + MEMORY.md)
│   │   │   └── prompt-queue.ts      # Prompt 串行队列
│   │   └── tools/
│   │       └── web.ts               # 自定义工具 (web_search + web_fetch)
│   ├── package.json
│   └── tsconfig.json
├── desktop/                         # Tauri v2 + Svelte 5 桌面客户端
│   ├── src-tauri/
│   │   ├── src/lib.rs               # Tauri 入口 (注册 8 个 Rust 命令)
│   │   ├── src/stream.rs            # SSE 流式桥接 (stream_fetch + stream_abort + http_fetch)
│   │   ├── src/cowork.rs            # Cowork 文件操作 (tar/上传/下载/目录选择)
│   │   ├── Cargo.toml
│   │   └── tauri.conf.json
│   ├── src/
│   │   ├── routes/+page.svelte      # 根页面 (Login 或 Chat 布局 + 模型传递)
│   │   ├── lib/api.ts               # Fetch shim: Tauri invoke ↔ 浏览器 fetch
│   │   ├── lib/sse.ts               # SSE 解析器 (content/tool_start/status/done 事件)
│   │   ├── lib/auth-client.ts       # Better Auth Svelte 客户端
│   │   ├── lib/auth.svelte.ts       # 三种登录 + BA session 管理 (签名 cookie 持久化)
│   │   ├── lib/sessions.ts          # 会话 CRUD (网关 API，含 model 字段, JSONB)
│   │   ├── lib/cowork.ts            # Cowork 前端 API (选择/上传/拉取)
│   │   ├── lib/config.ts            # 网关地址 + 认证服务地址 + MODEL_OPTIONS (9 模型)
│   │   ├── lib/stores/app.svelte.ts # 全局状态 ($state runes)
│   │   ├── lib/components/
│   │   │   ├── LoginPage.svelte     # 三种登录入口 (邮箱密码 / 激活码 / 飞书 SSO)
│   │   │   ├── ChatView.svelte      # 核心聊天 (SSE 流式 + session_id + 模型路由)
│   │   │   ├── InputBar.svelte      # 输入框 + 附件 (图片/文本文件)
│   │   │   ├── MessageBubble.svelte # 消息气泡 (Markdown + 图片)
│   │   │   ├── Markdown.svelte      # Markdown 渲染 (marked + highlight.js + DOMPurify)
│   │   │   ├── NewSession.svelte    # 新建会话 (模型选择 + Cowork 文件夹)
│   │   │   ├── SessionList.svelte   # 会话侧栏 (chat/cowork 类型图标)
│   │   │   ├── ToolStatus.svelte    # 工具执行状态 (Pi SDK 7 内置 + 3 自定义)
│   │   │   └── TopBar.svelte        # 顶栏 (标题 + 模型徽章 + 用户名)
│   │   └── app.css                  # CSS 变量主题 (暗色/亮色自适应)
│   └── package.json
├── deploy/                          # 部署配置
│   ├── sql/
│   │   ├── 001_init_business_tables.sql  # PostgreSQL 业务表初始化
│   │   └── 002_seed_test_data.sql        # 测试激活码种子数据
│   ├── auth-service/auth-service.service # systemd 服务
│   ├── gateway/jacoworks-gateway.service
│   ├── pi-agent/
│   │   ├── pi-agent.service         # systemd 服务
│   │   └── setup.sh                 # VM 初始化脚本
│   └── scripts/
├── shared/                          # 共享资源 (只读挂载到容器)
│   ├── skills/                      # 预制技能包 (SKILL.md)
│   └── docs/                        # 企业知识库
├── docs/                            # 设计文档
│   └── auth-migration-plan.md       # 认证系统迁移设计文档
└── tasks/                           # 任务追踪
```

---

## 3. 系统架构

```
Tauri 桌面端 ──登录──→ Better Auth 微服务 (:3100)
                        │ ├─ 飞书 SSO (内部员工)
                        │ ├─ 激活码登录 (外部用户)
                        │ └─ 签发 session token (签名 cookie)
                        ↓
Tauri 桌面端 ──业务──→ Go 网关 (:8090)
                        │ ├─ 验证 BA session (HTTP 调用 BA /api/auth/get-session)
                        │ ├─ 查 user→container 映射 (PostgreSQL)
                        │ └─ 透传 → vm-agent (SSE)
                        ↓
                    PostgreSQL (Railway) ← BA + 网关共用
```

### 3.1 认证流程

```
激活码注册:
  桌面端 → POST auth-service/api/activate {code, username, password}
         → 验证激活码 → BA 创建用户 → 返回 user
         → 自动登录 → POST auth-service/api/auth/sign-in/email
         → 返回签名 cookie (set-cookie: better-auth.session_token=<token>.<signature>)

密码登录:
  桌面端 → POST auth-service/api/auth/sign-in/email {email, password}
         → 返回签名 cookie

业务请求:
  桌面端 → Go 网关 (Authorization: Bearer <signed_cookie>)
         → 网关 → BA /api/auth/get-session (Cookie: better-auth.session_token=<signed_cookie>)
         → BA 返回 {session, user} → 网关注入 context → 处理请求
```

### 3.2 数据流 (双模式路由)

```
用户请求 → Go 网关 (:8090) → 认证验证 (session token)
             │
             ├─ Chat 模式 (无 X-Cowork-Session 头)
             │    └─ 直接转发 → 共享 vm-agent (:18790, 宿主机)
             │         ├─ 受限工具: web_search, web_fetch only
             │         ├─ Pi SDK session 隔离 (per session_id)
             │         └─ SSE 流式返回
             │
             └─ Cowork 模式 (有 X-Cowork-Session 头)
                  ├─ 查 user→container 映射 (PostgreSQL)
                  ├─ 唤醒容器 (如 frozen/stopped)
                  └─ httputil.ReverseProxy → vm-agent (:18789) in LXD
                       ├─ 全部工具: bash, edit, read, grep, find, ls, web_*
                       ├─ Pi SDK createAgentSession(session_id)
                       └─ SSE 流式返回
```

**路由决策**: `proxy/handler.go` 通过 `X-Cowork-Session` HTTP 头判断模式。Chat 请求不查容器表，直接转发共享 agent，无容器也能聊天。

### 3.3 Better Auth 认证服务

独立 Node.js 微服务，运行在宿主机 :3100。

核心依赖:
- `better-auth` — 认证框架 (session 管理, OAuth, 用户 CRUD)
- `express` — HTTP 服务
- `pg` — PostgreSQL 连接

**BA 自动管理的表** (首次启动自动创建):
- `user` — 用户主表 (id, name, email, role, ...)
- `session` — 登录会话 (token, userId, expiresAt, ...)
- `account` — OAuth 绑定
- `verification` — 验证令牌

**认证方式**:
- 邮箱密码 (`emailAndPassword: { enabled: true }`)
- 飞书 SSO (`genericOAuth` 插件, 待配置 client_id/secret)
- 激活码 (自定义 `/api/activate` 端点)

**用户注册策略**: 无公开注册。两种渠道:
1. 飞书 SSO — 内部员工自动创建账户
2. 激活码 — 管理员生成一次性激活码，用户通过激活码注册

### 3.4 Go 管理网关

Go module: `github.com/fran0220/jacoworks/gateway`

核心依赖:
- `net/http` + `httputil.ReverseProxy` — SSE 透传 (`FlushInterval: -1`)
- `github.com/jackc/pgx/v5` — PostgreSQL 连接池
- `github.com/rs/zerolog` — 结构化日志

API 端点:

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/users/me` | 当前用户信息 (从 BA session 获取) |
| GET | `/api/sessions` | 列出用户聊天会话 |
| POST | `/api/sessions` | 创建会话 (type: chat/cowork) |
| GET | `/api/sessions/{id}` | 获取会话详情 |
| PUT | `/api/sessions/{id}` | 更新会话 (title/messages) |
| DELETE | `/api/sessions/{id}` | 删除会话 |
| GET | `/api/cowork/container-status` | Cowork: 检查用户容器状态 |
| POST | `/api/cowork/provision` | Cowork: 自助分配容器 (首次进入 cowork 触发) |
| POST | `/api/cowork/{sid}/upload` | Cowork: 上传项目 tar.gz |
| GET | `/api/cowork/{sid}/changes` | Cowork: 获取变更文件列表 |
| GET | `/api/cowork/{sid}/download` | Cowork: 下载变更 tar.gz |
| POST | `/v1/chat/completions` | **透传** → 用户 VM 的 vm-agent (SSE) |
| GET | `/api/admin/containers` | 管理: 列出容器状态 |
| POST | `/api/admin/containers/{id}/start` | 管理: 启动容器 |
| POST | `/api/admin/containers/{id}/stop` | 管理: 停止容器 |
| POST | `/api/admin/provision` | 管理: 为用户分配容器 |
| POST | `/api/admin/invite-codes` | 管理: 生成激活码 |
| GET | `/api/admin/invite-codes` | 管理: 列出激活码 |
| GET | `/health` | 健康检查 |

容器唤醒策略: 请求到达 → 检查容器状态 → frozen 则 unfreeze → 轮询 `/health` → 透传请求 (超时 10s)

### 3.5 VM Agent (Pi SDK)

每个 LXD 容器内运行的 Agent 服务。

**入口**: `vm-agent/src/index.ts` — Node.js HTTP server (:18789)

**核心组件**:
- `config.ts` — 从 `.env` / 环境变量加载配置，支持 `LLM_PROXY_KEY` 或 `ANTHROPIC_API_KEY`
- `agent.ts` — Pi SDK session 池 + `registerProvider()` 注册 4 个中转 Provider
- `extensions/memory.ts` — Pi Extension: daily log + MEMORY.md 记忆系统 (context/agent_end/session_before_compact 事件)
- `services/heartbeat.ts` — 定时心跳 (HEARTBEAT.md → Agent 自检)
- `services/cron.ts` — Cron 定时任务 (cron_manage 工具 + 持久化 cron-jobs.json)
- `lib/prompt-queue.ts` — Prompt 串行队列 (防止 Pi SDK 流式中重复 prompt)
- `lib/daily-log.ts` — 日志 I/O (memory/YYYY-MM-DD.md + MEMORY.md)
- `tools/web.ts` — web_search (Tavily) + web_fetch 自定义工具

**模型注册** (代码内注册，无需 models.json):

| Provider | 协议 | 端点 | 模型 |
|----------|------|------|------|
| `proxy-claude` | `anthropic-messages` | `POST /v1/messages` | claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5-20251001 |
| `proxy-gpt` | `openai-completions` | `POST /v1/chat/completions` | gpt-5.3-codex, gpt-5.2 |
| `proxy-gemini` | `openai-completions` | `POST /v1/chat/completions` | gemini-3.1-pro-preview, gemini-3-pro-preview, gemini-3-flash-preview |
| `proxy-grok` | `openai-completions` | `POST /v1/chat/completions` | grok-4.20-beta, grok-4.1-fast |

**请求级模型切换**: 客户端在 `model` 字段指定模型 ID，支持:
- `"claude-sonnet-4-6"` — 自动匹配 provider
- `"proxy-gpt/gpt-5.2"` — 完整路径

**Session 隔离**: 客户端在 `session_id` 字段传入桌面会话 ID，vm-agent 为每个 session_id 创建独立的 Pi SDK AgentSession，不同会话不共享上下文。

**SSE 事件格式**:
- `data: {"choices":[{"delta":{"content":"..."}}]}` — 文本增量
- `: tool <name> started` — 工具执行开始 (SSE 注释)
- `: compaction started (reason: ...)` — 上下文压缩 (SSE 注释)
- `: retry <n>/<max> (delay: <ms>ms)` — LLM 重试 (SSE 注释)
- `data: [DONE]` — 流结束

**内置工具** (Pi SDK): read, bash, edit, write, grep, find, ls (7 个)
**自定义工具**: web_search (Tavily API), web_fetch (HTTP 抓取), memory_search, memory_save, cron_manage

### 3.6 Tauri 桌面客户端

**Rust 侧命令** (src-tauri/src/):
- `stream_fetch` → SSE 流式桥接 (reqwest stream + Tauri emit)
- `stream_abort` → 取消流式请求 (oneshot channel)
- `http_fetch` → 同步 HTTP (认证/会话 API, 返回 headers 含 set-cookie)
- `select_directory` → 原生文件夹选择对话框
- `tar_directory` → 项目打包 tar.gz (排除 .git/node_modules 等)
- `extract_tar` → 解压 tar.gz 到本地
- `upload_cowork` → 上传 tar.gz 到网关
- `download_cowork` → 下载变更 tar.gz

**前端数据流**:
```
用户输入 → messages[] 追加 → stream_fetch(POST /v1/chat/completions)
  请求体: { model, messages, stream: true, session_id }
  请求头: Authorization: Bearer <BA_signed_cookie>
                            → Rust reqwest → Go 网关 → vm-agent
                            → emit("stream-response", chunk[]) 逐 chunk
                            → parseSSE(content/tool_start/status/done)
                            → 增量 Markdown 渲染 + 工具状态 + compaction/retry 提示
                            → emit("stream-end") → 保存到网关会话 API
```

**登录页**: 三种登录方式标签切换:
- 密码登录: 邮箱 + 密码 → BA sign-in/email
- 激活码: 激活码 + 用户名 + 密码 → auth-service /api/activate → 自动登录
- 飞书 SSO: 按钮跳转 BA OAuth 流程

**模型选择**: NewSession 组件提供 9 个模型下拉 (config.ts MODEL_OPTIONS)，选择后存储在会话对象上，ChatView 在每次请求中传递 `model` 字段，TopBar 显示当前模型徽章。

**Cowork 模式**: 选择本地项目文件夹 → tar + 上传到网关 → 网关挂载到 LXD 容器 → Agent 可直接读写项目文件 → 对话结束后自动拉取变更到本地。

---

## 4. 数据库 Schema

### PostgreSQL (Railway)

连接: `postgresql://postgres:***@trolley.proxy.rlwy.net:28177/railway`

**Better Auth 管理的表** (自动创建，勿手动修改):

| 表 | 说明 |
|-----|------|
| `user` | 用户 (id TEXT, name, email, role, banned, ...) |
| `session` | 登录会话 (token, userId, expiresAt, ...) |
| `account` | OAuth 绑定 |
| `verification` | 验证令牌 |

**Go 网关业务表** (`deploy/sql/001_init_business_tables.sql`):

| 表 | 说明 |
|-----|------|
| `containers` | 用户→容器映射 (user_id TEXT, container_name, container_ip, container_token) |
| `chat_sessions` | 聊天会话 (user_id TEXT, title, type, model, messages JSONB) |
| `invite_codes` | 激活码 (code TEXT PK, role, max_uses, used_count, expires_at) |
| `invite_code_usages` | 激活码使用记录 |
| `audit_logs` | 审计日志 (user_id, action, resource_type, detail JSONB) |

**关键设计**:
- `user_id` 全部为 TEXT 类型 (BA 使用 nanoid/随机字符串)
- 聊天会话表名为 `chat_sessions` (避免与 BA 的 `session` 表冲突)
- `messages` 使用 JSONB 存储，支持 GIN 索引
- `updated_at` 由数据库触发器自动更新

---

## 5. LLM 中转站

地址: `http://67.230.171.248:8317` (环境变量 `LLM_PROXY_URL`)
密钥: 环境变量 `LLM_PROXY_KEY`

支持 4 种原生协议:
- Claude: `POST /v1/messages` (Anthropic 原生)
- GPT: `POST /v1/chat/completions` (OpenAI 原生)
- Gemini: OpenAI 兼容 或 `POST /v1beta/models/{model}:generateContent`
- Grok: `POST /v1/chat/completions` (OpenAI 兼容)

全部用同一个 API Key，vm-agent 通过 `registerProvider()` 将同一 key 注入所有 provider。

---

## 6. 基础设施

| 项目 | 值 |
|------|-----|
| 宿主机 | 192.168.31.162 (Ubuntu 24.04, SSH: `ssh local`) |
| 宿主机规格 | Ryzen 5 5600H (6C/12T), 62GB RAM, 1.9TB |
| LXD 网络 | `jaconet` (10.10.10.0/24) |
| VM 模板 | `tpl-openclaw` (运行中) |
| LLM 中转 | http://67.230.171.248:8317 |
| PostgreSQL | Railway: trolley.proxy.rlwy.net:28177/railway |
| 共享 Chat Agent | 192.168.31.162:18790, systemd: jacoworks-chat-agent.service |
| Go 网关 | 192.168.31.162:8090, systemd: jacoworks-gateway.service |

SSH 连接:
- 宿主机: `ssh local`
- 容器命令: `ssh local "lxc exec <container> -- <cmd>"`

宿主机部署路径:
- `/opt/jacoworks/gateway` — 网关二进制
- `/opt/jacoworks/gateway.yaml` — 网关配置
- `/opt/jacoworks/gateway-src/` — 网关源码 (用于在宿主机编译)
- `/opt/jacoworks/auth-service/` — 认证服务 (Node.js)

扩容: ≤60 人当前宿主机可承载 (1GB/VM) → 60-120 人扩容内存 → 120+ 人多节点 LXD 集群
空闲策略: `lxc pause` 冻结 + 请求时自动唤醒

---

## 7. 环境变量

### auth-service (.env)

| 变量 | 说明 | 示例 |
|------|------|------|
| `DATABASE_URL` | PostgreSQL 连接串 | `postgresql://postgres:xxx@trolley.proxy.rlwy.net:28177/railway` |
| `BETTER_AUTH_SECRET` | 加密密钥 (≥32字符) | 随机生成 |
| `BETTER_AUTH_URL` | BA 服务地址 | `http://192.168.31.162:3100` |
| `PORT` | HTTP 端口 | `3100` |
| `FEISHU_CLIENT_ID` | 飞书应用 ID | 飞书开放平台获取 |
| `FEISHU_CLIENT_SECRET` | 飞书应用密钥 | 飞书开放平台获取 |

### gateway.yaml

```yaml
server:
  port: 8090
  host: "0.0.0.0"
auth:
  admin_token: "<admin-token>"
  auth_service_url: "http://localhost:3100"
database:
  url: "postgresql://postgres:xxx@trolley.proxy.rlwy.net:28177/railway"
lxd:
  ssh_target: "local"
  template: "tpl-openclaw"
  network: "jaconet"
  openclaw_port: 18789
llm:
  proxy_url: "http://67.230.171.248:8317"
  proxy_key: "<key>"
```

### vm-agent (.env)

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LLM_PROXY_URL` | 中转站地址 | `http://67.230.171.248:8317` |
| `LLM_PROXY_KEY` | 中转站密钥 (或 `ANTHROPIC_API_KEY`) | 必填 |
| `PORT` | HTTP 端口 | `18789` |
| `GATEWAY_TOKEN` | Go 网关 Bearer 认证 | 空 = 无认证 |
| `WORKSPACE_DIR` | Agent 工作目录 | `process.cwd()` |
| `PRIMARY_MODEL` | 默认模型 | `claude-sonnet-4-6` |
| `PRIMARY_PROVIDER` | 默认 Provider | `proxy-claude` |
| `MEMORY_ENABLED` | 记忆系统开关 | `true` |
| `HEARTBEAT_ENABLED` | 心跳服务开关 | `false` |
| `HEARTBEAT_INTERVAL` | 心跳间隔 (ms/s/m/h) | `30m` |
| `HEARTBEAT_ACTIVE_START` | 心跳活跃时段起始 | — |
| `HEARTBEAT_ACTIVE_END` | 心跳活跃时段结束 | — |
| `CRON_ENABLED` | Cron 服务开关 | `false` |
| `SKILLS_PATHS` | 技能目录 (逗号分隔) | `/shared/skills,/workspace/skills` |
| `TOOL_DENY_LIST` | 禁用工具 (逗号分隔) | — |
| `TAVILY_API_KEY` | Web 搜索 (可选) | — |

### desktop (config.ts)

| 常量 | 说明 | 值 |
|------|------|-----|
| `GATEWAY_URL` | 网关地址 | `http://192.168.31.162:8090` |
| `AUTH_URL` | 认证服务地址 | `http://192.168.31.162:3100` |

---

## 8. 已完成 & 待完成

### ✅ 已完成
- [x] vm-agent 全功能实现 (Pi SDK session + 4 Provider + memory + heartbeat + cron)
- [x] vm-agent 集成测试通过 (16 tests)
- [x] Go 网关 v1 (JWT + SQLite + 代理 + 会话 CRUD + Cowork + LXD 管理)
- [x] 桌面端核心 UI (登录/聊天/会话管理/Cowork)
- [x] 桌面端 SSE 解析器修复 (支持工具/compaction/retry 注释事件)
- [x] 桌面端模型选择器 (9 模型，NewSession→ChatView→TopBar 全链路)
- [x] 桌面端 session_id 传递 (不同会话隔离 Pi SDK Agent 上下文)
- [x] 桌面端工具状态标签修正 (匹配 Pi SDK 内置工具名)
- [x] 端到端 SSE 流式联调通过 (桌面端→网关→vm-agent→LLM)
- [x] **认证系统迁移**: SQLite JWT → PostgreSQL + Better Auth
- [x] **auth-service 微服务**: Better Auth + 飞书 SSO 结构 + 激活码
- [x] **Go 网关 v2**: pgx/v5 + BA session 验证 + 激活码管理 API
- [x] **桌面端 v2**: 三种登录方式 + BA 签名 cookie + 新 LoginPage
- [x] **PostgreSQL 部署**: Railway, 9 张表 (4 BA + 5 业务)
- [x] **全栈部署**: auth-service + 网关 + 桌面端适配均已上线
- [x] **双模式路由**: Chat → 共享 agent (restricted), Cowork → per-user 容器 (full tools)
- [x] **共享 Chat Agent**: 宿主机 :18790, TOOL_DENY_LIST=bash,edit,write,read,grep,find,ls
- [x] **Cowork 自助分配**: 用户首次进入 cowork 自动分配容器 (无需 admin)

### 🔲 待完成
- [ ] 飞书 SSO 联调 (需飞书开放平台应用凭证)
- [ ] 创建 `tpl-pi-agent` VM 模板，替代 tpl-openclaw
- [ ] 向量记忆系统 (Pi Extension + SQLite-vec)
- [ ] 技能植入 (Pi Extension `context` 事件注入 SKILL.md)
- [ ] 飞书 Webhook 接入 (Go 网关 + 飞书 Bot SDK)
- [ ] system prompt 定制 (AGENTS.md/SOUL.md 注入)
- [ ] Nginx TLS + 安全加固
- [ ] 灰度发布

---

## 9. 开发规范

- Go: 标准风格 + `golangci-lint`
- TypeScript: strict mode, ES2022, NodeNext 模块
- Frontend: Svelte 5 runes + TypeScript, 纯 CSS 变量主题, 设计 Token 系统 (见下方)
- Rust: Tauri v2 命令, reqwest + futures-util, serde
- 提交: Conventional Commits (`feat:`, `fix:`, `docs:`)
- 分支: `main` (生产) / `develop` / `feature/*`
- 安全: `.gitignore` 保护所有敏感文件 (`.env`, `gateway.yaml`, `data/`)

### 关键约束
- **Better Auth 优先**: 认证相关逻辑全部由 auth-service 处理，网关仅验证 session
- **签名 Cookie**: 桌面端存储 BA 签名 cookie (token.signature)，以 Bearer 传给网关，网关以 Cookie 转发给 BA
- **user_id 为 string**: BA 使用随机字符串 ID，所有 user_id 字段均为 TEXT 类型
- **Pi SDK 优先**: 使用 Pi SDK 原生功能，不要重建已有能力
- **SSE 兼容**: vm-agent SSE 流包含 `data:` 行 (OpenAI 格式) + `:` 注释行 (工具/compaction/retry 状态)
- **Session 隔离**: 桌面端每个会话必须传 `session_id`，vm-agent 按此隔离 Pi SDK session
- **模型路由**: `model` 字段支持 `"model-id"` (自动匹配) 或 `"provider/model-id"` (显式指定)
- **chat_sessions**: 聊天会话表名为 `chat_sessions`，避免与 BA 的 `session` 表冲突

### 设计语言 (Design Token System) — 强制约束

> 完整规范见 `docs/design-system.md`，Token 定义在 `desktop/src/app.css` 的 `:root`。

**设计风格**: Claude.ai 暖色奶油主题 — `#F5F0EB` 主背景、`#C4724A` 陶土强调色、白色卡片、柔和阴影、大圆角。

**必须遵守**:
1. **禁止魔法数字**: 所有 `padding`/`margin`/`gap` 必须用 `--space-*` (15 级, 2px 递增)；`font-size` 用 `--text-*` (10 级)；`font-weight` 用 `--font-*`；`border-radius` 用 `--radius-*`；`z-index` 用 `--z-*`；`transition` 时长用 `--duration-*`
2. **颜色必须使用变量**: 禁止在组件 `<style>` 中硬编码 `#hex` / `rgb()` / `rgba()` 颜色值
3. **白色文字统一**: 强调色/危险色背景上的白色文字用 `var(--text-on-accent)`
4. **Token 类别不混用**: `--space-*` 仅用于间距，`--radius-*` 仅用于圆角，`--shadow-sm`/`--shadow-md` 是完整声明，`--shadow-color` 是纯颜色值
5. **组件尺寸标准化**: 按钮/头像/图标使用 `--size-*` token (btn-sm/btn/btn-lg, avatar-sm/avatar, icon-sm/icon/icon-lg)

**允许的例外**: `0`/`auto`/百分比、`1px` 边框宽度、`opacity` 值、`em` 相对值、SVG 属性、`@keyframes` 动画参数、组件唯一的一次性约束 (如 `max-width: 200px`)

**新增 Token 流程**: 优先对齐最近的现有 token → 如确需新值，添加到 `app.css :root` 并同步更新 `docs/design-system.md`
