# Desktop — Tauri v2 + React 18 桌面客户端

> 本地优先: vm-agent 作为 sidecar 进程运行 (stdin/stdout JSON lines RPC)，对话、文件操作、记忆全部本地执行。会话数据持久化到本地 SQLite。捆绑 Python/bash/node 运行时，开箱即用无需用户安装。LLM 密钥由 Gateway 下发。无需云端 Docker 容器。支持运行时自动更新 (tauri-plugin-updater)。

## 代码结构

```
src-tauri/src/
  lib.rs                       Tauri 入口 (文件预览/导入/路径解析)
  db.rs                        本地 SQLite 持久化 (jacoworks.db, WAL 模式, sessions + messages 表, sync_status 追踪)
  sidecar.rs                   Sidecar 进程管理 (start/stop/send) + 本地文件管理 (记忆/技能) + 捆绑运行时 PATH 注入
  stream.rs                    http_fetch (网关 API)
  cowork.rs                    远程文件系统 Tauri 命令 (read/write/list/stat + safe_resolve 安全校验) + 目录选择/tar (保留兼容)

src/
  App.tsx                      Login → Agent → 会话 / 任务面板 (含协作入口)
  app.css                      Design Token (:root 变量)
  react/
    components/                LoginPanel Sidebar TopBar ChatView Composer
                               MessageBubble Markdown StreamingMarkdown
                               ToolStatus SkillMenu NewSessionPanel SettingsModal
                               TaskPanel (时间线 UI + 协作入口) RpcLogPanel
                               AgentationDevTools (dev-only Agentation 调试面板)
                               ClawIcon ConfirmDialog CustomSelect
                               PreviewDrawer (文件预览抽屉, 语法高亮)
    hooks/                     use-agent-bootstrap use-chat-stream
                               use-cowork-connection use-responsive-sidebar
                               use-session-state use-cron-results
                               use-click-outside use-updater (tauri-plugin-updater 自动更新检查/下载/安装)
    lib/                       auth sessions agent agent-transport local-sidecar-transport
                               cloud-agent-ws (仅 webchat 使用) cloud-file-handler
                               transport config recentFolders session-persistence
                               skills memory-sync (记忆双向同步)
                               chat-stream-store (per-session 流状态, useSyncExternalStore)
                               session-store (本地 SQLite CRUD via Tauri invoke)
                               file-utils tool-utils hljs-setup cowork
    cowork/                    容器 API (api.ts) + 遗留类型 (types.ts)
      lib/api.ts               容器状态检查 + 自助分配
    styles/                    按组件拆分 CSS (chat composer layout sidebar task-panel...)
    types.ts                   ChatMessage ChatSession StreamBlock
```

## Design Token — 强制约束

> Token 定义: `src/app.css :root`，完整规范: `docs/design-system.md`

风格: Claude.ai 暖色奶油 — `#F5F0EB` 背景、`#FAF7F4` 卡片/侧栏、`#C4724A` 陶土强调、大圆角。**去边框化**: 用背景色层级 + 阴影替代 border，仅功能性边框保留 (如任务卡片左侧彩色条)。

1. **禁止魔法数字**: spacing 用 `--space-*`、font-size 用 `--text-*`、radius 用 `--radius-*`、z-index 用 `--z-*`、transition 用 `--duration-*`
2. **颜色必须用变量**: 禁止硬编码 `#hex` / `rgb()`
3. **白色文字**: 强调色背景用 `var(--text-on-accent)`
4. 例外: `0`/`auto`/%/`1px`/`opacity`/`em`/SVG/`@keyframes`

## 环境变量

- `VITE_GATEWAY_URL` = `https://jacoapi.jingao.club` (本地: `http://localhost:8847`)
- `DEFAULT_MODEL` = `proxy-claude/claude-opus-4-6`

## 测试

```bash
# Vitest 单元测试
npm test
```

覆盖: auth, sessions, config, transport。

## 捆绑运行时

Desktop 在 `resources/runtimes/` 中捆绑 Python (python-build-standalone)、bash 和 node (Windows only)。`sidecar.rs` 启动 sidecar 前将捆绑运行时 prepend 到 PATH，确保 Python/bash 工具开箱即用，无需用户自行安装。Windows 额外设置 `MSYS2_PATH_TYPE=inherit`。

## 本地会话持久化

