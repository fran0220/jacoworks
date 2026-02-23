# JAcoworks — 企业 AI 协同办公平台

> 基于 OpenClaw 的内部办公协同平台，为员工提供零配置的 AI Agent 能力。
> 每人一个独立 LXD 容器，完全隔离的文件系统、进程、网络、工作空间和记忆。

---

## 1. 技术栈

| 层级 | 选型 | 说明 |
|------|------|------|
| AI 引擎 | OpenClaw v2026.2.21 | 25+ 工具, 40+ HTTP API, 向量记忆, 3000+ 技能 |
| 管理网关 | Go 自建 | 认证 + 用户路由 + LXD 生命周期 (单实例, 宿主机运行) |
| 前端 | Tauri v2 + Svelte 5 | 桌面优先, 轻量 (~10MB), github.com/fran0220/jacoworks-desktop |
| LLM | 公司中转平台 | `http://67.230.171.248:8317`, Claude/GPT/Gemini/Grok |
| 容器 | LXD Per-User VM | 克隆自 `tpl-openclaw`, 2CPU/2GB/10GB |
| 认证 | SSO / 飞书 | 对接企业现有身份系统 |

---

## 2. 系统架构

```
Tauri 桌面端 → Go 管理网关 (认证+路由) → OpenClaw /v1/chat/completions (Per-User VM)
飞书消息    → OpenClaw 飞书插件 (WebSocket 直连, 绕过网关)
```

Go 网关只做三件事：**认证、路由、LXD 管理**。OpenClaw 已内置 OpenAI 兼容 API + SSE 流式 + 飞书/钉钉/企微插件。

### 2.1 Go 管理网关

```
gateway/
├── cmd/gateway/main.go
├── internal/
│   ├── config/       # 配置 (gateway.yaml)
│   ├── auth/         # Bearer Token / SSO 认证中间件
│   ├── proxy/        # httputil.ReverseProxy → OpenClaw (SSE 透传)
│   ├── lxd/          # LXD 容器生命周期 (克隆/启停/冻结/唤醒)
│   ├── user/         # 用户管理 + user↔container↔token 映射
│   └── audit/        # 审计日志
├── go.mod
└── Dockerfile
```

核心 Go 依赖:
- `net/http` + `httputil.ReverseProxy` — SSE 透传 (`FlushInterval: -1`)
- `github.com/canonical/lxd/client` — LXD 官方 Go SDK
- `github.com/golang-jwt/jwt/v5` — JWT 认证
- `modernc.org/sqlite` — 用户数据 (CGo-free)

API 端点:

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 登录 → JWT |
| GET | `/api/users/me` | 当前用户 |
| POST | `/v1/chat/completions` | **透传** → 用户的 OpenClaw 容器 |
| GET | `/api/admin/containers` | 管理: 列出容器状态 |
| POST | `/api/admin/containers/:id/start` | 管理: 启动容器 |
| POST | `/api/admin/containers/:id/stop` | 管理: 停止容器 |
| POST | `/api/admin/users` | 管理: 创建用户 (自动克隆容器) |

容器唤醒策略: 请求到达 → 检查容器状态 → frozen 则 unfreeze → 轮询 `/health` → 透传请求 (超时 10s)

### 2.2 OpenClaw 配置

配置文件: `deploy/openclaw/openclaw.json` (JSON5 格式)
环境变量: `deploy/openclaw/.env.template`
同步脚本: `deploy/scripts/sync-openclaw.sh [container_name]`

4 个 LLM Provider:
- `proxy-claude` — Anthropic 协议 (`POST /v1/messages`)
- `proxy-gpt` — OpenAI 协议 (`POST /v1/chat/completions`)
- `proxy-gemini` — OpenAI 兼容
- `proxy-grok` — OpenAI 兼容

主模型: `proxy-claude/claude-opus-4-6`, 备用: `proxy-gpt/gpt-5.2`, `proxy-gemini/gemini-3-pro-preview`

Token 策略:
- `OPENCLAW_GATEWAY_TOKEN`: 每容器独立 (`openssl rand -hex 32`)
- `LLM_PROXY_URL/KEY`, `EXA/TAVILY_API_KEY`: 所有容器共享

---

## 3. 基础设施

| 项目 | 值 |
|------|-----|
| 宿主机 | 192.168.31.162 (Ubuntu, SSH: `ssh local`) |
| 宿主机规格 | Ryzen 5 5600H (6C/12T), 62GB RAM, 1.9TB |
| LXD 网络 | `jaconet` (10.10.10.0/24) |
| OpenClaw 模板 | `tpl-openclaw` (10.10.10.126) |
| OpenClaw 版本 | 2026.2.21-2, Gateway 端口 18789 |
| LLM 中转 | http://67.230.171.248:8317 |
| 快照 | `v2-full-verified` (2026-02-22), `gateway-v4-e2e-verified` (2026-02-20) |
| Go 网关 | 192.168.31.162:8090, systemd: jacoworks-gateway.service |

SSH 连接:
- 宿主机: `ssh local`
- 容器命令: `ssh local "lxc exec tpl-openclaw -- <cmd>"`

