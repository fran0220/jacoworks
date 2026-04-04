# JAcoworks — 企业 AI 协同办公平台

> Tauri 桌面端 local-first sidecar (bundled runtimes: Python/bash/Node.js) 直接读写本地文件。Go gateway (jingao 云主机, OpenResty 反代) 提供桌面端认证、会话存储、配置下发与管理 API。Go oc-gateway (local x86_64, :18700) 现为 chat.jingao.club 的完整后端，承载 auth/session/cron、WebChat SPA 托管、OpenClaw thin WS relay、JaMOSS、teams/cowork 与 Incus VM 管理。Rust 官网 (Axum, 同机部署) 提供公开页面、文档、反馈、管理后台和 Tauri 更新 API。LLM 中转站 (`http://67.230.182.59:8317`) 统一接入 Claude/GPT/Gemini/Grok。

## AGENTS.md 层级

| 文件 | 内容 |
|------|------|
| `AGENTS.md` (本文件) | 项目概览、架构、数据库、CI/CD、本地开发 |
| `gateway/AGENTS.md` | 双网关说明: gateway(:8847) 桌面端管控面 + oc-gateway(:18700) WebChat 完整后端，含路由拆分、环境变量、测试 |
| `vm-agent/AGENTS.md` | RPC 协议、模型、TS 环境变量、5 层测试、Cron 定时任务、server.ts WS 模式、python 工具 |
| `desktop/AGENTS.md` | local-first sidecar 架构、bundled runtimes、本地 SQLite 持久化、组件结构、Design Token、React 规范 |
| `webchat/AGENTS.md` | React SPA 聊天前端 (chat.jingao.club)、4-Tab 指挥台布局 (workbench/tasks/team/observe)、状态分域 hooks、群聊 (agent attribution + @mention + orchestration)、三栏 WorkbenchView、JaMOSS 集成、移动端适配、WS 协议 |
| `website/AGENTS.md` | 路由、Askama 模板、Rust 规范 |
| `deploy/AGENTS.md` | SQL schema、测试账号、基础设施、部署策略 |
| `openclaw/AGENTS.md` | 团队模板体系、JMOS Go 协作网关、模板生命周期 |
| `.agents/skills/openclaw-integration/` | OpenClaw WS 协议、容器部署、配置陷阱、协议翻译映射 |
| `.agents/skills/releasing-desktop/` | Desktop 发版全流程 (version bump → macOS/Windows 构建 → COS 上传 → DB 注册 → git tag) |

## 架构概览

