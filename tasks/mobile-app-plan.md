# JAcoworks 移动端应用 — 完整规划方案

> 技术栈: React Native + Expo Prebuild | 架构: 纯云端模式 (Gateway WebSocket → Docker vm-agent)
> 预估: Phase 0 (1周) + Phase 1 MVP (4-6周) + Phase 2 (2-4周) + Phase 3 (4-8周)

## 一、项目定位

移动端是桌面端的**云端模式原生化前端**，不是桌面端的移植：

- **不运行** 本地 sidecar / vm-agent
- **100% 走** Gateway `/ws/agent` → Docker 容器
- **复用** 现有 RPC 协议 (prompt/abort/session_event/done)
- **共享** 业务逻辑层，**不共享** UI 组件层

## 二、技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 框架 | React Native + Expo SDK 53+ | Expo Prebuild + Custom Dev Client |
| 构建 | EAS Build | 企业内测分发 (Ad Hoc / APK) |
| 导航 | Expo Router | 文件系统路由，与 Expo 深度集成 |
| 状态 | React hooks + Context | 与桌面端保持一致，不引入额外状态库 |
| 存储 | expo-secure-store (token) + MMKV (缓存) | 安全存储 + 高性能 KV |
| 网络 | 原生 fetch + WebSocket | 无需额外库 |
| Markdown | react-native-markdown-display | 流式阶段节流 + 完成后全量渲染 |
| 代码高亮 | react-native-syntax-highlighter | 基于 highlight.js |
| 图标 | lucide-react-native | 与桌面端一致 |
| 样式 | StyleSheet + Design Token 常量 | 复用桌面端色彩体系 |

## 三、Monorepo 结构调整

```
jacoworks/
├── desktop/                 # 桌面端 (Tauri + React DOM) — 不动
├── mobile/                  # 新增：移动端 (Expo + React Native)
│   ├── app/                 # Expo Router 页面
│   │   ├── _layout.tsx      # Root layout (auth guard)
│   │   ├── login.tsx        # 登录页
│   │   ├── (tabs)/          # Tab 导航
│   │   │   ├── _layout.tsx  # Tab bar
│   │   │   ├── index.tsx    # 会话列表 (首页)
│   │   │   ├── tasks.tsx    # 定时任务
│   │   │   └── settings.tsx # 设置
│   │   └── chat/[id].tsx    # 对话详情页
│   ├── components/          # RN 原生组件
│   │   ├── ChatBubble.tsx
│   │   ├── StreamingView.tsx
│   │   ├── Composer.tsx
│   │   ├── SessionList.tsx
│   │   ├── ModelPicker.tsx
│   │   ├── MarkdownRenderer.tsx
│   │   └── FileAttachment.tsx
│   ├── hooks/               # 移动端专用 hooks
│   │   ├── use-app-state.ts # AppState 前后台切换
│   │   └── use-keyboard.ts  # 键盘适配
│   ├── adapters/            # 平台适配层
│   │   ├── storage.ts       # SecureStore / MMKV
│   │   ├── http.ts          # 原生 fetch (替代 Tauri invoke)
│   │   └── lifecycle.ts     # AppState / NetInfo (替代 document.visibilityState)
│   ├── app.json             # Expo 配置
│   ├── package.json
│   ├── tsconfig.json
│   └── AGENTS.md
├── shared/                  # 新增：桌面 + 移动共享代码
│   ├── types.ts             # ChatMessage, ChatSession, StreamBlock, User
│   ├── config.ts            # GATEWAY_URL, MODEL_OPTIONS, THINKING_LEVELS
│   ├── sessions.ts          # Session CRUD (纯 HTTP，无平台依赖)
│   ├── agent-protocol.ts    # AgentRpcEvent, PromptPayload, AsyncEventQueue
│   ├── cloud-agent-ws.ts    # CloudAgentWS (参数化 lifecycle hooks)
│   ├── auth-core.ts         # 认证逻辑 (参数化 storage)
│   ├── stream-reducer.ts    # 流式状态机 (纯逻辑，无 DOM/RAF)
│   └── package.json         # { "name": "@jacoworks/shared" }
├── gateway/                 # Go 网关 — 需扩展
├── vm-agent/                # Agent — 不动
├── website/                 # 官网 — 不动
└── deploy/                  # 部署 — 需补移动端 CI
```

