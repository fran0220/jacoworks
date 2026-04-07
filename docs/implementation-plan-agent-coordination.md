# JAcoworks Agent 协调层 & 数字小镇实施计划

> 综合讨论结论：在 oc-gateway 上自建轻量协调层（不引入 OpenASE），打通事件链路驱动数字小镇可视化，前端收敛为"对话 + 小镇"双核心布局。

## 一、架构总览

```
用户 → webchat (React SPA)
         ├─ 左栏: Agent/团队切换 + 线程列表
         ├─ 中央: 对话流 (单Agent / 群聊)
         ├─ 右栏: 精灵全身像 (单Agent) 或 VillageScene (团队)
         └─ ⚙️ 配置抽屉: Agent管理/团队模板/任务/运营/定时/设置

webchat ←→ oc-gateway (Go)
              ├─ /ws/oc           (现有 WS relay, 加 sender 透传)
              ├─ /api/tasks       (🆕 任务 CRUD)
              ├─ /api/workflows   (🆕 工作流 CRUD)
              ├─ /api/activity/stream (🆕 SSE 事件流)
              ├─ /api/teams       (现有)
              ├─ /api/profiles    (现有)
              └─ Scheduler goroutine (🆕 5s tick 调度)

oc-gateway ←→ Pi WS Wrapper (:18789) ←→ Pi CLI (per-session)
```

## 二、实施分为 5 个工作包

| # | 工作包 | 依赖 | 预计改动量 |
|---|--------|------|-----------|
| WP1 | 事件链路修复 (sender 透传) | 无 | ~50 行 |
| WP2 | 后端协调层 (task/workflow/scheduler) | 无 | ~800 行 Go + 2 SQL |
| WP3 | 内置 Agent & 团队配置 | 无 | JSON + ~40 行 Go/TS |
| WP4 | 前端布局重构 (双模式: 工作台 + 城市) | WP1 | ✅ 已完成 |
| WP5 | 前端事件消费 (SSE + 小镇驱动) | WP1, WP2 | ~150 行 TS |

**并行策略**: WP1 + WP2 + WP3 可完全并行。WP4 依赖 WP1（sender）。WP5 依赖 WP1 + WP2（SSE）。

---

## WP1: 事件链路修复 — sender 透传

### 目标
打通 Pi CLI → translator → event-parser → 前端的 sender 归属链路，让团队模式下的群聊能区分"谁在说话"，让小镇知道"谁在活动"。

### 1.1 修改 `gateway/internal/pi/translator.go`

**在现有事件翻译中提取并透传 sender 信息。**

Pi CLI 团队模式下，`message_update` 事件的顶层可能包含 `agentId`、`agentName`、`agentRole` 字段（由 Pi 的 /team 插件注入）。当前 translator 完全忽略了这些字段。

改动点 1 — 新增 `extractSender` 辅助函数:

```go
// extractSender extracts agent attribution from a Pi event if present.
func extractSender(event map[string]any) map[string]any {
    sender := map[string]any{}
    if id := asString(event["agentId"]); id != "" {
        sender["agentId"] = id
    }
    if name := asString(event["agentName"]); name != "" {
        sender["agentName"] = name
    }
    if role := asString(event["agentRole"]); role != "" {
        sender["role"] = role
    }
    if len(sender) == 0 {
        return nil
    }
    return sender
}
```

改动点 2 — 在 `TranslatePiToOC` 的以下 case 中，把 sender 注入 OC 帧:

- `message_update` → `text_delta`: payload 加 `"sender": extractSender(event)`
- `message_update` → `thinking_delta`: payload 加 `"sender": extractSender(event)`
- `tool_execution_start/update/end`: payload.data 加 `"sender": extractSender(event)`
- `agent_end`: payload 加 `"sender": extractSender(event)`

示例（text_delta 分支改后）:
```go
case "text_delta":
    delta := asString(assistantEvent["delta"])
    if delta == "" {
        return nil, nil
    }
    payload := map[string]any{
        "stream": "text",
        "data":   map[string]any{"delta": delta},
    }
    if sender := extractSender(event); sender != nil {
        payload["sender"] = sender
    }
    return mustMarshal(map[string]any{
        "type":    "event",
        "event":   "agent",
        "payload": payload,
    }), nil
```

**对所有 6 个翻译分支（text_delta, thinking_delta, tool_start, tool_update, tool_end, agent_end）做同样处理。**

### 1.2 修改 `webchat/src/lib/event-parser.ts`

改动点 1 — `ParsedEvent` 接口加 sender:
```ts
export interface ParsedEvent {
    kind: /* ...existing... */;
    // ...existing fields...
    sender?: { agentId: string; agentName: string; role: string };  // 🆕
}
```