```
浏览器 ──────────→ Rust 官网 (jaco.jingao.club, OpenResty → :9527)
  │                 ├─ 公开页面 (首页/下载/文档/反馈)
  │                 ├─ 管理后台 (用户/激活码/版本/容器/反馈/审计/设置)
  │                 ├─ Tauri Updater API (GET /api/update/:target/:arch/:version)
  │                 ├─ 直连 PostgreSQL (读写)
  │                 └─ 代理容器操作 → Gateway Admin API

浏览器 ──────────→ WebChat (chat.jingao.club, OpenResty → FRP tunnel → local:18700)
  │                 ├─ /login → 登录页 (oc-gateway serve)
  │                 ├─ /chat → React SPA (oc-gateway serve, 注入 auth token)
  │                 ├─ /static/chat/* → webchat 静态文件
  │                 ├─ /api/auth/* /api/users/me
  │                 ├─ /api/sessions/* /api/cron/*
  │                 ├─ /ws/oc (thin WS relay → OpenClaw VM) + /api/cowork/*
  │                 ├─ /api/teams* /api/jamoss/* /vnc/*
  │                 └─ Incus VM 管理 (OpenClaw + Desktop)

桌面端 / 飞书 Bot ──────────→ OpenResty (jacoapi.jingao.club)
  │
  └─ Go gateway (jingao :8847, 桌面端管控面)
  │    ├─ 认证/会话/配置: /api/auth/* /api/users/me /api/sessions/* /api/agent/config
  │    ├─ 数据能力: /api/memory/* /api/skills/* /api/cron/* /api/feedback /api/games/*
  │    └─ 管理能力: /api/admin/* /api/feishu/* /health

桌面端 ──登录──→ Go gateway (auth/sessions/config/memory/skills/cron/feedback)
  │
  └─ local-first sidecar: vm-agent (Bun 编译二进制, stdin/stdout RPC)
       ├─ bundled runtimes (Python, bash/Git Bash on Windows, Node.js)
       ├─ Pi SDK session → LLM 中转站
       ├─ read/write/glob/grep → 本地 node:fs
       ├─ python → 本地 Python 运行时 (替代旧 powershell 工具)
       ├─ bash → 本地 shell (Windows: Git Bash)
       ├─ memory → 本地 SQLite + FTS5
       ├─ session 持久化 → 本地 SQLite (db.rs)
       └─ cron_manage → 代理到 Gateway API (云端调度)

jingao ──── SSH (公网) ────→ oracle (161.33.13.122)
  ssh opc@oracle                      vm-agent Docker (agent-net 网络, ARM64)
                                      jacoworks/vm-agent:latest

jingao ──── FRP tunnel ────→ local / fan (192.168.31.162)
  ssh root@local (LAN)                oc-gateway (:18700) + webchat 静态文件 + OpenClaw Incus VM, x86_64
  FRP: jingao:7000 → local            Incus VM (Ubuntu Desktop + OpenClaw + JMOS + VNC)
  chat.jingao.club → FRP → :18700    VM 通过 bridge IP (10.193.112.x) 直接暴露端口，无 proxy device
```

**三域部署**: jingao (gateway + website + PostgreSQL + OpenResty) / local (oc-gateway + webchat + OpenClaw Incus VM) / oracle (vm-agent Docker)
**三种客户端**: 桌面端 (Tauri, local-first sidecar + 本地 SQLite) / Web 聊天 (chat.jingao.club) / 管理后台 (jaco.jingao.club/admin/)
**双网关拆分**: gateway 保持桌面端管控面 API；oc-gateway 提供 WebChat 完整后端 (auth/session/cron/SPA + thin WS relay + teams/jamoss/vnc + Incus)
**认证共享**: gateway 与 oc-gateway 读写同一个 `auth_sessions` 表，token 互通
**thin WS relay**: oc-gateway `/ws/oc` 仅做 ticket auth → container lookup → 直连 OpenClaw VM WS → 双向原样帧转发 (~220 行), 浏览器直接收发 OpenClaw 原生协议帧
**跨机**: vm-agent Docker 容器在 oracle (161.33.13.122, ARM64)；OpenClaw Incus VM 与 oc-gateway 同机在 local/fan (192.168.31.162, x86_64)；oc-gateway 通过 SSH tunnel 访问 jingao PostgreSQL
**VM 直连**: OpenClaw VM 通过 Incus bridge 网络获取 IP (10.193.112.x)，服务端口直接暴露，不使用 proxy device。oc-gateway 通过 VM bridge IP 访问 OpenClaw (:18789)、noVNC (:6080)、VNC (:5901)
**团队模板**: OpenClaw VM 支持安装团队模板 (如 JaMOSS), 每个模板创建一组协作 agent (planner/executor/reviewer/patrol), 用户通过 webchat 与 leader agent 对话, 多团队通过 sessionKey 切换 (`agent:<leader-id>:main`)

## 数据库

PostgreSQL (jingao 本地 `127.0.0.1:5432/jacoworks`)。Schema: `deploy/sql/001~014*.sql`

| 表 | 关键字段 |
|-----|------|
| `users` | id TEXT PK, name, email, password_hash, role, feishu_open_id |
| `auth_sessions` | token, user_id → users, expires_at |
| `chat_sessions` | user_id, title, type('chat'\|'cowork'), model, workspace_path, messages JSONB |
| `containers` | (user_id, container_type) UNIQUE, container_name, container_ip, container_token, host_port, container_type, status, config JSONB, desired/applied_config_hash, pairing_status |
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

