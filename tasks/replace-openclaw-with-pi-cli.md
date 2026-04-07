# 重构计划：用 Pi CLI 替换 OpenClaw + vm-agent

> 分支: `feat/replace-openclaw-with-pi-cli`
> 目标: 统一桌面端和云端为 Pi CLI + 插件系统，删除 OpenClaw 和 vm-agent 自研代码

## 架构变更

```
之前:
  Desktop → Tauri sidecar → vm-agent (Bun binary, 7068行) → Pi SDK
  Webchat → oc-gateway → OpenClaw WS relay (4660行Go) → OpenClaw VM

之后:
  Desktop → Tauri sidecar → pi CLI (npm global) → Pi extensions/skills
  Webchat → oc-gateway → pi CLI in VM (JSONL→OC帧翻译) → Pi extensions/skills
```

## 工作分解 (9 个线程)

### Thread 1: Pi CLI 配置层 [基础，无依赖]
- `pi-config/models.json` — LLM 中转站 Provider 配置
- `pi-config/settings.json` — 默认 provider/model/compaction
- `pi-config/extensions/visual.ts` — render_visual 工具 (从 vm-agent 移植)
- `pi-config/extensions/cron-proxy.ts` — cron_manage 代理到 Gateway API
- `pi-config/extensions/image-gen.ts` — 图片生成 (Gemini Flash + fal.ai)
- 放置到 `pi-config/` 目录，后续被 sidecar 和 golden image 共用

### Thread 2: Desktop sidecar.rs 重构 [依赖 Thread 1 的配置格式]
- `AGENT_PROCESS` 单进程 → `AGENT_PROCESSES` HashMap<session_id, Process> 多进程池
- spawn 命令从 `vm-agent` binary → `pi --mode json` (stdin 持续交互)
- 启动时写 `~/.pi/agent/models.json` + `settings.json` (从 Gateway 下发的 env vars 生成)
- 将 Pi CLI extensions 复制到 `~/.pi/agent/extensions/`
- ready 检测从 `{"type":"ready"}` → `{"type":"session",...}` (Pi 首行)
- 进程池清理: 30 分钟闲置自动 kill
- 保留: memory 管理、skills 同步、日志轮转、运行时 PATH 注入
- 删除: vm-agent binary 查找、Bun 编译逻辑

### Thread 3: Desktop 前端事件适配 [依赖 Thread 2 的事件格式]
- `use-chat-stream.ts`: 解析 Pi JSONL 替代 vm-agent RPC 事件
  - `message_update.assistantMessageEvent.text_delta` → 文本流
  - `tool_execution_start/end` → 工具状态 (少一层 session_event 嵌套)
  - `agent_end` → done
  - `message_update.assistantMessageEvent.thinking_delta` → thinking
- `agent.ts`: send 命令格式 (Pi stdin 接受纯文本行，不是 JSON RPC)
- `local-sidecar-transport.ts`: 适配多进程路由
- `chat-stream-store.ts`: 如有需要调整 AssistantPart 构建逻辑
- 删除 generate_title (Pi 无此 RPC，可用 gateway API 或轻量 LLM 调用替代)
- 验证: visual widget、tool status、thinking block 渲染正常

### Thread 4: Golden Image 构建脚本 [依赖 Thread 1 的配置]
- 修改 `deploy/incus/build-openclaw-vm.sh`:
  - 删除 OpenClaw 安装 (npm i -g @anthropic/openclaw 等)
  - 删除 JMOS 安装
  - 添加 Pi CLI: `npm i -g @mariozechner/pi-coding-agent`
  - 安装社区插件:
    - `pi install npm:pi-subagents`
    - `pi install npm:@tmustier/pi-agent-teams`
    - `pi install npm:taskplane`
    - `pi install npm:pi-web-access`
    - `pi install npm:@apmantza/greedysearch-pi`
    - `pi install npm:pi-mcp-adapter`
    - `pi install npm:@aliou/pi-guardrails`
    - `pi install npm:@aliou/pi-processes`
    - `pi install npm:pi-rtk`
  - 部署 Pi 配置: models.json + settings.json + custom extensions
  - 保留: XFCE/VNC/noVNC/Python/系统工具/LibreOffice
  - 删除: openclaw.service / jmos.service systemd 单元
  - 新增: pi-agent.service (systemd, 以 node 用户运行 `pi --mode json`)
- 更新镜像名从 `openclaw-ready` → `pi-ready`

### Thread 5: oc-gateway — 砍掉 OpenClaw 协议层 [独立]
- 删除 `gateway/internal/openclaw/`:
  - protocol.go (帧定义)
  - gateway_client.go (WS 握手)
  - client.go (Provision/SyncConfig/DeploySkills/Credentials)
  - template.go (团队模板安装)
  - profile.go (Agent 人设)
  - jamoss.go (JaMOSS 集成)
