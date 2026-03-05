# vm-agent — 本地 Agent Sidecar

> Pi SDK + RPC stdio。桌面端内嵌 sidecar，直接读写本地文件。5 Provider (claude/gpt/gemini/grok/glm) + per-user 隔离。

## 代码结构

```
src/
  index.ts                     RPC 主循环 (stdin/stdout JSON lines, ready 等待后台服务就绪)
  config.ts                    环境变量 (网关下发, 无本地 fallback)
  agent.ts                     Session 池 + 5 Provider + per-user 隔离 + title 生成 + isolated cron session
  prompts/system.ts            系统提示词 (核心身份 + SOUL.md overlay + 动态能力)
  extensions/memory.ts         记忆系统 (context hook 纯本地读 + memory_search/save 工具)
  extensions/image-gen.ts      图片生成/编辑 (generate_image 工具, gemini-flash + fal.ai fallback)
  extensions/read-document.ts  文档读取 (read_document 工具, docx/xlsx/csv/pdf/pptx + OCR)
  extensions/web-search.ts     网络搜索 (web_search 工具, Tavily → Grok fallback)
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
| `cron_manage` | `services/cron.ts` | `CRON_ENABLED=true` | 定时任务管理 |
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
| `proxy-gpt` (openai) | gpt-5.3-codex, gpt-5.2 |
| `proxy-gemini` (openai) | gemini-3.1-pro-preview, gemini-3-flash-preview |
| `proxy-grok` (openai) | grok-4.1-fast |
| `proxy-glm` (openai) | glm-5 |

**路由**: `"model-id"` (自动匹配) 或 `"provider/model-id"` (显式指定)

**标题生成**: `claude-haiku-4-5` → fallback `gemini-3-flash-preview`

## 环境变量

`.env` (Tauri 启动时注入, 网关下发):
- `LLM_PROXY_URL` / `LLM_PROXY_KEY` — 中转站 (网关下发, 无本地 fallback)
- `WORKSPACE_DIR` — 默认 cwd (可被请求级 workspace 覆盖)
- `MEMORY_ROOT_DIR` — 记忆根目录 (默认 `~/Library/Application Support/JAcoworks/memory`)
- `PRIMARY_MODEL=claude-opus-4-6` / `PRIMARY_PROVIDER=proxy-claude`
- `MEMORY_ENABLED=true` / `HEARTBEAT_ENABLED=false` / `CRON_ENABLED=false`
- `EMBEDDING_API_KEY` / `EMBEDDING_BASE_URL` — 向量 embedding (可选)
- `MEMORY_EMBED_TIMEOUT_MS=8000` / `MEMORY_EMBED_CACHE_MAX=10000`
- `MEMORY_HYBRID_W_BM25=0.3` / `MEMORY_HYBRID_W_VEC=0.7` — hybrid 搜索权重
- `SKILLS_PATHS` — 内置技能目录 (逗号分隔, sidecar 显式传入)
- `USER_SKILLS_DIR` — 用户自建技能目录 (默认 `~/Library/Application Support/JAcoworks/skills`)
- `TOOL_DENY_LIST` / `TAVILY_API_KEY`

## Cron 定时任务

**cron_manage 工具** (CRON_ENABLED=true 时注册为 Pi SDK extension):
- **调度类型**: `cron` (标准表达式) / `at` (一次性, 支持 `+20m` 相对时间) / `every` (固定间隔 `5m`, `1h`)
- **Session 模式**: `main` (复用主会话) / `isolated` (每次创建独立 session, 运行后销毁)
- **操作**: create / list / delete / run (手动触发) / history (JSONL 运行记录)
- **特性**: deleteAfterRun (at 默认 true) / 指数退避 (1→5→15→60 分钟) / 向后兼容迁移
- **持久化**: `{workspaceDir}/cron-jobs.json` + `{workspaceDir}/cron/runs/{jobId}.jsonl`

## 测试 (5 层)

| 层 | 命令 | 测试数 | 依赖 |
|---|---|---|---|
| **Unit** | `npm test` | 37 | 零网络，纯本地 SQLite |
| **Cron Unit** | `bun test src/services/__tests__/cron.test.ts` | 20 | 零网络，mock prompt |
| **Gateway API E2E** | `npm run test:gateway-e2e` | 75 | 真实网关 |
| **RPC E2E** | `npm run test:e2e` | 15 | 真实网关 + LLM |
| **Cron E2E** | `bun test src/__tests__/cron.e2e.test.ts` | 7 | 真实网关 + LLM (cron_manage 全流程) |
| **Journey E2E** | `npm run test:journeys` | 8 | 全链路场景 |

- **单元测试** (`src/lib/__tests__/`): memory-store (FTS5+CJK+hybrid+migration+cache) + daily-log
- **Cron 单元测试** (`src/services/__tests__/cron.test.ts`): 三种调度、session 模式、deleteAfterRun、历史、退避、迁移
- **Cron E2E** (`src/__tests__/cron.e2e.test.ts`): spawn 进程 → 真实 LLM 调用 cron_manage → 创建/列出/运行/历史/删除
- **E2E RPC** (`src/__tests__/rpc.test.ts`): spawn 进程 → 真实网关认证 → LLM 对话 → 双用户隔离
- **自动降级**: 网关不可达时 E2E 全部优雅跳过，单元测试始终可跑
- `make check-agent` = typecheck + 单元测试 (CI 安全)

## 开发规范

- **TS strict ES2022 NodeNext**
- **Session 隔离**: `session_id` + `user_id` 隔离 Pi SDK session 和记忆
- **本地 Agent 优先**: 对话走 sidecar RPC，不经网关
- 开发: `make dev-agent` (热重载)
- 编译: `bun build --compile` 打包进 desktop sidecar，不独立部署
