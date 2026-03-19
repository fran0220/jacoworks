# JAcoworks 移动端 App 方案重设计

> 状态: 2026-03 重写版，替代旧的 `React Native + Expo + shared/` 方案
> 路线: `webchat` 单前端基座 + Capacitor 原生壳 + 远程托管 `/chat`
> 结论: 不做本地模式，不新建 `mobile/`，不抽 `shared/`

## 一、背景

旧方案的问题不是局部过时，而是技术前提已经改变：

- 当前移动端主线已经明确为 `webchat` 后续包装成 iOS/Android App，而不是新建 React Native 客户端。
- 当前云端协作链路已经是 `oc-gateway + OpenClaw + Incus VM`，不再是 `gateway + /ws/agent + Docker vm-agent`。
- 当前产品核心能力已经沉淀在 `webchat`，包括 `SetupGate`、团队切换、JaMOSS、活动流、远程桌面等，不应该再从桌面端抽一套新前端。

因此，本方案的目标不是“给旧计划修补”，而是确认一条与现状一致、可以直接实施的新路线。

## 二、方案结论

### 2.1 产品定义

移动端 App 定义为：

- 现有 `webchat` 的原生壳化版本
- 只提供云端协作能力
- 不运行本地 sidecar
- 不运行本地 `vm-agent`
- 不提供桌面端那种本地文件读写模式

### 2.2 技术路线

采用以下组合：

- 前端基座: `webchat/` 现有 Vite + React 代码库
- 壳层: Capacitor
- 内容交付: 远程托管 `/chat`
- 协作链路: `POST /api/oc/ws-ticket` -> `GET /ws/oc`
- 容器准备: `GET /api/cowork/container-status` + `POST /api/cowork/provision`

明确不采用以下路线：

- 不新建 `mobile/` React Native / Expo 项目
- 不新建 `shared/` 共享包
- 不引入第二套聊天协议
- 不把桌面端本地模式移植到手机

## 三、为什么选远程托管 `/chat`

当前最稳的实现路线不是把 `webchat` 打成本地静态包，而是让 Capacitor 作为原生壳直接承载远程 `/chat` 页面。

原因：

- `webchat` 目前依赖网站 `/chat` 路由在服务端注入 `__AUTH_TOKEN__`、`__OPENCLAW_TOKEN__`、`__OPENCLAW_VNC_URL__` 等运行时变量。
- 当前登录闭环已经围绕网页 `/login` 和 `/chat` 建立，用户名密码登录可以直接在 WebView 中沿用，不需要先改写前端认证架构。
- 当前 `webchat` 已经是生产形态页面，远程托管能避免“每改一次前端就重新发一个移动包”。
- 当前 OpenClaw/VNC/注入变量都依赖服务端上下文，远程托管比本地静态包更贴近现状。

本方案的默认选择是：

- Phase 1 使用远程托管 `/chat`
- 是否切换到“本地静态包 + API 拉配置”的模式，放到后续评估，不作为首版前提

## 四、产品目标

### 4.1 目标

- 在 iOS 和 Android 上交付一个可用的 JAcoworks 云端协作 App
- 复用现有 `webchat` 业务能力，避免维护两套前端
- 保持与当前 OpenClaw 架构一致
- 控制首版范围，优先打通稳定的聊天与团队协作闭环

### 4.2 非目标

- 不提供本地模式
- 不提供桌面端本地文件读写
- 不首发 3D 观测站和数字之城
- 不首发推送通知
- 不首发文件上传
- 不首发 Feishu SSO Deep Link

## 五、现状能力复用

以下能力直接复用现有 `webchat`：

- `SetupGate` 容器冷启动与 ready 检查
- OpenClaw WebSocket 客户端与流式消息处理
- 会话列表、流式渲染、停止生成、标题生成
- TeamPanel 团队安装与 `sessionKey` 切换
- JaMOSS 任务面板与 Cron 面板
- FeedPanel 活动流
- 已有移动端响应式样式，包括 safe-area 和底部触控布局

以下能力保留但降级处理：

- 远程桌面保留为 Beta 能力
- 首版不承诺 App 内嵌 noVNC 稳定体验
- 首版默认优先“外跳系统浏览器打开远程桌面”

以下能力延后：

- AgentObservatory
- DigitalCityPanel
- 容器状态独立面板
- 推送通知
- 文件上传与系统分享

## 六、MVP 范围

### 6.1 首版必须具备

- App 壳可以打开远程 `/chat`
- WebView 内可完成用户名密码登录
- 登录后可进入 `webchat`
- 无容器时可通过 `SetupGate` 自动 provision
- 可进行聊天、停止生成、查看历史会话
- 可切换团队
- 可浏览任务与 Cron
- 可浏览活动流
- 可退出登录

### 6.2 首版可交付但标记 Beta

- 远程桌面入口
- 默认策略: 在 App 中展示入口，但实际打开优先走系统浏览器或 In-App Browser

### 6.3 首版明确不做

- 文件上传
- 图片/文档附件
- 推送通知
- Feishu SSO Deep Link
- App 内嵌稳定 noVNC 输入体验承诺
- 3D 观测站
- 数字之城

## 七、信息架构

### 7.1 App 层级

Capacitor App 只负责：

- 原生窗口与分发
- WebView 承载远程页面
- 原生桥接能力
- 平台特有能力开关

业务 UI 仍由 `webchat` 负责。

### 7.2 首版导航建议

移动 App 内保留以下主导航：

- 对话
- 团队
- 任务
- 动态
- 我的

补充入口：

- 远程桌面: 从“我的”或团队页进入，标记为 Beta

首版从主导航移除：

