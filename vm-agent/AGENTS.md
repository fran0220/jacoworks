# vm-agent — 本地 Agent Sidecar

> Pi SDK + RPC stdio。桌面端内嵌 sidecar，直接读写本地文件。5 Provider (claude/gpt/gemini/grok/glm) + per-user 隔离。

## 代码结构

```
src/
  index.ts                     RPC 主循环 (stdin/stdout JSON lines)
  config.ts                    环境变量 (网关下发, 无本地 fallback)
  agent.ts                     Session 池 + 5 Provider + per-user 隔离 + title 生成
  prompts/system.ts            系统提示词 (核心身份 + SOUL.md overlay + 动态能力)
  extensions/memory.ts         记忆系统 (context hook 纯本地读 + memory_search/save 工具)
  services/{heartbeat,cron}.ts 后台服务 (sidecar 模式默认关闭)
  tools/web.ts                 web_search (Tavily) + web_fetch
  lib/embedding.ts             OpenAI Embedding API 客户端 (text-embedding-3-small)
  lib/memory-store.ts          SQLite + FTS5 记忆存储 (BM25 + CJK 分词 + 向量 rerank + 迁移)
  lib/{daily-log,prompt-queue}.ts
  __tests__/rpc.test.ts        E2E RPC 测试
  __tests__/helpers/            测试辅助 (gateway-config.ts — 自动获取 LLM 配置)
  lib/__tests__/               单元测试 (memory-store, daily-log)
skills/                        预制技能包 (创作/办公/工具/开发)
```

## RPC 协议

**命令**: `prompt` `abort` `destroy_session` `generate_title` `health` `list_sessions` `list_skills`

**prompt 字段**: `message` `session_id` `model` `user_id` `workspace?` `restricted` `streaming_behavior`

**事件** (stdout JSON lines): `response` `session_event` `error` `done` `ready` (启动握手, 含技能列表)

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
- `SKILLS_PATHS` — 技能目录 (逗号分隔)
- `TOOL_DENY_LIST` / `TAVILY_API_KEY`

## 测试 (4 层)

| 层 | 命令 | 测试数 | 依赖 |
|---|---|---|---|
| **Unit** | `npm test` | 37 | 零网络，纯本地 SQLite |
| **Gateway API E2E** | `npm run test:gateway-e2e` | 75 | 真实网关 |
| **RPC E2E** | `npm run test:e2e` | 15 | 真实网关 + LLM |
| **Journey E2E** | `npm run test:journeys` | 8 | 全链路场景 |

- **单元测试** (`src/lib/__tests__/`): memory-store (FTS5+CJK+hybrid+migration+cache) + daily-log
- **E2E RPC** (`src/__tests__/rpc.test.ts`): spawn 进程 → 真实网关认证 → LLM 对话 → 双用户隔离
- **自动降级**: 网关不可达时 E2E 全部优雅跳过，单元测试始终可跑
- `make check-agent` = typecheck + 单元测试 (CI 安全)

## 开发规范

- **TS strict ES2022 NodeNext**
- **Session 隔离**: `session_id` + `user_id` 隔离 Pi SDK session 和记忆
- **本地 Agent 优先**: 对话走 sidecar RPC，不经网关
- 开发: `make dev-agent` (热重载)
- 编译: `bun build --compile` 打包进 desktop sidecar，不独立部署
