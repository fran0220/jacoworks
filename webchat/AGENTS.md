# WebChat — React SPA 聊天前端

> Vite + React 18 + TypeScript。前端保持 **OpenClaw-like 兼容事件格式**，后端走 Pi WS Wrapper + oc-gateway 翻译层。不接入 vm-agent。支持两种部署模式：
> - **独立模式 (`chat.jingao.club`)**: 由 oc-gateway 直接托管 `/login` + `/chat` + `/static/*` 并注入 token。
> - **嵌入模式 (`jaco.jingao.club/chat`)**: 由 Rust 网站注入 token 后加载同一套 SPA（历史兼容）。
>
> 后续用 Capacitor 包装为 iOS/Android App。

## 独立部署架构

```
浏览器 → OpenResty (jingao, chat.jingao.club)
       → Tailscale (100.97.254.31:18700)
       → oc-gateway (local)
         ├─ /login, /chat, /static/* — SPA 托管 (chat.html 注入 CacheBust 参数)
         ├─ /api/auth/*, /api/users/me — 认证
         ├─ /api/sessions/* — 会话 CRUD
         ├─ /api/cron/* — 定时任务
         ├─ /ws/oc — Pi WS Wrapper relay (服务端做兼容帧翻译)
         └─ /api/cowork/*, /api/teams, /vnc/*
```

## 代码结构

```
src/
  main.tsx                     React 入口, 读取 window.__AUTH_TOKEN__ 等注入变量
  App.tsx                      壳层: SetupGate → NavRail + 三模式切换 (agent/team/city)
  types.ts                     View, ChatMessage, ChatSession, StreamBlock, AgentExpression 等类型
  hooks/
    useUIShell.ts              view: View / compact / sidebarOpen 状态管理 (无 opsLens/configDrawer)
    useWorkspace.ts            workspace key + thread 管理 (localStorage 持久化)
    useConversation.ts         WS 连接 + 原生帧解析 + 流管理 + 发送
    use-conversation/          对话状态机内部 (content, frame-handler, stream-lifecycle, state, types)
    useOperations.ts           agentSummary + feed 轮询 (TeamModeView 内部使用, 不在 App 层)
    useAgentExpression.ts      Sprite 表情状态 (idle/thinking/speaking/working/happy/error)
    usePretext.ts              DOM-free 文本度量 (@chenglou/pretext 封装, 详见下方)
    useActivityStream.ts       活动流 hook
  lib/
    config.ts                  从 window.__*__ 读取 GATEWAY_URL / AUTH_TOKEN / PI_TOKEN
    ws-client.ts               WSClient 统一接口 (封装兼容客户端, prompt→chat.send 映射)
    ws-relay-client.ts         WS relay 客户端
    event-parser.ts            兼容事件解析 (agent/chat 事件 → StreamBlock)
    message-extract.ts         消息内容提取 (content 数组 → 纯文本)
    tool-stream.ts             工具事件流处理 (tool_start/update/end → StreamBlock)
    sessions.ts                Gateway 会话 CRUD (REST API)
    teams.ts                   团队 API (GET /api/teams, POST /api/teams/install, agent presets)
    team-utils.ts              团队工具函数 (sessionKey 生成/匹配等)
    container.ts               容器状态检查 + 自助 provision
    cron.ts                    Cron 定时任务 CRUD
    feed.ts / feed-translate.ts  活动流 API + 翻译
    file-artifacts.ts / file-utils.ts  文件产物解析 + 工具函数
    upload.ts                  文件上传
    sprite-packs.ts            Sprite Pack 顶层入口
    sprite-packs/              Sprite Pack 注册表 (constants, data, paths, registry, types, workspace)
    avatars.ts                 头像工具
    ops-types.ts               运营面板类型
    platform.ts                平台检测 (iOS/Android/browser, compact viewport)
    posthog.ts                 PostHog 初始化 + 用户 identify
    hljs-setup.ts              Highlight.js 语言注册 (12 种)
    sun-position.ts            太阳位置计算 (城市昼夜)
    external-open.ts           外部链接打开
  components/                  ← 见下方"组件详解"
  village/                     ← 2D 像素村庄系统
  city-3d/                     ← 3D 数字之城 (Three.js + OSM 亦庄真实地图)
  observatory/                 ← 观测站 3D 系统 (Three.js + VRM, legacy)
  styles/
    index.css                  全量样式 (响应式, 三模式布局, sprite, village, city)
```

## 导航结构 (三模式)