`db.rs` 在应用数据目录创建 SQLite (`jacoworks.db`，WAL 模式)，包含 `sessions` 和 `messages` 两张表。每条 session 有 `sync_status` 字段追踪云端同步状态。React 侧通过 `session-store.ts` 调用 Tauri invoke 命令 (`db_init` / `db_upsert_session` / `db_list_sessions` / `db_get_session` / `db_delete_session` / `db_append_message` 等) 进行 CRUD。

## 自动更新

`use-updater.ts` 使用 `@tauri-apps/plugin-updater` 实现运行时自动更新。启动后检查更新 → 展示可用版本 → 用户确认下载安装。更新端点由 Rust 官网提供 (`GET /api/update/:target/:arch/:version`)。

## 开发规范

- **React 18 纯 CSS 变量** (无 CSS-in-JS, 无 Tailwind)
- **CSS 模块化**: 样式拆分到 `react/styles/` 按组件分文件
- **本地对话**: vm-agent sidecar 通过 Tauri 命令 `start_agent` / `agent_rpc_send` / `stop_agent` 管理。启动时注入 `LLM_PROXY_URL` / `LLM_PROXY_KEY` (由 Gateway `GET /api/agent/config` 下发)。RPC 协议为 stdin/stdout JSON lines，事件通过 Tauri `agent-rpc-event` 分发到 React 层
- **本地 Agent**: vm-agent sidecar 为 Bun 编译二进制 (`bun build --compile`)，Pi SDK 提供 `read` / `write` / `glob` / `grep` 等文件操作 (纯 Node.js fs，跨平台)。bash 工具跨平台 (捆绑运行时保证可用, Windows 不再依赖 Git for Windows)
- **WebSocket 文件通道** (仅云端容器使用, 桌面端不涉及): 云端容器通过 WS 按需读写桌面端本地文件 (替代旧 tar 上传/下载)。`CloudAgentWS` 拦截 `fs.*` 消息 → `onFileRequest` → `cloud-file-handler.ts` 分发到 Tauri 命令 (`read_file_text` / `write_file_text` / `list_directory` / `file_stat`)。`use-cowork-connection.ts` 注入 workspace 路径，`cowork.rs` 用 `dunce::canonicalize` + `safe_resolve` 做路径安全校验 (防 `..` 遍历和符号链接逃逸)。目录列表上限 5000 条
- **三色模式体系**: 默认 (陶土 `--accent`)、隐私 (紫灰 `--accent-anonymous`)、云端 (蓝 `--accent-cloud`)。通过 composer/input-card 的 `inset box-shadow` + 发送按钮色 + chat-view 背景微调区分
- **记忆同步**: `memorySyncEnabled` 设置 (默认关)，开启后 syncMemory() 在登录和对话结束后自动执行 (30s 防抖)
- 开发: `make dev-desktop` (Vite HMR + Tauri)

## 技能架构

**数据源**: Gateway DB `skill_files` 表 (owner + file_path UNIQUE)。桌面端通过 REST API CRUD。

**内置技能** (`vm-agent/skills/`): 通过 `make push-skills` 上传到 Gateway DB (owner=system)，桌面端启动后拉取并写入本地技能目录供 sidecar 使用。

**用户自建技能**: 通过设置面板创建/删除，`skills.ts` 调用 Gateway API (`GET/PUT/DELETE /api/skills/{skillId}`)。本地保存到用户 skills 目录后由 sidecar 直接加载。

**SkillMenu 初始化**: `use-agent-bootstrap.ts` 登录后调用 `fetchSkills()` → `setSkills()`，SkillMenu 显示 system + user 技能列表。

**本地生效**: upsert/delete handler 成功后，刷新本地 skills 目录并触发 sidecar 下一轮会话读取，无需容器热推送。

**向后兼容**: 旧 `POST /api/skills/upload` + `GET /api/skills/checksum` + `GET /api/skills/pull` 保留，`push-skills.sh` 继续工作。

## 排查

1. 看 RPC 日志面板 (`agent-rpc-log`)
2. Agent 未启动 → 检查 sidecar 二进制是否存在
3. LLM 密钥缺失 (`需要 LLM_PROXY_KEY`) → 检查管理后台「系统设置」中 LLM 密钥配置
4. bash/Python 不可用 → 检查 `resources/runtimes/` 捆绑运行时是否正确解包
5. sidecar 需预编译: `cd ../vm-agent && bun build --compile src/index.ts --outfile dist/vm-agent-aarch64-apple-darwin`
