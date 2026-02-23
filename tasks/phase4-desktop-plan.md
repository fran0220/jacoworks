# Phase 4 — JAcoworks Desktop 桌面客户端计划

> Tauri v2 + Svelte 5 轻量桌面端，连接 Go 网关 OpenAI 兼容 API

---

## 0. 设计原则

1. **极简** — 只做登录 + 对话 + Markdown，不做多余功能
2. **标准协议** — 只调 OpenAI `/v1/chat/completions` (SSE)，不碰 OpenClaw 私有协议
3. **会话客户端存储** — 对话历史存 IndexedDB，每次请求发完整 messages 数组
4. **复用 NextChat stream.rs** — Rust 侧 ~150 行处理 SSE 桥接，前端 fetch shim 透明切换

---

## 1. 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 桌面框架 | **Tauri v2.10** | 10MB 二进制, 原生窗口, Rust 安全 |
| 前端框架 | **Svelte 5** (runes) | 无虚拟 DOM, 编译产物小, Tauri 官方模板 |
| 构建工具 | **Vite 6** | Tauri + Svelte 标准搭配 |
| Markdown | **marked** + **highlight.js** | 轻量, 流式友好 (增量解析) |
| HTTP/SSE | **Rust reqwest** (桌面) / **fetch** (web fallback) | 绕过 CORS, API key 不暴露 |
| 本地存储 | **idb-keyval** (IndexedDB) | 对话历史持久化 |
| 样式 | **纯 CSS** (CSS 变量主题) | 不引入 UI 框架, 保持极简 |

### 不使用

- ❌ React / Next.js (太重)
- ❌ Tailwind (对话 UI 不需要)
- ❌ 任何 UI 组件库 (Ant Design / shadcn)
- ❌ 状态管理库 (Svelte 5 runes 自带响应式)

---

## 2. 项目结构

```
desktop/
├── src-tauri/                          # Rust 后端
│   ├── src/
│   │   ├── main.rs                     # Tauri 入口 + 命令注册
│   │   └── stream.rs                   # SSE 流式桥接 (借鉴 NextChat)
│   ├── Cargo.toml                      # tauri, reqwest, futures-util, serde
│   ├── tauri.conf.json                 # 窗口配置, 权限, 应用信息
│   └── capabilities/default.json       # Tauri v2 权限声明
│
├── src/                                # Svelte 前端
│   ├── App.svelte                      # 根组件 (路由: Login / Chat)
│   ├── lib/
│   │   ├── api.ts                      # fetch shim: Tauri invoke ↔ 浏览器 fetch
│   │   ├── sse.ts                      # OpenAI SSE delta 解析器
│   │   ├── auth.ts                     # 登录 + JWT 管理
│   │   ├── sessions.ts                 # 会话 CRUD (IndexedDB)
│   │   └── config.ts                   # 网关地址等配置
│   ├── components/
│   │   ├── ChatView.svelte             # 对话主界面
│   │   ├── MessageBubble.svelte        # 单条消息 (用户/AI)
│   │   ├── Markdown.svelte             # Markdown 渲染 (marked + highlight.js)
│   │   ├── InputBar.svelte             # 输入框 + 发送/停止按钮
│   │   ├── SessionList.svelte          # 左侧会话列表
│   │   ├── LoginPage.svelte            # 登录表单
│   │   └── TopBar.svelte               # 顶栏 (用户名, 设置, 新建会话)
│   ├── stores/
│   │   └── app.svelte.ts               # 全局状态 (Svelte 5 runes)
│   ├── app.css                         # 全局样式 + CSS 变量主题
│   └── main.ts                         # 入口
│
├── index.html
├── package.json
├── vite.config.ts
├── svelte.config.js
└── tsconfig.json
```

---

## 3. 核心数据流

### 3.1 登录流程

```
LoginPage → POST /api/auth/login {username, password}
         → 200 {token: "jwt...", user: {id, username, role}}
         → 存 JWT 到内存 (不持久化, 安全)
         → 跳转 ChatView
```

### 3.2 对话流程 (核心)

```
用户输入 → 追加到 messages[] → POST /v1/chat/completions
         {model: "auto", messages: [...], stream: true}
         Authorization: Bearer <jwt>

Rust stream.rs:
  1. reqwest POST → Go 网关 → OpenClaw 容器
  2. 逐 chunk 读取 SSE 字节流
  3. window.emit("stream-response", {request_id, chunk})

前端 fetch shim:
  1. 监听 "stream-response" 事件
  2. chunk → TransformStream → 重建 Response
  3. SSE 解析: data: {"choices":[{"delta":{"content":"你好"}}]}
  4. 增量拼接 → Markdown 渲染 → DOM 更新

完成: data: [DONE] → 存入 IndexedDB
```

### 3.3 会话管理

```
会话数据结构 (IndexedDB):
{
  id: "session-uuid",
  title: "新对话",          // 首条 AI 回复自动生成标题
  messages: [
    {role: "user", content: "..."},
    {role: "assistant", content: "..."},
  ],
  createdAt: timestamp,
  updatedAt: timestamp,
}

操作: 新建 / 切换 / 删除 / 自动命名
```

