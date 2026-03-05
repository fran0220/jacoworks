# JAcoworks — 企业 AI 协同办公平台

> Tauri 桌面端内嵌 Pi SDK Agent sidecar 直接读写本地文件。Go 网关 (jingao 云主机, OpenResty 反代) 提供认证、会话存储和管理 API。Rust 官网 (Axum, 同机部署) 提供公开页面、文档、反馈、管理后台和 Tauri 更新 API。LLM 中转站 (`http://67.230.182.59:8317`) 统一接入 Claude/GPT/Gemini/Grok。oracle 主机通过 SSH 管理 Docker 容器。

## AGENTS.md 层级

| 文件 | 内容 |
|------|------|
| `AGENTS.md` (本文件) | 项目概览、架构、数据库、CI/CD、本地开发 |
| `gateway/AGENTS.md` | API 端点、Go 环境变量、测试 |
| `vm-agent/AGENTS.md` | RPC 协议、模型、TS 环境变量、5 层测试、Cron 定时任务 |
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
  │                    ├─ POST /v1/chat/completions → ChatAgent 代理
  │                    └─ GET /ws/agent → WS 代理 → SSH → 容器端口
  │
  ├─ 本地模式: sidecar RPC (stdin/stdout)
  │    vm-agent → Pi SDK session → LLM 中转站
  │    可选 workspace → Agent 直接读写本地文件
  │
  └─ 协作模式: WebSocket → 网关 WS 代理 → SSH → Docker 容器
       Ed25519 设备认证, JSON framing 协议

jingao (82.156.239.212) ──── SSH ────→ oracle (161.33.28.249)
  ssh opc@10.0.1.3                    Docker 容器群 (agent-net 网络)
                                      jacoworks/vm-agent:latest, ARM
```

**三层服务**: 官网 (浏览器) + 网关 (桌面端 API) + 共享 PostgreSQL (jingao 本地)
**双模式**: 本地 `type="chat"` (sidecar RPC) / 协作 `type="cowork"` (WebSocket)
**跨机**: 网关通过 SSH 管理 oracle 上的 Docker 容器, WS 连接容器端口

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
make deploy            # 部署 gateway + website 到 jingao
make deploy-agent      # 构建 ARM64 镜像 → 部署到 oracle
```

### 日常工作流

```
1. ssh -L 5432:127.0.0.1:5432 jingao -N -f   # 开隧道
2. make dev-gateway    # 终端 1
3. make dev-website    # 终端 2
4. make dev-desktop    # 终端 3
5. make check          # 提交前检查
6. make deploy         # 部署 gateway + website
7. make deploy-agent   # 部署 vm-agent 到 oracle (需要时)
```

## 开发规范与约束

**代码风格**: Go 标准 + golangci-lint | TS strict ES2022 NodeNext | React 18 纯 CSS 变量 | Rust Axum + Askama | Conventional Commits

**关键约束**:
- **本地 Agent 优先**: 对话走 sidecar RPC，不经网关
- **网关仅管控面**: 认证、会话 CRUD、LLM 配置下发、WS 代理
- **技能本地内置**: `vm-agent/skills/` 跟随代码版本, sidecar 通过 `SKILLS_PATHS` 传入, 不从网关拉取
- **Session 隔离**: `session_id` + `user_id` 隔离 Pi SDK session 和记忆
- **协作前端解耦**: `cowork/` 不复用本地组件，仅共享 auth/config/transport
- **配置集中管理**: LLM 密钥统一由 DB `system_settings` 管理，网关启动加载 + 热重载，无本地 fallback

## 待完成

- [ ] Apple 公证 (notarization) 端到端验证
- [ ] 移动端 / 语音 / 文件上传
- [ ] 桌面端接入 tauri-plugin-updater (运行时自动检查更新)
