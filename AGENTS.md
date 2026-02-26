# JAcoworks — 企业 AI 协同办公平台

> Tauri 桌面端内嵌 Pi SDK Agent sidecar 直接读写本地文件。Go 网关 (jingao 云主机, OpenResty 反代) 提供认证、会话存储和管理 API。Rust 官网 (Axum, 同机部署) 提供公开页面、文档、反馈、管理后台和 Tauri 更新 API。LLM 中转站 (`http://67.230.171.248:8317`) 统一接入 Claude/GPT/Gemini/Grok。本地宿主机通过 WireGuard VPN 提供 LXD 容器 (OpenClaw)。

## 1. 代码结构

```
gateway/                         Go 管理网关 (jingao :8847, OpenResty 反代 jacoapi.jingao.club)
  cmd/gateway/main.go            入口 (认证 + 会话 CRUD + 管理 + WS 代理)
  internal/
    config/config.go             YAML + env override, ChatAgentConfig
    auth/{middleware,handlers}.go Goth 飞书 SSO + bcrypt + 激活码
    auth/feishu/                 Goth Feishu Provider
    store/{pg,users,sessions,containers,invites,settings,memory,skills}.go  PostgreSQL (pgx/v5)
    proxy/handler.go             ReverseProxy (OpenClaw HTTP + ChatAgent)
    cowork/handler.go            文件操作 (upload/download/changes)
    openclaw/ws_proxy.go         WebSocket 代理 (Ed25519 设备密钥)
    lxd/{client,ssh_client,freezer}.go  LXD 容器生命周期 + 记忆/技能文件推拉
    feishubot/{client,handler}.go  飞书 Bot webhook + 消息路由到容器
    audit/logger.go

vm-agent/                        本地 Agent sidecar (Pi SDK + RPC stdio)
  src/
    index.ts                     RPC 主循环 (stdin/stdout JSON lines)
    config.ts                    环境变量 (网关下发, 无本地 fallback)
    agent.ts                     Session 池 + 4 Provider + per-user 隔离 + title 生成
    prompts/system.ts            系统提示词 (核心身份 + SOUL.md overlay + 动态能力)
    extensions/memory.ts         记忆系统 (向量语义搜索 + Markdown 文件存储)
    services/{heartbeat,cron}.ts 后台服务 (sidecar 模式默认关闭)
    tools/web.ts                 web_search (Tavily) + web_fetch
    lib/embedding.ts             OpenAI Embedding API 客户端 (text-embedding-3-small)
    lib/vector-store.ts          本地向量存储 (JSON 持久化 + 余弦相似度)
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

website/                         Rust 官网 + 管理后台 (Axum :9527, jingao 同机, jaco.jingao.club)
  Cargo.toml                     Axum + Askama + sqlx + pulldown-cmark
  src/
    main.rs                      Axum 入口, 路由注册, admin 登录/登出
    config.rs                    TOML 配置 (website.toml)
    db.rs                        sqlx PgPool 工厂
    error.rs                     AppError → IntoResponse
    auth.rs                      Admin cookie 认证 + AdminUser 提取器 (bcrypt + sha256 双格式)
    models/                      user, invite, release, feedback, audit, session, auth_session
    routes/
      pages.rs                   首页 / 下载 / 关于
      docs.rs                    文档渲染 (Markdown → HTML)
      feedback.rs                反馈表单 (公开)
      update.rs                  Tauri Updater API (GET /api/update/:target/:arch/:version)
      admin/
        mod.rs                   Admin 路由组
        dashboard.rs             统计仪表盘
        users.rs                 用户 CRUD
        invites.rs               激活码管理 (创建/列表/撤销)
        releases.rs              版本发布 (CRUD + 安装包上传)
        containers.rs            容器管理 (代理 Gateway API)
        feedback.rs              反馈管理 (回复/状态变更)
        audit.rs                 审计日志 (分页+筛选)
        settings.rs              系统设置 (LLM 密钥管理, 网关/DB 状态, 模型列表)
    services/
      docs.rs                    Markdown 解析 + TOC + 导航树
      gateway.rs                 Gateway Admin API HTTP 客户端
  templates/                     Askama HTML 模板
    base.html                    公开页面布局 (Tailwind + HTMX CDN)
    pages/{index,download,about}.html
    docs/{layout,index}.html     文档三栏布局
    feedback.html                反馈表单
    admin/
      login.html                 管理登录 (独立布局)
      layout.html                管理后台布局 (深色侧边栏)
      {dashboard,users,invites,releases,release_edit}.html
      {containers,feedback_list,audit,settings}.html
  static/css/style.css           自定义样式
  static/js/app.js               平台检测 + Toast + HTMX 事件
  content/                       Markdown 文档源文件
    index.md                     文档首页
    getting-started.md           快速开始
    guide/{overview,models,workspace,memory,skills,openclaw}.md
    architecture.md              技术架构
    faq.md                       常见问题
    changelog.md                 更新日志

deploy/
  sql/001_init_business_tables.sql   PostgreSQL 全量 schema
  sql/002_website_tables.sql         官网表: releases, release_assets, feedback
  sql/003_system_settings.sql        system_settings 表 (LLM 密钥管理)
  sql/004_memory_and_skills.sql      user_memory + skill_files 表 (记忆/技能同步)
  sql/002_seed_test_data.sql         测试数据 (admin 用户 + 激活码)
  gateway/{frpc.toml,jacoworks-gateway.service,gateway.yaml.example}
  website/{deploy.sh,jacoworks-website.service}
  openclaw/{.env.template,openclaw.json}

.github/workflows/
  ci.yml                           PR/push CI (按模块变更检测, 只跑有改动的 job)
  deploy.yml                       push main 自动部署 gateway/website 到 jingao (SSH)
  release-desktop.yml              git tag v* 触发跨平台 Tauri 构建 → GitHub Release

Makefile                           根目录统一命令入口 (dev/build/deploy/check)
vm-agent/skills/                 预制技能包 (创作/办公/工具)
docs/design-system.md            Design Token 完整规范
docs/ci-cd.md                    CI/CD 与本地开发完整指南
tasks/                           lessons.md next-steps.md
```

