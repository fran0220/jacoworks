# PicoClaw vs OpenClaw 深度对比报告

> 日期: 2026-02-22
> 目的: 系统性对比 PicoClaw 和 OpenClaw，确认 PicoClaw 是否仍是 JAcoworks 最佳选择
> 结论: **PicoClaw 仍是最佳选择** — OpenClaw 功能最强但内存占用 20-40x，与 Per-User VM 架构根本冲突

---

## 0. 快速概览

| 维度 | PicoClaw ⭐ (选定) | OpenClaw |
|------|-------------------|----------|
| **仓库** | [sipeed/picoclaw](https://github.com/sipeed/picoclaw) | [openclaw/openclaw](https://github.com/openclaw/openclaw) |
| **Stars** | 17.3k | **215k** |
| **语言** | Go | TypeScript (Node.js) |
| **空闲 RSS** | **~10-20 MB** | **~380 MB — 1 GB+** |
| **运行时** | **无** (静态二进制) | Node.js ≥22.12.0 |
| **二进制/安装** | 预编译 ~6-15 MB | npm install (数百 MB) |
| **飞书/钉钉/企微** | ✅ 全部内置 | ✅ Extension 插件 |
| **HTTP API** | ❌ (可加 ~150 行) | ✅ **40+ 端点 + OpenAI 兼容** |
| **MCP 支持** | ❌ | ⚠️ 部分 (Claude CLI 透传) |
| **安全模型** | 基础 (命令黑名单) | ✅✅ 多层 (审计/审批/沙箱) |
| **成熟度** | v0.1.1 (13 天) | **v2026.2.21 (活跃 1 年+)** |
| **部署复杂度** | **低** (复制二进制) | 高 (Node.js + npm + 可选 Docker) |

> **核心矛盾**: OpenClaw 是功能最全面的 Agent 框架，但其 Node.js 运行时导致每容器 380 MB+ 内存，直接与 JAcoworks "Per-User VM × 150 人" 架构冲突。

---

## 1. 项目规模对比

| 维度 | PicoClaw | OpenClaw |
|------|----------|----------|
| Stars | 17,300 | **215,772** |
| Forks | 2,000 | **40,539** |
| Contributors | 69 | 数百+ |
| Commits | 433 | 数千+ |
| Releases | 3 (v0.0.1~v0.1.2) | **持续发布** (日历版本 vYYYY.M.D) |
| 生态项目 | ClawHub (技能市场) | **ClawHub + 3000+ 技能 + 数十社区插件** |
| License | MIT | MIT |
| 背景 | Sipeed (硬件公司) | OpenClaw Foundation (创始人已加入 OpenAI) |

OpenClaw 是当前最流行的开源 AI Agent 框架，Star 数是 PicoClaw 的 **12.5 倍**。

---

## 2. 资源占用 — 决定性差距

| 维度 | PicoClaw | OpenClaw | 差距 |
|------|----------|----------|------|
| **空闲 RSS** | ~10-20 MB | ~380 MB+ | **20-40x** |
| **运行时内存** | ~30-50 MB | ~500 MB - 1 GB+ | **10-20x** |
| **二进制/安装大小** | ~6-15 MB | 数百 MB (node_modules) | **30-50x** |
| **冷启动** | < 1s | > 5s (Node.js + 依赖加载) | **5x+** |
| **容器模板大小** | ~50 MB | ~500-800 MB (Node.js + deps) | **10-16x** |
| **运行时依赖** | 无 | Node.js ≥22, pnpm, native addons | — |

### 对 Per-User VM 的影响 (30 人 → 150 人)

| 规模 | PicoClaw (512 MB/容器) | OpenClaw (1.5 GB/容器) | 宿主机 62 GB |
|------|----------------------|---------------------|-------------|
| 30 人 | **~15 GB** ✅ | ~45 GB ⚠️ | PicoClaw 余裕大 |
| 80 人 | ~40 GB ⚠️ | ❌ 无法承载 | OpenClaw 超出 |
| 150 人 | ❌ 需缩配 | ❌ 完全不可行 | — |

**OpenClaw 在单宿主机上最多支撑 ~40 个容器，而 PicoClaw 可支撑 ~120 个。** 这是不可调和的架构级差距。

---

## 3. IM 通道对比

| 通道 | PicoClaw | OpenClaw | 说明 |
|------|----------|----------|------|
| **飞书 (Feishu)** | ✅ **内置** (WebSocket) | ✅ Extension 插件 | PicoClaw 零配置；OpenClaw 需安装插件 |
| **钉钉 (DingTalk)** | ✅ **内置** (Stream) | ✅ Extension 插件 + 社区 | 同上 |
| **企业微信 (WeCom)** | ✅ **内置** (Bot + App) | ✅ Extension 插件 + 社区 | 同上 |
| **QQ** | ✅ **内置** | ✅ 社区插件 | 同上 |
| **微信 (WeChat)** | ❌ | ✅ 社区插件 | OpenClaw 有优势 |
| Telegram | ✅ | ✅ 内置 (grammy) | 平手 |
| Discord | ✅ | ✅ 内置 (@buape/carbon) | 平手 |
| Slack | ✅ | ✅ 内置 (@slack/bolt) | 平手 |
| WhatsApp | ❌ | ✅ 内置 (baileys) | OpenClaw 优 |
| Signal | ❌ | ✅ 内置 | OpenClaw 优 |
| iMessage | ❌ | ✅ 内置 | OpenClaw 优 |
| LINE | ✅ | ✅ | 平手 |
| Matrix | ❌ | ✅ Extension | OpenClaw 优 |
| MS Teams | ❌ | ✅ Extension | OpenClaw 优 |
| Mattermost | ❌ | ✅ Extension | OpenClaw 优 |
| OneBot | ✅ | ❌ | PicoClaw 优 |
| MaixCAM | ✅ | ❌ | PicoClaw 独有 |
| **通道总数** | **13** | **25+** (内置 + 插件) | OpenClaw 2x |

**分析**:
- **对 JAcoworks 重要的通道** (飞书/钉钉/企微/QQ): 两者都支持。PicoClaw 内置，OpenClaw 通过插件
- **PicoClaw 优势**: 内置通道无需额外安装/配置，且 Go 原生实现性能更好
- **OpenClaw 优势**: 通道数量更多，社区生态更丰富，有专门的中国 IM Docker 镜像

---

## 4. HTTP API 对比

| 功能 | PicoClaw | OpenClaw |
|------|----------|----------|
| HTTP Server | ❌ (仅 /health, /ready) | ✅ **完整 Axum/Express server** |
| OpenAI 兼容端点 | ❌ | ✅ `/v1/chat/completions` + `/v1/models` |
| OpenResponses API | ❌ | ✅ `/v1/responses` |
| Webhook 端点 | ❌ | ✅ `/hooks/*` (可配置映射) |
| SSE 流式响应 | ❌ | ✅ `/api/chat/events` |
| WebSocket | ❌ | ✅ `/api/chat/ws` + ACP |
| 工具直接调用 | ❌ | ✅ `/tools/invoke` |
| 内存 API | ❌ | ✅ `/api/memory/*` |
| Control UI | ❌ | ✅ 内置 Web 控制面板 |
| 认证 | N/A | ✅ Bearer Token + 限流 + 暴力破解防护 |
| 默认端口 | N/A | 18789 |

**OpenClaw 的 HTTP API 是所有候选方案中最完善的。** 但 PicoClaw 可以通过添加 ~150 行 Go 代码实现 HTTP Channel，覆盖 JAcoworks 核心需求。

---

## 5. 工具集对比

| 工具 | PicoClaw | OpenClaw |
|------|----------|----------|
| read_file | ✅ | ✅ |
| write_file | ✅ | ✅ (apply_patch) |
| edit_file | ✅ | ✅ (apply_patch: create/update/delete/move) |
| append_file | ✅ | ❌ (通过 apply_patch) |
| list_dir | ✅ | ❌ (通过 bash) |
| shell/exec | ✅ (命令黑名单) | ✅ (PTY + 审批门控 + Docker 沙箱) |
| web_search | ✅ (Brave/DDG) | ✅ (Brave/Perplexity/Grok) |
| web_fetch | ✅ | ✅ (Readability + Firecrawl) |
| browser | ❌ (Roadmap) | ✅ **Playwright 自动化** |
| memory_* | ✅ (MEMORY.md) | ✅✅ **(SQLite-vec 向量 + FTS5 混合搜索)** |
| spawn/subagent | ✅ (两种) | ✅✅ **(sessions_spawn + steer + cascade kill)** |
| message | ✅ | ✅ (跨通道发送) |
| cron | ✅ | ✅ |
| image | ❌ | ✅ image_tool |
| tts | ❌ | ✅ tts_tool (edge-tts) |
| canvas | ❌ | ✅ canvas_tool (可视化工作区) |
| gateway 控制 | ❌ | ✅ gateway_tool (运行时重配置) |
| 长时进程 | ❌ | ✅ process tool (send_keys) |
| **工具总数** | 15 | **25+** |

**OpenClaw 工具集显著更丰富**，特别是浏览器自动化、语义记忆搜索、图片生成和 TTS。

---

## 6. LLM Provider 对比

| 维度 | PicoClaw | OpenClaw |
|------|----------|----------|
| 自定义端点 | ✅ `api_base` 字段 | ✅ `baseUrl` 字段 |
| OpenAI 兼容 | ✅ `openai/` 前缀 | ✅ `openai-completions` api 类型 |
| Anthropic | ✅ (通过 OpenAI 兼容) | ✅ 原生 `anthropic-messages` |
| 中国 LLM | DeepSeek, 智谱, 千问, 豆包 | ✅✅ **千帆(百度), Moonshot/Kimi, 豆包(火山), MiniMax, 小米MiMo, 千问** |
| 负载均衡 | ✅ 同模型多端点轮询 | ❌ (单端点) |
| Fallback 链 | ✅ | ❌ |
| 本地模型 | Ollama | Ollama + vLLM + LM Studio + node-llama-cpp |

两者都能通过自定义端点连接 JAcoworks 的 LLM 中转平台 (http://67.230.171.248:8317/v1)。

---

## 7. 安全模型对比

| 维度 | PicoClaw | OpenClaw |
|------|----------|----------|
| 工作区隔离 | ✅ `restrict_to_workspace` | ✅ `assertSandboxPath` |
| 命令拦截 | ✅ 危险命令黑名单 | ✅✅ **审批门控 + Docker 沙箱** |
| Docker 沙箱 | ❌ | ✅ 完整容器隔离 |
| 秘密加密 | ❌ | ✅ AES-GCM + OS Keychain |
| 审计日志 | ❌ | ✅ 工具执行 + 通道事件审计 |
| Prompt 注入防护 | ❌ | ✅ external-content 包装 |
| 技能扫描 | ❌ | ✅ skill-scanner (恶意内容检测) |
| 暴力破解防护 | N/A | ✅ 20 次/60s IP 限流 |
| 常量时间比较 | ❌ | ✅ secret-equal |
| SSRF 防护 | ❌ | ✅ HTTP 工具 (私有 IP 阻断) |

**OpenClaw 的安全模型远超 PicoClaw**。但在 Per-User VM (LXD 容器) 架构下，容器本身提供了进程/网络/文件系统隔离，部分弥补了 PicoClaw 安全模型的不足。

---

## 8. 扩展性对比

| 维度 | PicoClaw | OpenClaw |
|------|----------|----------|
| Skills | ✅ SKILL.md + ClawHub | ✅✅ **SKILL.md + ClawHub + 3000+ 技能** |
| Plugin 系统 | ❌ (仅 skills) | ✅✅ **完整插件系统** (通道/技能/Provider/Hooks/服务) |
| 自定义工具 | ❌ (需改源码) | ✅ 插件可注册工具 |
| 自定义通道 | Go Channel 接口 (~150 行) | ✅ 插件可贡献通道 |
| 记忆系统 | MEMORY.md (文件) | ✅✅ **SQLite-vec 向量 + FTS5 混合搜索** |
| MCP 支持 | ❌ | ⚠️ 部分 (Claude CLI 透传) |
| ACP 协议 | ❌ | ✅ Agent Client Protocol |
| Context 压缩 | ❌ | ✅ 自动 compaction |
| Session 分支 | ❌ | ✅ JSONL 树 + 分支/回退 |

---

## 9. 部署对比

| 维度 | PicoClaw | OpenClaw |
|------|----------|----------|
| 安装 | `wget` 预编译二进制 (2 秒) | `npm install -g openclaw` (分钟级) |
| 运行时 | **无** | Node.js ≥22.12.0 |
| 配置 | 单 JSON 文件 | YAML 配置 + 向导 |
| Docker 支持 | 可选 | ✅ 官方 Dockerfile + Compose |
| 中国 IM Docker | ❌ | ✅ [OpenClaw-Docker-CN-IM](https://github.com/justlovemaki/OpenClaw-Docker-CN-IM) |
| 升级 | 下载新二进制替换 | `npm update -g openclaw` |
| 容器模板大小 | **~50 MB** | ~500-800 MB |
| 多平台发布 | 16 平台 | npm (跨平台) |
| systemd | 自行配置 | 自行配置 |

---

## 10. 对 JAcoworks 架构的影响

### 方案 A: PicoClaw (当前选定) ⭐

```
每容器: PicoClaw 二进制 (~15 MB) + 配置
内存: ~20-50 MB / 容器
模板: ~50 MB
30 人: ~15 GB RAM ✅
150 人: ~75 GB RAM (需扩容或缩配)
管理网关: 需添加 HTTP Channel (~150 行 Go)
飞书: PicoClaw 内置通道直连
```

### 方案 B: OpenClaw

```
每容器: Node.js 22 + OpenClaw + node_modules
内存: ~500 MB - 1 GB / 容器
模板: ~500-800 MB
30 人: ~15-30 GB RAM ⚠️ (紧张)
150 人: ❌ 单宿主机无法承载
管理网关: OpenClaw 已有 HTTP API，网关只需路由
飞书: OpenClaw Extension 插件
```

### 方案 C: 混合方案 (大多数用 PicoClaw, 高级用户用 OpenClaw)

```
普通员工 (120 人): PicoClaw 容器 (~20 MB × 120 = ~2.4 GB)
高级用户 (10 人): OpenClaw 容器 (~500 MB × 10 = ~5 GB)
总计: ~7.4 GB ✅
好处: 高级用户获得浏览器自动化、Canvas、向量记忆等高级功能
坏处: 两套系统维护成本高
```

---

## 11. 综合评分

| 维度 | 权重 | PicoClaw | OpenClaw | 说明 |
|------|------|----------|----------|------|
| **内存占用** | 30% | ⭐⭐⭐⭐⭐ (10-20 MB) | ⭐ (380 MB+) | Per-User VM 核心约束 |
| **中国 IM 通道** | 25% | ⭐⭐⭐⭐⭐ (全部内置) | ⭐⭐⭐⭐ (插件可用) | 两者都满足 |
| **部署简洁** | 15% | ⭐⭐⭐⭐⭐ (单二进制) | ⭐⭐ (Node.js 生态) | 模板大小差 10x |
| **HTTP API** | 10% | ⭐⭐ (需添加) | ⭐⭐⭐⭐⭐ (40+ 端点) | PicoClaw 可补 |
| **安全模型** | 10% | ⭐⭐ (基础) | ⭐⭐⭐⭐⭐ (多层) | LXD 容器弥补 |
| **扩展性/生态** | 10% | ⭐⭐ (仅 skills) | ⭐⭐⭐⭐⭐ (插件+3000技能) | OpenClaw 远超 |
| **加权总分** | 100% | **4.25** | **2.95** | PicoClaw 胜 |

---

## 12. 结论

### PicoClaw 仍是 JAcoworks 最佳选择 ✅

| 因素 | 判断 |
|------|------|
| **内存占用** | PicoClaw 20x 更省 — Per-User VM 架构的决定性因素 |
| **中国 IM 通道** | 两者都支持飞书/钉钉/企微 — 平手 |
| **HTTP API** | OpenClaw 更强，但 PicoClaw 可补 ~150 行 Go — 可接受 |
| **安全模型** | OpenClaw 更强，但 LXD 容器提供底层隔离 — 可接受 |
| **扩展性** | OpenClaw 远超，但 JAcoworks 初期不需要插件系统 — 可接受 |
| **部署** | PicoClaw 单二进制 vs Node.js 生态 — PicoClaw 大幅优势 |

### OpenClaw 适合什么场景？

- **单实例部署** — 个人 AI 助手或小团队 (不需要 Per-User VM)
- **需要丰富生态** — 3000+ 技能、浏览器自动化、Canvas、TTS
- **安全要求极高** — 多层安全模型 + Docker 沙箱
- **不受内存限制** — 有充足服务器资源

### 如果未来 JAcoworks 需要 OpenClaw 的高级功能？

1. **浏览器自动化**: 可在 PicoClaw 容器中安装 Playwright，通过 shell 工具调用
2. **向量记忆搜索**: 可在 PicoClaw 容器中运行 SQLite-vec，通过 skill 封装
3. **OpenAI 兼容 API**: Go 管理网关本身就实现 `/v1/chat/completions`，无需 Agent 引擎提供
4. **插件生态**: PicoClaw 的 SKILL.md 兼容 OpenClaw 技能格式，可移植部分技能

---

## 13. 生态系统关系图

```
openclaw/openclaw (TypeScript, 215k ⭐) ← 最大的 AI Agent 项目
  ├── nearai/ironclaw (Rust 重写, 2.6k ⭐) ← 无中国 IM，已排除
  ├── zeroclaw-labs/zeroclaw (Rust 重写, 4.9k ⭐) ← UTF-8 panic，已排除
  ├── openclaw/clawhub (技能市场, 2.5k ⭐)
  ├── justlovemaki/OpenClaw-Docker-CN-IM (中国 IM Docker)
  ├── BytePioneer-AI/openclaw-china (中国生态)
  └── 3000+ 社区技能

sipeed/picoclaw (Go, 17.3k ⭐) ← 选定方案 ⭐
  ├── 13 个内置 IM 通道
  └── ClawHub 技能市场

badlogic/pi-mono (TypeScript, 14.4k ⭐)
  ├── Dicklesworthstone/pi_agent_rust (Rust port, 310 ⭐) ← 备选
  └── can1357/oh-my-pi (TS + Rust N-API, 982 ⭐)
```

OpenClaw 是 AI Agent 领域的 "Linux"（最全面但最重），PicoClaw 是 "Alpine Linux"（精简但够用）。JAcoworks 的 Per-User VM 架构需要 Alpine 级别的轻量。
