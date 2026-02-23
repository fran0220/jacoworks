# JAcoworks — 企业 AI 协同办公平台

> 每人一个独立 LXD 容器，运行 Pi SDK 轻量 Agent 服务。
> 通过公司 LLM 中转站统一接入 Claude/GPT/Gemini/Grok 四大模型。

---

## 1. 技术栈

| 层级 | 选型 | 说明 |
|------|------|------|
| AI 引擎 | Pi SDK (`@mariozechner/pi-coding-agent`) | 轻量 Agent 框架，9MB，< 50MB 内存 |
| HTTP 桥接 | vm-agent (TypeScript) | Pi SDK → OpenAI 兼容 SSE 端点 (:18789) |
| 管理网关 | Go 自建 | 认证 + 用户路由 + LXD 生命周期 (宿主机运行) |
| 前端 | Tauri v2 + Svelte 5 | 桌面优先，轻量 (~10MB) |
| LLM | 公司中转站 | `http://67.230.171.248:8317`，4 Provider 10+ 模型 |
| 容器 | LXD Per-User VM | 克隆自 `tpl-pi-agent`，1CPU/1GB/5GB |
| 认证 | JWT + Admin Token | 后续对接飞书 SSO |

---

## 2. 代码仓库

**Monorepo**: `github.com/fran0220/jacoworks` (private)

```
JAcoworks/
├── AGENTS.md                        # 本文件
├── .gitignore
├── gateway/                         # Go 管理网关
│   ├── cmd/gateway/main.go          # 入口 (HTTP server + graceful shutdown)
│   ├── internal/
│   │   ├── config/config.go         # 配置 (YAML + env override)
│   │   ├── auth/middleware.go       # JWT 认证 + Admin token 中间件
│   │   ├── proxy/handler.go         # httputil.ReverseProxy → VM Agent (SSE 透传)
│   │   ├── lxd/ssh_client.go        # LXD 容器生命周期 (克隆/启停/冻结/唤醒)
│   │   ├── lxd/freezer.go           # 空闲自动冻结 (30min idle → lxc pause)
│   │   ├── user/store.go            # 用户管理 + user↔container↔token 映射 (SQLite)
│   │   └── audit/logger.go          # 审计日志
│   ├── go.mod
│   ├── gateway.yaml.example
│   ├── Makefile
│   └── Dockerfile
├── vm-agent/                        # Per-VM Agent 服务 (Pi SDK + HTTP 桥接)
│   ├── src/
│   │   ├── index.ts                 # HTTP server (:18789, SSE 流式 + compaction/retry 事件)
│   │   ├── config.ts                # 配置加载 (.env + 环境变量)
│   │   ├── agent.ts                 # Pi SDK session 管理 + 4 Provider 模型注册
│   │   ├── extensions/
│   │   │   └── memory.ts            # 记忆系统 Extension (daily log + MEMORY.md)
│   │   ├── services/
│   │   │   ├── heartbeat.ts         # 心跳服务 (定时 Agent 自检)
│   │   │   └── cron.ts              # 定时任务 (cron 表达式 + Agent 工具)
│   │   ├── lib/
│   │   │   ├── daily-log.ts         # 日志读写工具
│   │   │   └── prompt-queue.ts      # Prompt 串行队列
│   │   └── tools/
│   │       └── web.ts               # 自定义工具 (web_search + web_fetch)
│   ├── package.json                 # @mariozechner/pi-coding-agent, @sinclair/typebox, @mariozechner/pi-ai
│   └── tsconfig.json
├── desktop/                         # Tauri v2 + Svelte 5 桌面客户端
│   ├── src-tauri/
│   │   ├── src/lib.rs               # Tauri 入口 (注册 3 个 Rust 命令)
│   │   ├── src/stream.rs            # SSE 流式桥接 (stream_fetch + stream_abort + http_fetch)
│   │   ├── Cargo.toml
│   │   └── tauri.conf.json
│   ├── src/
│   │   ├── routes/+page.svelte      # 根页面 (Login 或 Chat 布局)
│   │   ├── lib/api.ts               # Fetch shim: Tauri invoke ↔ 浏览器 fetch
│   │   ├── lib/sse.ts               # OpenAI SSE delta 解析器
│   │   ├── lib/auth.svelte.ts       # 登录 + JWT 管理
│   │   ├── lib/sessions.ts          # 会话 CRUD (IndexedDB)
│   │   ├── lib/config.ts            # 网关地址 + 系统提示词
│   │   ├── lib/stores/app.svelte.ts # 全局状态
│   │   ├── lib/components/
│   │   │   ├── LoginPage.svelte
│   │   │   ├── ChatView.svelte
│   │   │   ├── InputBar.svelte
│   │   │   ├── MessageBubble.svelte
│   │   │   ├── Markdown.svelte
│   │   │   ├── SessionList.svelte
│   │   │   └── TopBar.svelte
│   │   └── app.css
│   └── package.json
├── deploy/                          # 部署配置
│   ├── pi-agent/
│   │   ├── pi-agent.service         # systemd 服务
│   │   └── setup.sh                 # VM 初始化脚本
│   ├── gateway/jacoworks-gateway.service
│   └── scripts/sync-openclaw.sh     # (历史, 待清理)
├── shared/                          # 共享资源 (只读挂载到容器)
│   ├── skills/                      # 预制技能包 (SKILL.md)
│   └── docs/                        # 企业知识库
├── docs/                            # 设计文档
└── tasks/                           # 任务追踪
```

