# Mobile App — 分步实施任务追踪

> 主规划文档: `tasks/mobile-app-plan.md`
> 工作模式: 每步 handoff 到 deep 模式实施，完成后回主线更新状态

## 状态图例

- ⬜ 待开始 | 🟡 进行中 | ✅ 完成 | 🔴 阻塞 | ⏭️ 跳过

---

## Phase 0: 共享层抽取 + 网关扩展 (预计 1 周)

### Step 0.1 ⬜ 创建 shared/ 包骨架

**目标**: 初始化 `shared/` 包结构，配置 monorepo 引用

**交付物**:
- `shared/package.json` (`@jacoworks/shared`, type: module, exports 配置)
- `shared/tsconfig.json` (ES2022, strict, 产出 `dist/`)
- `shared/tsconfig.build.json` (排除测试)
- `desktop/package.json` 添加 `@jacoworks/shared` workspace 依赖
- `desktop/tsconfig.json` 添加 paths alias
- 根目录 `package.json` 添加 workspaces (如需)

**验证**: `cd shared && npx tsc --noEmit` 通过

---

### Step 0.2 ⬜ 抽取 types.ts + config.ts → shared/

**目标**: 将纯类型和常量抽取到 shared，桌面端改为 re-export

**操作**:
1. `desktop/src/react/types.ts` → `shared/types.ts` (100% 复制)
2. `desktop/src/react/lib/config.ts` 中的 `MODEL_OPTIONS`, `THINKING_LEVELS`, `DEFAULT_MODEL`, `AppSettings` 类型 → `shared/config.ts`
3. 桌面端 `types.ts` 改为 `export * from "@jacoworks/shared/types"`
4. 桌面端 `config.ts` 保留 `getSettings()`/`updateSettings()`/`ensureDefaultWorkspace()` (localStorage 依赖)，常量从 shared import

**验证**: `cd desktop && npm run check && npm test`

---

### Step 0.3 ⬜ 抽取 auth-core.ts → shared/

**目标**: 参数化 storage，创建 `createAuthModule()` 工厂函数

**操作**:
1. 定义 `StorageAdapter` 接口: `getItem`, `setItem`, `removeItem`
2. 定义 `AuthCallbacks` 接口: `onAuthExpired(path)`, `onLoginRedirect(url)`
3. 定义 `HttpFetch` 类型: `(url, options) => Promise<{status, body}>`
4. `shared/auth-core.ts`: `createAuthModule(storage, callbacks, httpFetch, gatewayUrl)` 返回所有 auth 方法
5. 桌面端 `auth.ts` 改为薄 adapter：用 localStorage + window.dispatchEvent 实例化

**验证**: `cd desktop && npm run check && npm test` (auth.test.ts 必须通过)

---

### Step 0.4 ⬜ 抽取 sessions.ts → shared/

**目标**: 参数化 HTTP transport 和 auth token 获取

**操作**:
1. `shared/sessions.ts`: `createSessionsModule(httpFetch, getToken, gatewayUrl)` 工厂
2. 导出所有 session CRUD + `generateTitle` + helper types
3. 桌面端 `sessions.ts` 改为薄 adapter

**验证**: `cd desktop && npm run check && npm test` (sessions.test.ts 必须通过)

---

### Step 0.5 ⬜ 抽取 agent-protocol.ts → shared/

**目标**: 提取云端协议相关的纯逻辑 (不含 Tauri 本地 RPC)

**操作**:
1. `shared/agent-protocol.ts`:
   - `PromptPayload`, `CloudPromptPayload` 类型
   - `AgentRpcEvent` 类型
   - `AsyncEventQueue<T>` 类
   - `nextCommandId(prefix)` 函数
   - `startCloudStream(ws, payload, onMessage)` 函数
   - `abortCloudSession(ws, sessionId)` 函数
   - `requestCloudTitleGeneration(ws, ...)` 函数
2. 定义 `CloudAgentWSLike` 接口: `{ isReady, send(cmd) }` (不引入完整 CloudAgentWS 类)
3. 桌面端 `agent.ts` 保留 Tauri 本地 RPC 部分，云端函数从 shared import

**验证**: `cd desktop && npm run check && npm test`

---

### Step 0.6 ⬜ 抽取 cloud-agent-ws.ts → shared/

**目标**: 参数化 lifecycle hooks (visibilitychange, online, setTimeout)

