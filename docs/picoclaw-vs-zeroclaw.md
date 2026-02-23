# PicoClaw vs ZeroClaw 深度对比报告

> 日期: 2026-02-22
> 目的: 评估是否应从 ZeroClaw 切换到 PicoClaw 作为 JAcoworks 的 AI Agent 引擎

---

## 0. 结论：建议切换到 PicoClaw

**PicoClaw 对 JAcoworks 的适配度远优于 ZeroClaw**，原因如下：

1. **ZeroClaw 处理中文文本会崩溃** — UTF-8 多字节边界 panic 是已知问题
2. **PicoClaw 内置飞书通道** — 零代码对接飞书 Bot
3. **PicoClaw 有预编译二进制** — 无需在容器内安装 Rust 编译链
4. **PicoClaw 社区活跃度高 3.5x** — 17.3k ⭐ vs 4.9k ⭐
5. **PicoClaw 工具集更完整** — 有 edit_file、spawn (子 Agent)、cron

---

## 1. 项目概况

| 维度 | PicoClaw | ZeroClaw |
|------|----------|----------|
| **仓库** | [sipeed/picoclaw](https://github.com/sipeed/picoclaw) | [zeroclaw-labs/zeroclaw](https://github.com/zeroclaw-labs/zeroclaw) |
| **Stars** | **17.3k** ⭐ | 4.9k ⭐ |
| **Forks** | 2k | 462 |
| **Contributors** | **69** | 15 |
| **Commits** | **433** | 217 |
| **语言** | Go | Rust |
| **License** | MIT | MIT / Apache-2.0 |
| **发布** | **3 个版本 (v0.0.1 ~ v0.1.2)** | ❌ 无发布 |
| **背景** | Sipeed (知名硬件公司) | 个人/小团队 |
| **发布日期** | 2026-02-09 (13 天前) | 2025 Q4+ |

---

## 2. 技术对比

### 2.1 二进制 & 资源

| 维度 | PicoClaw | ZeroClaw |
|------|----------|----------|
| 二进制大小 | ~5.75 MB (Linux x86_64) | ~3.4 MB |
| 空闲内存 | **< 10 MB** (官方)，近期 PR 后 10-20 MB | **< 5 MB** |
| 冷启动 | < 1s | < 10ms |
| 预编译发布 | ✅ **16 个平台** (x86_64, arm64, riscv64, mips64, Darwin, FreeBSD) | ❌ 需从源码编译 |
| 构建依赖 | Go 1.25+ (`go build`) | Rust 1.87+ (`cargo build --release`, 15-30 min) |
| Docker | ✅ docker-compose | ✅ Dockerfile |

### 2.2 内置工具

| 工具 | PicoClaw | ZeroClaw |
|------|----------|----------|
| `file_read` / `read_file` | ✅ | ✅ |
| `file_write` / `write_file` | ✅ | ✅ |
| **`edit_file`** | ✅ **就地编辑** | ❌ 无 |
| `append_file` | ✅ | ❌ |
| `list_dir` | ✅ | ❌ (需通过 shell `ls`) |
| `shell` / `exec` | ✅ (`exec`) | ✅ (`shell`) |
| `web_search` | ✅ (Brave + DuckDuckGo) | 可选 |
| `memory_store` / `memory_recall` | ✅ (MEMORY.md) | ✅ (SQLite 向量+关键词) |
| **`spawn` (子 Agent)** | ✅ **独立上下文** | 未确认 (`delegate`) |
| **`message`** (直接给用户发消息) | ✅ | ❌ |
| **`cron` (定时任务)** | ✅ | ❌ (HEARTBEAT.md 仅) |
| `browser_open` | ❌ (Roadmap) | ✅ (可选) |

### 2.3 通道 (Channels)

| 通道 | PicoClaw | ZeroClaw |
|------|----------|----------|
| CLI | ✅ | ✅ |
| Telegram | ✅ | ✅ |
| Discord | ✅ | ✅ |
| Slack | ✅ | ✅ |
| **飞书 (Feishu/Lark)** | ✅ **内置** (`larksuite/oapi-sdk-go/v3`) | ❌ 无 |
| **钉钉 (DingTalk)** | ✅ **内置** (Stream Mode) | ❌ 无 |
| **QQ** | ✅ **内置** | ❌ 无 |
| **企业微信 (WeCom)** | ✅ **内置** (Bot + App) | ❌ 无 |
| WhatsApp | ❌ | ✅ |
| iMessage | ❌ | ✅ |
| Matrix | ❌ | ✅ (可选) |
| LINE | ✅ | ❌ |
| OneBot | ✅ | ❌ |
| Webhook (通用) | ❌ (仅特定通道) | ✅ (`/webhook`) |

> **对 JAcoworks 的影响**: 飞书 + 钉钉 + QQ + 企业微信 全部内置，大幅减少管理网关的开发量。

### 2.4 LLM Provider

| 维度 | PicoClaw | ZeroClaw |
|------|----------|----------|
| 配置格式 | JSON (`model_list`) | TOML (`default_provider`) |
| 自定义端点 | ✅ `api_base` 字段覆盖 | ✅ `custom:https://url` |
| 内置 Provider | OpenAI, Anthropic, Zhipu, DeepSeek, Gemini, Groq, Qwen, Ollama, OpenRouter, Cerebras, 火山引擎, 神算云 | 23+ (OpenRouter, Anthropic, OpenAI, Ollama, Venice, Groq, Mistral, xAI, DeepSeek 等) |
| 负载均衡 | ✅ 同模型多端点轮询 | ❌ |
| 多 Agent 多模型 | ✅ 每 Agent 独立 Provider | ✅ `[agents.*]` 配置 |

**LLM 代理对接方式 (PicoClaw)**:

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

### 2.5 记忆系统

| 维度 | PicoClaw | ZeroClaw |
|------|----------|----------|
| 存储 | MEMORY.md (Markdown 文件) | **SQLite (向量 + FTS5 关键词)** |
| 向量搜索 | ❌ | ✅ (cosine similarity) |
| 关键词搜索 | 基于文件内容 | ✅ (BM25 评分) |
| 跨会话持久化 | ✅ | ✅ |
| 嵌入模型 | ❌ | ✅ (OpenAI / noop) |

> ZeroClaw 的记忆系统更先进。但对于办公场景，PicoClaw 的 MEMORY.md 方式足够用。

### 2.6 技能系统

| 维度 | PicoClaw | ZeroClaw |
|------|----------|----------|
| 格式 | `workspace/skills/` 目录 | `SKILL.md` + `SKILL.toml` |
| 加载方式 | 自动发现 | 自动扫描 + `getSkill` 按需加载 |
| HEARTBEAT | ✅ (HEARTBEAT.md, 30min 周期) | ✅ |
| Identity | IDENTITY.md / SOUL.md / USER.md / AGENTS.md | 同 (OpenClaw 格式) + AIEOS JSON |

### 2.7 安全

| 维度 | PicoClaw | ZeroClaw |
|------|----------|----------|
| 工作区隔离 | ✅ `restrict_to_workspace` | ✅ `workspace_only` |
| 危险命令拦截 | ✅ (rm -rf, format, fork bomb 等) | ✅ (`allowed_commands` 白名单) |
| Gateway 认证 | 依赖通道各自的 allow_from | ✅ Pairing 配对码 + Bearer Token |
| 加密存储 | ❌ | ✅ ChaCha20-Poly1305 |
| Docker 沙箱 | ✅ | ✅ |

---

## 3. 稳定性对比（关键！）

### 3.1 ZeroClaw 已知稳定性问题

| 问题 | 严重程度 | 对 JAcoworks 影响 |
|------|----------|-------------------|
| **UTF-8 边界 panic** — 处理中文字符时崩溃 (`byte index N is not a char boundary; it is inside '正'`) | 🔴 **致命** | **直接导致中文对话崩溃** |
| Provider API 调用失败 → 无限重试 | 🟡 高 | Gateway 不稳定 |
| OpenTelemetry 集成破坏 daemon | 🟡 高 | 影响 daemon 模式 |
| Rust 版本不匹配构建失败 (需 1.87+) | 🟡 中 | 编译问题 |
| 结构体字段变更导致编译错误 | 🟡 中 | 升级困难 |
| 平台特定构建失败 (Termux/Android) | 🟠 低 | 暂不影响 |
| SQLite 记忆覆盖最近事实 | 🟡 中 | 记忆不可靠 |

> **UTF-8 panic 是 DEALBREAKER** — JAcoworks 是中文办公平台，几乎所有对话都包含中文。ZeroClaw 在 `src/agent/loop_.rs` 中的字符串截断使用字节索引而非字符边界，中文字符 (3 字节 UTF-8) 被从中间截断时直接 panic。

### 3.2 PicoClaw 已知问题

| 问题 | 严重程度 | 对 JAcoworks 影响 |
|------|----------|-------------------|
| 早期开发阶段，可能有网络安全问题 | 🟡 中 | 内网环境可控 |
| 近期 PR 后内存增长到 10-20 MB | 🟢 低 | 仍然很低 |
| 某些 Provider 标记为 "To be tested" | 🟡 中 | 我们用 custom api_base |
| 无向量搜索记忆 | 🟢 低 | 办公场景够用 |

---

## 4. 对 JAcoworks 架构的影响

### 4.1 如果选择 PicoClaw

**大幅简化架构**：

```
Flutter/飞书 → 管理网关 (Go)
  ├─ 认证 (SSO Token)
  ├─ 路由 (user → container IP)
  └─ 转发 → PicoClaw Gateway (port 18800)
       ├─ Agent Loop
       ├─ 工具调用 (file/exec/edit/spawn)
       ├─ 技能加载 (workspace/skills/)
       └─ 响应 → 管理网关 → 客户端
```

**飞书集成直接走 PicoClaw 内置通道**（可选）：
```
飞书消息 → PicoClaw Feishu Channel (内置)
  → Agent 处理
  → PicoClaw 直接回复飞书
```

### 4.2 管理网关简化

| 功能 | ZeroClaw 方案 | PicoClaw 方案 |
|------|-------------|-------------|
| 飞书消息转发 | Go 网关需自建完整飞书 Bot 对接 | **PicoClaw 内置飞书通道，网关可不处理** |
| 钉钉/企业微信 | Go 网关需自建 | **PicoClaw 内置** |
| 协议适配 | OpenAI API → /webhook | OpenAI API → /webhook 或直接用 `picoclaw gateway` |
| 容器 HTTP 端点 | `/webhook` (需 Bearer token) | `picoclaw gateway` (通道级 allow_from) |

### 4.3 部署简化

| 步骤 | ZeroClaw | PicoClaw |
|------|----------|----------|
| 安装 | 安装 Rust 1.87+ → `cargo build --release` (15-30 min) | **`wget` 下载预编译二进制 (2 sec)** |
| 容器模板大小 | ~500MB+ (Rust 工具链) | **< 50MB** (纯二进制) |
| 升级 | 重新编译 | **下载新版本替换** |
| 故障恢复 | 重新编译或从快照恢复 | **重新下载二进制** |

---

## 5. PicoClaw 配置方案 (for JAcoworks)

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
    }
  },
  "tools": {
    "web": {
      "duckduckgo": {
        "enabled": true,
        "max_results": 5
      }
    }
  },
  "heartbeat": {
    "enabled": false,
    "interval": 30
  }
}
```

### 5.2 Per-User VM 资源调整

| 资源 | ZeroClaw 方案 | PicoClaw 方案 |
|------|-------------|-------------|
| 内存 | 1 GB | **512 MB** (Go 比 Rust + 编译工具链更省磁盘) |
| 磁盘 | 10 GB | **5 GB** (无需 Rust 工具链和源码) |
| CPU | 2 核 | 2 核 (不变) |

---

## 6. 风险评估

### 6.1 PicoClaw 风险

| 风险 | 概率 | 缓解 |
|------|------|------|
| 项目太新 (13 天) 可能有 breaking changes | 高 | 锁定 v0.1.2 版本，关注 Release |
| 无内置 Gateway webhook (通用 HTTP 端点) | 中 | 利用 `picoclaw gateway` 启动的通道服务 |
| 内存增长超预期 | 低 | 监控 + 容器限制 |
| 记忆系统不如 SQLite 向量搜索 | 低 | 办公场景文件记忆足够 |

### 6.2 关键验证点

1. [ ] `model_list` 中 `api_base` 自定义端点能否正确连接 LLM 代理
2. [ ] 飞书通道能否在 LXD 容器内正常工作
3. [ ] `picoclaw gateway` 是否暴露 HTTP API (非通道模式)
4. [ ] `edit_file` / `exec` / `spawn` 在 `restrict_to_workspace=true` 下的行为
5. [ ] 多用户容器隔离下的稳定性

---

## 7. 建议行动

1. **立即停止 ZeroClaw 部署验证** — UTF-8 中文 panic 是致命缺陷
2. **创建 `tpl-picoclaw` LXD 容器** — 下载 v0.1.2 预编译二进制
3. **端到端验证 PicoClaw** — LLM 连接 + 工具 + 飞书通道
4. **更新 AGENTS.md** — 将 AI 引擎从 ZeroClaw 切换到 PicoClaw
5. **评估管理网关简化** — PicoClaw 内置飞书/钉钉通道可能大幅减少 Go 网关工作量