- 保留 `gateway/internal/incus/` (VM 管理不变)
- 保留 `gateway/internal/agent/` 但重写 ws_handler.go:
  - 删除 OpenClaw 握手 (HandshakeConn)
  - 新 relay: 浏览器 WS ←→ VM 内 pi 进程的 WS wrapper
- 保留 `gateway/internal/store/` (containers 表不变)

### Thread 6: oc-gateway — Pi 进程管理 + JSONL 翻译 [依赖 Thread 5]
- 新增 `gateway/internal/pi/`:
  - `manager.go`: 管理 VM 内的 pi 进程 (incus exec)
  - `translator.go`: Pi JSONL → 现有 webchat 期望的 OpenClaw 帧格式
    - message_update.text_delta → agent stream content delta
    - tool_execution_start/end → tool_start/tool_end
    - agent_end → chat state=final
    - thinking_delta → thinking event
  - `config.go`: Provision 时写入 Pi 配置到 VM
- 修改 `ws_handler.go`:
  - ticket auth → 找到 VM → incus exec 连到 VM 内 pi WS wrapper
  - 双向帧翻译 (Pi JSONL ←→ OpenClaw-like 帧)
- 修改 Provision 流程:
  - 删除 WriteConfig/SyncConfig/DeploySkills
  - 新增: 写 models.json + settings.json + extensions 到 VM

### Thread 7: VM 内 Pi WS Wrapper [独立]
- 创建 `pi-ws-wrapper/` 轻量服务 (Bun/Node, ~100行)
  - HTTP :18789 (复用旧 OpenClaw 端口)
  - GET /health
  - WS /ws → 管理 pi 进程池 (per-session)
  - 接收: `{"type":"prompt","session_id":"xxx","message":"..."}` 
  - 发送: 转发 pi stdout JSONL (附加 session_id)
  - abort: kill -SIGINT 对应 pi 进程
- systemd: `pi-ws-wrapper.service` (替代 openclaw.service)
- 这样 oc-gateway 的 thin relay 架构保持不变，只是上游从 OpenClaw → Pi wrapper

### Thread 8: 清理 + AGENTS.md 更新 [最后]
- 更新根 `AGENTS.md`: 架构概览、三域部署描述
- 更新 `gateway/AGENTS.md`: 删除 OpenClaw 相关描述
- 更新 `webchat/AGENTS.md`: 协议层描述更新
- 更新 `desktop/AGENTS.md`: sidecar 描述更新
- 更新 `vm-agent/AGENTS.md` → 标记废弃或删除
- 删除 `openclaw/AGENTS.md`
- 更新 Makefile: deploy-local 命令
- 更新 CI: `.github/workflows/ci.yml`

### Thread 9: Skills 迁移 [独立]
- 将 `vm-agent/skills/` (创作/办公/工具/开发) 转为 Pi skill 格式
- 将 `openclaw/skills/` (search/agent-reach/asset-gateway/word-docx/excel-xlsx) 转为 Pi skill 格式
- Pi skill 格式 = SKILL.md (frontmatter: name, description) — 与现有格式兼容
- 统一放置到 `skills/` 顶层目录
- 团队模板 (`openclaw/templates/`) → 转为 pi-agent-teams 配置格式

## 依赖图

```
Thread 1 (Pi 配置)
  ├→ Thread 2 (Desktop sidecar) → Thread 3 (Desktop 前端)
  ├→ Thread 4 (Golden Image)
  └→ Thread 7 (VM WS Wrapper)

Thread 5 (砍 OpenClaw) → Thread 6 (oc-gateway Pi 管理)

Thread 9 (Skills 迁移) — 独立

Thread 8 (清理) — 所有完成后
```

## 并行执行策略

**第一批 (同时启动):**
- Thread 1: Pi 配置层
- Thread 5: 砍 OpenClaw 代码
- Thread 9: Skills 迁移

**第二批 (Thread 1 完成后):**
- Thread 2: Desktop sidecar
- Thread 4: Golden Image
- Thread 7: VM WS Wrapper

**第三批 (Thread 2+5 完成后):**
- Thread 3: Desktop 前端
- Thread 6: oc-gateway Pi 管理

**最后:**
- Thread 8: 清理

## 不变的部分
- Incus VM 管理 (保持)
- VNC 桌面 (保持)
- webchat 前端组件 (零改动，oc-gateway 做翻译)
- 认证/session 存储 (保持)
- PostgreSQL schema (保持)
- 飞书 Bot (保持)
