# vm-agent — 本地 Agent Sidecar

> Pi SDK + RPC stdio。桌面端内嵌 sidecar，直接读写本地文件。5 Provider (claude/gpt/gemini/grok/glm) + per-user 隔离。

## 代码结构

```
src/
  index.ts                     RPC 主循环 (stdin/stdout JSON lines, ready 等待后台服务就绪)
  config.ts                    环境变量 (网关下发, 无本地 fallback)
  agent.ts                     Session 池 + 5 Provider + per-user 隔离 + title 生成 + isolated cron session
  prompts/system.ts            系统提示词 (3 层: runtime context + agentHomeDir bootstrap files + project SOUL.md)
  prompts/seeds/               首次运行种子模板 (SOUL.md, AGENTS.md, USER.md, TOOLS.md)
  extensions/memory.ts         记忆系统 (context hook 纯本地读 + memory_search/save 工具)
  extensions/image-gen.ts      图片生成/编辑 (generate_image 工具, gemini-flash + fal.ai fallback)
  extensions/read-document.ts  文档读取 (read_document 工具, docx/xlsx/csv/pdf/pptx + OCR)
  extensions/web-search.ts     网络搜索 (web_search 工具, Tavily → Grok fallback)
  extensions/remote-fs.ts      远程文件系统 (remote_read/write/list/stat, 云端模式 WS 文件通道)
  transport/handler.ts         RPC 命令路由 + fs.*.result 响应处理器注册表
  transport/types.ts           TransportSender 接口
  services/heartbeat.ts        心跳服务 (sidecar 模式默认关闭)
  services/cron.ts             定时任务服务 (cron/at/every 三种调度 + isolated session + JSONL 历史 + 指数退避)
  tools/powershell.ts          PowerShell fallback (仅 Windows, 环境自修复)
  lib/embedding.ts             OpenAI Embedding API 客户端 (text-embedding-3-small)
  lib/memory-store.ts          SQLite + FTS5 记忆存储 (BM25 + CJK 分词 + 向量 rerank + 迁移)
  lib/{daily-log,prompt-queue}.ts
  services/__tests__/cron.test.ts  Cron 单元测试 (20 cases)
  __tests__/rpc.test.ts        E2E RPC 测试
  __tests__/cron.e2e.test.ts   Cron E2E 测试 (真实 LLM 验证 cron_manage 工具)
  __tests__/helpers/            测试辅助 (gateway-config.ts — 自动获取 LLM 配置)
  lib/__tests__/               单元测试 (memory-store, daily-log)
skills/                        内置技能包 (创作/办公/工具/开发), sidecar 通过 SKILLS_PATHS 传入
```

## 自定义工具 (Extensions)

| 工具 | 文件 | 条件 | 说明 |
|------|------|------|------|
| `memory_search` / `memory_save` | `extensions/memory.ts` | `MEMORY_ENABLED=true` | 语义记忆搜索与保存 |
| `generate_image` | `extensions/image-gen.ts` | `LLM_PROXY_KEY` 或 `FAL_API_KEY` | 文生图 + 图片编辑 |
| `read_document` | `extensions/read-document.ts` | `LLM_PROXY_KEY` | 文档读取 + 扫描件 OCR |
| `web_search` | `extensions/web-search.ts` | `LLM_PROXY_KEY` 或 `TAVILY_API_KEY` | 网络搜索 (Grok → Tavily fallback) |
| `remote_read/write/list/stat` | `extensions/remote-fs.ts` | 云端/server 模式 (transport sender 可用) | WebSocket 文件通道, 按需读写桌面端本地文件 |
| `cron_manage` | `services/cron.ts` | 始终注册 | 定时任务管理 (sidecar→Gateway 代理, server→本地执行) |
| (compaction safeguard) | `extensions/compaction-safeguard.ts` | `MEMORY_ENABLED=true` | token 用量日志 + 压缩前记忆刷写 |
| `powershell` | `tools/powershell.ts` | Windows only | 环境自修复 |
| (拦截器) | `agent.ts` 内联 | 始终 | read 二进制文档 → 提示用 read_document |
| (拦截器) | `agent.ts` 内联 | `TOOL_DENY_LIST` | 屏蔽 Pi 内置 Web 工具 (默认 WebSearch/WebFetch/WebBrowse) |

## RPC 协议

**命令**: `prompt` `abort` `destroy_session` `generate_title` `health` `list_sessions` `list_skills`

**prompt 字段**: `message` `session_id` `model` `user_id` `workspace?` `restricted` `streaming_behavior`