---

## 4. Rust 侧关键代码 (stream.rs)

借鉴 NextChat 的 `stream_fetch` 命令，核心逻辑：

```rust
// 前端调用: invoke("stream_fetch", {url, method, headers, body})
// → 返回 {request_id, status, headers}
// → 异步 emit "stream-response" 事件 (多次, 每次 chunk)
// → 最终 emit {request_id, status: 0} 表示结束

#[tauri::command]
async fn stream_fetch(
    window: tauri::Window,
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<StreamResponse, String> {
    // 1. reqwest 发请求
    // 2. 立即返回 status + headers
    // 3. spawn 异步任务读 bytes_stream, emit 到前端
}
```

---

## 5. 开发阶段

### Day 1: 项目脚手架 + 登录

- [ ] `cargo create-tauri-app` 初始化 (Svelte + TypeScript)
- [ ] 实现 `stream.rs` (SSE 桥接, ~150 行 Rust)
- [ ] 实现 `api.ts` fetch shim (Tauri invoke / 浏览器 fetch 透明切换)
- [ ] 实现 `auth.ts` 登录 + JWT 管理
- [ ] `LoginPage.svelte` 登录表单 → Go 网关验证
- [ ] 验证: 登录成功获取 JWT ✅

### Day 2: 对话核心 + SSE 流式

- [ ] 实现 `sse.ts` OpenAI delta 格式解析器
- [ ] `ChatView.svelte` 基础对话界面
- [ ] `InputBar.svelte` 输入框 + 发送按钮
- [ ] `MessageBubble.svelte` 用户/AI 消息气泡
- [ ] 集成 SSE 流式: 输入 → 发送 → 流式接收 → 逐字显示
- [ ] 验证: 发送消息, 收到 Claude 流式回复 ✅

### Day 3: Markdown + 代码高亮

- [ ] `Markdown.svelte` 集成 marked + highlight.js
- [ ] 流式 Markdown 增量渲染 (不等 [DONE])
- [ ] 代码块复制按钮
- [ ] 消息自动滚动到底部
- [ ] 打字光标动画 (▋)
- [ ] 验证: 代码块语法高亮, 列表/表格渲染正确 ✅

### Day 4: 会话管理 + 持久化

- [ ] `sessions.ts` IndexedDB CRUD (idb-keyval)
- [ ] `SessionList.svelte` 左侧会话列表
- [ ] 新建会话 / 切换会话 / 删除会话
- [ ] 首条 AI 回复自动生成会话标题 (截取前 20 字)
- [ ] 应用启动时恢复上次会话
- [ ] 验证: 关闭重开, 历史对话还在 ✅

### Day 5: UI 打磨 + 构建

- [ ] CSS 暗色/亮色主题 (CSS 变量)
- [ ] 窗口标题栏自定义 (Tauri decorations)
- [ ] 停止生成按钮 (abort 流式请求)
- [ ] 空状态引导页
- [ ] 快捷键: Enter 发送, Shift+Enter 换行, Cmd+N 新建会话
- [ ] `cargo tauri build` 构建 macOS .dmg
- [ ] 验证: 安装包可用, 全流程端到端 ✅

---

## 6. 与 Go 网关的接口约定

| 接口 | 方法 | 请求 | 响应 |
|------|------|------|------|
| 登录 | `POST /api/auth/login` | `{username, password}` | `{token, user}` |
| 用户信息 | `GET /api/users/me` | Bearer JWT | `{user_id, username, role}` |
| 对话 | `POST /v1/chat/completions` | Bearer JWT + OpenAI body | SSE stream |

对话请求体 (OpenAI 标准):
```json
{
  "model": "auto",
  "messages": [
    {"role": "system", "content": "你是 JAcoworks AI 助手"},
    {"role": "user", "content": "帮我写一份会议纪要"}
  ],
  "stream": true
}
```

SSE 响应格式:
```
data: {"choices":[{"delta":{"role":"assistant"},"index":0}]}

data: {"choices":[{"delta":{"content":"好"},"index":0}]}

data: {"choices":[{"delta":{"content":"的"},"index":0}]}

data: [DONE]
```

---

## 7. 后续迭代 (不在 MVP 范围)

- 文件上传 / 图片发送
- 多模型切换 (Claude / GPT / Gemini)
- 设置面板 (网关地址, 主题, 字体大小)
- 系统托盘 + 快捷唤起
- 自动更新 (Tauri updater)
- 移动端 (Tauri v2 支持 iOS/Android, 但优先级低)

---

## 8. 前置条件

| 项目 | 状态 |
|------|------|
| Rust 1.92 | ✅ 已安装 |
| Node.js 22 | ✅ 已安装 |
| cargo-tauri 2.10 | ✅ 已安装 |
| Go 网关运行中 | ✅ 192.168.31.162:8090 |
| 测试用户账号 | ⚠️ 需确认 (admin 或普通用户) |