改动点 2 — `parseAgentEvent()` 提取 sender:
```ts
function parseAgentEvent(payload: Record<string, unknown>): ParsedEvent {
    const stream = asString(payload.stream);
    const data = asRecord(payload.data);
    const senderRaw = asRecord(payload.sender);           // 🆕
    const sender = senderRaw.agentId                      // 🆕
        ? {                                                // 🆕
            agentId: asString(senderRaw.agentId),          // 🆕
            agentName: asString(senderRaw.agentName),      // 🆕
            role: asString(senderRaw.role),                 // 🆕
          }                                                // 🆕
        : undefined;                                       // 🆕

    if (stream === "text" || stream === "assistant") {
        const text = asString(data.delta || data.text);
        return text ? { kind: "text_delta", text, sender } : { kind: "ignore" };  // 加 sender
    }
    // ... thinking, tool 分支同样传递 sender ...
}
```

改动点 3 — `parseChatEvent()` 提取 sender（agent_end 翻译后走这里）:
```ts
function parseChatEvent(payload: Record<string, unknown>): ParsedEvent {
    const state = asString(payload.state).toLowerCase();
    const senderRaw = asRecord(payload.sender);             // 🆕
    const sender = senderRaw.agentId ? { ... } : undefined; // 🆕
    if (state === "final" || state === "aborted") {
        return { kind: "done", message: payload.message, sender };  // 加 sender
    }
    // ...
}
```

### 1.3 修改 `webchat/src/hooks/useConversation.ts`

改动点 — streaming 期间暂存 sender，finishStream 时写入消息:

在 `onFrame` 回调中，收到带 sender 的事件时暂存:
```ts
// 在 wsRef 闭包顶部新增:
const currentSenderRef = useRef<ChatSender | undefined>(undefined);

// 在 onFrame 中，parseFrame 后:
if (parsed.sender) {
    currentSenderRef.current = parsed.sender;
}
```

在 `finishStream` 中:
```ts
const assistantMsg: ChatMessage = {
    role: "assistant",
    content: ...,
    timestamp: Date.now(),
    sender: finalMeta.sender || currentSenderRef.current || undefined,  // 🆕 fallback
    ...finalMeta,
};
// reset
currentSenderRef.current = undefined;
```

### 1.4 验证

- 单 Agent 模式: sender 为 undefined → resolveSender fallback 到 preset 名字 ✅
- 团队模式: Pi 不带 sender → resolveSender fallback 到 leader ✅ (向后兼容)
- 团队模式 + Pi 插件带 sender → 精确归属到成员 ✅ (新能力)

---

## WP2: 后端协调层

### 目标
在 oc-gateway 中新增任务队列、工作流引擎和调度器，让前端能创建结构化任务并通过 SSE 获取生命周期事件。

### 2.1 SQL 迁移

**`deploy/sql/015_tasks.sql`**:
```sql
CREATE TABLE tasks (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id     TEXT NOT NULL REFERENCES users(id),
    session_id  TEXT,
    workflow_id TEXT,
    stage       TEXT NOT NULL DEFAULT '',
    type        TEXT NOT NULL DEFAULT 'chat',
    status      TEXT NOT NULL DEFAULT 'pending',
    priority    INT  NOT NULL DEFAULT 0,
    agent_name  TEXT NOT NULL DEFAULT '',
    prompt      TEXT NOT NULL,
    result      TEXT NOT NULL DEFAULT '',
    error       TEXT NOT NULL DEFAULT '',
    retry_count INT  NOT NULL DEFAULT 0,
    max_retries INT  NOT NULL DEFAULT 2,
    timeout_sec INT  NOT NULL DEFAULT 300,
    started_at  TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_user_status ON tasks(user_id, status);
CREATE INDEX idx_tasks_status ON tasks(status) WHERE status IN ('pending', 'running');

CREATE TRIGGER set_tasks_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

status 合法值: `pending`, `assigned`, `running`, `done`, `failed`, `timeout`

type 合法值: `chat`, `research`, `document`, `analysis`, `creative`, `code`

**`deploy/sql/016_workflows.sql`**:
```sql
CREATE TABLE workflows (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id     TEXT NOT NULL REFERENCES users(id),
    name        TEXT NOT NULL,
    stages      JSONB NOT NULL DEFAULT '[]',
    enabled     BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, name)
);

CREATE TRIGGER set_workflows_updated_at
    BEFORE UPDATE ON workflows
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

stages JSONB 结构:
```json
[
  {"name": "research",  "agent_name": "researcher", "prompt_template": "搜集关于 {{topic}} 的资料", "next": "write"},
  {"name": "write",     "agent_name": "writer",     "prompt_template": "基于以下资料撰写报告:\n{{prev_result}}", "next": ""},
]
```

### 2.2 新建 `gateway/internal/task/`

**`store.go`** (~120 行) — tasks 表 CRUD:
- `Create(ctx, userID, req CreateTaskRequest) (*Task, error)`
- `Get(ctx, userID, taskID string) (*Task, error)`
- `ListByUser(ctx, userID string, statusFilter []string) ([]Task, error)`
- `UpdateStatus(ctx, taskID, newStatus string, fields map[string]any) error`
- `ListPending(ctx, limit int) ([]Task, error)` — 按 priority DESC, created_at ASC
- `ListRunningTimedOut(ctx) ([]Task, error)` — started_at + timeout_sec < now()

使用 pgx/v5 连接池，遵循 `gateway/internal/store/sessions.go` 的风格。