**操作**:
1. 定义 `LifecycleAdapter` 接口 (见 mobile-app-plan.md §4.3)
2. `shared/cloud-agent-ws.ts`: `CloudAgentWS` 接受 `LifecycleAdapter` + `gatewayUrl` + `getToken`
3. 去掉直接 `window.*` / `document.*` 引用
4. 桌面端创建 `webLifecycleAdapter` 传入

**验证**: `cd desktop && npm run check && npm test`

---

### Step 0.7 ⬜ 抽取 stream-reducer.ts → shared/

**目标**: 提取流式事件处理纯逻辑 (无 DOM/RAF/scroll)

**操作**:
1. 从 `use-chat-stream.ts` 提取:
   - `StreamBlock` 状态机更新逻辑 (processSessionEvent)
   - `collectMetaBlocks()`, `isUntitledTitle()`, `buildPrompt()`
   - `finalizeBlocks()`: 从 blocks 生成 assistant message
2. `shared/stream-reducer.ts`: 纯函数，输入 event → 输出 blocks 变更
3. 桌面端 `use-chat-stream.ts` 调用 shared 函数，保留 DOM/RAF/scroll 逻辑

**验证**: `cd desktop && npm run check && npm test`

---

### Step 0.8 ⬜ 桌面端全量验证

**目标**: 确保 shared 抽取后桌面端完全不受影响

**操作**:
1. `cd desktop && npm run check` (TypeScript 无错)
2. `cd desktop && npm test` (所有 vitest 通过)
3. `cd shared && npx tsc --noEmit` (shared 包编译通过)
4. 手动启动 `make dev-desktop` 验证核心流程:
   - 登录 → 会话列表 → 新建对话 → 发消息 → 流式渲染 → 停止
   - 云端模式连接 + 对话

**验证**: 所有 check 通过 + 手动烟雾测试

---

### Step 0.9 ⬜ Gateway: POST /api/mobile/agent/ensure

**目标**: 幂等容器确保端点

**操作**:
1. `gateway/cmd/gateway/main.go` 添加路由 `POST /api/mobile/agent/ensure`
2. 逻辑: 查 containers 表 → running 直接返回 → 无/stopped → 调 docker provision → poll ready
3. 响应: `{ "status": "ready"|"provisioning"|"error", "container_name", "ws_path": "/ws/agent" }`
4. 复用现有 `internal/docker/` 逻辑

**验证**: `cd gateway && go vet ./... && go test ./...`

---

### Step 0.10 ⬜ Gateway: Sessions 分页 + 飞书 Deep Link

**目标**: 会话列表分页 + 飞书 SSO 支持 custom scheme

**操作**:
1. `GET /api/sessions` 增加 `?cursor=&limit=` 查询参数 (默认 limit=50, 向后兼容)
2. `store/sessions.go` SQL 加 `WHERE updated_at < $cursor ORDER BY updated_at DESC LIMIT $limit`
3. 飞书 SSO callback: `redirect` 参数支持 `jacoworks://` scheme
4. `auth/handlers.go` 校验 redirect URL (白名单 custom scheme)

**验证**: `cd gateway && go vet ./... && go test ./...`

---

## Phase 1: Mobile MVP (预计 4-6 周)

### Step 1.1 ⬜ Expo 项目初始化

**目标**: 创建 mobile/ Expo 项目，配置与 shared/ 集成

**操作**:
- `npx create-expo-app mobile` + Expo Prebuild
- Expo Router 基础页面结构 (`app/_layout.tsx`, `app/login.tsx`, `app/(tabs)/`)
- `mobile/package.json` 依赖 `@jacoworks/shared`
- Design Token 常量 (`mobile/theme/tokens.ts`)
- `mobile/adapters/` 骨架 (storage, http, lifecycle)

**验证**: `cd mobile && npx tsc --noEmit && npx expo start` 能启动

---

### Step 1.2 ⬜ 移动端认证 (登录 + 路由守卫)

**目标**: 用户名密码登录 + token 持久化 + AuthGuard

**操作**:
- `mobile/adapters/storage.ts`: SecureStore adapter 实现 StorageAdapter
- `mobile/adapters/http.ts`: 原生 fetch adapter 实现 HttpFetch
- 用 shared `createAuthModule()` 初始化 auth
- Login 页面 UI (TextInput + 登录按钮)
- `_layout.tsx` AuthGuard: 无 token → login, 有 token → tabs
- 飞书 SSO: 后续 Step (先只做密码登录)

**验证**: 模拟器登录 → 进入主界面 → 退出后回到登录页

---

### Step 1.3 ⬜ 会话列表 + 新建会话

**目标**: FlatList 会话列表 + 下拉刷新 + 新建 + 滑动删除

