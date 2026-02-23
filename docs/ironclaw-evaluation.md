# IronClaw (nearai/ironclaw) 评估报告

> 日期: 2026-02-22
> 目的: 评估 IronClaw 是否适合替代 PicoClaw 作为 JAcoworks 的 AI Agent 引擎
> 结论: **❌ 不推荐** — 中国企业 IM 通道完全缺失，内存占用大，项目过新

---

## 0. 项目概况

| 维度 | IronClaw | PicoClaw (当前选定) |
|------|----------|-------------------|
| **仓库** | [nearai/ironclaw](https://github.com/nearai/ironclaw) | [sipeed/picoclaw](https://github.com/sipeed/picoclaw) |
| **Stars** | 2,639 ⭐ | **17,300 ⭐** |
| **Forks** | 259 | 2,000 |
| **Contributors** | ~15-20 | 69 |
| **Commits** | ~250-400 (10 天内) | 433 |
| **语言** | Rust | Go |
| **License** | MIT | MIT |
| **版本** | v0.9.0 (12 个版本，10 天内全部发布) | v0.1.1 |
| **背景** | NEAR AI (区块链/AI 公司) | Sipeed (知名硬件公司) |
| **公开日期** | 2026-02-12 (~10 天前) | 2026-02-09 (~13 天前) |
| **来源** | OpenClaw (TypeScript) 的 Rust 重写 | 独立 Go 实现 |
| **Rust 版本要求** | **1.92** (edition 2024) | N/A (Go) |
| **预编译二进制** | ✅ 5 平台 (linux/mac/win x86_64+arm64) | ✅ 16 平台 |

**关键发现**: IronClaw 是 OpenClaw (TypeScript, 215k ⭐) 的 Rust 重写版。它参考了 ZeroClaw 的架构模式（agent 模块拆分），但两者没有代码共享关系。

---

## 1. 技术架构

IronClaw 的架构比 PicoClaw 复杂得多:

```
IronClaw 架构:
├─ Axum Web Gateway (HTTP/SSE/WebSocket, port 3000)
├─ HTTP Webhook (port 8080)
├─ WASM Channels (Telegram/Slack/Discord 编译为 WASM 组件)
├─ CLI/TUI (Ratatui)
├─ Agent Loop (ReAct + Safety Layer)
├─ Tool Registry
│   ├─ Built-in Tools (file/shell/http/memory/jobs/routine)
│   ├─ WASM Tools (GitHub/Gmail/Google Suite/Okta)
│   └─ MCP Client (外部工具服务器)
├─ Skills System (SKILL.md + Trust Model)
├─ Docker Sandbox (Orchestrator + Worker)
├─ Database (PostgreSQL + pgvector 或 libSQL/Turso)
├─ Secrets Store (AES-GCM + OS Keychain)
└─ LLM Providers (NEAR AI/Anthropic/OpenAI/Ollama/OpenRouter)
```

**对比 PicoClaw 的简洁架构**:
```
PicoClaw 架构:
├─ Gateway (IM 通道聚合器)
├─ 13 个内置通道 (飞书/钉钉/企微/QQ/Telegram/Discord/...)
├─ Agent Loop (ReAct)
├─ 15 个内置工具 (file/exec/web/spawn/cron/message)
├─ Skills (SKILL.md)
├─ Memory (MEMORY.md)
└─ JSON 配置
```

---

## 2. 对 JAcoworks 关键需求的评估

### 2.1 中文 IM 通道 — ❌ 致命缺陷

| 通道 | IronClaw | PicoClaw |
|------|----------|----------|
| **飞书 (Feishu/Lark)** | ❌ **P3 (低优先级，未开始)** | ✅ **内置** |
| **钉钉 (DingTalk)** | ❌ **文档中完全未提及** | ✅ **内置** |
| **企业微信 (WeCom)** | ❌ **文档中完全未提及** | ✅ **内置** |
| **QQ** | ❌ 未提及 | ✅ **内置** |
| Telegram | ✅ WASM 通道 | ✅ 内置 |
| Slack | ✅ WASM 通道 | ✅ 内置 |
| Discord | ✅ WASM 通道 | ✅ 内置 |
| WhatsApp | ⚠️ 源码存在但标记 P1 | ❌ |
| HTTP Webhook | ✅ 内置 (port 8080) | ❌ (可加 ~150 行) |
| **通道总数** | ~6 (实际可用) | **13** |

> **这是 DEALBREAKER**: JAcoworks 是中国企业办公平台，飞书/钉钉/企微是核心需求。IronClaw 将飞书标记为 P3（最低优先级），钉钉和企微甚至不在路线图上。

### 2.2 HTTP API — ✅ 优势

IronClaw 在所有候选方案中 HTTP API 最完善:

- **Web Gateway** (Axum, port 3000): 40+ API 端点
- **OpenAI 兼容代理**: `/v1/chat/completions` 和 `/v1/models` — 任何 OpenAI 客户端库可直接对接
- **SSE + WebSocket** 流式响应
- **HTTP Webhook** (port 8080): 用于外部集成
- Bearer Token 认证 + 常量时间比较

这是 IronClaw 相比 PicoClaw 的唯一明显优势。PicoClaw 需要添加 ~150 行 Go 代码实现 HTTP Channel。

### 2.3 内存占用 — ❌ 过高

| 维度 | IronClaw | PicoClaw | pi_agent_rust |
|------|----------|----------|---------------|
| **空闲 RSS** | **未文档化** (估计 50-100+ MB) | ~10-20 MB | **6.7 MB** |
| **运行时依赖** | wasmtime (WASM JIT) + PostgreSQL/libSQL | 无 | 无 |
| **二进制大小** | **未文档化** (wasmtime 单独 10-40 MB) | ~8-15 MB | 7.6 MB |

IronClaw 内嵌 wasmtime (WebAssembly JIT 运行时)，仅 wasmtime 就可能贡献 10-40 MB 二进制大小和显著内存开销。此外还需要:
- PostgreSQL 进程 (如果选择 Postgres 后端) — 额外 ~30-50 MB
- 或 libSQL 嵌入模式 (较轻但仍有开销)
- Docker daemon (如果使用 Sandbox) — 额外 ~100 MB+

**对 Per-User VM 的影响**: 假设 IronClaw 空闲 RSS ~80 MB，30 个容器 = ~2.4 GB RAM。vs PicoClaw ~600 MB。差距 4x。

### 2.4 UTF-8 / 中文安全 — ⚠️ 已修复但需警惕

IronClaw 曾有 UTF-8 多字节边界 panic（与 ZeroClaw 同样的问题！），但已修复:

- **PR #57**: `truncate()` 修复多字节字符边界 panic
- **Feb 13 commit**: `truncate_for_preview` 使用 `char_indices()` 替代字节索引

**当前状态**: UTF-8 安全（标准 Rust String 保证），但缺乏 CJK 专门处理:
- 无 CJK 显示宽度计算
- 无中文分词/搜索优化
- 无 i18n 支持 (中文 UI 标记为 P3)

### 2.5 自定义 LLM 端点 — ✅ 支持

```bash
# 通过环境变量配置 OpenAI 兼容端点
LLM_BACKEND=openai_compatible
OPENAI_API_BASE=http://67.230.171.248:8317/v1
OPENAI_API_KEY=sk-123456
```

支持多 Provider 故障转移 (`FailoverProvider`) 和重试退避。

### 2.6 工具集 — ✅ 丰富

| 工具 | IronClaw | PicoClaw |
|------|----------|----------|
| read_file | ✅ (1 MB 限制) | ✅ |
| write_file | ✅ (5 MB 限制) | ✅ |
| **apply_patch** | ✅ (就地编辑) | ✅ edit_file |
| list_dir | ✅ | ✅ |
| shell | ✅ (多层安全) | ✅ exec |
| http | ✅ (SSRF 防护) | ✅ web_fetch |
| memory_* | ✅ (4 个工具) | ✅ (MEMORY.md) |
| web_search | ❌ | ✅ (Brave/DDG) |
| spawn/subagent | ❌ (通过 jobs) | ✅ (两种) |
| message | ❌ | ✅ |
| cron | ✅ (routine_*) | ✅ |
| **MCP Client** | ✅ **独有** | ❌ |
| **WASM Tools** | ✅ (GitHub/Gmail/Google Suite) | ❌ |
| **Docker Sandbox** | ✅ **独有** | ❌ |
| **工具总数** | ~20+ (内置) + WASM + MCP | 15 |

### 2.7 扩展性 — ✅ 强于 PicoClaw

| 维度 | IronClaw | PicoClaw |
|------|----------|----------|
| Skills | ✅ SKILL.md + Trust Model | ✅ SKILL.md + ClawHub |
| Extension 系统 | ❌ (WASM 通道/工具) | ❌ (仅 skills) |
| 自定义工具 | ❌ (需改源码或 WASM) | ❌ (需改源码) |
| MCP 支持 | ✅ **内置** | ❌ |
| 记忆系统 | ✅✅ PostgreSQL + pgvector 向量搜索 | MEMORY.md (文件) |
| Docker Sandbox | ✅ 完整编排 | ❌ |
| 安全模型 | ✅✅ 多层 (命令拦截/SSRF防护/秘密加密/沙箱隔离) | 基础 (命令黑名单) |

### 2.8 部署复杂度 — ❌ 过重

| 维度 | IronClaw | PicoClaw |
|------|----------|----------|
| 安装 | 下载二进制 + onboard 向导 | 下载二进制 + JSON 配置 |
| **数据库** | **需要 PostgreSQL 或 libSQL** | 无 |
| **Docker** | **需要 Docker daemon (Sandbox)** | 无 |
| **Rust 版本** | 需 1.92+ (如果从源码编译) | N/A |
| **WASM 运行时** | 内嵌 wasmtime | 无 |
| 容器模板大小 | 估计 200-500 MB | ~50 MB |
| 配置复杂度 | 高 (DB/安全/通道/LLM/沙箱) | 低 (单 JSON 文件) |

**对 Per-User VM 的影响**: 每个 LXD 容器需要:
- IronClaw 二进制 (估计 30-50 MB)
- PostgreSQL 或 libSQL (如果用 Postgres: 需额外进程 + ~300 MB 磁盘)
- 可选 Docker-in-Docker (如果用 Sandbox: 需嵌套容器)

这与 JAcoworks "轻量级 Per-User VM" 的设计哲学直接冲突。

---

## 3. 完整六方对比

| 维度 | IronClaw | PicoClaw ⭐ | pi_agent_rust | pi-mono | oh-my-pi | ZeroClaw |
|------|----------|-----------|---------------|---------|----------|----------|
| **语言** | Rust | **Go** | Rust | TypeScript | TS+Rust | Rust |
| **Stars** | 2.6k | **17.3k** | 310 | 14.4k | 982 | 4.9k |
| **空闲 RSS** | ~50-100+ MB (估) | **~10-20 MB** | **6.7 MB** | 45-80 MB | ~60 MB | ~5 MB |
| **运行时依赖** | wasmtime+DB | **无** | **无** | Node.js | Bun/Node | **无** |
| **预编译发布** | ✅ 5 平台 | ✅ **16 平台** | ✅ | npm | npm | ❌ |
| **飞书** | ❌ P3 | ✅ **内置** | ❌ | ❌ | ❌ | ❌ |
| **钉钉** | ❌ 未提及 | ✅ **内置** | ❌ | ❌ | ❌ | ❌ |
| **企微** | ❌ 未提及 | ✅ **内置** | ❌ | ❌ | ❌ | ❌ |
| **HTTP API** | ✅ **最强** (40+ 端点) | ❌ (可加) | ❌ | ❌ | ❌ | ✅ |
| **OpenAI 兼容** | ✅ `/v1/chat/completions` | ❌ | ❌ | ❌ | ❌ | ❌ |
| **MCP 支持** | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ |
| **UTF-8 安全** | ✅ (已修复) | ✅ Go 原生 | ✅ Rust 安全 | ✅ JS 原生 | ✅ | ❌ **panic** |
| **Docker Sandbox** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **DB 依赖** | PostgreSQL/libSQL | **无** | **无** | **无** | **无** | SQLite |
| **通道总数** | ~6 | **13** | 1 | 2 | 1 | ~6 |
| **部署复杂度** | **高** | **低** | 低 | 中 | 中 | 高 |
| **安全模型** | ✅✅ 最强 | 基础 | 基础 | 基础 | 基础 | 中等 |
| **容器模板** | 200-500 MB (估) | **~50 MB** | ~50 MB | ~300 MB | ~350 MB | ~500 MB |

---

## 4. IronClaw 的独特优势

尽管不适合 JAcoworks，IronClaw 有一些值得关注的创新:

1. **OpenAI 兼容代理端点** — `/v1/chat/completions` 让任何 OpenAI 客户端直接对接，这是其他所有候选方案都缺少的
2. **WASM 通道/工具沙箱** — 通道和工具编译为 WASM 组件，在 wasmtime 中运行，安全隔离
3. **多层安全模型** — 命令注入检测、SSRF 防护、秘密加密、环境变量清洗、Docker 沙箱
4. **pgvector 向量搜索记忆** — 比 MEMORY.md 文件或 SQLite 更强大的语义搜索
5. **MCP 支持** — 可连接外部 MCP 工具服务器
6. **Skills Trust Model** — Installed (只读) vs Trusted (完全访问)，防止权限提升

---

## 5. 风险评估

| 风险 | 严重度 | 说明 |
|------|--------|------|
| **飞书/钉钉/企微缺失** | 🔴 **致命** | P3 优先级意味着短期内不会实现 |
| **内存占用过高** | 🔴 高 | wasmtime + DB 使单容器 RSS 远超 50 MB 目标 |
| **部署过重** | 🟡 高 | 需要 DB + 可能需要 Docker，与 Per-User VM 冲突 |
| **项目太新** | 🟡 高 | 10 天内发布 12 个版本，稳定性未经验证 |
| **Rust 1.92 要求** | 🟡 中 | 如需源码编译，需最新 Rust 版本 |
| **NEAR AI 绑定** | 🟡 中 | 默认 LLM 后端是 NEAR AI (需要 OAuth)，自定义端点是备选 |
| **OpenClaw 功能差距** | 🟠 低 | FEATURE_PARITY.md 列出大量未实现功能 |

---

## 6. 结论

### IronClaw ❌ 不适合 JAcoworks

| 关键需求 | IronClaw | PicoClaw ⭐ | 差距 |
|----------|----------|-----------|------|
| 飞书通道 | ❌ P3 | ✅ 内置 | **致命** |
| 钉钉/企微 | ❌ 未规划 | ✅ 内置 | **致命** |
| 容器内存 <50 MB | ❌ 估计 80+ MB | ✅ ~20 MB | **严重** |
| 部署简洁 | ❌ 需 DB + Docker | ✅ 单二进制 | **严重** |
| HTTP API | ✅ 最强 | ❌ 需加 | PicoClaw 可补 |
| MCP 支持 | ✅ | ❌ | 非当前需求 |

**PicoClaw 仍然是 JAcoworks 的最佳选择。** IronClaw 的 HTTP API 和安全模型虽然更强，但中国企业 IM 通道的完全缺失是不可逾越的障碍。

### IronClaw 适合的场景

- 面向国际市场的 AI Agent 平台（Telegram/Slack/Discord 已内置）
- 需要 OpenAI 兼容代理端点的场景
- 需要 Docker 沙箱执行不可信代码的场景
- 需要 MCP 工具生态集成的场景
- 安全要求极高的企业环境（多层安全模型）

---

## 7. 生态系统关系图（更新）

```
openclaw/openclaw (TypeScript, 215k ⭐) ← 原始项目
  ├── nearai/ironclaw (Rust reimplementation, 2.6k ⭐) ← 本次评估
  │     └── 参考了 ZeroClaw 的架构模式
  └── zeroclaw-labs/zeroclaw (Rust, 4.9k ⭐) ← 已废弃 (UTF-8 panic)

badlogic/pi-mono (TypeScript, 14.4k ⭐)
  ├── Dicklesworthstone/pi_agent_rust (Rust port, 310 ⭐) ← 备选方案
  └── can1357/oh-my-pi (TS + Rust N-API fork, 982 ⭐)

sipeed/picoclaw (Go, 17.3k ⭐) ← 选定方案 ⭐
```