**`status.go`** (~60 行) — 状态机:
```go
var validTransitions = map[string][]string{
    "pending":  {"assigned"},
    "assigned": {"running", "failed"},
    "running":  {"done", "failed", "timeout"},
    "failed":   {"pending"}, // retry
    "timeout":  {"pending"}, // retry
}

func ValidateTransition(from, to string) error { ... }
```

### 2.3 新建 `gateway/internal/workflow/`

**`engine.go`** (~100 行):
```go
type Stage struct {
    Name           string `json:"name"`
    AgentName      string `json:"agent_name"`
    PromptTemplate string `json:"prompt_template"`
    Next           string `json:"next"`
}

type Workflow struct {
    ID      string  `json:"id"`
    UserID  string  `json:"user_id"`
    Name    string  `json:"name"`
    Stages  []Stage `json:"stages"`
    Enabled bool    `json:"enabled"`
}

// CRUD methods using store.Pool()
```

**`runner.go`** (~80 行):
```go
// OnTaskDone 检查是否有下一阶段
func (r *Runner) OnTaskDone(ctx context.Context, task *task.Task) error {
    if task.WorkflowID == "" || task.Stage == "" { return nil }

    wf, err := r.workflowStore.Get(ctx, task.UserID, task.WorkflowID)
    if err != nil { return err }

    currentStage := findStage(wf.Stages, task.Stage)
    if currentStage == nil || currentStage.Next == "" { return nil }

    nextStage := findStage(wf.Stages, currentStage.Next)
    if nextStage == nil { return nil }

    prompt := renderTemplate(nextStage.PromptTemplate, map[string]string{
        "prev_result": task.Result,
    })

    _, err = r.taskStore.Create(ctx, task.UserID, task.CreateTaskRequest{
        WorkflowID: task.WorkflowID,
        Stage:      nextStage.Name,
        Type:       task.Type,
        AgentName:  nextStage.AgentName,
        Prompt:     prompt,
    })
    return err
}
```

### 2.4 新建 `gateway/internal/scheduler/`

**`scheduler.go`** (~100 行):
```go
type Scheduler struct {
    taskStore     *task.Store
    workflowRun   *workflow.Runner
    dispatcher    *Dispatcher
    watchdog      *Watchdog
    eventBus      *EventBus        // SSE 广播
    maxConcurrent int              // 每用户最大并发 (默认 3)
    ticker        *time.Ticker
}

func (s *Scheduler) Run(ctx context.Context) {
    s.ticker = time.NewTicker(5 * time.Second)
    defer s.ticker.Stop()
    for {
        select {
        case <-ctx.Done(): return
        case <-s.ticker.C:
            s.tick(ctx)
        }
    }
}

func (s *Scheduler) tick(ctx context.Context) {
    // 1. watchdog: 检查超时任务
    s.watchdog.CheckTimeouts(ctx)

    // 2. 获取 pending tasks
    tasks, _ := s.taskStore.ListPending(ctx, 10)
    for _, t := range tasks {
        // 检查用户并发数
        running := s.taskStore.CountRunning(ctx, t.UserID)
        if running >= s.maxConcurrent { continue }

        // dispatch
        if err := s.dispatcher.Dispatch(ctx, &t); err != nil {
            log.Warn().Err(err).Str("task_id", t.ID).Msg("dispatch failed")
            continue
        }

        // 广播事件
        s.eventBus.Publish(t.UserID, ActivityEvent{
            Kind:      "task_claim",
            TaskID:    t.ID,
            AgentID:   t.AgentName,
            AgentName: t.AgentName,
            Detail:    truncate(t.Prompt, 60),
        })
    }
}

// OnAgentEnd 由 ws_handler hook 调用
func (s *Scheduler) OnAgentEnd(userID, sessionKey string) {
    // 查找该 session 对应的 running task
    // 标记 done
    // 触发 workflow runner
    // 广播 task_complete 事件
}
```

**`dispatch.go`** (~80 行):
```go
func (d *Dispatcher) Dispatch(ctx context.Context, t *task.Task) error {
    // 1. 选 Agent: 按 task.type 匹配 agent_profiles 的 skills
    //    或 fallback 到 agents.json preset
    agent := d.resolveAgent(ctx, t)

    // 2. 组装 Harness prompt
    prompt := agent.SystemPrompt + "\n\n" + t.Prompt

    // 3. 更新 task 状态
    d.taskStore.UpdateStatus(ctx, t.ID, "running", map[string]any{
        "agent_name": agent.Name,
        "started_at": time.Now(),
    })

    // 4. 通过现有 WS relay 发给 Pi
    //    构造内部 prompt 帧，写入用户的 Pi session
    d.sendToPi(ctx, t.UserID, t.SessionID, prompt)
    return nil
}
```

