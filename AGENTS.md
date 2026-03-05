# JAcoworks — 企业 AI 协同办公平台

> Tauri 桌面端内嵌 Pi SDK Agent sidecar 直接读写本地文件。Go 网关 (jingao 云主机, OpenResty 反代) 提供认证、会话存储和管理 API。Rust 官网 (Axum, 同机部署) 提供公开页面、文档、反馈、管理后台和 Tauri 更新 API。LLM 中转站 (`http://67.230.182.59:8317`) 统一接入 Claude/GPT/Gemini/Grok。本地宿主机通过 WireGuard VPN 提供 LXD 容器 (OpenClaw)。

## AGENTS.md 层级

| 文件 | 内容 |
|------|------|
| `AGENTS.md` (本文件) | 项目概览、架构、数据库、CI/CD、本地开发 |
| `gateway/AGENTS.md` | API 端点、Go 环境变量、测试 |
| `vm-agent/AGENTS.md` | RPC 协议、模型、TS 环境变量、4 层测试 |
| `desktop/AGENTS.md` | 组件结构、Design Token、React 规范 |
| `website/AGENTS.md` | 路由、Askama 模板、Rust 规范 |
| `deploy/AGENTS.md` | SQL schema、测试账号、基础设施、部署策略 |

## 架构概览

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

## 数据库

PostgreSQL (jingao 本地 `127.0.0.1:5432/jacoworks`)。Schema: `deploy/sql/001~005*.sql`

| 表 | 关键字段 |
|-----|------|
| `users` | id TEXT PK, name, email, password_hash, role, feishu_open_id |
| `auth_sessions` | token, user_id → users, expires_at |
| `chat_sessions` | user_id, title, type('chat'\|'cowork'), model, workspace_path, messages JSONB |
| `containers` | user_id UNIQUE, container_name, container_ip, status |
| `invite_codes` | code PK, role, max_uses, used_count |
| `audit_logs` | user_id, action, detail JSONB |
| `system_settings` | key TEXT PK, value TEXT, description TEXT |
| `user_memory` | user_id + file_path UNIQUE, content TEXT, checksum TEXT |
| `skill_files` | owner + file_path UNIQUE, content TEXT, checksum TEXT |
| `games` | id TEXT PK, user_id → users, title, play_url, status, play_count |
| `releases` | id TEXT PK, version UNIQUE, notes, pub_date, is_latest BOOL |
| `release_assets` | release_id → releases, platform, download_url, signature |
| `feedback` | id TEXT PK, name, email, category, message, status, admin_reply |

`user_id` 为 TEXT (gen_random_uuid()::text)。`updated_at` 触发器自动更新。

## CI/CD

| 工作流 | 触发 | 作用 |
|--------|------|------|
| `ci.yml` | PR / push main | 按模块变更检测, 只构建有改动的 job |
| `issue-autofix.yml` | issue opened/labeled | AI 分诊 (GPT-5.2) → mini-swe-agent (GPT-5.3 Codex) → PR |
| `release-desktop.yml` | git tag `v*` | (CI 付费暂停) Tauri 构建 → GitHub Release |

**部署**: `make deploy` → SSH jingao → git pull (经 jpdata SSH 跳板) → 本地编译 → 重启。详见 `deploy/AGENTS.md`。

### Windows 构建 VM (win-build)

| 项目 | 值 |
|------|-----|
| VM IP | 192.168.122.98 (KVM on 192.168.31.162) |
| OS | Windows 11 LTSC, 用户 builder/build2026 |
| 工具 | Git, Rust, Node.js 22, Bun, VS Build Tools, NSIS |
| 构建目录 | `C:\build\jacoworks` |
| 签名密钥 | `C:\build\tauri-signing.key` |

### GitHub Secrets

| Secret | 说明 |
|--------|------|
| `JINGAO_HOST` / `JINGAO_SSH_KEY` / `JINGAO_SSH_USER` | jingao SSH |
| `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_KEY_PASSWORD` | Tauri updater 签名 |
| `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` | .p12 |
| `APPLE_SIGNING_IDENTITY` | Developer ID Application: fan Z (9UUWCMKMDH) |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` | 公证 |
| `LLM_PROXY_URL` / `LLM_PROXY_KEY` | issue-autofix |

## 本地开发

### 数据库连接

```bash
ssh -L 5432:127.0.0.1:5432 jingao -N -f
```

连接串: `postgresql://postgres:jacoworks-jingao-2026@127.0.0.1:5432/jacoworks`

### 本地配置文件 (gitignore)

| 文件 | 来源 |
|------|------|
| `gateway/gateway.yaml` | `gateway.yaml.example` |
| `website/website.toml` | `website.toml.example` |
| `vm-agent/.env` | `.env.template` |
| `desktop/.env` | `.env.example` |

### Makefile 命令

```bash
make dev-gateway       # Go 网关 → localhost:8847
make dev-website       # Rust 官网 → localhost:9527
make dev-agent         # vm-agent 热重载
make dev-desktop       # Tauri 桌面端 (Vite HMR)
make check             # 全量 lint + typecheck + test
make deploy            # SSH jingao 远程 git pull + 编译 + 重启
```

### 日常工作流

```
1. ssh -L 5432:127.0.0.1:5432 jingao -N -f   # 开隧道
2. make dev-gateway    # 终端 1
3. make dev-website    # 终端 2
4. make dev-desktop    # 终端 3
5. make check          # 提交前检查
6. make deploy         # 手动部署
```

## 开发规范与约束

**代码风格**: Go 标准 + golangci-lint | TS strict ES2022 NodeNext | React 18 纯 CSS 变量 | Rust Axum + Askama | Conventional Commits

**关键约束**:
- **本地 Agent 优先**: 对话走 sidecar RPC，不经网关
- **网关仅管控面**: 认证、会话 CRUD、LLM 配置下发、WS 代理
- **Session 隔离**: `session_id` + `user_id` 隔离 Pi SDK session 和记忆
- **OpenClaw 前端解耦**: `openclaw/` 不复用本地组件，仅共享 auth/config/transport
- **配置集中管理**: LLM 密钥统一由 DB `system_settings` 管理，网关启动加载 + 热重载，无本地 fallback

## 待完成

- [ ] 飞书 SSO 端到端验证 (桌面端发起 → 回调 → 登录成功)
- [ ] 飞书 Bot 联调 (飞书开放平台事件订阅 + 权限审批)
- [ ] Apple 公证 (notarization) 端到端验证
- [ ] 移动端 / 语音 / 文件上传
- [ ] 桌面端接入 tauri-plugin-updater (运行时自动检查更新)