```ts
type View = "agent" | "team" | "city";
```

| 模式 | 图标 | 组件 | 说明 |
|------|------|------|------|
| 助手 (Agent) | Bot | AgentModeView | 单 agent + sprite 动画 + 对话。顶栏 agent presets 切换，左侧线程列表 |
| 团队 (Team) | Users | TeamModeView | 3 支团队 + 村庄场景 + 对话。顶栏团队 tabs 切换 |
| 城市 (City) | Globe2 | CityPanel (city-3d/) | 3D 数字之城 (Three.js, 亦庄真实 OSM 地图) |

NavRail: 桌面端左侧垂直侧栏 + 移动端底部 bar，3 个 tab (助手/团队/城市)，底部 UserMenu。

## 状态管理架构

App.tsx 仅作壳层，三模式切换，状态分域到 3 个核心 hooks:

```
useUIShell()        → view: View, compact, sidebarOpen
useWorkspace()      → activeWorkspaceKey, activeThreadId, threads[]
useConversation()   → messages, blocks, streaming, connState, send(), abort()
```

useOperations 由 TeamModeView 内部使用 (agentSummaries + feed 轮询)，不在 App 层。

```tsx
// App.tsx 核心结构
const ui = useUIShell();
const workspace = useWorkspace();
const conversation = useConversation(ocToken, workspace);

if (!ocToken || conversation.connState !== "connected") {
  return <SetupGate ... />;
}

return (
  <NavRail mode={ui.view} onModeChange={ui.setView} ... />
  {ui.view === "agent" && <AgentModeView ... />}
  {ui.view === "team" && <TeamModeView ... />}
  {ui.view === "city" && <CityPanel />}  // from city-3d/CityPanel.tsx
);
```

## 应用入口流程

```
浏览器访问 chat.jingao.club
  → oc-gateway `/chat` (Cookie auth_token)
  ├─ 无/失效 Cookie → 302 到 `/login`
  └─ 有效 Cookie → 渲染 chat.html (注入 __AUTH_TOKEN__/__PI_TOKEN__/__GATEWAY_URL__ + CacheBust)

SPA 启动后:
  App 加载 → 检查 PI_TOKEN
    ├─ 为空 → SetupGate 自动 provision + 轮询 container-status
    └─ 有值 → useConversation 建立 WS → connState="connected" → 进入主界面
```

## 组件详解

### 活跃组件 (在 App.tsx 主流程中)

| 组件 | 用途 |
|------|------|
| `NavRail.tsx` | 三模式 tab 导航 (agent/team/city)，桌面左侧栏 + 移动底栏 |
| `SetupGate.tsx` | 容器前置检查 (无容器时全屏 provision + 轮询 → onReady) |
| `AgentModeView.tsx` | 助手模式: 线程列表 + sprite 动画 + 对话 + 输入框 |
| `TeamModeView.tsx` | 团队模式: 团队 tabs (3 支) + 对话 + 村庄场景 |
| `city-3d/CityPanel.tsx` | 城市模式: Three.js 3D 亦庄数字之城 |
| `UserMenu.tsx` | 头像下拉 (用户名 + 退出登录) |

### AgentModeView 子组件

| 组件 | 用途 |
|------|------|
| `ThreadListPanel.tsx` | 左栏: workspace switcher + 线程列表 (≥20 条启用 pretext 虚拟滚动) |
| `SpriteAvatar.tsx` | Sprite 动画头像 (6 种表情, 3 种尺寸) |
| `ChatView.tsx` | 消息列表容器 + 流式块渲染 (委托 VirtualMessageList) |
| `Composer.tsx` | 输入框 (@mention, pretext 自适应高度, Enter 发送) |

### TeamModeView 子组件

| 组件 | 用途 |
|------|------|
| `TeamPresenceBar.tsx` | 团队 agent 状态条 (角色 + 状态点 + 当前任务) |
| `CrewProgressBar.tsx` | Crew 任务进度条 |
| `ChatView.tsx` / `Composer.tsx` | 共享对话组件 |
| `VillageScene.tsx` (lazy) | 2D 像素村庄场景 (每支团队) |

### 共享基础组件

