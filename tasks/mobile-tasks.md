# Mobile App — WebChat + Capacitor 实施清单

> 主规划文档: `tasks/mobile-app-plan.md`
> 目标: 交付基于现有 `webchat` 的云端移动 App
> 约束: 本清单不再沿用旧的 `RN/Expo/shared` 路线

## 状态图例

- ⬜ 待开始
- 🟡 进行中
- ✅ 完成
- 🔴 阻塞
- ⏭️ 跳过

## Phase 0: 方案落地与冻结

### Step 0.1 ✅ 冻结旧方案

**目标**: 明确旧 `React Native + Expo + shared/` 方案停用

**交付物**:

- `tasks/mobile-app-plan.md` 已重写
- `tasks/mobile-tasks.md` 已重写
- 新方案明确写明 `webchat + Capacitor + 远程托管 /chat`

### Step 0.2 ✅ 形成实施 PRD

**目标**: 把移动端首版范围、非目标、验收标准固定下来

**交付物**:

- `.agents/tasks/prd-mobile-capacitor-app.md`

**验收**:

- PRD 与主规划一致
- 明确首版不包含文件上传、推送、观测站

## Phase 1: Capacitor 壳 MVP

### Step 1.1 🟡 建立 Capacitor 工程

**目标**: 在现有 `webchat` 基础上增加原生壳

**建议改动**:

- 在 `webchat/` 内增加 Capacitor 配置
- 引入 `ios/` 与 `android/` 工程
- 定义 App ID、应用名、图标、启动页

**建议文件**:

- `webchat/capacitor.config.ts`
- `webchat/package.json`

**验收**:

- `webchat` 可通过 Capacitor 在 iOS/Android 模拟器启动

**当前进度**:

- 已新增 `webchat/capacitor.config.ts`
- 已引入 `@capacitor/core` / `@capacitor/cli` / `@capacitor/ios` / `@capacitor/android` / `@capacitor/browser`
- 已生成 `webchat/ios/` 与 `webchat/android/`
- `npm run cap:doctor` / `npm run cap:sync` 已通过
- Android 原生构建受本机 Java Runtime 缺失阻塞
- iOS `xcodebuild` 在当前环境卡在 `Resolve Package Graph`，尚未完成本地编译验收

### Step 1.2 ✅ 确认远程托管入口

**目标**: App 壳稳定打开远程 `/chat`

**建议改动**:

- 配置 App 首屏加载线上或预发 `/chat`
- 区分开发环境与生产环境基址
- 为 WebView 设置允许导航域名

**验收**:

- App 启动后能稳定进入 `/chat`
- 未登录时可自动进入 `/login`

### Step 1.3 🟡 保持现有网页登录闭环

**目标**: 在不改认证架构的前提下打通首版登录

**范围**:

- 首版只保证用户名密码登录
- 保持 `/login -> /chat` 的现有网页流程
- 不在首版引入 Feishu Deep Link

**相关文件**:

- `website/src/main.rs`
- `website/templates/login.html`

**验收**:

- WebView 中可完成用户名密码登录
- 登录完成后可进入 `/chat`
- 退出登录后可回到 `/login`

**当前进度**:

- 架构未改写，仍沿用现有网页 `/login -> /chat` 闭环
- App 壳默认指向远程托管 `/chat`
- 尚未在可运行的 iOS/Android 模拟器环境里完成端到端验收

### Step 1.4 ✅ 增加 App 运行时识别

**目标**: 让 `webchat` 能感知自己运行在移动壳中

**建议改动**:

- 新增平台检测工具
- 区分 browser 与 capacitor 运行环境
- 对外链、窗口打开、实验性能力进行差异化处理

**建议文件**:

- `webchat/src/lib/platform.ts`
- `webchat/src/lib/external-open.ts`

**验收**:

- 前端能判断是否运行在 Capacitor
- `target="_blank"` 类行为不再依赖浏览器默认实现

### Step 1.5 ✅ 适配移动导航结构

**目标**: 将现有 `webchat` 调整为移动 App 可用的主导航

**首版导航**:

- 对话
- 团队
- 任务
- 动态
- 我的

**首版移出主导航**:

- 容器
- 观测站
- 数字之城

**验收**:

- 手机尺寸下可稳定使用主导航
- 不再暴露首版不支持的重型模块

### Step 1.6 🟡 打通 `SetupGate` 与聊天闭环

**目标**: 保证容器准备、WS 连接、聊天主流程在 App 内可用

**范围**:

- `/api/cowork/container-status`
- `/api/cowork/provision`
- `/api/oc/ws-ticket`
- `/ws/oc`
- 聊天、停止生成、标题生成、历史会话

**相关文件**:

- `webchat/src/components/SetupGate.tsx`
- `webchat/src/lib/container.ts`
- `webchat/src/lib/openclaw-client.ts`
- `webchat/src/App.tsx`

**验收**:

- 无容器用户首次进入可自动 provision
- 连接成功后可稳定聊天
- 停止生成与会话切换正常

**当前进度**:

- Web 逻辑未拆分，继续复用既有 `SetupGate`、聊天、WS 和会话能力
- `npm run typecheck` / `npm run build` / `npm run cap:sync` 已通过
- 尚未在原生模拟器里完成完整聊天链路烟测

### Step 1.7 ✅ 保留团队、任务、动态

**目标**: 让首版移动 App 保持 OpenClaw 的核心产品能力

**范围**:

- TeamPanel
- TasksPanel
- FeedPanel

**验收**:

- 可安装和切换团队
- 可查看任务与 Cron
- 可查看活动流

### Step 1.8 ✅ 远程桌面 Beta 入口

**目标**: 首版保留桌面能力，但不承诺内嵌 noVNC 稳定

**策略**:

- App 中保留远程桌面入口
- 默认优先外跳系统浏览器或 In-App Browser
- 内嵌 iframe 模式只做实验验证

**相关文件**:

- `webchat/src/components/DesktopPanel.tsx`

**验收**:

- 用户能从 App 打开远程桌面
- 外跳策略在 iOS/Android 都可工作

**当前进度**:

- 远程桌面入口已收纳到“我的”
- 移动端/Capacitor 运行时默认走外跳浏览器
- 桌面浏览器仍保留嵌入式预览

## Phase 2: 移动可用性补强

### Step 2.1 ⬜ 键盘与安全区专项修补

**目标**: 解决 WebView 下输入区遮挡与滚动错位

**建议改动**:

- 引入 Capacitor Keyboard 或等价方案
- 对 `visualViewport`、底部 inset、滚动容器做专项适配
- 调整 Composer 聚焦与页面滚动策略

**相关文件**:

- `webchat/src/components/Composer.tsx`
- `webchat/src/styles/index.css`

**验收**:

- iOS 和 Android 真机下输入区不被遮挡
- 键盘弹起时消息区和发送区位置稳定

### Step 2.2 ⬜ Feishu SSO Deep Link

**目标**: 支持 App 从系统浏览器完成 Feishu 登录再回跳

**建议改动**:

- 注册 `jacoworks://` scheme
- 网关允许自定义 scheme redirect
- 网站登录页可触发 App 回跳

**相关文件**:

- `gateway/internal/auth/handlers.go`
- `website/src/main.rs`
- Capacitor iOS/Android URL scheme 配置

**验收**:

- Feishu 登录后可回到 App
- 回跳后能进入 `/chat`

### Step 2.3 ⬜ 文件上传能力

**目标**: 为聊天补上附件能力

**需要同时完成**:

- 前端附件按钮与上传状态
- 后端上传 API
- 存储策略
- 聊天消息附件引用模型

**相关文件范围**:

- `webchat/src/components/Composer.tsx`
- `webchat/src/types.ts`
- `gateway/`
- `website/` 或对象存储接入点

**验收**:

- 可从手机选择图片或文件
- 上传后消息里可引用附件
- Agent 可收到附件信息

### Step 2.4 ⬜ 原生分享

**目标**: 增加系统分享能力

**范围**:

- App 内分享会话链接或文本
- 评估是否支持系统“分享到 JAcoworks”

**约束**:

- 入站分享应与附件模型统一设计

## Phase 3: 移动高级能力

### Step 3.1 ⬜ 推送通知

**目标**: 支持任务结果和重要事件通知

**需要新增**:

- 推送设备表
- 设备注册 API
- APNs/FCM 发送链路
- 通知点击回到会话或任务

**验收**:

- App 可注册设备 token
- 服务端可向设备发送通知
- 点击通知可回到目标页面

### Step 3.2 ⬜ 远程桌面内嵌模式评估

**目标**: 评估是否把 noVNC 作为默认体验

**验证维度**:

- 触控
- 输入法
- 剪贴板
- 全屏
- 稳定性

**结果要求**:

- 验证通过才提升为默认模式
- 否则维持浏览器外跳策略

### Step 3.3 ⬜ 观测站与数字之城移动评估

**目标**: 在真机上评估 GPU 与交互成本

**范围**:

- `AgentObservatory`
- `DigitalCityPanel`

**验收**:

- 给出“保留 / 裁剪 / 继续延后”的结论

## 明确废弃的旧任务

以下旧任务不再执行：

- 新建 `mobile/` Expo 项目
- 新建 `shared/` 包
- 从桌面端抽 `CloudAgentWS`
- 新增 `/api/mobile/agent/ensure`
- 沿用 `/ws/agent` 作为移动端主链路

## 总验收

满足以下条件时，视为移动端方案进入可开发状态：

- Capacitor 工程路径确定
- 远程托管 `/chat` 路线确定
- 首版范围与非目标无歧义
- 认证、远程桌面、文件上传三类风险都已分阶段处理
