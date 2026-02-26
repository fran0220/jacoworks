# JAcoworks 下一步开发计划

> 创建于 2026-02-22，基于 Phase 2 部署验证完成后的状态
> ⚠️ **2026-02-24 修正**: 本文档中多处提到 SSE 流式透传，实际 OpenClaw 使用 **WebSocket + JSON framing** 协议（非 SSE）。
> 正确架构参见 `AGENTS.md` 3.2.1 节。Go 网关需新增 `/ws/openclaw` WebSocket 代理端点。

---

## 当前状态总结

| 项目 | 状态 |
|------|------|
| OpenClaw 容器 | ✅ tpl-openclaw 运行中，v2026.2.21-2 |
| Gateway API | ✅ /v1/chat/completions 返回 200 |
| LLM 4 Provider | ✅ proxy-claude/gpt/gemini/grok 已配置 |
| 24 个内置工具 | ✅ tools.profile: "full" |
| Chrome 浏览器 | ✅ headless 可用 |
| 搜索技能 | ✅ 7 个 skills loaded |
| 配置同步脚本 | ✅ sync-openclaw.sh |
| v2 快照 | ❌ 未创建 |
| Go 管理网关 | ❌ 未开始 |
| Flutter 客户端 | ❌ 未开始 |
| 预制技能 | ❌ shared/ 为空 |

---

## Step 1: 完成 Phase 2 收尾 (2-3 小时)

> 目标：创建 v2-full-verified 快照，锁定可复用的容器模板

### 1.1 验证向量记忆搜索

```bash
# 在容器内测试 memory_search 工具
# 通过 /v1/chat/completions 发送一条消息，让 Agent 记住信息
# 新会话中搜索该信息，验证 SQLite-vec 工作正常
```

### 1.2 验证子 Agent

```bash
# 让 Agent 使用 sessions_spawn 创建子 Agent
# 验证 sessions_send / subagents / cascade kill
```

### 1.3 配置 workspace 基础文件

在容器 `~/.openclaw/workspace/` 中创建：
- `AGENTS.md` — Agent 行为指南（中文，面向企业员工）
- `SOUL.md` — Agent 身份/性格设定
- `IDENTITY.md` — 名称、头像、表情
- `USER.md` — 用户元数据模板（克隆时由网关填充）

### 1.4 创建 v2 快照

```bash
ssh local "lxc stop tpl-openclaw"
ssh local "lxc snapshot tpl-openclaw v2-full-verified"
ssh local "lxc start tpl-openclaw"
```

### 1.5 飞书插件 (可延后)

飞书需要在飞书开放平台创建应用、获取凭证，属于**外部依赖**。
建议在 Phase 3 网关基本可用后再集成，不阻塞主线。

---

## Step 2: Go 管理网关开发 (Phase 3, 1 周)

> 这是整个项目的**关键路径**。网关连接 Flutter 客户端和 OpenClaw 容器。

### 2.1 项目初始化

```
gateway/
├── cmd/gateway/main.go          # 入口
├── internal/
│   ├── config/config.go         # 配置加载 (YAML/env)
│   ├── auth/
│   │   ├── middleware.go        # Bearer Token 认证中间件
│   │   └── sso.go               # SSO/飞书OAuth (Phase 5 再做)
│   ├── routing/
│   │   ├── proxy.go             # HTTP 反向代理 → OpenClaw
│   │   └── registry.go          # 用户↔容器↔Token 映射表
│   ├── lxd/
│   │   ├── client.go            # LXD API 客户端
│   │   ├── lifecycle.go         # 克隆/启停/冻结/唤醒/回收
│   │   └── pool.go              # 容器池管理
│   └── audit/
│       └── logger.go            # 审计日志
├── api/
│   └── openapi.yaml             # API 规范
├── go.mod
├── go.sum
├── Makefile
└── Dockerfile
```

### 2.2 核心模块开发顺序

#### Day 1-2: 最小可用 (MVP)

1. **config** — 加载配置 (网关端口、LXD 地址、管理员 Token)
2. **routing/registry** — 硬编码 user→container 映射 (先用 map 实现)
3. **routing/proxy** — `httputil.ReverseProxy` 透传到 OpenClaw
   - 关键：SSE 流式透传 (`Transfer-Encoding: chunked`, `Content-Type: text/event-stream`)
   - 注入 `Authorization: Bearer <container_token>` 头
