# PRD: Mobile Capacitor App

## Introduction

将现有 `webchat` 包装为 iOS / Android 原生 App，作为 JAcoworks 的云端协作移动入口。该 App 复用现有 OpenClaw 协作前端，不提供桌面端本地模式，不新建第二套 React Native 客户端。

## Goals

- 基于现有 `webchat` 交付可用的移动端 App
- 保持与当前 `oc-gateway + OpenClaw + Incus VM` 架构一致
- 用最小改动打通登录、容器准备、聊天、团队和任务闭环
- 避免维护两套前端和两套路由协议

## User Stories

### US-001: 以 `webchat` 作为唯一移动端前端基座
**Description:** As a developer, I want the mobile app to reuse `webchat` so that we do not maintain a second frontend.

**Acceptance Criteria:**
- [ ] 新方案明确写明移动端基座是 `webchat`
- [ ] 明确不新建 `mobile/` Expo 工程
- [ ] 明确不新建 `shared/` 包
- [ ] 明确不沿用 `/ws/agent` 作为移动端主链路

### US-002: 通过 Capacitor 交付原生壳
**Description:** As a user, I want to install a native mobile app so that I can access JAcoworks from iOS and Android.

**Acceptance Criteria:**
- [ ] 方案明确使用 Capacitor 作为壳层
- [ ] 首版采用远程托管 `/chat`
- [ ] App 壳职责仅包括 WebView、原生桥接和平台能力
- [ ] 明确浏览器版与 App 版共享同一 `webchat` 代码库

### US-003: 首版聚焦核心协作闭环
**Description:** As a user, I want the first mobile release to focus on the collaboration features that matter most so that it is stable and useful.

**Acceptance Criteria:**
- [ ] MVP 包含登录、SetupGate、聊天、团队、任务、动态
- [ ] MVP 明确保留远程桌面入口但标记为 Beta
- [ ] MVP 明确不包含文件上传、推送、观测站、数字之城
- [ ] 每项非目标都在文档中写明原因

### US-004: 复用现有网页登录闭环
**Description:** As a developer, I want the first release to keep the current `/login -> /chat` flow so that we avoid rebuilding auth before launch.

**Acceptance Criteria:**
- [ ] 首版登录方案明确为 WebView 内用户名密码登录
- [ ] 方案说明当前 `/chat` 依赖服务端注入运行时变量
- [ ] Feishu SSO Deep Link 被放入后续阶段
- [ ] 明确列出需要后续改造的文件和链路

### US-005: 分阶段处理高风险能力
**Description:** As a product owner, I want risky features to be phased so that the first mobile release remains controllable.

**Acceptance Criteria:**
- [ ] 远程桌面在首版默认采用浏览器外跳或实验入口策略
- [ ] 文件上传被列为第二阶段能力
- [ ] 推送通知被列为第三阶段能力
- [ ] 观测站与数字之城被列为评估项而非首发项

## Functional Requirements

- FR-1: 移动端必须基于现有 `webchat` 实现，不得新开第二套前端基座
- FR-2: 移动端必须通过 Capacitor 提供 iOS / Android 原生壳
- FR-3: 首版必须使用当前 OpenClaw 链路，即 `/api/cowork/*`、`/api/oc/ws-ticket`、`/ws/oc`
- FR-4: 首版必须支持 WebView 内用户名密码登录
- FR-5: 首版必须支持 `SetupGate` 自动 provision 容器
- FR-6: 首版必须支持聊天、团队切换、任务浏览、活动流
- FR-7: 首版必须为远程桌面提供 Beta 入口
- FR-8: 方案必须明确列出文件上传、推送、Feishu Deep Link 的后续阶段

## Non-Goals

- 不做本地模式
- 不做桌面端 sidecar 移植
- 不做 React Native / Expo 客户端
- 不做首版文件上传
- 不做首版推送通知
- 不做首版观测站和数字之城

## Design Considerations

- 保持现有 `webchat` 移动端响应式风格
- 主导航缩减为高价值模块
- 远程桌面在移动端不承诺内嵌 noVNC 稳定体验

## Technical Considerations

- 当前 `webchat` 依赖 `/chat` 页面服务端注入运行时变量
- 当前网页登录闭环适合直接在 WebView 中复用
- Feishu SSO 目前不支持移动 custom scheme，需要后续改造
- 文件上传当前无通用聊天附件能力，需要前后端同时新增

## Success Metrics

- 团队接受单前端基座路线，不再并行维护旧移动方案
- MVP 范围没有歧义
- 认证、文件上传、远程桌面风险都被明确分阶段
- 文档可以直接作为实施输入

## Open Questions

- 首版远程桌面是否默认外跳系统浏览器，还是允许用户手动切换内嵌模式
- 文件上传是 Phase 2 必做，还是放到更晚阶段
- Feishu SSO 在移动端是必须首批跟进，还是继续由用户名密码承担首版登录