扩容: ≤30 人当前宿主机可承载 → 30-80 人扩容内存 → 80+ 人多节点 LXD 集群
空闲策略: `lxc pause` 冻结 + 请求时自动唤醒

---

## 4. 已验证功能

| 功能 | 状态 |
|------|------|
| OpenClaw 安装 + 升级 | ✅ v2026.2.21-2 |
| LLM 4 Provider 连接 | ✅ Claude/GPT/Gemini/Grok |
| Gateway `/v1/chat/completions` | ✅ HTTP 200 + SSE |
| 24 个内置工具 | ✅ tools.profile: "full" |
| Chrome 浏览器 (headless) | ✅ Chrome 145 |
| 搜索技能 (Grok/Exa/Tavily) | ✅ 7 skills loaded |
| 配置同步脚本 | ✅ sync-openclaw.sh |
| systemd 开机自启 | ✅ openclaw.service |
| Per-User 容器隔离 | ✅ LXD 天然隔离 |
| 飞书/钉钉/企微插件 | 🔲 待配置 (需飞书应用凭证) |
| 子 Agent (sessions_spawn) | ✅ 需先 `openclaw devices approve` 配对 (operator→admin scope) |
| 向量记忆搜索 (SQLite-vec) | ✅ memory_search + MEMORY.md + local embedding (gemma-300m) |

---

## 5. 项目目录

```
JAcoworks/
├── AGENTS.md                        # 本文件
├── gateway/                         # Go 管理网关
│   ├── cmd/gateway/main.go
│   ├── internal/{config,auth,proxy,lxd,user,audit}/
│   ├── go.mod
│   └── Dockerfile
├── deploy/                          # 部署配置
│   ├── openclaw/                    # OpenClaw 模板 (openclaw.json, .env)
│   ├── scripts/sync-openclaw.sh     # 配置同步脚本
│   ├── lxd/                         # LXD 容器模板
│   └── nginx/                       # 反向代理
├── desktop/                         # Tauri v2 + Svelte 5 桌面客户端 (Phase 4)
├── shared/                          # 共享资源 (只读挂载到容器)
│   ├── skills/                      # 预制技能包 (SKILL.md)
│   └── docs/                        # 企业知识库
├── docs/                            # 设计文档 + 历史归档
└── tasks/                           # 任务追踪
    ├── next-steps.md
    └── lessons.md
```

---

## 6. 路线图

### Phase 1 — 选型 + 验证 ✅

6 方案选型 (OpenClaw/PicoClaw/IronClaw/pi_agent_rust/pi-mono/ZeroClaw) → 选定 OpenClaw

### Phase 2 — OpenClaw 部署 ✅ 完成

容器运行, LLM 连通, 工具可用, 搜索技能安装, 配置同步工作流就绪
向量记忆 (SQLite-vec) ✅, 子 Agent (sessions_spawn + devices approve) ✅, 快照 `v2-full-verified` ✅

### Phase 3 — Go 管理网关 ✅ MVP 完成

- [x] 项目脚手架 + 配置加载 (YAML + env override)
- [x] HTTP 反向代理 + SSE 透传 → OpenClaw (`FlushInterval: -1`)
- [x] JWT 认证中间件 + Admin token
- [x] LXD 容器生命周期 (克隆/启停/冻结/唤醒, SSHClient via `lxc` CLI)
- [x] 用户管理 + user↔container↔token 映射 (SQLite)
- [x] 创建用户自动克隆容器 + 注入 .env + 启动
- [x] E2E: 登录 → JWT → 代理 → OpenClaw → Claude SSE 流式 ✅
- [x] 部署到宿主机 (systemd, port 8090, 无 SSH 隧道)
- [x] 空闲自动冻结 (30min idle → `lxc pause`, 请求到达自动唤醒)
- [x] devices approve 自动化 (ProvisionContainer 中自动批准)

### Phase 4 — Tauri 桌面客户端 (2 周 MVP)

- [x] 项目脚手架 (Tauri v2 + Svelte 5 + Vite)
- [x] Rust SSE 流式桥接 (stream_fetch + stream_abort + http_fetch)
- [x] 登录 + JWT (通过 Rust http_fetch 绕过 CORS)
- [x] Chat UI + SSE 流式 Markdown (marked + highlight.js + DOMPurify)
- [x] 会话管理 (IndexedDB, 新建/切换/删除/自动命名)
- [ ] 端到端联调 (连接 Go 网关实测)
- [ ] UI 打磨 + 构建 .dmg

### Phase 5 — 生产化 (3 周)

- [ ] Nginx TLS + 安全加固
- [ ] 飞书集成 (飞书网关容器方案)
- [ ] 预制技能 x10
- [ ] 灰度发布 10→30→80 人

---

## 7. 开发规范

- Go: 标准风格 + `golangci-lint`
- Frontend: Svelte 5 runes + TypeScript
- 提交: Conventional Commits (`feat:`, `fix:`, `docs:`)
- 分支: `main` (生产) / `develop` / `feature/*`
- 测试: 网关核心端点单元测试 + 端到端集成测试