## 四、共享层抽取计划 (Phase 0)

### 4.1 从桌面端提取到 shared/

| 桌面端源文件 | → shared/ | 改动说明 |
|---|---|---|
| `react/types.ts` | `types.ts` | 直接复制，100% 复用 |
| `react/lib/config.ts` | `config.ts` | 提取常量 (GATEWAY_URL, MODEL_OPTIONS)，去掉 localStorage |
| `react/lib/sessions.ts` | `sessions.ts` | 将 `httpFetch` 改为注入参数，去掉 Tauri 依赖 |
| `react/lib/agent.ts` | `agent-protocol.ts` | 提取：AgentRpcEvent, PromptPayload, AsyncEventQueue, startCloudStream, abortCloudSession, requestCloudTitleGeneration |
| `react/lib/cloud-agent-ws.ts` | `cloud-agent-ws.ts` | 参数化 lifecycle hooks (替代 document.visibilityState / window.addEventListener) |
| `react/lib/auth.ts` | `auth-core.ts` | 参数化 storage (替代 localStorage)，去掉 window.location/dispatchEvent |
| `react/hooks/use-chat-stream.ts` | `stream-reducer.ts` | 提取纯逻辑：block 状态机、event 处理、finalize 逻辑；去掉 DOM/RAF/scroll |

### 4.2 桌面端改造

桌面端 `react/lib/` 改为薄 adapter 层，import from `@jacoworks/shared`：

```typescript
// desktop/src/react/lib/transport.ts — 不变
// desktop/src/react/lib/auth.ts — 改为:
import { createAuthModule } from "@jacoworks/shared/auth-core";

const auth = createAuthModule({
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
  onAuthExpired: (path) => window.dispatchEvent(new CustomEvent("auth-expired", { detail: { path } })),
});

export const { login, logout, getToken, getUser, isAuthenticated, subscribeAuth, ... } = auth;
```

### 4.3 共享 CloudAgentWS 改造

```typescript
// shared/cloud-agent-ws.ts
export interface LifecycleAdapter {
  onVisibilityChange(callback: () => void): () => void;  // 返回 unlisten
  onNetworkRestore(callback: () => void): () => void;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

// 桌面端 adapter:
const webAdapter: LifecycleAdapter = {
  onVisibilityChange: (cb) => { document.addEventListener("visibilitychange", cb); return () => document.removeEventListener("visibilitychange", cb); },
  onNetworkRestore: (cb) => { window.addEventListener("online", cb); return () => window.removeEventListener("online", cb); },
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
};

// 移动端 adapter:
const mobileAdapter: LifecycleAdapter = {
  onVisibilityChange: (cb) => { const sub = AppState.addEventListener("change", (s) => { if (s === "active") cb(); }); return () => sub.remove(); },
  onNetworkRestore: (cb) => { const unsub = NetInfo.addEventListener((state) => { if (state.isConnected) cb(); }); return unsub; },
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};
```

## 五、网关 API 扩展 (Phase 0)

### 5.1 必做扩展

| 端点 | 方法 | 说明 | 优先级 |
|---|---|---|---|
| `/api/mobile/agent/ensure` | POST | 幂等容器确保：有容器返回状态，无则自动 provision + 等待就绪 | P0 |
| `/api/sessions` | GET | 增加 `?cursor=&limit=` 分页参数 | P0 |
| `/api/sessions/{id}/messages` | GET | 消息分页 `?before=&limit=`（当前 messages 是大 JSONB） | P1 |
| `/api/uploads` | POST | 标准附件上传 (multipart)，返回 file_id + URL | P1 |
| `/api/push/devices` | POST/DELETE | 设备推送 token 注册/注销 | P2 |

### 5.2 ensure container 实现思路