## 2. 架构概览

```
浏览器 ──────────→ Rust 官网 (jaco.jingao.club, OpenResty → :9527)
  │                 ├─ 公开页面 (首页/下载/文档/反馈)
  │                 ├─ Tauri Updater API (GET /api/update/:target/:arch/:version)
  │                 ├─ 管理后台 (用户/激活码/版本/容器/反馈/审计/设置)
  │                 ├─ 直连 PostgreSQL (读写)
  │                 └─ 代理容器操作 → Gateway Admin API

桌面端 ──登录/会话──→ Go 网关 (jacoapi.jingao.club, OpenResty → :8847)
  │                    ├─ Goth 认证 (飞书 SSO / bcrypt / 激活码)
  │                    ├─ chat_sessions CRUD (PostgreSQL jingao 本地)
  │                    ├─ GET /api/agent/config → 下发 LLM 密钥
  │                    ├─ POST /v1/chat/completions → OpenClaw/ChatAgent 代理
  │                    └─ GET /ws/openclaw → WS 代理 → WireGuard → 容器 :18789
  │
  ├─ 本地模式: sidecar RPC (stdin/stdout)
  │    vm-agent → Pi SDK session → LLM 中转站
  │    可选 workspace → Agent 直接读写本地文件
  │
  └─ OpenClaw 模式: WebSocket → 网关 WS 代理 → WireGuard VPN → LXD 容器
       Ed25519 设备认证, JSON framing 协议

jingao (82.156.239.212) ←── WireGuard wg1 ──→ jpdata (185.200.65.233) ←── wg0 ──→ oracle (161.33.28.249)
  10.0.1.1/24                       10.0.1.254/24                       10.0.1.3/24
  route 10.20.20.0/24 via wg1      hub (转发 jingao ↔ oracle, ~67ms)   jaconet: 10.20.20.0/24 (LXD)
  ssh opc@10.0.1.3                  xTom Japan, Tokyo                   LXD 容器群 (tpl-openclaw, ARM)
```

**三层服务**: 官网 (浏览器) + 网关 (桌面端 API) + 共享 PostgreSQL (jingao 本地)
**双模式**: 本地 `type="chat"` (sidecar RPC) / OpenClaw `type="cowork"` (WebSocket)
**跨机**: WireGuard VPN 经 jpdata relay 中继连接 jingao ↔ oracle, 网关通过 SSH 管理 LXD, WS 直连容器 IP

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
| POST | `/api/memory/sync` | 记忆双向同步 (manifest + push/pull) |
| POST | `/api/skills/upload` | 技能文件上传 |
| GET | `/api/skills/checksum` | 技能文件校验和 |
| POST | `/api/feishu/webhook` | 飞书 Bot webhook (无需认证) |
| GET | `/api/admin/settings` | 读取系统设置 (LLM 密钥等) |
| PUT | `/api/admin/settings` | 更新系统设置 + 热重载内存配置 |
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