**事件** (stdout JSON lines): `response` `session_event` `error` `done` `ready` (后台服务就绪后发送, 含技能列表)

## 模型

| Provider | 模型 |
|----------|------|
| `proxy-claude` (anthropic) | claude-sonnet-4-6, claude-opus-4-6, claude-haiku-4-5 |
| `proxy-gpt` (openai) | gpt-5.3-codex, gpt-5.4 |
| `proxy-gemini` (openai) | gemini-3.1-pro-preview, gemini-3-flash-preview |
| `proxy-grok` (openai) | grok-4.1-fast |
| `proxy-glm` (openai) | glm-5 |

**路由**: `"model-id"` (自动匹配) 或 `"provider/model-id"` (显式指定)

**标题生成**: `claude-haiku-4-5` → fallback `gemini-3-flash-preview`

## 环境变量

`.env` (Tauri 启动时注入, 网关下发):
- `LLM_PROXY_URL` / `LLM_PROXY_KEY` — 中转站 (网关下发, 无本地 fallback)
- `WORKSPACE_DIR` — 默认 cwd (可被请求级 workspace 覆盖)
- `AGENT_HOME_DIR` — Agent 人格/配置主目录 (默认 `~/Library/Application Support/JAcoworks/`), 存放 SOUL.md, AGENTS.md, cron-jobs.json, memory/, skills/
- `MEMORY_ROOT_DIR` — 记忆根目录 (默认 `agentHomeDir/memory`)
- `PRIMARY_MODEL=claude-opus-4-6` / `PRIMARY_PROVIDER=proxy-claude`
- `MEMORY_ENABLED=true` / `HEARTBEAT_ENABLED=false` / `CRON_ENABLED=false`
- `EMBEDDING_API_KEY` / `EMBEDDING_BASE_URL` — 向量 embedding (可选)
- `MEMORY_EMBED_TIMEOUT_MS=8000` / `MEMORY_EMBED_CACHE_MAX=10000`
- `MEMORY_HYBRID_W_BM25=0.3` / `MEMORY_HYBRID_W_VEC=0.7` — hybrid 搜索权重
- `SKILLS_PATHS` — 内置技能目录 (逗号分隔, sidecar 显式传入)
- `USER_SKILLS_DIR` — 用户自建技能目录 (默认 `~/Library/Application Support/JAcoworks/skills`)
- `TOOL_DENY_LIST` / `TAVILY_API_KEY`

## WebSocket 文件通道 (云端模式)

容器中的 Agent 通过 WebSocket 按需读写桌面端本地文件，替代旧的 tar 上传/下载方式。

**协议**: 容器发送 `{"type":"fs.read","req_id":"uuid","path":"relative/path"}`，桌面端响应 `{"type":"fs.read.result","req_id":"uuid","content":"base64","size":N}` 或 `{"...","error":"message"}`。write/list/stat 同理。

**架构**:
- `remote-fs.ts`: 4 个 Pi SDK 工具 (remote_read/write/list/stat)，30s 超时，UUID 请求追踪
- `transport/handler.ts`: `registerTransportResponseHandler()` 路由 `fs.*.result` 响应回对应 pending promise
- `agent.ts`: `setTransportSender()` 注入 WS sender，仅 server 模式注册 remote-fs extension
- 网关: 零改动，`/ws/agent` 全透明双向转发

**安全**: 路径验证在桌面端 (TS isPathSafe + Rust safe_resolve + symlink 检测)，容器侧仅发请求。

## Cron 定时任务

**cron_manage 工具** (始终注册为 Pi SDK extension，双模式运行):

**Sidecar 模式** (本地): cron_manage 调用自动代理到 Gateway `/api/cron/jobs` API，任务在云端调度执行，用户关机不影响。
**Server 模式** (容器): 本地 CronService 执行，tick 每 60s 检查，持久化到 `cron-jobs.json`。

- **调度类型**: `cron` (标准表达式) / `at` (一次性, 支持 `+20m` 相对时间) / `every` (固定间隔 `5m`, `1h`)
- **Session 模式**: `main` (复用主会话) / `isolated` (每次创建独立 session, 运行后销毁)
- **操作**: create / list / delete / run (手动触发) / history (JSONL 运行记录)
- **特性**: deleteAfterRun (at 默认 true) / 指数退避 (1→5→15→60 分钟) / 飞书 announce 推送
- **持久化 (server)**: `{workspaceDir}/cron-jobs.json` + `{workspaceDir}/cron/runs/{jobId}.jsonl`
- **持久化 (sidecar)**: Gateway PostgreSQL `cron_jobs` 表

## Compaction (上下文压缩)

