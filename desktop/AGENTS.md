# Desktop — Tauri v2 + React 18 桌面客户端

> 双模式: 本地 `type="chat"` (sidecar RPC) / OpenClaw `type="cowork"` (WebSocket)。

## 代码结构

```
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
```

## Design Token — 强制约束

> Token 定义: `src/app.css :root`，完整规范: `docs/design-system.md`

风格: Claude.ai 暖色奶油 — `#F5F0EB` 背景、`#C4724A` 陶土强调、白色卡片、大圆角。

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
- **OpenClaw 前端解耦**: `openclaw/` 不复用本地组件，仅共享 auth/config/transport
- 开发: `make dev-desktop` (Vite HMR + Tauri)
- sidecar 需预编译: `cd ../vm-agent && bun build --compile src/index.ts --outfile dist/vm-agent-aarch64-apple-darwin`

## Agent 启动排查

1. 看 RPC 日志面板 (`agent-rpc-log`)
2. `需要 LLM_PROXY_KEY` → 检查管理后台「系统设置」中 LLM 密钥配置
3. `Agent ready handshake timed out` → 重新构建 `vm-agent/dist/index.js`
