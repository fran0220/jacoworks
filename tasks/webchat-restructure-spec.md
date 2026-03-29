# WebChat 重构实施规格

> P1: IA 收敛 + App 壳层重组 + 群聊基础

## 目标

8 tab → 4 tab，默认页从"单聊"变成"指挥台"三栏布局，状态管理从 App.tsx 散落 useState 改为分域 hooks。

## 新一级导航 (4 tab)

```ts
type View = "workbench" | "tasks" | "team" | "observe";
```

| Tab | 图标 | 组件 | 说明 |
|-----|------|------|------|
| 指挥台 | Command | WorkbenchView | 三栏: 线程 + 群聊 + 运营侧栏 |
| 任务 | ListTodo | TasksView | 现 TasksPanel (保留) |
| 团队 | Users | TeamStudioView | 现 TeamPanel (保留) |
| 观测 | Orbit | ObserveView | Observatory + City 二级切换 |

移动端底部 tab: 指挥台 / 任务 / 团队 / 更多(观测+设置)

### 砍掉的 tab 去向

- `container` → 删除一级 tab，容器状态显示为 WorkbenchView 顶部状态点
- `feed` → 指挥台右栏"动态"子 tab
- `me` → NavRail 底部头像下拉菜单 (用户名 + 退出登录)
- `city` → 观测页内二级切换

## 文件结构变更

### 新增文件

```
src/
  hooks/
    useUIShell.ts           → view, compact, sidebarOpen, opsPanel 状态
    useWorkspace.ts         → activeWorkspaceKey, activeThreadId, threads[]
    useConversation.ts      → messages, blocks, streaming 状态 + WS 连接
    useOperations.ts        → agentSummaries, activities, selectedAgent/Task
  components/
    WorkbenchView.tsx       → 三栏布局壳层
    ThreadListPanel.tsx     → 左栏: workspace switcher + 线程列表
    TeamPresenceBar.tsx     → 群聊顶部 agent 状态条
    OpsSidebar.tsx          → 右栏: 概览|动态|任务 子 tab
    OpsOverview.tsx         → 右栏"概览" (agent 卡片 + 风险)
    OpsTimeline.tsx         → 右栏"动态" (精简版 FeedPanel)
    OpsTaskSummary.tsx      → 右栏"任务" (摘要 + 跳完整页)
    OrchestrationRow.tsx    → 群聊中的编排注解行
    MentionPopover.tsx      → @mention 弹窗
    UserMenu.tsx            → 头像下拉菜单 (替代 MyPanel)
    ObserveView.tsx         → Observatory + City 二级切换
    TasksView.tsx           → 包装 TasksPanel (适配新布局)
    TeamStudioView.tsx      → 包装 TeamPanel (适配新布局)
```

### 保留不动的文件

```
ChatView.tsx              → 改造 (加 agent attribution + orchestration rows)
Composer.tsx              → 改造 (加 @mention 支持)
StreamingMarkdown.tsx     → 不动
StreamingCursor.tsx       → 不动
ThinkingBlock.tsx         → 不动
ToolStatus.tsx            → 不动
Markdown.tsx              → 不动
SetupGate.tsx             → 不动
AgentObservatory.tsx      → 不动 (ObserveView 包装)
DigitalCityPanel.tsx      → 不动 (ObserveView 包装)
```

### 删除/降级的文件

```
ContainerPanel.tsx        → 删除 (功能移入顶部状态点)
DesktopPanel.tsx          → 保留但仅在 UserMenu 中引用
MyPanel.tsx               → 删除 (功能移入 UserMenu)
NavRail.tsx               → 重写 (8 tab → 4 tab + 头像菜单)
Sidebar.tsx               → 替换为 ThreadListPanel
FeedPanel.tsx             → 拆分复用到 OpsTimeline + 保留完整版在任务页
```

## 状态管理规格

### useUIShell.ts

```ts
type View = "workbench" | "tasks" | "team" | "observe";
type OpsLens = "overview" | "timeline" | "board";

interface UIShellState {
  view: View;
  compact: boolean;
  sidebarOpen: boolean;     // 移动端线程列表抽屉
  opsPanelOpen: boolean;    // 右栏运营面板
  opsLens: OpsLens;
}

// 导出: state, setView, toggleSidebar, toggleOpsPanel, setOpsLens
```

### useWorkspace.ts