| 组件 | 用途 |
|------|------|
| `VirtualMessageList.tsx` | 虚拟滚动消息列表 (pretext 高度预算 + Float64Array + ResizeObserver 修正) |
| `Markdown.tsx` | marked + hljs + DOMPurify (streaming/静态统一, 无切换闪烁) |
| `MentionPopover.tsx` | @mention 弹窗 (agent 列表 + @team + 键盘选择) |
| `OrchestrationRow.tsx` | 群聊编排注解行 |
| `StreamingCursor.tsx` | 流式动画光标 (SVG 双环旋转) |
| `ToolStatus.tsx` | 工具状态单行条 (紧凑, 点击展开详情) |
| `ThinkingBlock.tsx` | 可折叠思考过程块 (pretext 预算高度 + CSS transition) |
| `FileCard.tsx` | 文件产物卡片 (预览 + 下载) |
| `WebPreviewPane.tsx` | 文件 Web 预览面板 |
| `preview-renderers.tsx` | 各格式预览渲染器 |
| `SpriteAvatarPanel.tsx` | Sprite 头像选择面板 |
| `AvatarPicker.tsx` | 头像选择器 |

### 非活跃/遗留组件 (仍编译，未在 App.tsx 使用)

| 组件 | 说明 |
|------|------|
| `WorkbenchView.tsx` | 旧三栏布局 (线程 + 对话 + OpsSidebar), 已被 AgentModeView 替代 |
| `TasksView.tsx` | 旧任务页面 |
| `TeamStudioView.tsx` | 旧团队管理页 |
| `ObserveView.tsx` | 旧观测页 |
| `TeamPanel.tsx` | 团队 CRUD 面板 (team-panel/ 子目录内也有) |
| `AgentObservatory.tsx` | Three.js 观测站容器 (未接入主流程) |
| `DigitalCityPanel.tsx` | **已删除** (Mapbox 旧版, 被 city-3d/CityPanel 替代) |
| `DesktopPanel.tsx` | 桌面端信息面板 |
| `ops-sidebar/` | 旧运营侧栏组件 (OpsOverview, OpsTimeline, OpsTaskSummary) |

## Sprite 系统

每个 agent/workspace 关联一个 `spritePackId`，sprite 动画支持 6 种表情和 3 种尺寸:

**表情**: `idle` | `thinking` | `speaking` | `working` | `happy` | `error`

**尺寸**: sm (64×96) | md (96×144) | lg (192×288)

相关文件:
- `lib/sprite-packs/` — 注册表、路径、常量、数据定义
- `lib/sprite-packs.ts` — 顶层入口 (resolve + subscribe)
- `hooks/useAgentExpression.ts` — 根据对话状态计算当前表情
- `components/SpriteAvatar.tsx` — 渲染 sprite 动画

## 团队 (3 支)

| 模板 ID | 名称 | 成员数 |
|---------|------|--------|
| 01-yizhuang-life | 亦庄生活 | 6 |
| 02-content-crew | 内容创作 | 4 |
| 03-research-crew | 研究团队 | 4 |

TeamModeView 顶栏显示团队 tabs，点击切换 workspace key。每支团队对应一个 VillageScene (lazy load)。

## 子系统

### village/ — 2D 像素村庄

团队模式的可视化场景，每支团队一个村庄:

| 文件 | 用途 |
|------|------|
| `VillageScene.tsx` | 场景主组件 (Canvas 渲染, React.lazy 加载) |
| `VillageAgent.ts` | 村庄 agent 实体 (sprite + 移动 + 动画) |
| `VillageBridge.ts` | 对话状态 → 村庄事件桥接 |
| `VillageMap.ts` | 地图数据 (区域 + 路径) |
| `VillageCamera.ts` | 摄像机控制 (平移 + 缩放) |
| `VillagePathfinding.ts` | A* 路径寻路 |
| `VillageVFX.tsx` | 粒子特效 |
| `VillageYSort.ts` | Y 轴排序渲染 |
| `VillageZone.ts` | 区域定义 |
| `bridge/` | 桥接层子模块 |

### city-3d/ — 3D 数字之城

纯 Three.js + 亦庄真实 OSM 地图数据的 3D 城市场景，展示 AI Agent 在赛博朋克风格城市中游走协作。