`user_id` 为 TEXT (gen_random_uuid()::text)。`updated_at` 触发器自动更新。

## CI/CD

| 工作流 | 触发 | 作用 |
|--------|------|------|
| `ci.yml` `go-core` | `gateway/**` 变更 | Go vet + test (共享 `internal/`) |
| `ci.yml` `build-gateway` | `go-core` 通过 | 构建 gateway 二进制 (jingao) |
| `ci.yml` `build-oc-gateway` | `go-core` 通过 | 构建 oc-gateway 二进制 (local) |
| `ci.yml` `build-webchat` | `webchat/**` 变更 | TypeScript 检查 + Vite build |
| `ci.yml` `build-website` | `website/**` 变更 | cargo check + test + build |
| `ci.yml` `desktop-check` | `desktop/**` 变更 | npm check + test |
| `ci.yml` `vm-agent` | `vm-agent/**` 变更 | typecheck + build |
| `issue-autofix.yml` | issue opened/labeled | AI 分诊 (GPT-5.4) → mini-swe-agent (GPT-5.3 Codex) → PR |
| `release-desktop.yml` | git tag `v*` | Tauri 跨平台构建 → distribute-desktop 上传 |
| `distribute-desktop.yml` | workflow_call / workflow_dispatch | SSH jingao → gh 下载产物 → coscli 上传 COS → psql 注册 DB |

**Desktop 发布 (本地)**: `make release V=1.5.0` → 本地 M4 Mac 构建 macOS arm64+x86_64 → coscli 直传 COS → psql 注册 DB → git tag。Windows 在 win-build VM 单独构建。**完整流程见 `.agents/skills/releasing-desktop/` skill**。

### Windows 构建 VM (win-build)

| 项目 | 值 |
|------|-----|
| VM 名称 | win-build (KVM on local 100.97.254.31) |
| VM IP | 192.168.122.98 (NAT 内网, 需通过 local 跳板) |
| OS | Windows 11 LTSC, 用户 builder/build2026 |
| 工具 | Git, Rust, Node.js 22, Bun, VS Build Tools, NSIS |
| 构建目录 | `C:\build\jacoworks` |
| 签名密钥 | `C:\build\tauri-signing.key` |
| SSH 方式 | `sshpass` via local 跳板 (`ssh local 'sshpass -p build2026 ssh builder@192.168.122.98'`) |

### GitHub Secrets

| Secret | 说明 |
|--------|------|
| `JINGAO_HOST` / `JINGAO_SSH_KEY` / `JINGAO_SSH_USER` | jingao SSH |
| `COS_SECRET_ID` / `COS_SECRET_KEY` | 腾讯云 COS (release 安装包存储) |
| `DB_PASSWORD` | PostgreSQL 密码 (CI 注册 release) |
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