---

## 3. 系统架构

```
Tauri 桌面端 → Go 管理网关 (认证+路由) → vm-agent /v1/chat/completions (Per-User VM)
飞书消息    → Go 管理网关 /api/feishu/webhook → vm-agent (待实现)
```

### 3.1 数据流

```
用户请求 → Go 网关 (:8090)
             ├─ JWT 认证
             ├─ 查 user→container 映射
             ├─ 唤醒容器 (如 frozen/stopped)
             └─ httputil.ReverseProxy (FlushInterval: -1)
                  → vm-agent (:18789) in LXD container
                       ├─ Pi SDK createAgentSession
                       ├─ 路由到请求的模型 (model 字段)
                       ├─ Agent Loop: LLM ↔ 工具调用
                       └─ SSE 流式返回 (OpenAI 兼容格式)
```

### 3.2 Go 管理网关

Go module: `github.com/fran0220/jacoworks/gateway`

核心依赖:
- `net/http` + `httputil.ReverseProxy` — SSE 透传 (`FlushInterval: -1`)
- `github.com/golang-jwt/jwt/v5` — JWT 认证
- `github.com/rs/zerolog` — 结构化日志
- `modernc.org/sqlite` — 用户数据 (CGo-free)
- `golang.org/x/crypto/bcrypt` — 密码哈希

API 端点:

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 登录 → JWT (24h 有效) |
| GET | `/api/users/me` | 当前用户 |
| POST | `/v1/chat/completions` | **透传** → 用户 VM 的 vm-agent |
| GET | `/api/admin/containers` | 管理: 列出容器状态 |
| POST | `/api/admin/containers/:id/start` | 管理: 启动容器 |
| POST | `/api/admin/containers/:id/stop` | 管理: 停止容器 |
| POST | `/api/admin/users` | 管理: 创建用户 (自动克隆容器) |
| GET | `/health` | 健康检查 |

容器唤醒策略: 请求到达 → 检查容器状态 → frozen 则 unfreeze → 轮询 `/health` → 透传请求 (超时 10s)

### 3.3 VM Agent (Pi SDK)

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
| `proxy-claude` | `anthropic-messages` | `POST /v1/messages` | claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5 |
| `proxy-gpt` | `openai-completions` | `POST /v1/chat/completions` | gpt-5.3-codex, gpt-5.2 |
| `proxy-gemini` | `openai-completions` | `POST /v1/chat/completions` | gemini-3.1-pro, gemini-3-pro, gemini-3-flash |
| `proxy-grok` | `openai-completions` | `POST /v1/chat/completions` | grok-4.20-beta, grok-4.1-fast |

