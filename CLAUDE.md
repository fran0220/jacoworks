# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目简介

JAcoworks 是企业 AI 协同办公平台。Tauri 桌面端内嵌 vm-agent sidecar (Pi SDK) 直接读写本地文件；Go 网关提供认证、会话存储、WS 代理；Rust 官网提供页面与管理后台；webchat 是 OpenClaw 专属 Web 前端。LLM 中转站统一接入 Claude/GPT/Gemini/Grok/GLM。

## 常用命令

```bash
# 开发 (各模块在独立终端启动)
make dev-gateway          # Go 网关 → localhost:8847
make dev-website          # Rust 官网 → localhost:9527
make dev-desktop          # Tauri 桌面端 (Vite HMR + sidecar)
make dev-agent            # vm-agent 热重载
make dev-webchat          # Web 聊天 SPA → localhost:5180

# 检查 (提交前)
make check                # 全量 lint + typecheck + test
make check-gateway        # go vet + go test
make check-website        # cargo check + cargo test
make check-agent          # typecheck + 单元测试
make check-desktop        # npm run check (typecheck)
make check-webchat        # tsc --noEmit

# 单模块测试
cd gateway && go test ./internal/store/...       # 单包测试
cd gateway && go test -run TestFoo ./...         # 单个测试
cd vm-agent && npm test                          # bun test
cd vm-agent && npm run test:gateway-e2e          # E2E (需真实网关)
cd website && cargo test                         # Rust 测试

# 构建
make build                # 构建 gateway + website + agent
make build-webchat        # 构建 webchat → website/static/chat/
make compile-agent        # 编译 sidecar 二进制 (Tauri 用)
make build-desktop        # 完整桌面安装包

# 部署
make deploy               # 部署 gateway + website + push-skills 到 jingao
make deploy-agent         # 构建 ARM64 镜像 → oracle
make release V=1.5.0      # 完整发布 (构建 macOS + 上传 COS + 注册 DB)
```

## 架构

```
桌面端 (Tauri + React)
  ├─ 本地模式: sidecar RPC (stdin/stdout JSON) → vm-agent → Pi SDK → LLM 中转站
  └─ 云端模式: CloudAgentWS → Gateway /ws/agent → Docker 容器 (同一 RPC 协议)

Web 聊天 (webchat React SPA, OpenClaw 专属)
  └─ ticket auth → Gateway /ws/oc → OpenClaw 容器 (OpenClaw 帧协议)

Go 网关 (Gateway)
  ├─ 认证 (飞书 SSO / bcrypt / 激活码)
  ├─ 会话 CRUD + LLM 配置下发
  ├─ WS 代理 (vm-agent + OpenClaw 双通道)
  ├─ Docker 容器管理 (SSH → oracle/local)
  └─ 云端定时任务调度

Rust 官网 (Website, Axum + Askama)
  ├─ 公开页面 + /chat (嵌入 webchat SPA)
  ├─ 管理后台 + Tauri 更新 API
  └─ 直连 PostgreSQL
```

**双容器后端**: vm-agent (桌面端, oracle ARM64) / OpenClaw (webchat, local x86_64)，通过 `containers.container_type` 区分。

## 模块技术栈

| 模块 | 技术 | 入口文件 |
|------|------|---------|
| `desktop/` | Tauri 2 + React 18 + Vite | `src-tauri/src/lib.rs`, `src/App.tsx` |
| `vm-agent/` | Bun + TypeScript + Pi SDK | `src/index.ts` (RPC), `src/agent.ts` (会话池) |
| `gateway/` | Go 1.25 + pgx/v5 + gorilla/websocket | `cmd/gateway/main.go` |
| `website/` | Rust Axum + Askama + SQLx | `src/main.rs` |
| `webchat/` | React 18 + Vite | `src/App.tsx` |
| `deploy/` | SQL 迁移 + Shell 脚本 | `sql/001~014*.sql` |

## 关键约束

- **本地 Agent 优先**: 对话走 sidecar RPC，不经网关
- **Design Token 强制**: 禁止硬编码颜色/间距/圆角，必须用 CSS 变量 (`--space-*`, `--text-*`, `--radius-*`)；风格为暖色奶油基调 (`#F5F0EB`)
- **React 纯 CSS 变量**: 无 Tailwind、无 CSS-in-JS，样式在 `desktop/src/react/styles/` 按组件拆分
- **配置集中管理**: LLM 密钥统一由 DB `system_settings` 管理，无本地 fallback
- **新增 system_settings 四层联动**: ① SQL 迁移 ② 网关 Go ③ 网站 Rust 表单 ④ 线上 DB 执行迁移
- **Session 隔离**: `session_id` + `user_id` 隔离 Pi SDK session
- **Database as Single Source of Truth**: 本地状态只做缓存
- **Conventional Commits**: 提交信息规范

## 数据库

PostgreSQL，Schema 在 `deploy/sql/`。核心表: `users`, `chat_sessions`, `containers` (user_id + container_type UNIQUE), `system_settings`, `cron_jobs`, `llm_providers`, `llm_models`。

本地开发需先建隧道: `ssh -L 5432:127.0.0.1:5432 jingao -N -f`

## 本地配置文件 (gitignore)

| 文件 | 来源 |
|------|------|
| `gateway/gateway.yaml` | `gateway.yaml.example` |
| `website/website.toml` | `website.toml.example` |
| `vm-agent/.env` | `.env.template` |

## 分层 AGENTS.md

每个模块有独立 AGENTS.md 包含模块级细节（API 端点、RPC 协议、组件规范等），修改特定模块前先阅读对应 AGENTS.md。
