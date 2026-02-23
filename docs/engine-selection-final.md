# AI Agent 引擎最终选型报告

> 日期: 2026-02-22 (最后更新)
> 状态: **最终决策**
> 结论: **OpenClaw (openclaw/openclaw) — 功能最全面，资源约束解除后重新选定**

---

## 0. 最终决策：OpenClaw

经过对 6 个候选方案的深入源码级调研，**OpenClaw 是 JAcoworks 的最终选择**。

曾因内存占用 (~380 MB) 选定 PicoClaw，但随着资源约束解除（宿主机将随规模扩容），重新评估后 OpenClaw 的全面功能优势不可替代。

| 候选 | 仓库 | 语言 | Stars | 状态 |
|------|------|------|-------|------|
| **OpenClaw** ⭐ | [openclaw/openclaw](https://github.com/openclaw/openclaw) | TypeScript | 215k | **选定** |
| PicoClaw | [sipeed/picoclaw](https://github.com/sipeed/picoclaw) | Go | 17.3k | 轻量级备选 |
| pi_agent_rust | [Dicklesworthstone/pi_agent_rust](https://github.com/Dicklesworthstone/pi_agent_rust) | Rust | 310 | 深度定制备选 |
| IronClaw | [nearai/ironclaw](https://github.com/nearai/ironclaw) | Rust | 2.6k | ❌ 不适合 (无中国 IM 通道) |
| pi-mono | [badlogic/pi-mono](https://github.com/badlogic/pi-mono) | TypeScript | 14.4k | 被 OpenClaw 覆盖 |
| oh-my-pi | [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) | TS + Rust N-API | 982 | 被 OpenClaw 覆盖 |
| ZeroClaw | [zeroclaw-labs/zeroclaw](https://github.com/zeroclaw-labs/zeroclaw) | Rust | 4.9k | ❌ 已废弃 (UTF-8 panic) |

---

## 1. 关键调研发现

### 1.1 PicoClaw 没有 HTTP API（已确认解决方案）

**这是调研中最重要的发现。** 之前认为 PicoClaw `gateway` 模式是 HTTP API server，实际上：

- `picoclaw gateway` 是 **IM 通道聚合器**（连接飞书/钉钉/Discord 等，不是 HTTP API）
- 唯一暴露的 HTTP 端点是 `/health` 和 `/ready`（Kubernetes 探针）
- 飞书/企微等通道各自有 Webhook 接收端口，但这是给对应平台回调用的

**解决方案：添加自定义 HTTP Channel（~150 行 Go 代码）**

PicoClaw 的通道架构非常干净（`Channel` 接口 + `Manager` 动态注册），添加 HTTP 通道无需修改核心代码：

```go
// 实现 Channel 接口的 5 个方法:
type HTTPAPIChannel struct {
    *BaseChannel
    server *http.Server
    port   int
}

func (c *HTTPAPIChannel) Start(ctx context.Context) error { /* HTTP server */ }
func (c *HTTPAPIChannel) Send(ctx context.Context, msg bus.OutboundMessage) error { /* 回复 */ }
func (c *HTTPAPIChannel) Stop(ctx context.Context) error { /* 关闭 */ }
```

参考实现：[pkg/channels/maixcam.go](https://github.com/sipeed/picoclaw/blob/main/pkg/channels/maixcam.go)（TCP/JSON 通道，~244 行，与 HTTP 方案结构一致）

**架构影响**：Go 管理网关 → HTTP POST → PicoClaw HTTP Channel → Agent Loop → 响应

### 1.2 所有候选方案都没有内置 HTTP API

| 候选 | HTTP API | 集成方式 |
|------|----------|----------|
| PicoClaw | ❌ 无（仅 /health） | **添加 HTTP Channel（~150 行 Go）** ← 最优 |
| pi_agent_rust | ❌ 无 | 需要 HTTP→stdin/stdout RPC 桥接 |
| pi-mono | ❌ 无 | 需要 HTTP→stdin/stdout RPC 桥接 |
| oh-my-pi | ❌ 无 | 同 pi-mono |
| ZeroClaw | ✅ /webhook | 但 UTF-8 中文崩溃 |

PicoClaw 的 Go Channel 架构使 HTTP 集成最自然、最简洁。

### 1.3 PicoClaw 飞书通道确认

- ✅ **内置飞书通道**，使用官方 `larksuite/oapi-sdk-go/v3` SDK
- ✅ **WebSocket 长连接模式**（无需公网 Webhook URL，适合内网）
- ✅ 支持 P2P 和群聊
- ✅ `allow_from` 白名单过滤
- ⚠️ 仅支持 64 位平台（amd64/arm64/riscv64）

### 1.4 PicoClaw 自定义 LLM 端点确认

```json
{
  "model_list": [
    {
      "model_name": "claude-sonnet",
      "model": "openai/claude-sonnet-4-6",
      "api_base": "http://67.230.171.248:8317/v1",
      "api_key": "sk-123456"
    }
  ]
}
```

- ✅ `api_base` 字段完全覆盖 URL
- ✅ `openai/` 前缀选择 OpenAI 兼容协议
- ✅ 支持同模型多端点负载均衡
- ✅ 支持 fallback 模型链

---

## 2. 五方完整对比

### 2.1 资源 & 部署

| 维度 | PicoClaw | pi_agent_rust | pi-mono | oh-my-pi | ZeroClaw |
|------|----------|---------------|---------|----------|----------|
| 语言 | **Go** | Rust | TypeScript | TS + Rust N-API | Rust |
| 二进制大小 | ~8-15 MB | ~7.6 MB | npm 包 | npm 包 | ~3.4 MB |
| 启动 RSS | **10-20 MB** | **6.7 MB** | 45-80 MB | ~60 MB | ~5 MB |
| 1M token 会话 | ~30-50 MB (估) | **31 MB** | ~164 MB | ~170 MB | ~20 MB (估) |
| 运行时依赖 | **无** (静态) | **无** (静态) | Node.js 20+ | Bun/Node.js | **无** (静态) |
| 预编译发布 | ✅ 16 平台 | ✅ v0.1.6 | npm install | npm install | ❌ 需编译 |
| 容器模板大小 | **~50 MB** | ~50 MB | ~300 MB | ~350 MB | ~500 MB |

### 2.2 工具集

| 工具 | PicoClaw | pi_agent_rust | pi-mono | oh-my-pi | ZeroClaw |
|------|----------|---------------|---------|----------|----------|
| file_read | ✅ | ✅ | ✅ | ✅ | ✅ |
| file_write | ✅ | ✅ | ✅ | ✅ | ✅ |
| **edit_file** | ✅ | ✅ | ✅ | ✅ (hashline) | ❌ |
| append_file | ✅ | ❌ | ❌ | ❌ | ❌ |
| list_dir | ✅ | ✅ (ls) | ✅ (ls) | ✅ | ❌ |
| shell/exec | ✅ | ✅ (bash) | ✅ (bash) | ✅ | ✅ |
| web_search | ✅ (Brave/DDG) | ❌ | ❌ | ❌ | 可选 |
| web_fetch | ✅ | ❌ | ❌ | ✅ (browser) | ❌ |
| **spawn/subagent** | ✅ (两种) | ❌ | ❌ (SDK 实现) | ✅ (6 种) | 未确认 |
| **message** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **cron** | ✅ | ❌ | ❌ | ❌ | ❌ |
| grep | ❌ | ✅ | ✅ | ✅ | ❌ |
| find | ❌ | ✅ | ✅ | ✅ | ❌ |
| **工具总数** | **15** | 7 | 7 | 15+ | ~7 |

### 2.3 通道 & 集成

| 通道 | PicoClaw | pi_agent_rust | pi-mono | oh-my-pi | ZeroClaw |
|------|----------|---------------|---------|----------|----------|
| **飞书 (Feishu)** | ✅ **内置** | ❌ | ❌ | ❌ | ❌ |
| **钉钉 (DingTalk)** | ✅ **内置** | ❌ | ❌ | ❌ | ❌ |
| **企微 (WeCom)** | ✅ **Bot + App** | ❌ | ❌ | ❌ | ❌ |
| **QQ** | ✅ **内置** | ❌ | ❌ | ❌ | ❌ |
| Telegram | ✅ | ❌ | ❌ | ❌ | ✅ |
| Discord | ✅ | ❌ | ❌ | ❌ | ✅ |
| Slack | ✅ | ❌ | ✅ (pi-mom) | ❌ | ✅ |
| CLI | ✅ | ✅ | ✅ | ✅ | ✅ |
| HTTP API | ❌ (可加) | ❌ (RPC) | ❌ (RPC) | ❌ (RPC) | ✅ |
| **通道总数** | **13** | 1 | 2 | 1 | ~6 |

### 2.4 中文 & 稳定性

| 维度 | PicoClaw | pi_agent_rust | pi-mono | oh-my-pi | ZeroClaw |
|------|----------|---------------|---------|----------|----------|
| UTF-8 安全 | ✅ Go 原生 | ✅ Rust 类型安全 | ✅ JS 原生 | ✅ JS+Rust | ❌ **panic** |
| CJK 宽度 | Go 标准库 | unicode-width | Intl.Segmenter | Rust N-API text | ❌ |
| 成熟度 | v0.1.1 (新) | v0.1.6 (新) | **v0.52+ (成熟)** | 活跃 fork | v0.1.1 (不稳) |
| 测试覆盖 | 基础 | **3,857+ 测试** | 成熟 | 成熟 | 未知 |

### 2.5 扩展性

| 维度 | PicoClaw | pi_agent_rust | pi-mono | oh-my-pi |
|------|----------|---------------|---------|----------|
| 技能系统 | ✅ SKILL.md + ClawHub | ✅ 兼容 pi-mono | ✅ SKILL.md | ✅ SKILL.md |
| Extension 系统 | ❌ (仅 skills) | ✅ QuickJS + WASM | ✅ **28 种事件钩子** | ✅ 增强版 |
| 自定义工具 | ❌ (需改源码) | ✅ (Extension) | ✅ (registerTool) | ✅ |
| MCP 支持 | ❌ | ✅ (Extension) | ✅ (Extension) | ✅ |
| 记忆系统 | MEMORY.md + 日记 | JSONL + SQLite | JSONL sessions | JSONL |

---

## 3. 为什么选 PicoClaw（而不是 pi_agent_rust）

尽管 pi_agent_rust 在技术指标上更优（6.7 MB 启动 RSS、3,857 测试、Extension 系统），PicoClaw 对 JAcoworks 的适配度更高：

| 因素 | PicoClaw 优势 | pi_agent_rust 劣势 |
|------|-------------|-------------------|
| **飞书/钉钉/企微** | 13 个内置通道 | 零通道，需全部自建 |
| **管理网关开发量** | 添加 HTTP Channel ~150 行 | 需建 HTTP→RPC 桥接层 + 全部 IM 通道 |
| **技术栈统一** | Go (与管理网关一致) | Rust (需额外技能) |
| **部署简化** | 单二进制 + JSON 配置 | 单二进制，但无通道能力 |
| **办公工具** | spawn/subagent/cron/message | 仅 7 个开发工具 |
| **团队学习曲线** | Go 团队可直接贡献 | Rust 门槛高 |

**pi_agent_rust 作为备选方案保留**：如果未来需要深度 Extension 系统（自定义工具、事件拦截器）、MCP 支持、或更精细的 Session 管理（分支/回退），可以考虑迁移。

---

## 4. JAcoworks + PicoClaw 架构

### 4.1 系统架构（更新版）

```
┌─────────────────────────────────────────────────────────────────┐
│                        客户端层                                   │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐     │
│  │ Flutter 桌面  │  │ Flutter 移动  │  │ 飞书 Bot            │     │
│  │ • 目录选择    │  │ • 纯对话      │  │ • 直连 PicoClaw     │     │
│  │ • 文件树浏览  │  │ • 文件预览    │  │   飞书通道 (内置)    │     │
│  │ • Agent Relay │  │ • 拍照上传    │  │                    │     │
│  └──────┬───────┘  └──────┬───────┘  └─────────┬──────────┘     │
│         └────────┬────────┘                     │               │
│                  │                              │               │
└──────────────────┼──────────────────────────────┼───────────────┘
                   │ HTTP REST + SSE               │ 飞书 WebSocket
         ┌─────────▼──────────────────┐  ┌────────▼───────────────┐
         │    管理网关 (Go 自建)        │  │  PicoClaw 飞书通道      │
         │                            │  │  (内置, 直连飞书 API)   │
         │  • SSO 认证                 │  │  • WebSocket 长连接     │
         │  • /v1/chat/completions    │  │  • 无需公网 Webhook     │
         │  • 用户 → 容器路由          │  │  • allow_from 白名单    │
         │  • LXD 生命周期管理         │  └────────────────────────┘
         │  • 用量统计 / 审计          │           ↕ 同一进程
         └────────────┬───────────────┘
                      │ HTTP POST → HTTP Channel
         ┌────────────▼───────────────────────────────────────┐
         │          PicoClaw Agent 实例 (Per-User VM)          │
         │                                                     │
         │  picoclaw gateway (单进程)                           │
         │  ├─ HTTP Channel (自定义, port 18800)               │
         │  ├─ Feishu Channel (内置, WebSocket)                │
         │  ├─ Agent Loop                                      │
         │  │   ├─ ReAct 循环 (LLM → Tool → LLM)             │
         │  │   ├─ 自动会话摘要 (>20 消息 或 >75% 上下文)       │
         │  │   └─ 强制压缩 (上下文溢出时丢弃旧 50%)           │
         │  ├─ ToolRegistry (15 个内置工具)                     │
         │  │   ├─ read_file / write_file / edit_file          │
         │  │   ├─ append_file / list_dir                      │
         │  │   ├─ exec (命令拒绝名单)                         │
         │  │   ├─ web_search / web_fetch                      │
         │  │   ├─ spawn / subagent                            │
         │  │   ├─ message / cron                              │
         │  │   └─ find_skills / install_skill                 │
         │  ├─ SessionManager (JSON 持久化)                     │
         │  ├─ MemoryStore (MEMORY.md + 日记)                   │
         │  └─ SkillRegistry (workspace/skills/)               │
         │                                                     │
         │  共享目录 (只读 bind mount):                          │
         │  • /shared/skills → workspace/skills                 │
         │  • /shared/docs → workspace/docs                     │
         └─────────────────────┬───────────────────────────────┘
                               │
         ┌─────────────────────▼───────────────────────────────┐
         │              LLM 中转平台 (现有)                       │
         │  model_list + api_base: http://67.230.171.248:8317   │
         └─────────────────────────────────────────────────────┘
```

### 4.2 双通道策略

| 通道 | 路径 | 用途 |
|------|------|------|
| **Flutter → HTTP Channel** | Flutter → Go 网关 → HTTP Channel → PicoClaw | 桌面/移动客户端 |
| **飞书 → 内置通道** | 飞书 → PicoClaw 飞书通道 (直连) | 飞书 Bot 对话 |

飞书通道 **绕过** Go 管理网关，直连 PicoClaw 实例。这大幅减少管理网关的开发量。

### 4.3 请求流转

```
[Flutter 客户端路径]
Flutter → Go 网关 (认证/路由)
  → HTTP POST http://<container-ip>:18800/chat
    → PicoClaw HTTP Channel
      → HandleMessage() → MessageBus → AgentLoop
        → LLM (67.230.171.248:8317) → Tool 执行 → 响应
      → Agent 响应 → Send() → HTTP Response/SSE
    → Go 网关 → Flutter

[飞书路径]
飞书消息 → PicoClaw Feishu Channel (WebSocket 长连接)
  → HandleMessage() → MessageBus → AgentLoop
    → LLM → Tool 执行 → 响应
  → Send() → 飞书 API → 回复消息
```

---

## 5. PicoClaw 配置方案

### 5.1 config.json

```json
{
  "agents": {
    "defaults": {
      "workspace": "~/.picoclaw/workspace",
      "model": "claude-sonnet",
      "max_tokens": 8192,
      "temperature": 0.7,
      "max_tool_iterations": 20,
      "restrict_to_workspace": true
    }
  },
  "model_list": [
    {
      "model_name": "claude-sonnet",
      "model": "openai/claude-sonnet-4-6",
      "api_base": "http://67.230.171.248:8317/v1",
      "api_key": "sk-123456"
    },
    {
      "model_name": "gpt5",
      "model": "openai/gpt-5.2",
      "api_base": "http://67.230.171.248:8317/v1",
      "api_key": "sk-123456"
    },
    {
      "model_name": "gemini",
      "model": "openai/gemini-3-pro-preview",
      "api_base": "http://67.230.171.248:8317/v1",
      "api_key": "sk-123456"
    }
  ],
  "channels": {
    "feishu": {
      "enabled": true,
      "app_id": "cli_xxx",
      "app_secret": "xxx",
      "encrypt_key": "",
      "verification_token": "",
      "allow_from": []
    },
    "http_api": {
      "enabled": true,
      "port": 18800,
      "allow_from": []
    }
  },
  "gateway": {
    "host": "0.0.0.0",
    "port": 8080
  },
  "tools": {
    "exec": {
      "enable_deny_patterns": true
    },
    "web": {
      "duckduckgo": {
        "enabled": true,
        "max_results": 5
      }
    }
  },
  "heartbeat": {
    "enabled": false
  }
}
```

### 5.2 Per-User VM 资源规格

| 资源 | 值 | 说明 |
|------|-----|------|
| CPU | 2 核 | 足够运行 shell 命令、数据处理 |
| 内存 | **512 MB** | PicoClaw ~20 MB + shell/工具/脚本充裕 |
| 磁盘 | **5 GB** | 无需编译工具链，纯二进制 + workspace |
| 网络 | `jaconet` 桥接 | 10.10.10.0/24 |

---

## 6. Phase 2 部署验证计划（PicoClaw 版）

### 验证清单

| 功能 | 验证项 | 预计时间 |
|------|--------|---------|
| 安装 | 下载预编译二进制 v0.1.1 | 2 min |
| LLM 连接 | `api_base` → LLM 代理 (Claude/GPT) | 5 min |
| 内置工具 | read_file, write_file, edit_file, exec | 10 min |
| 飞书通道 | 内网 WebSocket 连接测试 | 15 min |
| HTTP Channel | 自定义 HTTP 通道实现 + 测试 | 2 h |
| 记忆系统 | MEMORY.md + 会话持久化 | 10 min |
| 技能系统 | workspace/skills/ 自动发现 | 10 min |
| 子 Agent | spawn + subagent 工具 | 10 min |
| 多用户隔离 | Per-container 天然隔离 | 10 min |
| systemd 服务 | 开机自启 | 5 min |
| 快照 | `tpl-picoclaw/base-verified` | 5 min |
| **总计** | | **~3-4 小时** |

### 关键验证顺序

```
Step 1: 创建 tpl-picoclaw LXD 容器
Step 2: 下载预编译二进制 (v0.1.1, linux-amd64)
Step 3: 配置 config.json + LLM 代理
Step 4: 验证 CLI 模式 (picoclaw agent "你好")
Step 5: 验证飞书通道 (WebSocket 连接)
Step 6: 验证内置工具 (file/exec/web)
Step 7: 实现 HTTP Channel (Go 代码)
Step 8: 验证 HTTP Channel 端到端
Step 9: systemd 服务 + 快照
```

---

## 7. 风险评估

| 风险 | 概率 | 严重度 | 缓解 |
|------|------|--------|------|
| PicoClaw 太新 (v0.1.1) 有 bug | 高 | 中 | 锁定版本 + 关注 GitHub Issues |
| HTTP Channel 需要 fork 修改源码 | 中 | 低 | Channel 接口设计良好，~150 行 Go |
| `openai/` 前缀协议与 LLM 代理不兼容 | 中 | 中 | 先 curl 验证 `/v1/chat/completions` |
| 飞书 WebSocket 在 LXD 容器内不通 | 低 | 高 | 检查网络 ACL + DNS |
| 内存超 20 MB 预期 | 中 | 低 | 容器限制 512 MB，余量充足 |
| 会话摘要丢失重要上下文 | 低 | 中 | 调整摘要阈值 (20 消息 → 50) |

---

## 8. 管理网关简化评估

| 功能 | ZeroClaw 方案 (旧) | PicoClaw 方案 (新) | 工作量变化 |
|------|-------------------|-------------------|-----------|
| 飞书消息转发 | Go 自建完整对接 | **PicoClaw 内置** | **-80%** |
| 钉钉/企微 | Go 自建 | **PicoClaw 内置** | **-80%** |
| 协议适配 | OpenAI → /webhook | OpenAI → HTTP Channel | 相似 |
| 容器 HTTP 端点 | /webhook (已有) | HTTP Channel (需加) | +2h 开发 |
| 用户路由 | 不变 | 不变 | 相同 |
| LXD 生命周期 | 不变 | 不变 | 相同 |

**管理网关开发量预计减少 40-50%**（飞书/钉钉/企微不需要在网关层实现）。

---

## 9. 生态系统关系图

```
badlogic/pi-mono (TypeScript, 14.4k ⭐)
  ├── Dicklesworthstone/pi_agent_rust (Rust port, 310 ⭐) ← 备选方案
  └── can1357/oh-my-pi (TS + Rust N-API fork, 982 ⭐)

sipeed/picoclaw (Go, 17.3k ⭐) ← 选定方案
  ├── lingfan/picoclaw-rs (Rust port, 5 ⭐, 太早期)
  └── picoclaw-labs/picoclaw (Go 分支)

openclaw/openclaw (TypeScript, 215k ⭐) ← 最大 AI Agent 项目，但 380 MB+ 内存不适合 Per-User VM
  ├── nearai/ironclaw (Rust 重写, 2.6k ⭐) ← 已评估，无中国 IM 通道
  └── zeroclaw-labs/zeroclaw (Rust 重写, 4.9k ⭐) ← 已废弃 (UTF-8 panic)
```

---

## 10. 附录：pi_agent_rust 详细评估

作为备选方案，以下是 pi_agent_rust 的关键数据：

- **仓库**: [Dicklesworthstone/pi_agent_rust](https://github.com/Dicklesworthstone/pi_agent_rust)
- **版本**: v0.1.6 (2026-02-21)
- **启动 RSS**: 6.7 MB（vs pi-mono 153 MB，23x 更小）
- **1M token 会话**: 31 MB（vs pi-mono 164 MB，5x 更小）
- **二进制**: 7.6 MB（LTO + strip）
- **启动延迟**: 2.77 ms（vs pi-mono 1,025 ms，370x 更快）
- **测试**: 3,857+ passing（3,319 lib + 296 TUI + 103 e2e + 139 fixture）
- **Extension 兼容**: 224/224 pi-mono extension 测试通过（QuickJS + WASM）
- **UTF-8**: Rust `#![forbid(unsafe_code)]`，类型系统保证 UTF-8 安全
- **自定义端点**: `models.json` 的 `base_url` 字段
- **缺点**: 无 HTTP API、无 IM 通道、无 cron/spawn/message 工具