**请求级模型切换**: 客户端在 `model` 字段指定模型 ID，支持:
- `"claude-sonnet-4-6"` — 自动匹配 provider
- `"proxy-gpt/gpt-5.2"` — 完整路径

**内置工具** (Pi SDK): read, bash, edit, write, grep, find, ls (7 个)
**自定义工具**: web_search (Tavily API), web_fetch (HTTP 抓取)

### 3.4 Tauri 桌面客户端

Rust 侧 3 个 Tauri 命令:
- `stream_fetch` → SSE 流式桥接
- `stream_abort` → 取消流式请求
- `http_fetch` → 同步 HTTP (登录等)

前端数据流:
```
用户输入 → messages[] 追加 → stream_fetch(POST /v1/chat/completions)
                            → Rust reqwest → Go 网关 → vm-agent
                            → emit("stream-response", chunk[]) 逐 chunk
                            → parseSSE → 增量 Markdown 渲染
                            → emit("stream-end") → 存入 IndexedDB
```

---

## 4. LLM 中转站

地址: `http://67.230.171.248:8317` (环境变量 `LLM_PROXY_URL`)
密钥: 环境变量 `LLM_PROXY_KEY`

支持 4 种原生协议:
- Claude: `POST /v1/messages` (Anthropic 原生)
- GPT: `POST /v1/chat/completions` (OpenAI 原生)
- Gemini: OpenAI 兼容 或 `POST /v1beta/models/{model}:generateContent`
- Grok: `POST /v1/chat/completions` (OpenAI 兼容)

全部用同一个 API Key，vm-agent 通过 `registerProvider()` 将同一 key 注入所有 provider。

---

## 5. 基础设施

| 项目 | 值 |
|------|-----|
| 宿主机 | 192.168.31.162 (Ubuntu, SSH: `ssh local`) |
| 宿主机规格 | Ryzen 5 5600H (6C/12T), 62GB RAM, 1.9TB |
| LXD 网络 | `jaconet` (10.10.10.0/24) |
| VM 模板 | `tpl-pi-agent` (待创建, 替代 tpl-openclaw) |
| LLM 中转 | http://67.230.171.248:8317 |
| Go 网关 | 192.168.31.162:8090, systemd: jacoworks-gateway.service |

SSH 连接:
- 宿主机: `ssh local`
- 容器命令: `ssh local "lxc exec <container> -- <cmd>"`

扩容: ≤60 人当前宿主机可承载 (1GB/VM) → 60-120 人扩容内存 → 120+ 人多节点 LXD 集群
空闲策略: `lxc pause` 冻结 + 请求时自动唤醒

---

## 6. 环境变量

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

---

## 7. 待完成

- [ ] 创建 `tpl-pi-agent` VM 模板，部署到宿主机
- [ ] 端到端联调: 桌面端 → Go 网关 → vm-agent
- [ ] 向量记忆系统 (Pi Extension + SQLite-vec)
- [ ] 技能植入 (Pi Extension `context` 事件注入 SKILL.md)
- [ ] 飞书 Webhook 接入 (Go 网关 + 飞书 Bot SDK)
- [ ] system prompt 定制 (AGENTS.md/SOUL.md 注入)
- [ ] 桌面端模型选择器 UI
- [ ] Nginx TLS + 安全加固
- [ ] 灰度发布

---

## 8. 开发规范

- Go: 标准风格 + `golangci-lint`
- TypeScript: strict mode, ES2022, Node16 模块
- Frontend: Svelte 5 runes + TypeScript, 纯 CSS 变量主题
- Rust: Tauri v2 命令, reqwest + futures-util, serde
- 提交: Conventional Commits (`feat:`, `fix:`, `docs:`)
- 分支: `main` (生产) / `develop` / `feature/*`
- 安全: `.gitignore` 保护所有敏感文件 (`.env`, `gateway.yaml`, `data/`)