连接串: `postgresql://postgres:$DB_PASSWORD@127.0.0.1:5432/jacoworks`（密码见 GitHub Secret `DB_PASSWORD`）

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
make dev-oc-gateway    # OC 网关 → localhost:18700
make dev-website       # Rust 官网 → localhost:9527
make dev-webchat       # Web 聊天 SPA → localhost:5180
make dev-agent         # vm-agent 热重载
make dev-desktop       # Tauri 桌面端 (Vite HMR)
make build-webchat     # 构建 webchat → website/static/chat/
make check             # 全量 lint + typecheck + test
make deploy-jingao     # 桌面端管控面 (gateway + website)
make deploy-local      # WebChat + OpenClaw (oc-gateway + webchat + openclaw)
make deploy-oracle     # vm-agent Docker
make deploy            # 全量部署 (jingao + local + skills)
make deploy-webchat    # 仅 webchat 前端 (构建 + 同步到 local)
```

### 日常工作流

```
1. ssh -L 5432:127.0.0.1:5432 jingao -N -f   # 开隧道
2. make dev-gateway    # 终端 1 (桌面端 API)
3. make dev-oc-gateway # 终端 2 (webchat API)
4. make dev-website    # 终端 3 (官网 + 管理后台)
5. make dev-webchat    # 终端 4 (webchat 前端 HMR)
6. make dev-desktop    # 终端 5 (需要时)
7. make check          # 提交前检查
8. make deploy-jingao  # 部署桌面端管控面
9. make deploy-local   # 部署 WebChat + OpenClaw
```

## 开发规范与约束

**代码风格**: Go 标准 + golangci-lint | TS strict ES2022 NodeNext | React 18 纯 CSS 变量 | Rust Axum + Askama | Conventional Commits

**关键约束**:
- **本地 Agent**: 桌面端对话全部走本地 sidecar RPC，不经网关/容器
- **Cron 云端代理**: 本地 sidecar 的 cron_manage 自动代理到 Gateway API，用户无需切换模式
- **webchat 独立**: `chat.jingao.club` 全部由 oc-gateway 提供，不经 jingao gateway/website
- **网关仅桌面端管控面**: 认证、会话 CRUD、LLM 配置下发、Memory API、云端定时任务调度与后台管理，不处理 WebChat/OpenClaw 实时链路
- **oc-gateway = WebChat 完整后端**: auth + users/me + session + cron + SPA 托管 + `/ws/oc` (thin relay) + Incus + teams + jamoss + VNC
- **认证共享**: 两个网关读写同一张 `auth_sessions` 表，token 互通
- **管理后台仅 jingao**: Rust 网站 `/admin/*` 仅部署在 `jaco.jingao.club`
- **技能本地内置**: `vm-agent/skills/` 跟随代码版本, sidecar 通过 `SKILLS_PATHS` 传入, 不从网关拉取
- **Session 隔离**: `session_id` + `user_id` 隔离 Pi SDK session 和记忆
- **协作前端解耦**: webchat 云端协作通过 ticket auth → OpenResty 路由到 oc-gateway `/ws/oc` → thin relay 直连 OpenClaw VM；与桌面端本地 sidecar 链路完全解耦
- **记忆同步可选**: 本地↔云端记忆同步默认关闭，用户在设置中开启
- **配置集中管理**: LLM 密钥统一由 DB `system_settings` 管理，网关启动加载 + 热重载，无本地 fallback
- **新增配置项四层联动**: 新增 `system_settings` 项必须同时改: ① SQL 迁移 ② 网关 Go ③ 网站 Rust 表单 ④ 线上 DB 执行迁移 (详见 `gateway/AGENTS.md` checklist)

## VM 模板与 Skills 自动同步

### Golden Image (`openclaw-ready` v2)

构建脚本: `deploy/incus/build-openclaw-vm.sh`。完整预装环境：

| 层 | 内容 |
|-----|------|
| **OS & 桌面** | Ubuntu 24.04, XFCE4, TigerVNC :5901, noVNC :6080, CJK/emoji 字体 |
| **运行时** | Node.js 22, Python 3.12 + pip, OpenClaw (latest), JMOS |
| **Python 库** | openpyxl, pandas, requests, beautifulsoup4, lxml, python-docx, Pillow, pyyaml, toml, markdown, chardet, feedparser, yt-dlp |
| **npm 全局** | @doufunao123/asset-gateway, @steipete/bird, mcporter |
| **系统工具** | git, curl, wget, jq, tmux, ffmpeg, ImageMagick, poppler-utils, zip, p7zip, htop, ncdu, tree, sqlite3, gh CLI |
| **办公套件** | LibreOffice Writer/Calc/Impress (文档转换) |
| **互联网能力** | agent-reach (Twitter/YouTube/Reddit/B站/小红书/RSS 等) |

### Skills 自动同步

Skills 文件统一管理在 `openclaw/skills/` 目录，oc-gateway 自动推送到 VM：

| Skill | 类型 | 功能 |
|-------|------|------|
| team-builder | 内置 | Agent 团队构建 |
| word-docx | ClawHub 指令 | Word 文档创建/编辑 |
| excel-xlsx | ClawHub 指令 | Excel 电子表格 |
| asset-gateway | 指令 + CLI | 统一资产生成 (图片/视频/音频/TTS/3D) |
| search | 指令 + Python 脚本 | 多源网页搜索 (Exa + Tavily + Grok) |
| agent-reach | 指令 | 互联网能力 (Twitter/YouTube/Reddit 等) |

**同步触发点**:
- **新用户 Provision**: `WriteConfig()` → `DeploySkills()` 自动推送
- **用户连接 WS**: `EnsureRunning()` → 后台 `DeploySkillsIfChanged()` 按 hash 比较
- **oc-gateway 启动**: 10s 后 `SyncAllVMs()` 遍历所有 RUNNING VM
- **`make deploy-local`**: rsync skills/ → 重启 gateway → 自动同步

**添加新 skill**: 把 SKILL.md 放到 `openclaw/skills/<name>/` → `make deploy-local` → 自动推到所有 VM。

**Credentials**: 从 `oc-gateway.yaml` 的 `llm` 配置读取，Provision 时自动注入 VM 的 `~/.openclaw/credentials/` 和 systemd drop-in。模板见 `openclaw/credentials.example/`。

### OpenClaw 工具权限

当前配置 `tools.deny: ["gateway"]`，即 **除 gateway 外所有工具默认开启**：

| 工具 | 状态 | 说明 |
|------|------|------|
| exec / bash | ✅ | Agent 可执行 shell 命令 |
| write / read / edit | ✅ | Agent 可读写文件 |
| web_search / web_fetch | ✅ | Agent 可搜索/抓取网页 |
| browser | ✅ | Agent 可操作浏览器 |
| cron | ✅ | Agent 可管理定时任务 |
| gateway | ❌ | 防止 Agent 修改自身配置 |
| sandbox | off | VM 本身即隔离边界 |

### 文件预览与下载

webchat 支持 Agent 生成的文件预览和下载：

| 格式 | 预览方式 | 库 |
|------|----------|-----|
| 图片 (PNG/JPG/GIF/SVG) | 缩略图 + 放大查看 | 原生 img |
| PDF | 分页渲染 + 缩放 | pdfjs-dist |
| DOCX | HTML 渲染 | mammoth |
| XLSX | 多 Sheet 表格 | SheetJS |
| CSV | 可排序表格 | 自实现 |
| 代码 | 语法高亮 + 行号 | highlight.js |
| 视频/音频 | 播放器 | 原生 video/audio |
| 其他 | 元信息 + 下载 | — |

**API**: `GET /api/vm/file?path=` (路径直取) + `POST /api/files/upload` (上传)。文件通过 `incus exec cat` 从 VM 代理。上限 50MB，文本预览 1MB。

## VNC 远程桌面

webchat 的「桌面」Tab 通过 noVNC iframe 嵌入用户专属 Incus 桌面 VM。

**⚠️ 关键架构**: 桌面环境运行在 **Incus VM** (虚拟机, `VIRTUAL-MACHINE` 类型), 有独立内核、GPU 直通、完整 Ubuntu Desktop。OpenClaw + JMOS 服务也运行在同一 VM 内。**OpenClaw 全部使用 Incus VM, 项目中仅 oracle 上的 vm-agent 使用 Docker。**

**Golden Image (`openclaw-ready`)**:
- Incus VM (VIRTUAL-MACHINE), Ubuntu 24.04 + XFCE4 桌面
- TigerVNC :5901 + websockify/noVNC :6080 + OpenClaw :18789 + JMOS :6565
- 4 CPU / 4GiB RAM (Provision 时设置)
- 构建脚本: `deploy/incus/build-openclaw-vm.sh`
- VNC 密码: `openclaw`

**VM 网络**: VM 通过 Incus bridge 网络自动获取 IP (10.193.112.x 段)，所有端口直接暴露，**不使用 proxy device**。oc-gateway 通过 `container_ip` 列存储的 bridge IP 直连 VM。

**VNC 代理链路 (已完成)**:
- oc-gateway `/vnc/*` → 反代到 VM bridge IP:6080 (noVNC 静态文件)
- oc-gateway `/websockify` → WS 代理到 VM bridge IP:6080 (noVNC WebSocket)
- webchat `DesktopPanel` 通过 iframe 加载 `/vnc/vnc.html`
- `__OPENCLAW_VNC_URL__` 由 oc-gateway chat.html 模板动态注入

**待完成**:
- [ ] 每用户独立桌面 VM provision (当前单用户验证通过)
- [ ] 桌面 VM 镜像 (预装 Godot + godot-forge CLI + 开发工具)

## Godot 游戏开发集成

设计文档: `docs/godot-integration-plan.md` (早期规划, 基于旧 Docker/ARM64 架构, 需适配 Incus VM/x86_64)

**GodotForge Skill**: `/Users/fan/agent-skills/skills/godotforge/` — AI 驱动 Godot 4.x 开发
- `godot-forge` CLI (`npm i -g @doufunao123/godot-forge`) — 52 条命令, 4 层架构 (L1 纯文件/L2 场景文本/L3a headless/L3b 编辑器同步)
- ForgeSync 插件 (TCP :23685) — Agent CLI 操作时自动同步到编辑器 GUI
- **L3b 编辑器同步是核心**: Agent 通过 CLI 操作 → ForgeSync → Godot 编辑器实时刷新 → 用户通过 VNC 观看

**运行环境**: Incus 桌面 VM (完整 Ubuntu Desktop + Godot 4.4+ 编辑器 GUI + godot-forge CLI)。OpenClaw Agent 运行在同一 VM 或通过网络访问 VM 内的 Godot 项目。

**GodotForge 团队模板** (规划中): `openclaw/templates/godotforge/`
- 7 角色: 游戏制作人 (leader) + 4 专精执行者 (玩法程序员/关卡设计师/UI 开发者/视效音效师) + QA 测试员 + 巡查者
- 使用 JMOS 任务调度 + godotforge skill + godot-forge CLI
- VM 需预装: Godot 4.4+ 编辑器 (Linux x86_64 GUI 版) + godot-forge CLI + Node.js

## 待完成

- [ ] Apple 公证 (notarization) 端到端验证
- [ ] webchat Capacitor 包装 → iOS/Android App
- [ ] 语音 / 文件上传
- [x] WebChat 独立域名部署 (chat.jingao.club → OpenResty → FRP tunnel → oc-gateway)
- [x] 三域分离落地 (jingao / local / oracle)
- [x] 桌面端接入 tauri-plugin-updater (运行时自动检查更新, use-updater.ts)
- [ ] @anthropic-ai/sandbox-runtime 集成 (macOS Seatbelt / Linux bubblewrap)
- [x] JMOS 内置 Incus 基础镜像 (Go 静态二进制 + jmos.service systemd 自启, 33 API 端点全通过)
- [x] Gateway 模板安装 API (GET /api/teams + POST /api/teams/install, 用户自助)
- [x] Webchat 团队管理 (TeamPanel: 查看/安装模板, 切换 sessionKey)
- [x] Webchat 容器前置检查 (SetupGate: 自动 provision → reload)
- [x] Webchat 移动端适配 (safe-area, icon-only tabs, 44px 触控)
- [x] OpenClaw 迁移到 Incus (VM + systemd 服务管理)
- [x] VNC 代理链路 (/vnc/* + /websockify → VM bridge IP:6080)
- [ ] 每用户独立桌面 VM (Incus VM, 基于 openclaw-ready golden image)
- [ ] 桌面 VM 镜像 (预装 Godot 4.4 编辑器 + godot-forge CLI)
- [x] GodotForge 团队模板创建 (7 角色 + prompts + skills)
- [x] VM Golden Image v2 全面预装 (Python/npm/系统工具/LibreOffice/Agent Reach)
- [x] Skills 自动同步机制 (DeploySkills + SyncAllVMs + hash 版本追踪)
- [x] 文件预览与下载 (FileCard + WebPreviewPane + oc-gateway 文件代理)
- [x] Agent Reach 预装 (Twitter/YouTube/Reddit/B站/小红书/RSS)