PostgreSQL (jingao 本地 `127.0.0.1:5432/jacoworks`)。Schema: `deploy/sql/001_init_business_tables.sql` + `002_website_tables.sql` + `003_system_settings.sql` + `004_memory_and_skills.sql`

| 表 | 关键字段 |
|-----|------|
| `users` | id TEXT PK, name, email, password_hash, role, feishu_open_id |
| `auth_sessions` | token, user_id → users, expires_at |
| `chat_sessions` | user_id, title, type('chat'\|'cowork'), model, workspace_path, messages JSONB |
| `containers` | user_id UNIQUE, container_name, container_ip, status('running'\|'stopped'\|'frozen'\|'creating'\|'error') |
| `invite_codes` | code PK, role, max_uses, used_count |
| `audit_logs` | user_id, action, detail JSONB |
| `system_settings` | key TEXT PK, value TEXT, description TEXT (LLM 密钥等运行时配置) |
| `user_memory` | user_id + file_path UNIQUE, content TEXT, checksum TEXT |
| `skill_files` | owner + file_path UNIQUE, content TEXT, checksum TEXT (owner='system' 或 user_id) |
| `releases` | id TEXT PK, version UNIQUE, notes, pub_date, is_latest BOOL |
| `release_assets` | release_id → releases, platform, download_url, signature, file_size, download_count |
| `feedback` | id TEXT PK, name, email, category, message, status, admin_reply |

`user_id` 为 TEXT (gen_random_uuid()::text)。`updated_at` 触发器自动更新。

## 6. 环境变量

**gateway.yaml** (宿主机, env override `GATEWAY_*`):
```yaml
server: { port: 8847, host: "0.0.0.0", public_url: "https://jacoapi.jingao.club" }
auth: { admin_token, feishu_client_id, feishu_client_secret, session_ttl_hours: 720 }
database: { url: "postgresql://...@127.0.0.1:5432/jacoworks" }
llm: { proxy_url, proxy_key }   # 留空, LLM 配置统一由 DB system_settings 管理
lxd: { ssh_target: "opc@10.0.1.3", template: "tpl-openclaw", network: "jaconet", openclaw_port: 18789 }
chat_agent: { url, token }  # 可选外部 ChatAgent
```

**vm-agent** (.env, Tauri 启动时注入):
- `LLM_PROXY_URL` / `LLM_PROXY_KEY` — 中转站 (网关下发, 无本地 fallback)
- `WORKSPACE_DIR` — 默认 cwd (可被请求级 workspace 覆盖)
- `MEMORY_ROOT_DIR` — 记忆根目录 (默认 `~/Library/Application Support/JAcoworks/memory`)
- `PRIMARY_MODEL=claude-sonnet-4-6` / `PRIMARY_PROVIDER=proxy-claude`
- `MEMORY_ENABLED=true` / `HEARTBEAT_ENABLED=false` / `CRON_ENABLED=false`
- `SKILLS_PATHS` — 技能目录 (逗号分隔)
- `TOOL_DENY_LIST` / `TAVILY_API_KEY`

**desktop** (config.ts + Vite env):
- `GATEWAY_URL` (`VITE_GATEWAY_URL`) = `https://jacoapi.jingao.club`
- `DEFAULT_MODEL` = `proxy-claude/claude-opus-4-6`

**website** (website.toml, env override `WEBSITE_*`):
```toml
cookie_secret = "32-byte-hex-string"
[server]
host = "0.0.0.0"
port = 9527
[database]
url = "postgresql://...@127.0.0.1:5432/jacoworks"
[gateway]
url = "http://localhost:8847"
admin_token = "your-admin-token"
[site]
name = "JAcoworks"
description = "企业 AI 协同办公平台"
base_url = "https://jaco.jingao.club"
```

## 7. 基础设施