```ts
interface WorkspaceState {
  activeWorkspaceKey: string;    // 现在的 activeTeamSessionKey
  activeThreadId: string | null; // 现在的 activeSessionId
  threads: ThreadMeta[];         // 现在的 sessions, 按 workspace 过滤
}

interface ThreadMeta {
  id: string;
  workspaceKey: string;    // 归属哪个 workspace
  title: string;
  updatedAt: number;
}

// 导出: state, switchWorkspace, selectThread, createThread, deleteThread
// switchWorkspace 时清空 messages/blocks/streaming
```

### useConversation.ts

```ts
interface ConversationState {
  messages: ChatMessage[];
  blocks: StreamBlock[];
  streaming: boolean;
  streamingAgents: Set<string>;  // 未来支持多 agent 并发
  error: string | null;
}

// 封装现在 App.tsx 的:
// - WS 连接 (wsRef, WSClient)
// - 帧解析 (parseFrame, applyEvent)
// - 流完成 (finishStream)
// - 发送/中止 (handleSend, handleAbort)
// - scheduleRender
// 导出: state, send, abort, observatoryEventRef
```

### useOperations.ts

```ts
interface OperationsState {
  agentSummaries: AgentSummary[];
  activities: TranslatedActivity[];
  selectedAgentId: string | null;
  selectedTaskId: string | null;
  dashboardStats: DashboardStats | null;
}

// 封装现在 FeedPanel 和 TasksPanel 的数据获取逻辑
// 5s 轮询 feed + agent summary
// 导出: state, selectAgent, selectTask, refresh
```

## 新 App.tsx 壳层

```tsx
export default function App() {
  const [ocToken, setOcToken] = useState<string | null>(() => getOpenClawToken() || null);
  const ui = useUIShell();
  const workspace = useWorkspace();
  const conversation = useConversation(ocToken, workspace.activeWorkspaceKey);
  const ops = useOperations(workspace.activeWorkspaceKey);

  if (!ocToken || conversation.connState !== "connected") {
    return <SetupGate onReady={...} wsState={...} />;
  }

  return (
    <div className="app-layout">
      <NavRail view={ui.view} compact={ui.compact} onViewChange={ui.setView} />
      <div className="app-main">
        {ui.view === "workbench" && (
          <WorkbenchView
            ui={ui} workspace={workspace} conversation={conversation} ops={ops}
          />
        )}
        {ui.view === "tasks" && <TasksView />}
        {ui.view === "team" && (
          <TeamStudioView
            activeSessionKey={workspace.activeWorkspaceKey}
            onSwitchTeam={(key) => { workspace.switchWorkspace(key); ui.setView("workbench"); }}
          />
        )}
        {ui.view === "observe" && (
          <ObserveView
            observatoryEventRef={conversation.observatoryEventRef}
            activeTeamSessionKey={workspace.activeWorkspaceKey}
            onTeamChange={workspace.switchWorkspace}
            onSend={conversation.send}
            onAbort={conversation.abort}
            streaming={conversation.streaming}
            connState={conversation.connState}
          />
        )}
      </div>
    </div>
  );
}
```

## WorkbenchView 三栏布局

```tsx
function WorkbenchView({ ui, workspace, conversation, ops }) {
  return (
    <div className="workbench">
      {/* 左栏: 线程 */}
      <ThreadListPanel
        workspaceKey={workspace.activeWorkspaceKey}
        threads={workspace.threads}
        activeThreadId={workspace.activeThreadId}
        onSelect={workspace.selectThread}
        onCreate={workspace.createThread}
        onDelete={workspace.deleteThread}
        onWorkspaceChange={workspace.switchWorkspace}
        open={ui.sidebarOpen}
      />

      {/* 中栏: 群聊 */}
      <div className="workbench-center">
        <TeamPresenceBar agents={ops.agentSummaries} />
        <ChatView
          messages={conversation.messages}
          blocks={conversation.blocks}
          streaming={conversation.streaming}
          error={conversation.error}
          agentSummaries={ops.agentSummaries}
        />
        <Composer
          disabled={conversation.connState !== "connected"}
          streaming={conversation.streaming}
          onSend={conversation.send}
          onAbort={conversation.abort}
          agents={ops.agentSummaries}   // for @mention
        />
      </div>

      {/* 右栏: 运营 (桌面端) */}
      {!ui.compact && (
        <OpsSidebar
          lens={ui.opsLens}
          onLensChange={ui.setOpsLens}
          ops={ops}
          onAgentClick={(id) => ops.selectAgent(id)}
        />
      )}
    </div>
  );
}
```

## CSS 布局规格

