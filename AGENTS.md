# JAcoworks — Desktop + Gateway + Website

> JAcoworks 现聚焦桌面端与其配套管控面：Tauri 桌面端通过 bundled vm-agent 二进制 sidecar（Bun 编译）为每个会话运行 Pi SDK agent，直接读写本地文件并把会话持久化到本地 SQLite；Go gateway (jingao `:8847`) 提供桌面端认证、会话存储、配置下发、记忆/技能/定时任务/反馈/游戏等 API；Rust 官网 (jingao `:9527`) 提供公开页面、管理后台和 Tauri Updater API；PostgreSQL 部署在 jingao。WebChat、oc-gateway、Incus VM、`hermes-ws-wrapper`、`pi-ws-wrapper` 已拆分到独立仓库 `jaco-cloud`（`/Users/fan/jaco-cloud`）。LLM 运行时网关统一使用 `https://api.xiaomao.chat`，实际密钥与覆盖配置以 DB `system_settings` 为准，仓库内 YAML/JSON 示例值仅作参考。

## AGENTS.md 层级

| 文件 | 内容 |
|------|------|
| `AGENTS.md` (本文件) | 项目概览、架构、数据库、CI/CD、本地开发 |
| `gateway/AGENTS.md` | 桌面端管控面网关、端点、配置、测试 |
| `desktop/AGENTS.md` | Tauri sidecar、本地 SQLite、vm-agent RPC、React 结构 |
| `website/AGENTS.md` | Rust Axum 路由、Askama 模板、管理后台 |
| `deploy/AGENTS.md` | SQL schema、部署流程、发布与基础设施 |
| `vm-agent/AGENTS.md` | Pi SDK agent 二进制 sidecar（Bun 编译，Tauri 捆绑） |
| `.agents/skills/releasing-desktop/` | Desktop 发版全流程 |

涉及 `chat.jingao.club`、WebChat、oc-gateway、云端 Agent 运行时、VM/relay 的工作，请切换到 `jaco-cloud` 仓库查看对应文档。

## 架构概览

```
浏览器 ──────────→ Rust 官网 (jaco.jingao.club, OpenResty → :9527)
  │                 ├─ 公开页面 (首页/下载/文档/反馈)
  │                 ├─ 管理后台 (用户/激活码/版本/反馈/审计/设置)
  │                 ├─ Tauri Updater API (GET /api/update/:target/:arch/:version)
  │                 └─ 直连 PostgreSQL

桌面端 / 飞书 Bot ──────────→ Go gateway (jacoapi.jingao.club, OpenResty → :8847)
  │                           ├─ 认证 / 会话 / 用户信息
  │                           ├─ LLM 配置下发
  │                           ├─ memory / skills / cron / feedback / games
  │                           ├─ 管理后台 API
  │                           └─ 部分历史云端路由保留为 410 Gone 兼容桩

桌面端 ──本地运行──→ Tauri sidecar (vm-agent, Bun 编译二进制)
                      ├─ Pi SDK per-session agent (stdin/stdout JSON lines RPC)
                      ├─ bundled runtimes (Python / bash / Node.js)
                      ├─ read/write/glob/grep → 本地 node:fs
                      ├─ bash → 本地 shell
                      └─ session 持久化 → 本地 SQLite
```

## 拆仓边界

- `jacoworks` 负责桌面端、桌面端后端、官网、管理后台、发布与系统技能。
- `jaco-cloud` 负责 WebChat、oc-gateway、云端协作运行时、VM/relay 与相关部署。
- `skills/` 仍由本仓维护，通过 `make push-skills` 上传到 gateway DB，桌面端再拉取使用。

## 数据库

PostgreSQL 位于 jingao `127.0.0.1:5432/jacoworks`。当前桌面端 / gateway / website 仍使用以下表：

| 表 | 关键字段 |
|-----|------|
| `users` | id TEXT PK, name, email, password_hash, role, feishu_open_id |
| `auth_sessions` | token, user_id → users, expires_at |
| `chat_sessions` | user_id, title, type, model, workspace_path, messages JSONB |
| `containers` | (user_id, container_type) UNIQUE；保留容器元数据，gateway 仍查询 `/api/cowork/container-status` |
| `invite_codes` | code PK, role, max_uses, used_count |
| `audit_logs` | user_id, action, detail JSONB |
| `system_settings` | key TEXT PK, value TEXT, description TEXT |
| `user_memory` | user_id + file_path UNIQUE, content TEXT, checksum TEXT |
| `skill_files` | owner + file_path UNIQUE, content TEXT, checksum TEXT |
| `games` | id TEXT PK, user_id → users, title, play_url, status, play_count |
| `releases` | id TEXT PK, version UNIQUE, notes, pub_date, is_latest BOOL |
| `release_assets` | release_id → releases, platform, download_url, signature |
| `feedback` | id TEXT PK, name, email, category, message, status, admin_reply |
| `cron_jobs` | id TEXT PK, user_id → users, schedule_kind, schedule_expr, prompt, enabled |
| `llm_providers` | key UNIQUE, display_name, api_type, base_url, api_key_ref, enabled |
| `llm_models` | (provider_key, model_id) UNIQUE, display_name, context_window, max_tokens, reasoning, enabled |

`user_id` 为 TEXT (`gen_random_uuid()::text`)；`updated_at` 由触发器自动更新。

## CI/CD