4. **auth/middleware** — Bearer Token 校验

```
MVP 验证: curl → Go 网关 → OpenClaw → SSE 流式响应 ✅
```

#### Day 3-4: LXD 容器管理

5. **lxd/client** — 通过 LXD REST API (Unix socket 或 HTTPS) 操作容器
6. **lxd/lifecycle** — 核心操作：
   - `CloneFromTemplate(userId)` — 从 tpl-openclaw 克隆 + 注入 .env (含唯一 Token)
   - `Start/Stop/Freeze/Unfreeze(containerId)`
   - `Destroy(containerId)` — 回收
7. **lxd/pool** — 用户首次登录时自动克隆；空闲 >30min 自动冻结；请求到达时自动唤醒

#### Day 5: 用户管理 + API

8. **REST API 端点**:

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 登录 (先用简单 username/password) |
| GET | `/api/users/me` | 当前用户信息 |
| POST | `/v1/chat/completions` | **透传** → 用户容器的 OpenClaw |
| POST | `/api/admin/users` | 管理员: 创建用户 |
| POST | `/api/admin/containers/{id}/start` | 管理员: 启动容器 |
| POST | `/api/admin/containers/{id}/stop` | 管理员: 停止容器 |
| GET | `/api/admin/containers` | 管理员: 列出所有容器状态 |

#### Day 6-7: 测试 + 完善

9. 集成测试: 登录 → 自动克隆容器 → 对话 → SSE 流式 → 冻结/唤醒
10. 错误处理: 容器启动超时、LLM 不可用、Token 失效
11. Dockerfile + systemd 服务

### 2.3 技术选型 (Go)

| 库 | 用途 |
|-----|------|
| `net/http` + `httputil.ReverseProxy` | HTTP 反向代理 (标准库即可) |
| `github.com/canonical/lxd/client` | LXD Go SDK |
| `github.com/golang-jwt/jwt/v5` | JWT Token (后续 SSO 用) |
| `github.com/rs/zerolog` | 结构化日志 |
| `gopkg.in/yaml.v3` | 配置文件 |
| SQLite (`modernc.org/sqlite`) | 用户数据库 (轻量, 单文件) |

### 2.4 关键设计决策

**SSE 透传策略**: Go 网关**不解析** SSE 事件内容，纯粹做 byte-level 转发：
```go
// proxy.go 核心逻辑
proxy := &httputil.ReverseProxy{
    Director: func(req *http.Request) {
        req.URL.Host = containerIP + ":18789"
        req.Header.Set("Authorization", "Bearer "+containerToken)
    },
    FlushInterval: -1, // 立即 flush (SSE 必须)
}
```

**容器唤醒策略**: 请求到达 → 检查容器状态 → 如果 frozen 则 unfreeze → 等待 Gateway 就绪 (轮询 /health) → 透传请求
- 唤醒超时: 10s (LXD unfreeze 通常 <2s, OpenClaw 启动 ~5s)

---

## Step 3: Flutter 客户端 MVP (Phase 4, 2 周先做 MVP)

> 与 Step 2 可部分并行 — API 定义后即可开始 Flutter 开发

### 3.1 MVP 范围 (桌面端优先)

只做**最核心的对话功能**，其他功能按需迭代：

1. **登录页** — username/password → Go 网关 `/api/auth/login` → 获取 JWT
2. **对话页** — Chat UI, 发送消息 → `/v1/chat/completions` (SSE 流式)
3. **Markdown 渲染** — Agent 回复的流式 Markdown 渲染
4. **会话管理** — 新建/切换/删除对话

**不做** (Phase 5 迭代)：
- 目录选择 / File Relay / 文件树
- 移动端适配
- 语音输入
- 文件上传

### 3.2 技术栈

| 功能 | 包 |
|------|-----|
| HTTP + SSE | `dio` + 手动 SSE 解析 (dart:io StreamSubscription) |
| 状态管理 | `riverpod` |
| Markdown | `flutter_markdown` |
| 路由 | `go_router` |
| 安全存储 | `flutter_secure_storage` (存 JWT) |