```go
// POST /api/mobile/agent/ensure
// 幂等：已有 running 容器 → 直接返回; 无容器或 stopped → provision + poll ready
type EnsureResponse struct {
    Status        string `json:"status"`         // "ready" | "provisioning" | "error"
    ContainerName string `json:"container_name"`
    WSPath        string `json:"ws_path"`        // "/ws/agent"
}
```

### 5.3 飞书 SSO 移动端适配

现有飞书 SSO 流程 (`GET /api/auth/feishu?redirect=`) 需要支持 App Deep Link 回跳：

```
移动端打开系统浏览器 → 飞书授权 → 回调到 Gateway
→ Gateway redirect 到 jacoworks://auth/callback?token=xxx
→ App 通过 Linking 捕获 → 存储 token
```

Gateway 改动：`redirect` 参数支持 custom scheme (`jacoworks://`)。

### 5.4 数据库扩展

```sql
-- 009_push_devices.sql (Phase 2)
CREATE TABLE push_devices (
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform   TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
    push_token TEXT NOT NULL,
    app_version TEXT,
    last_seen_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (user_id, push_token)
);
```

## 六、移动端页面与组件设计

### 6.1 页面结构

```
app/
├── _layout.tsx              # AuthGuard + CloudAgent Provider
├── login.tsx                # 登录 (用户名密码 + 飞书 SSO)
├── (tabs)/
│   ├── _layout.tsx          # Bottom Tab: 对话 | 任务 | 设置
│   ├── index.tsx            # 会话列表 (下拉刷新, 滑动删除)
│   ├── tasks.tsx            # 定时任务列表 + 创建
│   └── settings.tsx         # 模型/登出/缓存/关于
└── chat/
    └── [id].tsx             # 聊天详情 (流式渲染 + Composer)
```

### 6.2 核心组件

| 组件 | 说明 |
|---|---|
| `SessionList` | FlatList，按 updatedAt 降序，左滑删除，右侧流式指示器 |
| `ChatBubble` | 用户 / AI 消息气泡，AI 消息包含 Markdown 渲染 |
| `StreamingView` | 流式输出区域：节流渲染 (50-100ms)，只更新最后一条 |
| `MarkdownRenderer` | 段落/标题/代码块/列表/引用/表格/链接/图片 |
| `CodeBlock` | 语法高亮 + 复制按钮 + 水平滚动 |
| `ToolStatus` | 工具调用状态 (running → completed/error) |
| `Composer` | TextInput + 附件按钮 + 发送/停止按钮 + 模型选择 |
| `ModelPicker` | BottomSheet 模型列表 |
| `FileAttachment` | 图片/文件选择 + 上传进度 |
| `ImageViewer` | AI 生成图片全屏查看 + 保存到相册 |

### 6.3 Design Token 复用

```typescript
// mobile/theme/tokens.ts — 从桌面端 app.css :root 提取
export const colors = {
  background: "#F5F0EB",
  surface: "#FAF7F4",
  accent: "#C4724A",        // 陶土
  accentCloud: "#3B82F6",   // 云端蓝
  textPrimary: "#2C2C2C",
  textSecondary: "#8C8C8C",
  textOnAccent: "#FFFFFF",
  border: "#E8E2DC",
  error: "#DC3545",
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, full: 9999 };
export const fontSize = { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, xxl: 28 };
```

## 七、核心流程

### 7.1 启动流程

```
App 启动
  ├→ 检查 SecureStore 中的 token
  │   ├→ 无 token → 登录页
  │   └→ 有 token → GET /api/users/me 验证
  │       ├→ 401 → 清除 token → 登录页
  │       └→ 200 → 进入主界面
  │
  ├→ 进入主界面后自动:
  │   ├→ POST /api/mobile/agent/ensure (后台确保容器)
  │   ├→ GET /api/sessions?limit=20 (加载会话列表)
  │   └→ 建立 WebSocket /ws/agent?token=xxx
  │
  └→ 用户选择会话 → 进入聊天页
```

### 7.2 流式对话流程