```
city-3d/
├── CityScene.ts              渲染核心 (WebGLRenderer + EffectComposer: Bloom + Vignette + SMAA)
├── CityEnvironment.ts        编排器 (加载数据 → 建筑/道路/水体/粒子/光柱)
├── CityPanel.tsx             React 容器 (8 Demo Agent + 行为调度 + HUD)
├── fx/
│   ├── render-pipeline.ts    后期管线 (Bloom + Vignette + SMAA, 无 SSAO)
│   ├── city-particles.ts     1570 颗粒子 (星空 + 浮尘 + 数据流光 + 区域光环)
│   ├── agent-trail.ts        Agent 行走拖尾 (ring buffer Points)
│   ├── collaboration-beam.ts 协作贝塞尔光束 + 脉冲粒子
│   └── ground-fog.ts         体积雾 shader
├── geo/
│   ├── projection.ts         经纬度 ↔ Three.js 坐标 (Mercator, 亦庄中心)
│   ├── osm-loader.ts         加载预处理 JSON → TypedArray
│   ├── building-mesh.ts      chunk 建筑 Mesh + 赛博朋克窗户纹理
│   ├── road-mesh.ts          道路 ribbon + 发光边线
│   └── water-shader.ts       通明湖波纹反射 shader
└── navigation/
    ├── CityWaypointGraph.ts  32 节点手工路网 + A* 寻路
    └── zone-mapping.ts       8 区域 3D 定义 + 角色映射
```

**技术选型**: 纯 Three.js (不依赖 Mapbox/MapLibre), 构建期 OSM 预处理, chunk mergeGeometries 渲染, 手工导航图 ("地图真实, 行为导演过")。复用 observatory/avatar/ 的 AvatarPool/Animator/Navigator。

**数据**: `public/city-data/yizhuang.json` (~1.4MB, 1500 栋建筑 / 43 条道路 / 2 水体)。构建期脚本: `scripts/preprocess-osm.mjs` + `scripts/generate-yizhuang-data.mjs`。

### observatory/ — 3D 观测站 (legacy)

Three.js + VRM 3D 可视化系统 (未接入主流程, 保留待复用):

| 目录 | 用途 |
|------|------|
| `world/` | Three.js 场景、浮岛环境、区域管理、路径点寻路 |
| `avatar/` | VRM 模型池、创建/销毁/同步、程序化动画 |
| `bridge/` | FeedLog → WorldEvent 翻译、Agent 状态管理 |
| `hud/` | Leader 虚拟助手浮窗、半身像小场景、语音气泡 |
| `fx/` | 特效 |
| `types.ts` | 共享类型 (RoleConfig, Zone, WaypointNode, WorldAgent 等) |

## 群聊特性

### Agent Attribution
每条 assistant 消息标注发送者 (role badge + name)。向后兼容: 无 sender 字段时不显示。

### Orchestration Annotations
群聊中的编排注解行 (message.type === "orchestration"):
```
── planner 分配了任务 #23 给 @executor ──
```

### @mention
Composer 中输入 `@` 弹出 agent 列表，选择后插入 `@agentName`。支持 `@team` 发送给全体。键盘上下选择 + 过滤 + IME 兼容。

### TeamPresenceBar
团队模式顶部显示 agent 实时状态:
- 🟢 工作中 (有 current_sub_task)
- 🟡 思考中 (recent request)
- ⚪ 空闲

## 连接协议

webchat **仅支持云端 Pi VM**，不接入桌面端 sidecar。前端零改动，oc-gateway 在服务端把 Pi JSONL 翻译成现有兼容帧格式。

```
浏览器 SPA
  → POST /api/oc/ws-ticket (Bearer auth_token 或 Cookie auth_token)
  ← { ticket: "..." }
  → WS wss://chat.jingao.club/ws/oc?ticket=xxx → oc-gateway → VM `pi-ws-wrapper`
  ← OpenClaw-like 兼容帧 (Pi JSONL 由 oc-gateway 翻译，仍保留 proxy.ready / proxy.error)
```

**兼容 relay 架构**: oc-gateway 做 ticket auth → VM lookup → 连接 `pi-ws-wrapper` → Pi JSONL / OpenClaw-like 帧双向翻译。浏览器侧保持原有协议感知，无需改前端组件。

**连接层** (ws-client.ts / ws-relay-client.ts):
- 直收 oc-gateway 翻译后的兼容帧 (无信封解包)
- 合成事件: `proxy.ready` (连接就绪) / `proxy.error` (代理错误)
- 应用层心跳: 25s 间隔
- 前端不做 auto-abort (workspace/thread 切换不中止), 不做 client-side stream timeout; Pi 进程生命周期由 `pi-ws-wrapper` 自管理

**对前端暴露的兼容协议**:
- connect.challenge → connect (身份认证)
- chat.send / chat.abort → 对话
- agent stream → 流式事件 (唯一文本来源)
- chat state=final → 完成信号; chat state=delta → 忽略 (避免重复)

## Freezer 策略 (VM 生命周期)