### 3.3 开发顺序

1. Week 1: 项目脚手架 + 登录 + SSE 连接 + 基础 Chat UI
2. Week 2: Markdown 渲染优化 + 会话管理 + 桌面端 UI 打磨

---

## Step 4: 飞书集成 (Phase 4 后半, 1 周)

### 4.1 飞书开放平台配置

1. 创建飞书企业自建应用
2. 配置 Bot 能力 + 消息权限
3. 获取 App ID / App Secret / Encrypt Key / Verification Token

### 4.2 OpenClaw 飞书插件

```json5
// openclaw.json 添加
channels: {
  feishu: {
    appId: "${FEISHU_APP_ID}",
    appSecret: "${FEISHU_APP_SECRET}",
    encryptKey: "${FEISHU_ENCRYPT_KEY}",
    verificationToken: "${FEISHU_VERIFICATION_TOKEN}",
  },
},
```

### 4.3 部署模式

飞书插件**直连** OpenClaw (WebSocket)，绕过 Go 网关。
但需要解决：每个用户容器都有独立的飞书连接 → 飞书 Bot 如何路由到正确的容器？

**方案 A**: 所有用户共享一个"飞书接入容器"作为消息路由器
**方案 B**: 每个用户在飞书上有独立的 Bot (不现实)
**方案 C**: Go 网关做飞书消息中转 (回到了之前想避免的方案)

→ **推荐方案 A**: 独立的"飞书网关容器"，收到飞书消息后通过 HTTP 转发到对应用户的 OpenClaw 容器。

---

## Step 5: 生产加固 (Phase 5, 持续)

### 5.1 安全

- [ ] Nginx 反向代理 + Let's Encrypt TLS
- [ ] Go 网关 rate limiting (每用户)
- [ ] OpenClaw restrictToWorkspace 确认生效
- [ ] exec 工具审批策略

### 5.2 运维

- [ ] systemd 服务 (Go 网关 + Nginx)
- [ ] 日志收集 (journald → 集中存储)
- [ ] 容器健康检查 + 自动重启
- [ ] 磁盘清理策略 (session 日志 / 记忆 DB)

### 5.3 预制技能 (10 个)

在 `vm-agent/skills/` 创建，通过 `skills.load.extraDirs` 挂载到所有容器：
1. document-writer (文档写作)
2. excel-analyst (Excel 分析)
3. ppt-generator (PPT 生成)
4. email-drafter (邮件起草)
5. meeting-notes (会议纪要)
6. file-organizer (文件整理)
7. data-reporter (数据报告)
8. translator (翻译助手)
9. contract-reviewer (合同审查)
10. knowledge-base (知识库问答)

---

## 推荐执行顺序 & 时间线

```
Week 0 (今天)
├── Step 1: Phase 2 收尾 (2-3h)
│   ├── 验证 memory_search + sessions_spawn
│   ├── 创建 workspace 基础文件
│   └── 创建 v2-full-verified 快照
│
Week 1
├── Step 2: Go 管理网关 MVP
│   ├── Day 1-2: 配置 + 反向代理 + 认证 (最小可用)
│   ├── Day 3-4: LXD 容器生命周期
│   └── Day 5-7: 用户管理 + 测试 + 部署
│
Week 2-3
├── Step 3: Flutter 客户端 MVP (与网关调试并行)
│   ├── Week 2: 登录 + SSE + 基础 Chat
│   └── Week 3: Markdown + 会话管理 + UI
│
Week 4
├── Step 4: 飞书集成
│   ├── 飞书应用配置
│   ├── 飞书网关容器方案
│   └── 端到端测试
│
Week 5+
└── Step 5: 生产加固 (持续)
    ├── 安全 + 运维
    ├── 预制技能
    └── 灰度发布 (10→30 人)
```

---

## 立即行动 (Today)

1. **Phase 2 收尾** → 创建快照
2. **`gateway/` 项目脚手架** → `go mod init`, 目录结构, 基础 main.go
3. **定义 Go 网关 API 规范** → OpenAPI YAML (Flutter 团队可并行开发)
