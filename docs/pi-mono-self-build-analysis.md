# Pi-mono 自建方案分析

> 日期: 2026-02-22
> 目的: 评估使用 pi-mono SDK 自建 JAcoworks AI Agent 引擎的可行性

---

## 0. Pi-mono 项目概况

| 维度 | 值 |
|------|-----|
| 仓库 | [badlogic/pi-mono](https://github.com/badlogic/pi-mono) |
| Stars | 12.7k ⭐ |
| Forks | 1.3k |
| Contributors | 120 |
| Commits | **2,951** |
| Releases | **154 个** (最新 v0.52.12) |
| 语言 | TypeScript |
| License | MIT |
| 作者 | Mario Zechner (libGDX 作者, 知名开源开发者) |
| 运行时 | Node.js 18+ |

**Pi-mono 是三个候选方案中最成熟的项目** — 2,951 次提交、154 个版本、120 个贡献者。

---

## 1. 架构：三层 SDK

```
┌─────────────────────────────────────────────────────┐
│  @mariozechner/pi-coding-agent  (SDK + CLI + RPC)   │
│  createAgentSession() → AgentSession                │
│  Sessions, Extensions, Skills, Settings             │
├─────────────────────────────────────────────────────┤
│  @mariozechner/pi-agent-core    (Agent Runtime)     │
│  Agent class, Agent Loop, Tool Execution, Events    │
├─────────────────────────────────────────────────────┤
│  @mariozechner/pi-ai            (LLM Abstraction)   │
│  18+ providers, streaming, thinking, cost tracking  │
└─────────────────────────────────────────────────────┘
```

核心哲学：**极简核心 + 无限扩展**。只有 4 个内置工具 (read, write, edit, bash)，所有额外能力通过 TypeScript Extensions 添加。

---

## 2. 为什么 Pi-mono 适合自建

### 2.1 五种运行模式

| 模式 | 命令 | 用途 |
|------|------|------|
| **SDK** | `createAgentSession()` | 嵌入自定义应用 ✅ |
| **RPC** | `pi --mode rpc` | JSON stdin/stdout, 适合 Go 网关调用 ✅ |
| **JSON** | `pi --mode json "..."` | 流式 JSON lines ✅ |
| **Print** | `pi -p "..."` | 非交互, CI/CD |
| **Interactive** | `pi` | 完整 TUI |

**RPC 模式是关键** — Go 管理网关可以通过 `spawn` 子进程与 pi-agent 通信：

```
Go 网关 → spawn("pi", ["--mode", "rpc", "--no-session"])
       ← stdin:  {"id":"req-1","type":"prompt","message":"你好"}
       → stdout: {"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"你好！"}}
```

### 2.2 SSE 桥接模式 (SDK 内置)

```typescript
// 将 Agent 事件桥接到 SSE — 实现 HTTP 流式响应
function handleSSE(res: http.ServerResponse) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const unsub = session.subscribe((event) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  });
  res.on("close", unsub);
}
```

这意味着可以轻松实现 OpenAI 兼容的 `/v1/chat/completions` SSE 端点。

### 2.3 Extension 系统（核心优势）

```typescript
// extensions/jacoworks-office.ts
export default function (pi: ExtensionAPI) {
  // 注入中文办公系统提示
  pi.on("context", async () => ({
    systemPromptSuffix: "\n你是 JAcoworks 企业AI助手，服务中文办公场景。",
  }));

  // 注册自定义办公工具
  pi.registerTool({
    name: "generate_report",
    label: "Generate Report",
    description: "生成周报/月报",
    parameters: Type.Object({ type: Type.String(), period: Type.String() }),
    execute: async (_, params) => { /* ... */ },
  });

  // 拦截危险命令
  pi.on("tool_call", async (event) => {
    if (event.toolName === "bash" && /rm\s+-rf/.test(event.input.command))
      return { block: true, reason: "危险命令已阻止" };
  });
}
```

### 2.4 LLM 代理对接

```typescript
import { getModel } from "@mariozechner/pi-ai";

// 方法 1: 自定义 OpenAI-compatible endpoint
const authStorage = new AuthStorage();
authStorage.setRuntimeApiKey("openai", "sk-123456");

const model = getModel("openai", "claude-sonnet-4-6");
// 需要设置 baseUrl 到 LLM 代理

// 方法 2: 自定义模型注册
// ~/.pi/agent/models.json 中注册 custom 模型
```

---

## 3. 自建方案架构

```
┌─────────────────────────────────────────────────────┐
│                 客户端层                              │
│  Flutter 桌面/移动 │ 飞书 Bot                         │
└────────┬──────────┘────────┬────────────────────────┘
         │ HTTP REST + SSE    │ Feishu Webhook
┌────────▼──────────────────▼────────────────────────┐
│            管理网关 (Go 自建)                         │
│  • SSO 认证                                         │
│  • 用户 → 容器路由                                    │
│  • 飞书 Bot 消息转发 (Go 自建)                        │
│  • spawn pi --mode rpc (per container)              │
│  • RPC JSON ↔ OpenAI SSE 协议适配                    │
│  • LXD 容器生命周期                                   │
└────────────────────┬───────────────────────────────┘
                     │ spawn / stdin-stdout
┌────────────────────▼───────────────────────────────┐
│         Pi Agent 实例 (Per-User VM)                  │
│                                                     │
│  pi --mode rpc --no-session                         │
│  ├─ Agent Loop (pi-agent-core)                      │
│  ├─ Tools: read, write, edit, bash                  │
│  ├─ Extensions: jacoworks-office.ts                 │
│  │   ├─ 办公工具 (报告/翻译/数据分析)                  │
│  │   ├─ 安全拦截器                                   │
│  │   └─ 中文系统提示                                  │
│  ├─ Skills: workspace/skills/                       │
│  └─ Sessions: JSONL 持久化                           │
│                                                     │
│  LLM → http://67.230.171.248:8317/v1               │
└─────────────────────────────────────────────────────┘
```

---

## 4. 三方对比

| 维度 | Pi-mono (自建) | PicoClaw | ZeroClaw |
|------|---------------|----------|----------|
| **成熟度** | ✅✅ 154 releases | ✅ 3 releases | ❌ 0 releases |
| **Stars** | 12.7k | **17.3k** | 4.9k |
| **语言** | TypeScript | Go | Rust |
| **运行时依赖** | Node.js 18+ | 无 (静态) | 无 (静态) |
| **二进制/安装** | `npm install` | 预编译 ~6MB | 需编译 ~3.4MB |
| **内存 (空闲)** | ~50-100 MB | **~10-20 MB** | ~5 MB |
| **中文稳定性** | ✅ UTF-8 原生 | ✅ Go 原生 | ❌ **UTF-8 panic** |
| **飞书通道** | ❌ 需 Go 自建 | ✅ **内置** | ❌ 无 |
| **钉钉/企微/QQ** | ❌ 需自建 | ✅ **全部内置** | ❌ 无 |
| **edit_file** | ✅ | ✅ | ❌ |
| **子 Agent** | ✅ (Extension) | ✅ (spawn) | 未确认 |
| **Extension 系统** | ✅✅ **极强** (28 种事件钩子) | 有限 (skills) | 有限 (SKILL.md) |
| **自定义工具** | ✅✅ TypeBox schema | ❌ 无自定义 | ❌ Rust trait |
| **Session 管理** | ✅✅ JSONL 树 + 分支 | 基础 | SQLite |
| **Context 压缩** | ✅✅ 自动 compaction | ❌ | ❌ |
| **RPC/嵌入** | ✅✅ SDK + RPC + SSE | ❌ 仅 gateway | `/webhook` |
| **HTTP API** | 需自建 (有 SSE 模板) | `picoclaw gateway` | `/webhook` |
| **记忆系统** | JSONL sessions | MEMORY.md | SQLite 向量搜索 |
| **安全拦截** | ✅✅ tool_call 拦截器 | 命令黑名单 | 命令白名单 |
| **MCP 支持** | ✅ (Extension) | ❌ | ❌ |
| **容器内存占用** | ~100-150 MB | **~30-50 MB** | **~15-30 MB** |
| **可定制性** | ✅✅✅ **最高** | ✅ 中等 | ✅ 中等 |
| **学习曲线** | 中 (TypeScript) | 低 (配置即用) | 高 (Rust) |

---

## 5. Pi-mono 自建的优劣势

### 5.1 优势

1. **极致可定制** — Extension 系统可以拦截任何事件 (tool_call, context, message_update 等)，注册自定义工具，修改系统提示。这意味着可以深度定制办公场景。

2. **SDK 嵌入模式** — `createAgentSession()` 可以直接在 Go 网关中通过 RPC 调用，无需 HTTP 中间层。

3. **Context 压缩** — 自动 compaction 机制，长对话不会 OOM 或超 token 限制。

4. **Session 分支** — 支持对话树分支，用户可以回退到任意节点重新对话。

5. **成熟度最高** — 154 个版本，2,951 次提交，经过大量生产验证。

6. **TypeScript 生态** — 可以直接用 npm 包扩展能力 (puppeteer, xlsx, pdf-parse 等)。

### 5.2 劣势

1. **内存占用最高** — Node.js 运行时 ~50-100 MB 空闲，加上 Agent 运行 ~100-150 MB。30 个容器 = ~3-4.5 GB RAM（vs PicoClaw ~1-1.5 GB）。

2. **需要 Node.js 运行时** — 每个 LXD 容器需安装 Node.js 18+，增加容器模板大小 (~200 MB)。

3. **无内置通道** — 飞书/钉钉/企微需要在 Go 网关层自建。PicoClaw 全部内置。

4. **无内置 HTTP Gateway** — 需要自建 HTTP 层包装 RPC 模式。PicoClaw 有 `picoclaw gateway`。

5. **无向量记忆** — Session 持久化用 JSONL，无语义搜索。ZeroClaw 有 SQLite 向量搜索。

---

## 6. 推荐方案

### 方案 A: PicoClaw（推荐 ⭐）

适合 JAcoworks 的理由：
- 飞书/钉钉/企微/QQ **全部内置**，管理网关开发量减少 60%
- Go 静态二进制，容器内存 ~30-50 MB，30 人仅需 ~1.5 GB
- 预编译发布，部署零摩擦
- 中文原生支持，无 UTF-8 问题

### 方案 B: Pi-mono 自建（适合深度定制）

适合的场景：
- 需要深度定制 Agent 行为（自定义工具、拦截器、上下文注入）
- 需要 MCP 协议支持
- 需要 Session 分支/回退
- 需要 Context 自动压缩
- 团队有 TypeScript 能力
- 愿意承担更高的内存开销和更多的基础设施开发

### 方案 C: 混合方案（Pi-mono 核心 + Go 网关 + 飞书自建）

```
Flutter → Go 网关 → Pi Agent (RPC mode, per container)
飞书    → Go 网关 → Pi Agent (RPC mode, per container)
```

- 用 Pi-mono 的 SDK/RPC 作为 Agent 引擎
- Go 网关处理认证、路由、飞书对接
- Extension 系统定制办公工具
- 代价：每容器 ~150 MB，需 Node.js 运行时

---

## 7. 资源对比 (30 人规模)

| 维度 | Pi-mono | PicoClaw | ZeroClaw |
|------|---------|----------|----------|
| 每容器内存 | 1 GB (含 Node.js) | **512 MB** | 512 MB |
| 30 容器总 RAM | ~30 GB | **~15 GB** | ~15 GB |
| 容器模板大小 | ~300 MB (Node.js) | **~50 MB** | ~50 MB |
| 部署复杂度 | 中 (npm install) | **低** (复制二进制) | 高 (Rust 编译) |
| 管理网关开发量 | 高 (飞书/钉钉自建) | **低** (通道内置) | 高 (全部自建) |

---

## 8. 结论

**如果优先考虑快速上线 + 低运维成本** → 选 PicoClaw（方案 A）

**如果优先考虑深度定制 + 长期扩展性** → 选 Pi-mono 自建（方案 B/C）

对于 JAcoworks Phase 2（当前阶段），建议先用 PicoClaw 快速验证，后续如果需要更深度的定制再考虑迁移到 Pi-mono。两者并不互斥 — PicoClaw 可以作为"快速上线版"，Pi-mono 作为"终极定制版"。