```
用户输入消息
  ├→ optimistic 更新本地消息列表
  ├→ ws.send({ type: "prompt", session_id, message, model, ... })
  │
  ├→ 接收事件流:
  │   ├→ session_event.message_start → 创建 AI 消息占位
  │   ├→ session_event.content_delta → 追加文本 (节流 80ms batch)
  │   ├→ session_event.thinking → 更新思考块
  │   ├→ session_event.tool_execution_start → 添加工具状态卡
  │   ├→ session_event.tool_execution_end → 更新工具状态
  │   └→ done → finalize:
  │       ├→ 全量 Markdown 渲染
  │       ├→ PUT /api/sessions/{id} 持久化
  │       └→ 生成标题 (首次对话)
  │
  └→ 用户点击"停止"
      ├→ ws.send({ type: "abort", session_id })
      └→ 保存已接收内容
```

### 7.3 重连策略

```
WebSocket 断开
  ├→ 前台: 指数退避重连 (1s → 2s → 4s → ... → 15s max)
  ├→ 切到后台: 停止重连 timer
  ├→ 回到前台:
  │   ├→ 检查网络 (NetInfo)
  │   ├→ 立即尝试重连
  │   └→ 刷新会话列表 (补拉离线期间变更)
  └→ 推送通知唤醒 (Phase 2): 点击通知 → 打开对应会话
```

## 八、分期实施计划

### Phase 0: 共享层 + 网关补口 (1 周)

- [ ] 创建 `shared/` 包，提取 types, config, sessions, agent-protocol
- [ ] 重构 CloudAgentWS 为平台无关 (LifecycleAdapter)
- [ ] 重构 auth 为平台无关 (StorageAdapter)
- [ ] 提取 stream-reducer 纯逻辑
- [ ] 桌面端验证：引用 shared 后功能不变 (`make check-desktop`)
- [ ] Gateway: 实现 `POST /api/mobile/agent/ensure`
- [ ] Gateway: sessions API 增加 cursor/limit 分页
- [ ] Gateway: 飞书 SSO 支持 custom scheme redirect

### Phase 1: 移动端 MVP (4-6 周)

**Week 1-2: 基础框架**
- [ ] `npx create-expo-app mobile` + Expo Prebuild 配置
- [ ] Expo Router 页面结构 (login, tabs, chat)
- [ ] mobile/adapters/ 平台适配 (storage, http, lifecycle)
- [ ] 登录页 (用户名密码 + 飞书 SSO deep link)
- [ ] 认证状态管理 + 路由守卫
- [ ] Design Token 常量

**Week 3-4: 核心聊天**
- [ ] 会话列表 (FlatList + 下拉刷新 + 滑动删除)
- [ ] 聊天页骨架 (消息列表 + Composer)
- [ ] WebSocket 连接 + 容器自动确保
- [ ] 流式消息接收 + 节流渲染
- [ ] Markdown 渲染 (段落/标题/代码块/列表)
- [ ] 工具调用状态卡片
- [ ] 停止生成 / 中断
- [ ] 自动生成标题

**Week 5-6: 完善与测试**
- [ ] 模型切换 (BottomSheet)
- [ ] 图片附件 (拍照/相册 → 上传到云端)
- [ ] 图片结果查看 + 保存到相册
- [ ] 键盘适配 (KeyboardAvoidingView)
- [ ] 断线重连 + 网络状态提示
- [ ] 本地会话缓存 (MMKV)
- [ ] EAS Build 配置 + 内测分发
- [ ] 基础 E2E 测试 (Detox 或手动)

**MVP 交付标准:**
- 登录 → 会话列表 → 新建对话 → 流式聊天 → Markdown 渲染 → 图片查看
- 断线自动重连
- iOS + Android 双端内测包

### Phase 2: 企业能力 (2-4 周)

- [ ] 定时任务列表 / 创建 / 删除 (复用 Gateway API)
- [ ] 飞书通知集成 (cron 结果 → 飞书推送)
- [ ] 文档上传 + OCR 入口 (选文件/拍照 → Agent read_document)
- [ ] 更丰富的文件预览 (PDF inline / 图片大图)
- [ ] 推送 token 注册 (APNs/FCM)
- [ ] 基础推送通知 (cron 完成 / 长任务完成)
- [ ] 会话搜索
- [ ] 分享到 JAcoworks (Share Extension / Share Target)