**`watchdog.go`** (~60 行):
```go
func (w *Watchdog) CheckTimeouts(ctx context.Context) {
    timedOut, _ := w.taskStore.ListRunningTimedOut(ctx)
    for _, t := range timedOut {
        if t.RetryCount < t.MaxRetries {
            w.taskStore.UpdateStatus(ctx, t.ID, "pending", map[string]any{
                "retry_count": t.RetryCount + 1,
            })
            w.eventBus.Publish(t.UserID, ActivityEvent{Kind: "task_timeout", ...})
        } else {
            w.taskStore.UpdateStatus(ctx, t.ID, "failed", map[string]any{
                "error": "max retries exceeded",
            })
            w.eventBus.Publish(t.UserID, ActivityEvent{Kind: "task_failed", ...})
        }
    }
}
```

### 2.5 新建 `gateway/internal/scheduler/eventbus.go` (~60 行)

SSE 事件广播器:
```go
type ActivityEvent struct {
    Kind      string `json:"kind"`       // task_create/task_claim/task_start/task_complete/task_failed/task_timeout
    TaskID    string `json:"taskId"`
    AgentID   string `json:"agentId"`
    AgentName string `json:"agentName"`
    Detail    string `json:"detail"`
    Timestamp string `json:"ts"`
}

type EventBus struct {
    mu          sync.RWMutex
    subscribers map[string][]chan ActivityEvent  // key: userID
}

func (eb *EventBus) Subscribe(userID string) (<-chan ActivityEvent, func()) { ... }
func (eb *EventBus) Publish(userID string, event ActivityEvent) { ... }
```

### 2.6 修改 `gateway/cmd/oc-gateway/main.go`

新增路由 (~30 行):
```go
// Task API
mux.Handle("POST /api/tasks", authMiddleware.Authenticate(http.HandlerFunc(createTaskHandler(taskStore, eventBus))))
mux.Handle("GET /api/tasks", authMiddleware.Authenticate(http.HandlerFunc(listTasksHandler(taskStore))))
mux.Handle("PATCH /api/tasks/{id}", authMiddleware.Authenticate(http.HandlerFunc(updateTaskHandler(taskStore, eventBus))))

// Workflow API
mux.Handle("POST /api/workflows", authMiddleware.Authenticate(http.HandlerFunc(createWorkflowHandler(workflowStore))))
mux.Handle("GET /api/workflows", authMiddleware.Authenticate(http.HandlerFunc(listWorkflowsHandler(workflowStore))))
mux.Handle("PUT /api/workflows/{id}", authMiddleware.Authenticate(http.HandlerFunc(updateWorkflowHandler(workflowStore))))

// SSE Activity Stream
mux.Handle("GET /api/activity/stream", authMiddleware.Authenticate(http.HandlerFunc(activityStreamHandler(eventBus))))
```

初始化 Scheduler:
```go
eventBus := scheduler.NewEventBus()
taskStore := task.NewStore(s.Pool())
workflowStore := workflow.NewStore(s.Pool())
workflowRunner := workflow.NewRunner(taskStore, workflowStore)
sched := scheduler.New(taskStore, workflowRunner, eventBus)
go sched.Run(ctx)
```

SSE handler:
```go
func activityStreamHandler(bus *scheduler.EventBus) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        user := auth.GetUser(r.Context())
        flusher, ok := w.(http.Flusher)
        if !ok { http.Error(w, "streaming not supported", 500); return }

        w.Header().Set("Content-Type", "text/event-stream")
        w.Header().Set("Cache-Control", "no-cache")
        w.Header().Set("Connection", "keep-alive")

        ch, unsubscribe := bus.Subscribe(user.ID)
        defer unsubscribe()

        pingTicker := time.NewTicker(15 * time.Second)
        defer pingTicker.Stop()

        for {
            select {
            case <-r.Context().Done(): return
            case event := <-ch:
                data, _ := json.Marshal(event)
                fmt.Fprintf(w, "data: %s\n\n", data)
                flusher.Flush()
            case <-pingTicker.C:
                fmt.Fprintf(w, ": ping\n\n")
                flusher.Flush()
            }
        }
    }
}
```

### 2.7 修改 `gateway/internal/agent/ws_handler.go`

在 relay() 的 upstream→client goroutine 中加 hook (~10 行):

```go
// 在 translateUpstreamFrame 之后、写入 client 之前:
if isAgentEndEvent(data) {
    go scheduler.OnAgentEnd(userID, currentSessionKey)
}

// isAgentEndEvent 解析 Pi JSONL 判断 type == "agent_end"
func isAgentEndEvent(data []byte) bool {
    var m map[string]any
    if json.Unmarshal(data, &m) != nil { return false }
    return asString(m["type"]) == "agent_end"
}
```

---

## WP3: 内置 Agent & 团队配置

### 目标
扩充内置角色到 8 个，新增 3 个办公向团队模板，补全精灵映射。

### 3.1 扩充 `pi-config/agents.json`

从 4 个 → 8 个，每个加 `spritePackId`:

```json
[
  {"id":"default",    "label":"默认助手",   "icon":"bot",       "workspaceKey":"agent:default",    "spritePackId":"aria",   "systemPrompt":null},
  {"id":"researcher", "label":"研究员",     "icon":"search",    "workspaceKey":"agent:researcher", "spritePackId":"atlas",  "systemPrompt":"You are a thorough research assistant. When given a topic, search the web, analyze sources, and provide well-cited comprehensive answers. Always verify facts from multiple sources."},
  {"id":"coder",      "label":"程序员",     "icon":"code",      "workspaceKey":"agent:coder",      "spritePackId":"coda",   "systemPrompt":"You are an expert programmer. Write clean, well-tested code. Always consider edge cases, performance, and maintainability. Prefer simple solutions over clever ones."},
  {"id":"writer",     "label":"写作助手",   "icon":"pen-tool",  "workspaceKey":"agent:writer",     "spritePackId":"lyric",  "systemPrompt":"You are a skilled content writer. Produce engaging, well-structured content. Adapt your tone and style to the target audience. Focus on clarity and impact."},
  {"id":"analyst",    "label":"数据分析师", "icon":"bar-chart", "workspaceKey":"agent:analyst",    "spritePackId":"prism",  "systemPrompt":"你是一位数据分析专家。擅长从原始数据中提取洞察，制作清晰的表格和图表，用数字讲故事。处理 Excel、CSV 数据得心应手。"},
  {"id":"designer",   "label":"设计师",     "icon":"palette",   "workspaceKey":"agent:designer",   "spritePackId":"sketch", "systemPrompt":"你是一位视觉设计师。擅长 UI/UX 设计、品牌视觉、排版和配色。能产出设计规范、线框图描述和视觉方案。"},
  {"id":"planner",    "label":"规划师",     "icon":"calendar",  "workspaceKey":"agent:planner",    "spritePackId":"nova",   "systemPrompt":"你是一位项目规划师。擅长拆解复杂任务、制定时间线、分配资源、跟踪进度。输出结构清晰的计划文档和甘特图描述。"},
  {"id":"secretary",  "label":"秘书",       "icon":"clipboard", "workspaceKey":"agent:secretary",  "spritePackId":"echo",   "systemPrompt":"你是一位高效秘书。擅长会议纪要、日程安排、邮件撰写、信息汇总。简洁精准，格式规范。"}
]
```

### 3.2 Go 端 AgentPreset 加 SpritePackId

修改 `gateway/internal/pi/config.go`:

```go
type AgentPreset struct {
    ID           string  `json:"id"`
    Label        string  `json:"label"`
    Icon         string  `json:"icon"`
    WorkspaceKey string  `json:"workspaceKey"`
    SystemPrompt *string `json:"systemPrompt"`
    SpritePackId string  `json:"spritePackId,omitempty"` // 🆕
}
```

在 `LoadAgentPresets()` 的 normalize 循环中加:
```go
preset.SpritePackId = strings.TrimSpace(preset.SpritePackId)
```

### 3.3 新建 3 个团队模板

**`pi-config/team-templates/office-pod.json`**:
```json
{
  "id": "office-pod",
  "label": "办公小队",
  "description": "秘书统筹 + 分析师处理数据 + 写作助手产出文档。适合报告撰写、数据整理、文档处理。",
  "icon": "🏢",
  "version": "1.0.0",
  "workspaceKeyPrefix": "team:office-pod",
  "leaderSystemPrompt": "你是办公团队的统筹秘书。你有两位队友：analyst 负责数据分析，writer 负责文档产出。接到任务后，先拆解需求，让 analyst 处理数据部分，再让 writer 基于分析结果撰写最终文档。用 /team 命令协调。",
  "members": [
    {"name":"analyst", "role":"researcher", "spritePackId":"prism", "mode":"fresh", "workspace":"shared", "model":"proxy/gpt-5.4", "kickoff":"你是数据分析师，负责整理数据、提取关键指标、制作表格和图表。"},
    {"name":"writer",  "role":"writer",     "spritePackId":"lyric", "mode":"branch", "workspace":"shared", "model":"proxy/gpt-5.4", "kickoff":"你是文档写手，负责把分析结果转化为格式规范、逻辑清晰的正式文档。"}
  ],
  "bootstrapCommands": ["/team spawn analyst fresh shared --model proxy/gpt-5.4", "/team spawn writer branch shared --model proxy/gpt-5.4"]
}
```

**`pi-config/team-templates/creative-pod.json`**:
```json
{
  "id": "creative-pod",
  "label": "创作小队",
  "description": "规划师构思 + 设计师视觉 + 写作助手文案。适合品牌策划、内容创作、方案设计。",
  "icon": "🎨",
  "version": "1.0.0",
  "workspaceKeyPrefix": "team:creative-pod",
  "leaderSystemPrompt": "你是创作团队的策划总监。你有两位队友：designer 负责视觉方案，writer 负责文案创作。先确定创作方向和风格，再分别让 designer 和 writer 并行产出。用 /team 命令协调。",
  "members": [
    {"name":"designer", "role":"executor",   "spritePackId":"sketch", "mode":"fresh", "workspace":"shared", "model":"proxy/gpt-5.4", "kickoff":"你是视觉设计师，负责产出设计概念、配色方案、布局描述和视觉规范。"},
    {"name":"writer",   "role":"writer",     "spritePackId":"lyric",  "mode":"branch", "workspace":"shared", "model":"proxy/gpt-5.4", "kickoff":"你是创意文案，负责撰写有感染力的标题、正文、口号和传播文案。"}
  ],
  "bootstrapCommands": ["/team spawn designer fresh shared --model proxy/gpt-5.4", "/team spawn writer branch shared --model proxy/gpt-5.4"]
}
```