**操作**:
- 用 shared `createSessionsModule()` 初始化 sessions
- `(tabs)/index.tsx`: FlatList + SessionItem 组件
- 下拉刷新 (RefreshControl)
- 新建会话按钮 → createSession → 跳转 chat/[id]
- 滑动删除 (Swipeable)

**验证**: 能看到真实会话列表、新建、删除

---

### Step 1.4 ⬜ WebSocket 连接 + 容器确保

**目标**: CloudAgentWS 移动端集成 + 自动 ensure container

**操作**:
- `mobile/adapters/lifecycle.ts`: AppState + NetInfo adapter 实现 LifecycleAdapter
- 用 shared `CloudAgentWS` + mobileLifecycleAdapter
- 进入主界面后自动 `POST /api/mobile/agent/ensure`
- WS 连接 + ready 状态管理 (Context Provider)
- 连接状态 UI 提示 (准备中/已连接/断开)

**验证**: App 启动后容器 ready + WS 连接成功

---

### Step 1.5 ⬜ 流式聊天核心

**目标**: 发消息 → 流式接收 → Markdown 渲染

**操作**:
- `chat/[id].tsx`: 消息列表 + Composer (TextInput + Send/Stop)
- 用 shared `startCloudStream` 发送 prompt
- 流式事件处理 (用 shared stream-reducer)
- 节流渲染 (50-100ms batch setState)
- Markdown 渲染 (react-native-markdown-display)
- 代码高亮 (react-native-syntax-highlighter)
- 工具状态卡片 (ToolStatus 组件)
- 停止生成 (abortCloudSession)

**验证**: 完整对话流程 — 发消息 → 流式输出 → 工具调用 → 完成

---

### Step 1.6 ⬜ 模型切换 + 图片 + 完善

**目标**: ModelPicker、图片附件、键盘适配、断线重连

**操作**:
- ModelPicker (BottomSheet)
- 图片附件 (expo-image-picker → 上传)
- 图片结果查看 (ImageViewer)
- KeyboardAvoidingView 适配
- 断线重连 UI (自动重连 + 提示)
- MMKV 本地缓存 (离线查看历史会话)

**验证**: 切换模型对话、发送图片、键盘不遮挡输入框

---

### Step 1.7 ⬜ EAS Build + 内测分发

**目标**: iOS + Android 双端内测包

**操作**:
- `eas.json` 配置 (preview profile)
- iOS: Ad Hoc provisioning
- Android: APK 直接分发
- 基础 E2E 烟雾测试

**验证**: 真机安装 → 登录 → 对话完整流程

---

## Phase 2: 企业能力 (预计 2-4 周)

### Step 2.1 ⬜ 定时任务

- 任务列表 / 创建 / 删除 (复用 Gateway `/api/cron/jobs` API)
- `(tabs)/tasks.tsx` 页面

### Step 2.2 ⬜ 飞书 SSO Deep Link

- 系统浏览器 → 飞书授权 → `jacoworks://auth/callback?token=xxx`
- expo-linking 捕获

### Step 2.3 ⬜ 文档上传 + 推送通知

- 文件选择 (expo-document-picker) → 上传 Gateway
- APNs/FCM 推送 token 注册
- 推送 devices 表 (009_push_devices.sql)

### Step 2.4 ⬜ 会话搜索 + 分享

- 会话列表搜索
- Share Extension (iOS) / Share Target (Android)

---

## Phase 3: 高级能力 (预计 4-8 周)

### Step 3.1 ⬜ 协作容器视图
### Step 3.2 ⬜ 语音输入
### Step 3.3 ⬜ 深色模式
### Step 3.4 ⬜ 性能优化 (FlashList)
### Step 3.5 ⬜ CI: EAS + GitHub Actions
### Step 3.6 ⬜ 应用商店提交

---

## Makefile 扩展 (Phase 1 期间添加)

```makefile
dev-mobile:     cd mobile && npx expo start --dev-client
check-mobile:   cd mobile && npx tsc --noEmit && npm test
check-shared:   cd shared && npx tsc --noEmit
```

---

## 注意事项

1. **Phase 0 是关键路径** — 所有后续步骤依赖 shared 层正确抽取
2. **每步完成后更新此文档状态** (⬜ → ✅)
3. **桌面端回归测试** — Step 0.2~0.8 每步都必须跑 `check-desktop`
4. **Gateway 扩展** — Step 0.9~0.10 独立于前端抽取，可并行
5. **共享层只放纯逻辑** — 无 DOM, 无 React, 无 RN, 无平台 API