| 服务 | 位置 | 说明 |
|------|------|------|
| Rust 官网 | jingao 82.156.239.212 | :9527, OpenResty 反代 jaco.jingao.club |
| Go 网关 | jingao 82.156.239.212 | :8847, OpenResty 反代 jacoapi.jingao.club |
| PostgreSQL | jingao 本地 | 127.0.0.1:5432/jacoworks |
| 1Panel | jingao 82.156.239.212 | :8090, OpenResty + SSL 证书管理 |
| WireGuard | jingao ↔ jpdata ↔ oracle | wg1: 10.0.1.1 ↔ 10.0.1.254 ↔ 10.0.1.3, UDP 51820 |
| LXD 容器 | oracle 161.33.28.249 | jaconet 10.20.20.0/24, tpl-openclaw (ARM), SSH: `opc@10.0.1.3` |
| LLM 中转站 | 67.230.171.248 | :8317 LLM 中转 |
| WG relay (jpdata) | 185.200.65.233 | :51820 WireGuard hub, xTom Japan Tokyo |
| Oracle 主机 | 161.33.28.249 | Oracle Linux 9.7 ARM, 4 vCPU, 22GB RAM, 200GB Disk |

## 8. CI/CD

### 流水线

| 工作流 | 触发 | 作用 |
|--------|------|------|
| `ci.yml` | PR / push main | 按模块变更检测, 只构建有改动的 job (go vet/test, cargo check/test, tsc) |
| `release-desktop.yml` | git tag `v*` | 构建 vm-agent sidecar → 跨平台 Tauri (macOS/Win/Linux) → GitHub Release |

> **注意**: 自动部署已移除。gateway/website 通过 `make deploy` 手动部署 (SSH 到 jingao 远程 git pull + 本地编译)。

### GitHub Secrets

| Secret | 说明 |
|--------|------|
| `JINGAO_HOST` | jingao 服务器 IP (82.156.239.212) |
| `JINGAO_SSH_KEY` | SSH 私钥, 对应 jingao authorized_keys |
| `JINGAO_SSH_USER` | SSH 用户名 (ubuntu) |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri updater 签名私钥 (minisign, ~/.tauri/jacoworks.key) |
| `TAURI_SIGNING_KEY_PASSWORD` | 签名密钥密码 (jacoworks-updater-2026) |

### 部署策略

- **gateway / website**: `make deploy` → SSH jingao → git pull (经 jpdata SSH 跳板访问 GitHub) → 本地编译 → 重启
- **desktop**: git tag 触发跨平台构建 → GitHub Release (draft → publish)
- **vm-agent**: 打包进 desktop sidecar, 不独立部署

### jingao GitHub 访问

jingao 通过 jpdata (10.0.1.254) 做 SSH ProxyJump 访问 GitHub (GFW 限制直连)：
```
# jingao ~/.ssh/config
Host github.com
    ProxyJump root@10.0.1.254
    IdentityFile ~/.ssh/id_ed25519
```
jingao 的 deploy key 已添加到 GitHub 仓库。代码仓库: `/opt/jacoworks/repo`

## 9. 本地开发

### 数据库连接

Gateway 和 Website 共享 jingao 上的 PostgreSQL, 本地通过 SSH 隧道访问:

```bash
# 开隧道 (后台运行)
ssh -L 5432:127.0.0.1:5432 jingao -N -f

# 验证
pg_isready -h 127.0.0.1 -p 5432
```

连接串: `postgresql://postgres:jacoworks-jingao-2026@127.0.0.1:5432/jacoworks`

灌入测试数据:
```bash
psql "postgresql://postgres:jacoworks-jingao-2026@127.0.0.1:5432/jacoworks" \
  -f deploy/sql/002_seed_test_data.sql
```

测试账号: `admin@jacoworks.local` / `admin123` (role=admin)
测试激活码: `JACO-TEST-2026` (admin) / `JACO-USER-2026` (user)

### 本地配置文件 (gitignore, 不入库)

| 文件 | 来源 | 关键修改 |
|------|------|---------|
| `gateway/gateway.yaml` | `gateway.yaml.example` | `database.url` 指向隧道, `port: 8847` |
| `website/website.toml` | `website.toml.example` | `database.url` 指向隧道, `admin_token` 对齐 gateway |
| `vm-agent/.env` | `.env.template` | `LLM_PROXY_URL` + `LLM_PROXY_KEY` |
| `desktop/.env` | `.env.example` | `VITE_GATEWAY_URL=http://localhost:8847` |

### Makefile 命令

```bash
make help              # 查看所有命令
make dev-gateway       # Go 网关 → localhost:8847
make dev-website       # Rust 官网 → localhost:9527
make dev-agent         # vm-agent 热重载 (调试用)
make dev-desktop       # Tauri 桌面端 (Vite HMR)
make check             # 全量 lint + typecheck + test
make build             # 构建所有服务端组件
make deploy            # SSH jingao 远程 git pull + 编译 + 重启
make deploy-gateway    # 仅部署 Gateway
make deploy-website    # 仅部署 Website
make deploy-sync       # 仅同步代码 (git pull)
make clean             # 清理构建产物
```