**`pi-config/team-templates/ops-pod.json`**:
```json
{
  "id": "ops-pod",
  "label": "运营小队",
  "description": "研究员调研 + 分析师量化 + 规划师输出方案。适合市场调研、竞品分析、策略规划。",
  "icon": "📊",
  "version": "1.0.0",
  "workspaceKeyPrefix": "team:ops-pod",
  "leaderSystemPrompt": "你是运营团队的主理人。你有两位队友：researcher 负责信息搜集，analyst 负责数据分析与方案产出。先让 researcher 搜集材料，再让 analyst 基于材料做深度分析并产出可执行方案。用 /team 命令协调。",
  "members": [
    {"name":"researcher", "role":"researcher", "spritePackId":"atlas", "mode":"fresh", "workspace":"shared", "model":"proxy/gpt-5.4", "kickoff":"你是研究员，负责全网搜索、信息搜集、竞品对比和素材整理。"},
    {"name":"analyst",    "role":"reviewer",   "spritePackId":"prism", "mode":"branch", "workspace":"shared", "model":"proxy/gpt-5.4", "kickoff":"你是分析师，负责把研究材料量化、提取洞察、产出带数据支撑的策略方案。"}
  ],
  "bootstrapCommands": ["/team spawn researcher fresh shared --model proxy/gpt-5.4", "/team spawn analyst branch shared --model proxy/gpt-5.4"]
}
```

### 3.4 前端精灵映射

修改 `webchat/src/lib/sprite-packs.ts`:

```ts
const BUILTIN_AGENT_SPRITE_PACKS: Record<string, string> = {
  default: "aria",
  researcher: "atlas",
  coder: "coda",
  writer: "lyric",
  analyst: "prism",      // 🆕
  designer: "sketch",    // 🆕
  planner: "nova",       // 🆕
  secretary: "echo",     // 🆕
};

const ROLE_SPRITE_PACKS: Record<string, string> = {
  // ...existing...
  analyst: "prism",      // 🆕
  designer: "sketch",    // 🆕
  secretary: "echo",     // 🆕
  summarizer: "lyric",   // 🆕
};
```

修改 `webchat/src/village/VillageZone.ts` — ROLE_ALIASES:
```ts
// 新增:
analyst: "researcher",
designer: "executor",
secretary: "planner",
summarizer: "writer",
```

修改 `webchat/src/village/VillageAgent.ts` — ROLE_LABELS 和 ROLE_ACCENTS:
```ts
// ROLE_LABELS 新增:
analyst: "分析师",
designer: "设计师",
secretary: "秘书",
summarizer: "撰稿人",

// ROLE_ACCENTS 新增:
analyst: "#8b5cf6",
designer: "#6366f1",
secretary: "#a78bfa",
summarizer: "#bc6b4a",
```

---

## WP4: 前端布局重构 — 双核心

### 目标
从 4 Tab 三栏布局收敛为"对话 + 可视化"双核心，配置项收入统一抽屉。

### 4.1 核心原则

```
永远可见 (L0): 对话流 + 右栏可视化
一键可达 (L1): Agent/团队切换 + 线程列表
配置抽屉 (L2): Agent管理、团队模板、任务、运营、定时、设置
删除 (L3):     Hero Card、Squad Deck、Mission Grid、Toolbar 文案
```

### 4.2 动态右栏规则

```ts
const isTeam = activeWorkspaceKey.startsWith("team:");

// 右栏内容:
if (isTeam) {
  // 团队模式 → VillageScene (小镇)
  <VillageScene template={teamTemplate} ... />
} else {
  // 单 Agent → 精灵全身像
  <AvatarPanel spritePackId={spritePackId} expression={agentExpression} agentName={agentName} />
}
```

### 4.3 新建 `webchat/src/components/AgentSwitcher.tsx` (~80 行)

左栏顶部的 Agent/团队选择器:
```tsx
// 下拉列表，分两组:
// ── 个人助手 ──
//   默认助手 (Aria)
//   研究员 (Atlas)
//   程序员 (Coda)
//   ...
// ── 团队 ──
//   办公小队 🏢
//   创作小队 🎨
//   开发小队 🏗️
//   ...
// ── 管理 ──
//   + 创建新 Agent
//   + 安装团队模板

// 数据来源: GET /api/agents/presets + GET /api/profiles + GET /api/teams
// 切换时调用 workspace.switchWorkspace(selectedKey)
```

### 4.4 新建 `webchat/src/components/ConfigDrawer.tsx` ✅ 已完成

统一配置抽屉，⚙️ 按钮触发，5 个 Tab:

| Tab | 组件 | 说明 |
|-----|------|------|
| 团队 | `TeamPanel` | Agent/团队 CRUD + 模板安装 |
| 任务 | `TasksPanel` | JaMOSS 任务看板 |
| 运营 | `OpsSidebar` | Agent 概览/动态/任务 |
| 定时 | `CronPanel` | 定时任务管理 |
| 设置 | 占位 | 即将上线 |