| 工作流 | 作用 |
|--------|------|
| `ci.yml` | 主 CI；其中 `go-core`、`build-gateway`、`build-website`、`desktop-check` 是当前保留的核心 job |
| `issue-autofix.yml` | Issue 分诊与自动修复 |
| `release-preflight.yml` | 桌面端发布前检查 |
| `build-windows.yml` | Windows 构建流程 |
| `release-desktop.yml` | Desktop 发布入口 |
| `distribute-desktop.yml` | COS 上传与 release 资产注册 |
| `test-cos-upload.yml` | COS 上传链路验证 |

**Desktop 发布（本地）**：`make release V=1.5.0`。macOS 在本机构建，Windows 通过 `win-build` VM 构建；完整流程见 `.agents/skills/releasing-desktop/`。

### Windows 构建 VM (win-build)

| 项目 | 值 |
|------|-----|
| VM 名称 | `win-build` (KVM on `local` `100.97.254.31`) |
| VM IP | `192.168.122.98` |
| OS | Windows 11 LTSC |
| 用户 | `builder / build2026` |
| 工具 | Git, Rust, Node.js 22, Bun, VS Build Tools, NSIS |
| 构建目录 | `C:\build\jacoworks` |
| 签名密钥 | `C:\build\tauri-signing.key` |
| SSH 方式 | 通过 `local` 跳板，使用 `sshpass` |

### GitHub Secrets

| Secret | 说明 |
|--------|------|
| `JINGAO_HOST` / `JINGAO_SSH_KEY` / `JINGAO_SSH_USER` | jingao SSH |
| `COS_SECRET_ID` / `COS_SECRET_KEY` | 腾讯云 COS |
| `DB_PASSWORD` | PostgreSQL 密码 |
| `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_KEY_PASSWORD` | Tauri updater 签名 |
| `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` | Apple 证书 |
| `APPLE_SIGNING_IDENTITY` | Developer ID Application |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` | 公证 |
| `LLM_PROXY_URL` / `LLM_PROXY_KEY` | issue-autofix / 发布相关工作流使用 |

## 本地开发

### 数据库连接

```bash
ssh -L 5432:127.0.0.1:5432 jingao -N -f
```

连接串：`postgresql://postgres:$DB_PASSWORD@127.0.0.1:5432/jacoworks`

### 本地配置文件 (gitignore)

| 文件 | 来源 |
|------|------|
| `gateway/gateway.yaml` | `gateway.yaml.example` |
| `website/website.toml` | `website.toml.example` |
| `desktop/.env` | `.env.example` |

### Makefile 命令

```bash
make dev-gateway       # Go gateway → localhost:8847
make dev-website       # Rust 官网 → localhost:9527
make dev-desktop       # Tauri 桌面端开发模式
make build             # 构建服务端组件 (gateway + website)
make build-desktop     # 构建桌面端安装包
make compile-agent     # 编译 sidecar + 准备 release 资源
make check             # 全量检查
make deploy-jingao     # 部署 gateway + website 到 jingao
make push-skills       # 上传 system skills 到 gateway DB
make deploy            # deploy-jingao + push-skills
make release           # 一键桌面端发布
make release-build     # 仅构建发布产物
make release-upload    # 仅上传产物并注册 release
make release-bump      # 仅更新版本号
```

### 日常工作流

```bash
1. ssh -L 5432:127.0.0.1:5432 jingao -N -f
2. make dev-gateway
3. make dev-website
4. make dev-desktop
5. make check
6. make deploy-jingao   # 需要发后端时
7. make push-skills     # 需要更新 system skills 时
```

## 开发规范与约束

**代码风格**：Go 标准 + golangci-lint | TS strict ES2022 NodeNext | React 18 纯 CSS 变量 | Rust Axum + Askama | Conventional Commits

**关键约束**：
- **本地 Agent**：桌面端对话全部走 bundled vm-agent 二进制 sidecar（Bun 编译），通过 stdin/stdout JSON lines RPC 通信，不经过云端运行时。
- **Cron 云端代理**：桌面端的 `cron_manage` 通过 gateway API 管理云端定时任务。
- **Gateway 仅桌面端管控面**：负责认证、会话、LLM 配置下发、memory、skills、cron、feedback、games 与后台管理。
- **Website 仅官网与后台**：`jaco.jingao.club` 承载公开页面、管理后台和 Tauri 更新 API。
- **`skills/` 仍由本仓维护**：通过 `make push-skills` 上传到 gateway DB，桌面端拉取到本地使用。
- **配置集中管理**：LLM 密钥等敏感配置以 DB `system_settings` 为准；示例 YAML/JSON 仅用于开发提示，不是运行时事实来源。
- **新增配置项四层联动**：新增 `system_settings` 项时，必须同步更新 SQL、gateway、website 后台表单，以及线上 DB。

## 已拆出到 jaco-cloud

- WebChat SPA 与 `chat.jingao.club`
- oc-gateway
- 云端协作运行时、relay、VM / VNC / 文件预览链路
- `hermes-ws-wrapper` / `pi-ws-wrapper`
- Incus VM 模板、Golden Image、团队模板部署

需要修改这些能力时，请到 `jaco-cloud` 仓库处理，而不是继续在本仓补云端文档。

## 待完成

- [ ] Apple 公证 (notarization) 端到端验证
- [ ] `@anthropic-ai/sandbox-runtime` 集成（macOS Seatbelt / Linux bubblewrap）
