# Desktop — Tauri v2 + React 18 桌面客户端

> 本地优先: 对话永远走 sidecar RPC。云端能力 (定时任务、容器协作) 通过任务面板入口访问。记忆同步可选 (默认关闭)。

## 代码结构

```
src-tauri/src/
  lib.rs                       Tauri 入口
  sidecar.rs                   Agent 生命周期 + RPC + 记忆管理 + 技能路径注入
  stream.rs                    http_fetch (网关 API)
  cowork.rs                    目录选择/tar (保留兼容)

src/
  App.tsx                      Login → Agent → 会话 / 任务面板 (含协作入口)
  app.css                      Design Token (:root 变量)
  react/
    components/                LoginPanel Sidebar TopBar ChatView Composer
                               MessageBubble Markdown StreamingMarkdown
                               ToolStatus SkillMenu NewSessionPanel SettingsModal
                               TaskPanel (时间线 UI + 云端对话入口) RpcLogPanel
    hooks/                     use-agent-bootstrap use-chat-stream
                               use-cowork-connection use-responsive-sidebar
                               use-session-state use-cron-results
    lib/                       auth sessions agent cloud-agent-ws transport config
                               recentFolders session-persistence skills
                               skill-sync memory-sync (记忆双向同步)
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

## 开发规范

- **React 18 纯 CSS 变量** (无 CSS-in-JS, 无 Tailwind)
- **CSS 模块化**: 样式拆分到 `react/styles/` 按组件分文件
- **本地对话优先**: NewSessionPanel 无模式切换，对话永远本地 sidecar
- **云端模式统一协议**: 云端 (cowork) 会话通过 `CloudAgentWS` 连接 `/ws/agent?token=`，使用与本地模式相同的 vm-agent RPC 协议 (prompt/abort/session_event/done)，`use-chat-stream` 共享同一 `processStream` 事件处理循环
- **协作入口在任务面板**: TaskPanel 提供「启动云端对话」和「新建定时任务」按钮
- **三色模式体系**: 默认 (陶土 `--accent`)、隐私 (紫灰 `--accent-anonymous`)、云端 (蓝 `--accent-cloud`)。通过 composer/input-card 的 `inset box-shadow` + 发送按钮色 + chat-view 背景微调区分
- **TopBar 云端按钮**: 纯状态指示 — idle 显示「新建云端」触发连接、busy 时 disabled、ready 显示「已连接」toggle 面板、error 显示「重试连接」
- **面板仅 ready 可见**: 连接成功自动打开面板，面板内无连接状态 UI
- **记忆同步**: `memorySyncEnabled` 设置 (默认关)，开启后 syncMemory() 在登录和对话结束后自动执行 (30s 防抖)
- 开发: `make dev-desktop` (Vite HMR + Tauri)
- sidecar 需预编译: `cd ../vm-agent && bun build --compile src/index.ts --outfile dist/vm-agent-aarch64-apple-darwin`

## 技能架构

**内置技能** (`vm-agent/skills/`): 跟随代码版本，sidecar 启动时通过 `SKILLS_PATHS` 环境变量显式传入。
- 生产: 打包到 Tauri resources (`resources/skills/`)
- 开发: 直接引用 monorepo 中的 `vm-agent/skills/`

**用户自建技能** (`app_data/skills/`): 通过设置面板管理，`skill-sync.ts` 负责 push 到网关供 OpenClaw 容器使用。

**网关角色**: 仅存储用户技能副本 (供 OpenClaw)，不再向桌面端下发系统技能。

## Agent 启动排查

1. 看 RPC 日志面板 (`agent-rpc-log`)
2. `需要 LLM_PROXY_KEY` → 检查管理后台「系统设置」中 LLM 密钥配置
3. `Agent ready handshake timed out` → 重新构建 `vm-agent/dist/index.js`