**注意**: 数字之城不在 ConfigDrawer 内，而是作为独立的顶级模式。

### 4.5 新建 `webchat/src/components/ModeBar.tsx` ✅ 已完成

替换 4-Tab NavRail 的极简模式切换条:

- 桌面端: 52px 竖向侧栏 (品牌标 + 工作台/城市切换 + ⚙️ + 连接状态 + 头像)
- 移动端: 底部 3 列 bar (工作台 / 城市 / 配置)

### 4.6 重构 `App.tsx` ✅ 已完成

```tsx
export default function App() {
    // ...existing hooks...
    const ui = useUIShell(); // mode: "workspace" | "city"

    if (!ocToken) return <SetupGate onReady={handleGateReady} />;

    return (
        <div className="app-layout">
            <ModeBar
                mode={ui.mode}
                onModeChange={ui.setMode}
                compact={ui.compact}
                connState={conversation.connState}
                onToggleConfig={ui.toggleConfigDrawer}
            />
            <div className="app-main">
                {ui.mode === "workspace" && (
                    <WorkbenchView ui={workbenchUI} workspace={workbenchWorkspace}
                                   conversation={conversation} ops={ops} />
                )}
                {ui.mode === "city" && (
                    <Suspense fallback={...}>
                        {MAPBOX_TOKEN
                            ? <DigitalCityPanel mapboxToken={MAPBOX_TOKEN} />
                            : <div>尚未配置 MAPBOX_TOKEN</div>}
                    </Suspense>
                )}
            </div>
            <ConfigDrawer
                open={ui.configDrawerOpen}
                onClose={ui.closeConfigDrawer}
                activeSessionKey={workspace.activeWorkspaceKey}
                onSwitchTeam={workspace.switchWorkspace}
                opsLens={ui.opsLens}
                onOpsLensChange={ui.setOpsLens}
                ops={ops}
            />
        </div>
    );
}
```

### 4.7 废弃/降级的组件 ✅ 已完成

| 组件 | 处理 |
|------|------|
| `NavRail.tsx` | 由 `ModeBar.tsx` 替代（文件保留但不再 import） |
| `TasksView.tsx` | `TasksPanel` 移入 ConfigDrawer（文件保留） |
| `TeamStudioView.tsx` | `TeamPanel` 移入 ConfigDrawer（文件保留） |
| `ObserveView.tsx` | 世界观测保留待复用，城市已提升为顶级模式（文件保留） |
| `WorkbenchView.tsx` 的 Hero/Squad/Mission | ✅ 已删除，保留 Thread + Chat + Ops 核心 |
| `OpsSidebar.tsx` | 保留，同时在 WorkbenchView 右栏和 ConfigDrawer 中使用 |

### 4.8 移动端适配

```
移动端 (ui.compact):
  工作台模式: 全屏对话 + 底部 Composer + 右栏收入 drawer
  城市模式: 全屏 Mapbox + HUD 叠加层
  底部 bar: 工作台 | 城市 | 配置 (3 列)
  ConfigDrawer: 92vw 宽度，右滑入
```

---

## WP5: 前端事件消费 — SSE + 小镇驱动

### 目标
让小镇 VillageScene 由真实事件驱动，而不是模拟动画。

### 5.1 新建 `webchat/src/hooks/useActivityStream.ts` (~60 行)

```ts
export interface ActivityStreamEvent {
    kind: "task_create" | "task_claim" | "task_start" | "task_complete" | "task_failed" | "task_timeout";
    taskId: string;
    agentId: string;
    agentName: string;
    detail: string | null;
    ts: string;
}

export function useActivityStream(): {
    events: ActivityStreamEvent[];
    connected: boolean;
} {
    // EventSource 连接 GET /api/activity/stream?token=AUTH_TOKEN
    // 解析 data: JSON → ActivityStreamEvent
    // 维护最近 50 条事件环形缓冲
    // 组件卸载时 close EventSource
}
```

### 5.2 修改 `webchat/src/village/VillageBridge.ts`

增加 SSE 事件源支持 (~20 行):

```ts
// 新增转换函数
function sseEventToVillageEvent(sseEvent: ActivityStreamEvent): VillageActivityEvent {
    return {
        kind: sseEvent.kind as VillageEventKind,
        agentId: sseEvent.agentId,
        agentName: sseEvent.agentName,
        detailText: sseEvent.detail,
        timestamp: sseEvent.ts,
        story: `${sseEvent.agentName} ${describeEventKind(sseEvent.kind)}`,
    };
}

// useVillageBridge 签名扩展
export function useVillageBridge(
    template: TeamTemplate,
    agentSummaries: AgentSummary[],
    activities: TranslatedActivity[],
    _dashboardStats: DashboardStats | null,
    sseEvents?: ActivityStreamEvent[],  // 🆕
): UseVillageBridgeResult
```

