# JAcoworks

企业 AI 协同办公平台 — 把 AI 助手用进日常工作。

写文档、处理表格、分析数据、生成图片、整理想法。描述需求，Agent 帮你完成。

## 架构

```
桌面端 (Tauri + React)
  ├─ 本地模式: sidecar RPC → vm-agent → Pi SDK → LLM 中转站
  └─ 协作模式: WebSocket → Go 网关 → WireGuard VPN → LXD 容器 (OpenClaw)

Go 网关 (jacoapi.jingao.club)
  ├─ 认证 (飞书 SSO / 密码 / 激活码)
  ├─ 会话 CRUD (PostgreSQL)
  ├─ LLM 配置下发 & Chat 代理
  └─ OpenClaw WebSocket 代理

Rust 官网 (jaco.jingao.club)
  ├─ 公开页面 (首页/下载/文档/反馈)
  ├─ Tauri Updater API
  └─ 管理后台
```

## 模块

| 目录 | 技术栈 | 说明 |
|------|--------|------|
| `desktop/` | Tauri 2 + React 18 + TypeScript | 桌面客户端 |
| `vm-agent/` | Node.js + Pi SDK | AI Agent sidecar，本地读写文件 |
| `gateway/` | Go + PostgreSQL | API 网关：认证、会话、代理 |
| `website/` | Rust (Axum + Askama) | 官网、文档、管理后台 |
| `deploy/` | SQL + Shell + OpenClaw config | 部署脚本、数据库迁移、容器模板 |

## 双模式

- **本地模式** (`type="chat"`) — Agent 通过 sidecar RPC 直接读写本地文件，对话不经网关
- **协作模式** (`type="cowork"`) — 每用户独立 LXD 容器，WebSocket 经网关代理到 OpenClaw

## 支持模型

通过 LLM 中转站统一接入：

| 模型 | Provider |
|------|----------|
| Claude Sonnet 4.6 / Opus 4.6 | Anthropic |
| GPT-5.3 Codex / GPT-5.2 | OpenAI |
| Gemini 3.1 Pro / Gemini 3 Flash | Google |
| Grok 4.20 | xAI |
| GLM-5 | 智谱 |

## 本地开发

**前置条件**: Go 1.23+, Rust 1.82+, Node.js 22+, Bun 1.2+, PostgreSQL

```bash
# 1. 数据库隧道
ssh -L 5432:127.0.0.1:5432 jingao -N -f

# 2. 复制配置文件
cp gateway/gateway.yaml.example gateway/gateway.yaml
cp website/website.toml.example website/website.toml
cp vm-agent/.env.template vm-agent/.env
cp desktop/.env.example desktop/.env

# 3. 启动各模块 (分别在不同终端)
make dev-gateway    # Go 网关 → localhost:8847
make dev-website    # Rust 官网 → localhost:9527
make dev-desktop    # Tauri 桌面端 (含 sidecar)

# 4. 检查
make check          # lint + typecheck + test
```

更多命令见 `make help`。

## 部署

```bash
make deploy         # SSH 到 jingao → git pull → 编译 → 重启
```

详见 [`deploy/AGENTS.md`](deploy/AGENTS.md)。

## CI/CD

| 工作流 | 触发 | 作用 |
|--------|------|------|
| `ci.yml` | PR / push main | 按模块变更检测，只构建有改动的 job |
| `issue-autofix.yml` | issue opened/labeled | AI 分诊 → 自动修复 → PR |
| `release-desktop.yml` | git tag `v*` | Tauri 构建 → GitHub Release |

## License

Private — 京奥集团内部使用。