### Phase 3: 高级能力 (4-8 周)

- [ ] 协作容器视图 (简化版 TaskPanel)
- [ ] 技能列表展示 + 技能启用
- [ ] 语音输入 → 文字 → Agent
- [ ] 更强的 Markdown (LaTeX / 复杂表格)
- [ ] 消息长按菜单 (复制/分享/重新生成)
- [ ] 会话导出 (Markdown / PDF)
- [ ] 深色模式
- [ ] 性能优化 (FlashList / 大会话分页加载)
- [ ] CI: EAS Build 接入 GitHub Actions
- [ ] 应用商店提交 (App Store / 企业签名)

## 九、CI/CD

### 开发流程

```bash
# 本地开发
cd mobile
npx expo start --dev-client    # 启动开发服务器
# 扫码或模拟器运行

# 内测包构建
eas build --profile preview --platform all

# 分发
eas submit    # App Store / Google Play
# 或: EAS internal distribution (Ad Hoc)
```

### GitHub Actions 扩展

```yaml
# .github/workflows/ci.yml 增加 mobile job
mobile:
  if: contains(needs.changes.outputs.modules, 'mobile') || contains(needs.changes.outputs.modules, 'shared')
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
    - run: cd shared && npm ci && npm run build
    - run: cd mobile && npm ci
    - run: cd mobile && npx tsc --noEmit
    - run: cd mobile && npm test
```

## 十、风险与对策

| 风险 | 概率 | 对策 |
|---|---|---|
| 容器冷启动慢 (首条消息 5-10s) | 高 | `ensure` 接口预热 + "正在准备工作环境" loading + 容器池预分配 |
| 大会话 messages JSONB 拉取慢 | 中 | Phase 0 就做分页 API；移动端只拉最近 50 条 |
| Markdown 渲染卡顿 | 中 | 流式阶段 50-100ms 节流 + 只更新最后一条 + memo 化 |
| 飞书 SSO Deep Link 配置复杂 | 中 | 用户名密码登录作为兜底，SSO 作为增强 |
| Android 推送 (FCM 在国内不稳) | 高 | Phase 1 不做推送；Phase 2 先用飞书通知兜底 |
| 后台 WS 断开丢消息 | 中 | 回到前台自动重连 + 补拉 session 最新状态 |
| shared 层重构引入桌面端 regression | 低 | Phase 0 先做 shared 抽取 + 桌面端全量测试通过 |

## 十一、Makefile 扩展

```makefile
# ─── Mobile ───
dev-mobile: ## 启动 Mobile 开发服务器
	cd mobile && npx expo start --dev-client

build-mobile: ## 构建 Mobile 内测包
	cd mobile && eas build --profile preview --platform all

check-mobile: ## Mobile typecheck + 测试
	cd mobile && npx tsc --noEmit && npm test

check-shared: ## Shared 包 typecheck
	cd shared && npx tsc --noEmit
```

## 十二、关键决策记录

| 决策 | 结论 | 原因 |
|---|---|---|
| 技术栈 | React Native + Expo Prebuild | 复用 React/TS 心智 + 原生能力 + 成熟生态 |
| 不用 Tauri Mobile | 先不用 | 移动端无 sidecar 优势；但可作为快速原型备选 |
| 不做轻量聊天 API | 先不做 | 避免协议分叉；100% 走 vm-agent 容器保持统一 |
| 不做本地 Agent | 不做 | 移动端无法运行 bun compile 二进制 |
| 工作区 | 上传/拍照/分享 | 不复刻桌面"本地文件读写" |
| 记忆 | 纯云端消费 | 不做本地↔云端同步 UI |
| 推送 | Phase 2 + 飞书兜底 | 飞书生态优先；原生推送延后 |
| 离线 | 弱离线（只读缓存） | 不做离线消息排队 |