```css
.workbench {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.workbench-threads {   /* 左栏 */
  width: 240px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
}

.workbench-center {    /* 中栏 */
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.workbench-ops {       /* 右栏 */
  width: 300px;
  flex-shrink: 0;
  border-left: 1px solid var(--border);
}

/* 移动端: 只显示中栏, 左/右栏变抽屉 */
@media (max-width: 768px) {
  .workbench-threads { display: none; }
  .workbench-threads.open { /* overlay drawer */ }
  .workbench-ops { display: none; }
}
```

## ChatView 改造规格

### Agent Attribution (消息归属)

每条 assistant 消息增加 sender 信息:

```tsx
// 在 assistant bubble 前添加
<div className="msg-agent-header">
  <span className="msg-agent-role-badge planner">规划师</span>
  <span className="msg-agent-name">Planner</span>
</div>
```

当前后端只有 leader 输出，暂时所有 assistant 消息都标为当前 workspace 的 leader agent。

### Orchestration Annotation Row

新消息类型，显示为细灰色系统行:

```tsx
<div className="orchestration-row">
  <span className="orchestration-line" />
  <span className="orchestration-text">planner 分配了任务 #23 给 @executor</span>
  <span className="orchestration-line" />
</div>
```

数据来源: 从 FeedPanel 的增量轮询中提取 agent 协作事件。

### @mention in Composer

按 `@` 触发弹窗:

```tsx
<MentionPopover
  agents={agentSummaries}
  onSelect={(agent) => insertMention(agent)}
/>
```

插入 `@planner ` 到 textarea。发送时解析 @mentions，未来可用于定向路由。

## TeamPresenceBar 规格

```tsx
function TeamPresenceBar({ agents }: { agents: AgentSummary[] }) {
  return (
    <div className="presence-bar">
      {agents.map(agent => (
        <div key={agent.id} className="presence-chip">
          <span className={`presence-dot ${getStatusClass(agent)}`} />
          <span className="presence-name">{agent.name}</span>
          <span className="presence-status">{getStatusText(agent)}</span>
        </div>
      ))}
    </div>
  );
}
```

状态映射:
- 有 current_sub_task + recent request → 🟢 工作中
- recent request in 30s → 🟡 思考中
- 否则 → ⚪ 空闲

## NavRail 重写规格

```tsx
const TABS = [
  { key: "workbench", label: "指挥台", Icon: Command },
  { key: "tasks", label: "任务", Icon: ListTodo },
  { key: "team", label: "团队", Icon: Users },
  { key: "observe", label: "观测", Icon: Orbit },
];
```

底部:
- 连接状态点 (复用现有)
- 头像按钮 → 点击弹出 UserMenu (用户名 + 退出登录)

移动端底部 bar:
- 指挥台 / 任务 / 团队 / 更多
- "更多"点击展开: 观测 + 设置

## 实施分工

### Thread 1: Foundation (状态 hooks + App 壳层)
- 创建 `hooks/useUIShell.ts`
- 创建 `hooks/useWorkspace.ts`
- 创建 `hooks/useConversation.ts`
- 创建 `hooks/useOperations.ts`
- 重写 `App.tsx` 使用新 hooks
- 重写 `NavRail.tsx` (4 tab)
- 创建 `UserMenu.tsx`
- 删除 `MyPanel.tsx` / `ContainerPanel.tsx` 的一级 tab 引用
- 确保 `make dev-webchat` 可运行

### Thread 2: WorkbenchView 三栏布局
- 创建 `WorkbenchView.tsx` (三栏壳层)
- 创建 `ThreadListPanel.tsx` (替代 Sidebar, 加 workspace switcher)
- 创建 `TeamPresenceBar.tsx`
- 创建 `OpsSidebar.tsx` + `OpsOverview.tsx` + `OpsTimeline.tsx` + `OpsTaskSummary.tsx`
- 创建 `ObserveView.tsx` (Observatory + City 二级切换)
- 创建 `TasksView.tsx` + `TeamStudioView.tsx` (包装现有组件)
- 添加所有新 CSS (workbench 布局 + presence bar + ops sidebar)
- 移动端响应式

### Thread 3: 群聊 UI 升级
- 改造 `ChatView.tsx` (agent attribution + orchestration rows)
- 创建 `OrchestrationRow.tsx`
- 改造 `Composer.tsx` (加 @mention)
- 创建 `MentionPopover.tsx`
- 添加群聊相关 CSS
- 类型定义更新 (types.ts)