### 日常工作流

```
1. ssh -L 5432:127.0.0.1:5432 jingao -N -f   # 开隧道
2. make dev-gateway    # 终端 1
3. make dev-website    # 终端 2
4. make dev-desktop    # 终端 3 (连本地 gateway)
5. make check          # 提交前检查
6. git push            # CI 自动跑检查
7. make deploy         # 手动部署到 jingao (远程编译)
```

## 10. 待完成

- [x] TLS (OpenResty + Let's Encrypt via 1Panel)
- [x] CI/CD (GitHub Actions: ci + release-desktop)
- [x] 本地开发环境 (SSH 隧道 + Makefile + 配置模板)
- [x] 官网 admin 登录 bcrypt 支持 (对齐网关, 自动检测哈希格式)
- [x] LLM 密钥集中管理 (system_settings 表 + 网关热重载 + admin UI)
- [x] 移除本地 fallback (vm-agent/desktop 仅从网关获取 LLM 配置)
- [x] 飞书 SSO 联调 (凭证已配置, Goth Provider 热重载已修复)
- [x] 飞书 Bot 消息路由 (feishubot 包, webhook → 容器路由)
- [x] 向量记忆系统 (OpenAI Embedding API + 本地 JSON 向量缓存, 与 OpenClaw 同架构)
- [x] 记忆/技能同步 (gateway API + 容器冻结前拉取 + 解冻后推送)
- [x] Tauri updater 签名密钥 (minisign 密钥对 + pubkey 写入 tauri.conf.json)
- [x] GitHub Secrets 配置 (JINGAO_HOST/SSH_KEY/SSH_USER + TAURI_SIGNING_*)
- [x] 官网下载页对接 releases 表 + 平台检测
- [x] jingao GitHub 访问 (jpdata SSH ProxyJump + deploy key)
- [ ] 飞书 SSO 端到端验证 (桌面端发起 → 回调 → 登录成功)
- [ ] 飞书 Bot 联调 (飞书开放平台事件订阅 + 权限审批)
- [ ] vm-agent 编译为单二进制 (bun build --compile)
- [x] 预制技能 (vm-agent/skills/ — 创作/办公/工具 三大类)
- [ ] 移动端 / 语音 / 文件上传
- [ ] 首次 Tauri 构建 + 发布流程打通 (git tag v0.1.0 端到端验证)
- [ ] 桌面端接入 tauri-plugin-updater (运行时自动检查更新)

## 11. 开发规范与约束

**代码风格**: Go 标准 + golangci-lint | TS strict ES2022 NodeNext | React 18 纯 CSS 变量 | Rust Tauri v2 + Axum (官网) | Conventional Commits

**关键约束**:
- **本地 Agent 优先**: 对话走 sidecar RPC，不经网关
- **网关仅管控面**: 认证、会话 CRUD、LLM 配置下发、WS 代理
- **Session 隔离**: `session_id` + `user_id` 隔离 Pi SDK session 和记忆
- **OpenClaw 前端解耦**: `openclaw/` 不复用本地组件，仅共享 auth/config/transport
- **配置集中管理**: LLM 密钥统一由 DB `system_settings` 管理，网关启动加载 + 热重载，无本地 fallback
- **CSS 模块化**: 样式拆分到 `react/styles/` 按组件分文件

**Agent 启动排查**:
1. 看 RPC 日志面板 (`agent-rpc-log`)
2. `需要 LLM_PROXY_KEY` → 检查管理后台「系统设置」中 LLM 密钥配置
3. `Agent ready handshake timed out` → 重新构建 `vm-agent/dist/index.js`

### Design Token — 强制约束

> Token 定义: `desktop/src/app.css :root`，完整规范: `docs/design-system.md`

风格: Claude.ai 暖色奶油 — `#F5F0EB` 背景、`#C4724A` 陶土强调、白色卡片、大圆角。

1. **禁止魔法数字**: spacing 用 `--space-*`、font-size 用 `--text-*`、radius 用 `--radius-*`、z-index 用 `--z-*`、transition 用 `--duration-*`
2. **颜色必须用变量**: 禁止硬编码 `#hex` / `rgb()`
3. **白色文字**: 强调色背景用 `var(--text-on-accent)`
4. 例外: `0`/`auto`/%/`1px`/`opacity`/`em`/SVG/`@keyframes`