- 容器
- 观测站
- 数字之城

原因：

- `容器` 已被 `SetupGate` 吸收为前置流程，不是高频导航目的地
- `观测站` 和 `数字之城` 对移动 WebView 性能与 GPU 压力过高

## 八、认证与会话方案

### 8.1 Phase 1 方案

首版使用现有网页登录闭环：

- App 启动后打开远程 `/chat`
- 若未登录，由网站现有鉴权机制重定向到 `/login`
- 用户在 WebView 中完成用户名密码登录
- 登录成功后由网站回跳 `/chat`
- `/chat` 继续注入 `webchat` 所需运行时变量

这样做的目的：

- 避免首版新增一套独立认证 bootstrap
- 不阻塞现有服务端注入机制

### 8.2 Phase 2 方案

在首版稳定后补以下能力：

- Feishu SSO Deep Link
- `jacoworks://` 自定义 scheme
- App 从系统浏览器回跳 WebView

这部分需要同时改：

- `gateway/internal/auth/handlers.go`
- `website/src/main.rs`
- App 壳的 URL scheme 与路由接收

## 九、远程桌面策略

### 9.1 现状判断

当前 VNC 变量注入与 `/vnc/` 代理已经通了，说明地址与鉴权层面可复用。

问题不在“能不能打开”，而在“移动 WebView 里是否稳定好用”：

- noVNC 在移动触控、输入法、剪贴板、全屏上的体验风险较高
- 现有 `target="_blank"` 在原生壳里未必符合预期

### 9.2 决策

首版采用保守策略：

- 保留远程桌面能力
- App 中默认优先外跳系统浏览器打开
- 真机验证通过后再评估内嵌 iframe 模式是否默认开启

## 十、原生能力规划

### 10.1 Phase 1 必需

- Capacitor 壳工程
- WebView 打开远程 `/chat`
- 状态栏与启动页配置
- 安全区与软键盘适配
- 外部链接打开策略

### 10.2 Phase 2 补充

- Feishu SSO Deep Link
- 文件上传
- 原生分享
- 推送通知

## 十一、后端影响

### 11.1 首版不新增的后端改动

以下项目不作为首版前提：

- 不新增 `/api/mobile/agent/ensure`
- 不新增 React Native 专用接口
- 不新增 `shared` 协议层

### 11.2 首版可能需要的小改动

- 对 `/login` 与 `/chat` 的移动端体验做轻量优化
- 为 App User-Agent 或 query 增加可选识别，便于页面对 WebView 做差异化处理
- 针对外链、VNC、下载行为做移动端兼容判断

### 11.3 第二阶段后端改动

- 支持 Feishu SSO Deep Link
- 新增附件上传 API
- 设计附件消息模型
- 推送设备注册表与推送 API

## 十二、实施分期

### Phase 0: 文档与决策收敛

- 废弃旧 `RN/Expo/shared` 方案
- 重写主规划和任务清单
- 明确 Phase 1 采用远程托管 `/chat`

### Phase 1: App 壳 MVP

- 为 `webchat` 增加 Capacitor 工程
- 接入 iOS / Android 原生壳
- 打通 WebView -> `/chat` -> `/login` -> `/chat` 的现有闭环
- 打通 `SetupGate`
- 打通聊天、团队、任务、动态
- 实现移动导航收缩
- 远程桌面以 Beta 入口交付

### Phase 2: 移动增强

- 键盘与滚动问题专项修补
- Feishu SSO Deep Link
- 文件上传
- 原生分享
- 远程桌面内嵌模式评估

### Phase 3: 高级能力

- 推送通知
- 观测站移动化评估
- 数字之城移动化评估
- 是否转向本地静态包模式评估

## 十三、关键技术决策

| 决策项 | 结论 | 原因 |
|---|---|---|
| 移动端基座 | 继续使用 `webchat` | 当前业务能力已集中在 `webchat` |
| 原生壳 | Capacitor | 与现有 Web 前端最贴合 |
| 首版交付模型 | 远程托管 `/chat` | 最小改动复用当前注入体系 |
| 本地模式 | 不做 | 当前产品定义就是云端协作 App |
| 文件上传 | 延后到 Phase 2 | 当前前后端都没有聊天附件能力 |
| Feishu SSO | 延后到 Phase 2 | 需要 custom scheme 与回跳链路改造 |
| 远程桌面 | 首版保留入口，默认外跳 | 内嵌 noVNC 在移动 WebView 风险高 |
| 观测站/数字之城 | 延后 | 性能与必要性都不适合首版 |

## 十四、风险与对策

| 风险 | 级别 | 对策 |
|---|---|---|
| WebView 登录体验不稳定 | 高 | 首版先走用户名密码闭环，Feishu 延后 |
| 移动软键盘遮挡输入区 | 高 | 单列为 Phase 1 必测项，必要时接入 Capacitor Keyboard |
| noVNC 在移动端体验差 | 高 | 首版默认外跳系统浏览器 |
| 继续维护旧方案文档导致团队误判 | 高 | 本文档直接替代旧方案 |
| 文件上传需求推迟引发范围争议 | 中 | 在 PRD 和实施清单里明确写成非首发能力 |
| 双端发版节奏影响前端迭代 | 中 | 首版使用远程托管页面，降低前端变更成本 |

## 十五、验收标准

满足以下条件，视为新方案成立并可进入开发：

- 团队统一接受“`webchat + Capacitor + 远程托管 /chat`”路线
- 旧 `mobile/Expo/shared` 方案不再作为执行依据
- 实施清单已经按新路线重写
- MVP 范围与非目标写清楚
- 认证、文件上传、远程桌面三类风险已被分别归档