Pi SDK 在对话接近 context window 上限时自动触发压缩。通过环境变量调优：

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `COMPACTION_RESERVE_TOKENS` | `32768` | 为 LLM 响应预留的 token 数。触发阈值 = contextWindow - reserveTokens |
| `COMPACTION_KEEP_RECENT_TOKENS` | `40000` | 压缩时保留的最近消息 token 数 (~10K 字) |
| `MAX_HISTORY_TURNS` | `0` | 历史轮次硬上限 (0=不限, 预留未来使用) |
| `SYSTEM_PROMPT_TOTAL_CHARS` | `30000` | Bootstrap 文件总字符上限 (SOUL+AGENTS+USER+TOOLS) |
| `SYSTEM_PROMPT_FILE_CHARS` | `8000` | 单个 bootstrap 文件字符上限 |

**压缩流程**: agent_end → 检查 token 用量 → 超阈值时调用 LLM 生成结构化摘要 → 旧消息替换为摘要 + 保留近期消息。
**Compaction Safeguard** (extensions/compaction-safeguard.ts): 压缩前将对话主题刷写到 daily log 防止信息丢失；每轮记录 token 用量到日志。

## 测试矩阵（持续扩展）

| 层 | 命令 | 测试数 | 依赖 |
|---|---|---|---|
| **Unit** | `npm test` | 37 | 零网络，纯本地 SQLite |
| **Cron Unit** | `bun test src/services/__tests__/cron.test.ts` | 20 | 零网络，mock prompt |
| **Gateway API E2E** | `npm run test:gateway-e2e` | 80+ | 真实网关 |
| **RPC Core E2E** | `bun test src/__tests__/rpc.test.ts --timeout 120000` | 27+ | 真实网关 + LLM |
| **Extensions E2E (新增)** | `bun test src/__tests__/extensions.e2e.test.ts --timeout 120000` | ~12 | 真实网关 + LLM |
| **Workspace E2E (新增)** | `bun test src/__tests__/workspace.e2e.test.ts --timeout 120000` | ~10 | 真实网关 + LLM + 本地文件系统 |
| **Edge Cases E2E (新增)** | `bun test src/__tests__/edge-cases.e2e.test.ts --timeout 120000` | ~10 | 真实网关 + LLM |
| **Cron E2E** | `bun test src/__tests__/cron.e2e.test.ts` | 7 | 真实网关 + LLM (cron_manage 全流程) |
| **Journey E2E** | `npm run test:journeys` | 8 | 全链路场景 |
| **Website Smoke Routes (跨服务)** | `cd ../website && cargo test --test smoke_routes` | 12+ | 官网服务路由可达性 |

- **单元测试** (`src/lib/__tests__/`): memory-store (FTS5+CJK+hybrid+migration+cache) + daily-log
- **Cron 单元测试** (`src/services/__tests__/cron.test.ts`): 三种调度、session 模式、deleteAfterRun、历史、退避、迁移
- **Cron E2E** (`src/__tests__/cron.e2e.test.ts`): spawn 进程 → 真实 LLM 调用 cron_manage → 创建/列出/运行/历史/删除
- **E2E RPC Core** (`src/__tests__/rpc.test.ts`): spawn 进程 → 真实网关认证 → 双用户隔离 + 多模型切换 + sidecar 启动行为
- **Extensions E2E** (`src/__tests__/extensions.e2e.test.ts`): memory/read_document/generate_image/web_search 等扩展能力验证
- **Workspace E2E** (`src/__tests__/workspace.e2e.test.ts`): 工作区读写、路径解析与文件操作隔离验证
- **Edge Cases E2E** (`src/__tests__/edge-cases.e2e.test.ts`): 非法输入、边界参数、容错与回归场景
- **Gateway API E2E 扩展** (`src/__tests__/gateway-api.e2e.test.ts`): 会话、认证、配置、代理与异常路径覆盖持续增加
- **Website Smoke Routes** (`../website/tests/smoke_routes.rs`): 官网公开路由 + updater/health 等关键路径冒烟覆盖提升
- **自动降级**: 网关不可达时 E2E 全部优雅跳过，单元测试始终可跑
- `make check-agent` = typecheck + 单元测试 (CI 安全)

## 开发规范

- **TS strict ES2022 NodeNext**
- **Session 隔离**: `session_id` + `user_id` 隔离 Pi SDK session 和记忆
- **本地 Agent 优先**: 对话走 sidecar RPC，不经网关
- 开发: `make dev-agent` (热重载)
- 编译: `bun build --compile` 打包进 desktop sidecar，不独立部署