在 `eventsByAgent` 的 useMemo 中，优先使用 sseEvents:
```ts
const eventsByAgent = useMemo(() => {
    const events = new Map<string, VillageActivityEvent>();

    // 优先 SSE 事件 (如果有)
    if (sseEvents) {
        for (const sse of sseEvents) {
            const event = sseEventToVillageEvent(sse);
            events.set(normalizeToken(event.agentId), event);
        }
    }

    // fallback 到现有 activities (向后兼容)
    for (const activity of activities) {
        const event = activityToEvent(activity);
        if (!event) continue;
        const key = normalizeToken(event.agentId);
        if (!events.has(key)) events.set(key, event);
    }

    return events;
}, [activities, sseEvents]);
```

### 5.3 crops 农田进度映射

修改 `webchat/src/village/VillageMap.ts` — `buildCropPlots()`:

```ts
export interface CropPlot {
    index: number;
    position: VillagePoint;
    stage: "empty" | "seed" | "grow" | "ripe" | "dead";
    taskId?: string;
    label?: string;
}

// task status → crop stage 映射:
// pending/assigned → "seed"
// running → "grow"
// done → "ripe"
// failed/timeout → "dead"
// 无 task → "empty"
```

对应 CSS 动画:
```css
.crop-plot--seed  { /* 种子图标 + 微弹跳 */ }
.crop-plot--grow  { /* 绿芽 + 上下摇摆动画 */ }
.crop-plot--ripe  { /* 金色麦穗 + 光晕 */ }
.crop-plot--dead  { /* 灰色枯萎 */ }
```

---

## 三、验证清单

| 场景 | 预期效果 | 涉及 WP |
|------|---------|---------|
| 单 Agent 对话 | 左栏对话 + 右栏精灵全身像，表情跟随 streaming 状态 | WP3, WP4 |
| 切换到团队 | 右栏自动变为 VillageScene 小镇 | WP3, WP4 |
| 团队对话 - 群聊 | 消息带角色徽章 + 成员名字 (Leader/分析师/写作) | WP1 |
| 团队对话 - 小镇移动 | Agent 从营火走到对应 Zone (书屋/工坊) | WP1, WP5 |
| 创建 task | POST /api/tasks → SSE 推 task_create → Agent 走到 hq | WP2, WP5 |
| task 完成 | Agent 走到广场庆祝 + crops 变成熟 | WP2, WP5 |
| task 超时 | Watchdog 检测 → 自动 retry 或 fail | WP2 |
| 工作流接力 | Stage A 完成 → 自动创建 Stage B task | WP2 |
| ⚙️ 配置 | 打开抽屉，上下文敏感显示 Agent/团队设置 | WP4 |
| 移动端 | 全屏对话，右栏收起，⚙️ 进抽屉 | WP4 |

## 四、实施顺序

```
Week 1: WP1 (sender) + WP2 (后端) + WP3 (配置)  ← 全并行
Week 2: WP4 (前端布局) + WP5 (SSE消费)           ← 依赖 WP1+WP2
Week 2: 集成测试 + 移动端适配
```

## 五、文件改动索引

### 新建文件
```
deploy/sql/015_tasks.sql
deploy/sql/016_workflows.sql
gateway/internal/task/store.go
gateway/internal/task/status.go
gateway/internal/workflow/engine.go
gateway/internal/workflow/runner.go
gateway/internal/scheduler/scheduler.go
gateway/internal/scheduler/dispatch.go
gateway/internal/scheduler/watchdog.go
gateway/internal/scheduler/eventbus.go
pi-config/team-templates/office-pod.json
pi-config/team-templates/creative-pod.json
pi-config/team-templates/ops-pod.json
webchat/src/components/AgentSwitcher.tsx
webchat/src/components/ConfigDrawer.tsx
webchat/src/components/AvatarPanel.tsx
webchat/src/hooks/useActivityStream.ts
```

### 修改文件
```
gateway/internal/pi/translator.go          (WP1: +sender 提取)
gateway/internal/pi/config.go              (WP3: AgentPreset +SpritePackId)
gateway/internal/agent/ws_handler.go       (WP2: +agent_end hook)
gateway/cmd/oc-gateway/main.go             (WP2: +路由 +Scheduler 初始化)
pi-config/agents.json                      (WP3: 4→8 角色)
webchat/src/lib/event-parser.ts            (WP1: +sender)
webchat/src/hooks/useConversation.ts       (WP1: +sender 暂存)
webchat/src/lib/sprite-packs.ts            (WP3: +映射)
webchat/src/village/VillageZone.ts         (WP3: +角色别名)
webchat/src/village/VillageAgent.ts        (WP3: +角色标签)
webchat/src/village/VillageBridge.ts       (WP5: +SSE 事件源)
webchat/src/village/VillageMap.ts          (WP5: +crops 进度)
webchat/src/App.tsx                        (WP4: 布局重构)
```

### 删除文件/组件
```
webchat/src/components/NavRail.tsx          (WP4: 删除 4-Tab 导航)
webchat/src/components/TasksView.tsx        (WP4: 移入 ConfigDrawer)
webchat/src/components/TeamStudioView.tsx   (WP4: 拆分到 AgentSwitcher + ConfigDrawer)
webchat/src/components/ObserveView.tsx      (WP4: 移入 ConfigDrawer)
```