```
用户活跃 → Touch() 重置计时器
        ↓ 1小时无活动
      Freeze (cgroup暂停, 内存保留, 恢复<1秒)
        ↓ 永不 Stop (stopTimeout=0)
      VM 始终保留在内存中
```

- 首次注册登录: provision VM (10-30秒, 仅一次)
- 之后每次进入: 直连(<2秒) 或 Unfreeze(<1秒)
- 永远不会看到"容器启动中"的长等待

## Cache-Bust 机制

chat.html 中 JS/CSS 引用带 `?v={{.CacheBust}}` 参数，CacheBust 在 oc-gateway 启动时随机生成。每次部署重启后浏览器自动加载最新文件，无需手动硬刷新。

## 构建 & 部署

```bash
make deploy-webchat          # 构建 + 同步到 local + jingao
make deploy-webchat-static   # 仅同步静态文件 (无需重启)
make deploy-oc-gateway       # 完整部署 (Go 二进制 + webchat + 模板 + HTML)
```

## 开发

```bash
make dev-webchat    # Vite dev server → localhost:5180
```

## Pretext 文本度量层

`@chenglou/pretext` 提供 DOM-free 文本高度/宽度计算 (Canvas measureText + 纯算术, 200-500× 快于 DOM reflow)。

**共享 hook** (`hooks/usePretext.ts`):
- `usePretextFont(refEl?)` → `{ font, lineHeight, ready }` — 等待字体加载, 提取 CSS font 信息
- `calcTextHeight(text, font, lineHeight, maxWidth, whiteSpace?)` → `{ height, lineCount }` — 命令式高度计算
- `useShrinkwrap(text, maxWidth, fontInfo)` → number — 气泡最窄像素宽度 (二分法)
- `clearPretextCache()` — 释放内部 prepare 缓存

**使用场景**:
| 组件 | 用途 |
|------|------|
| Composer | `calcTextHeight(pre-wrap)` 替代 `scrollHeight`, 零 DOM reflow 自适应高度 |
| VirtualMessageList | user 消息 `calcTextHeight` 精确预算 + `useShrinkwrap` 气泡紧凑宽度 |
| ThreadListPanel | `calcTextHeight` 预算线程标题行高 → ≥20 条启用虚拟滚动 |
| ThinkingBlock | `calcTextHeight(pre-wrap)` 预算展开高度 → CSS transition 平滑动画 |

**关键约束**:
- 字体必须就绪后才能 prepare: 所有调用通过 `usePretextFont` 门控 `fontInfo.ready`
- `PreparedText` 与宽度无关, text/font 不变时可复用 (内部 LRU 缓存 2000 条)
- 避免 `system-ui` 字体 (Canvas/DOM 可能解析不同), 用具名字体
- pretext 只做**度量**, 不做渲染; Markdown 渲染仍由 `marked + DOMPurify` 完成

## 渲染策略

**Markdown 统一渲染**: streaming 和静态消息均直接使用 `<Markdown>` 组件 (marked.parse < 1ms, useMemo 防重复解析)。已删除 StreamingMarkdown, 消除 `<pre>` ↔ `<Markdown>` 切换导致的闪烁跳动。

**虚拟滚动** (VirtualMessageList):
- user 消息: pretext 精确高度预算 + shrinkwrap 紧凑气泡宽度
- assistant 消息: 行数启发式估算, 渲染后 ResizeObserver 修正真实高度
- orchestration: 固定 40px
- Float64Array 偏移表 + 二分搜索可见区间 + ±5 buffer + rAF 节流滚动

**工具状态** (ToolStatus): 紧凑单行显示 (图标 + 动作 + path/command hint + 状态), 点击可展开详情。默认折叠, 减少消息流视觉噪声。

## 开发规范

- **React 18 + TypeScript strict**
- **纯 CSS** (无 Tailwind/CSS-in-JS), 变量定义在 index.css :root
- **状态分域**: useUIShell / useWorkspace / useConversation (App 层) + useOperations (TeamModeView 内部), 不引入 Redux/Zustand
- **文本度量**: 需要高度/宽度计算时使用 `usePretext.ts`, 禁止直接读 `scrollHeight`/`offsetHeight` (除 ResizeObserver 修正)
- **无 Tauri 依赖**: 所有 API 用原生 fetch + WebSocket
- **3D 依赖**: three + @pixiv/three-vrm (仅 observatory / city-3d lazy-load)
- **2D Sprite**: sprite-packs 系统 (6 表情 × 3 尺寸), SpriteAvatar 组件
- **lucide-react**: 图标库
