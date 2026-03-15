# JMOS Go 重构规划

> OpenClaw 容器内置协作网关 — 为科幻可视化前端提供实时图数据

## 一、定位

```
OpenClaw 容器
├── OpenClaw 运行时 (Node.js, :18789)
│     ├── Agent 对话 (WS 协议)
│     ├── 模型调用 (LLM proxy)
│     ├── Cron 定时唤醒
│     └── 工具调用 (sandbox, Claude Code via sessions_spawn)
│
└── JMOS 协作网关 (Go 单二进制, :6565)
      ├── Agent 注册 + 角色认证 (API Key)
      ├── 任务调度 (Task → Module → SubTask 状态机)
      ├── 审查评分 (ReviewRecord + 积分排行)
      ├── 巡查监控 (PatrolRecord)
      ├── 统一事件流 (event 表 + 增量轮询)
      ├── 空间数据 (力导向图 nodes/edges, Agent 轨道, 心跳脉冲)
      ├── 统计聚合 (趋势图, 桑基图, 效率分析, 热力图)
      └── 规则管理 (三级合并 global/project/task)
```

**实时通道**: 不引入 SSE/WS。Agent 动作通过已有 OpenClaw WS 推送，JMOS 仅提供 REST API + 序列号增量轮询。

## 二、目录结构

```
openclaw/jmos/
  cmd/jmos/main.go                 单入口 (配置加载 + HTTP server)
  internal/
    config/config.go               YAML 配置加载 (兼容原 config.example.yaml)
    model/                         数据模型 (纯 struct, 与 DB schema 对应)
      agent.go
      task.go
      sub_task.go
      module.go
      event.go                     统一事件表 (取代 activity_log + request_log + reward_log)
      review_record.go
      patrol_record.go
      rule.go
    store/                         数据库层 (modernc.org/sqlite)
      db.go                        连接 + 初始化 + 迁移
      agent.go
      task.go
      sub_task.go
      module.go
      event.go
      review.go
      patrol.go
      rule.go
      stats.go                     聚合查询 (overview, timeline, flow, distribution, heatmap)
    service/                       业务逻辑
      agent.go                     注册 + API Key 生成 + 心跳更新
      task.go                      任务 CRUD + 状态推进
      sub_task.go                  子任务 CRUD + 状态机 + 耗时计算
      review.go                    审查 + 评分 + 积分 (事务内)
      patrol.go                    巡查记录
      reward.go                    积分规则 + 增减
      rule.go                      规则 CRUD + 三级合并
      event.go                     事件发布 (所有状态变更 → event 表)
      space.go                     空间数据计算 (graph, pulse, orbits)
    handler/                       HTTP handlers (net/http + chi router)
      middleware.go                RequestID + RequestLog + CORS + PanicRecovery
      auth.go                      Agent API Key 鉴权 + Admin Token 鉴权
      agent.go                     /api/v1/agents/*
      task.go                      /api/v1/tasks/*
      sub_task.go                  /api/v1/sub-tasks/*
      review.go                    /api/v1/reviews/*
      patrol.go                    /api/v1/patrol/*
      score.go                     /api/v1/scores/*
      rule.go                      /api/v1/rules/*
      event.go                     /api/v1/events (增量轮询)
      space.go                     /api/v1/space/* (graph, pulse, orbits)
      stats.go                     /api/v1/stats/* (overview, timeline, flow, distribution)
      admin.go                     /api/v1/admin/* (登录 + 管理端查询)
      health.go                    /api/v1/health
    migrate/                       SQLite schema 迁移
      001_init.sql
  go.mod
  go.sum
  config.example.yaml              配置模板
  Makefile                         构建 (CGO_ENABLED=0 静态二进制)
```

## 三、数据模型

### 3.1 agent

```sql
CREATE TABLE agent (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    role              TEXT NOT NULL,
    description       TEXT DEFAULT '',
    status            TEXT DEFAULT 'idle',       -- idle/thinking/working/reviewing/scanning/offline
    api_key           TEXT UNIQUE NOT NULL,
    total_score       INTEGER DEFAULT 0,
    capabilities      TEXT DEFAULT '',            -- 逗号分隔能力标签
    avatar_seed       TEXT DEFAULT '',            -- 虚拟形象种子 (前端 DiceBear/自定义)
    current_action    TEXT DEFAULT '',            -- "正在编写 auth 模块..."
    current_sub_task_id TEXT,
    current_session_id TEXT,
    last_seen_at      DATETIME,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 3.2 task

```sql
CREATE TABLE task (
    id           TEXT PRIMARY KEY,
    project      TEXT DEFAULT 'default',         -- 多团队隔离键
    name         TEXT NOT NULL,
    description  TEXT DEFAULT '',
    type         TEXT DEFAULT 'once',
    status       TEXT DEFAULT 'planning',         -- planning/active/in_progress/completed/archived/cancelled
    created_by   TEXT,
    deadline     DATETIME,
    tags         TEXT DEFAULT '[]',               -- JSON 数组
    metadata     TEXT DEFAULT '{}',               -- JSON 扩展
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
);
CREATE INDEX idx_task_project_status ON task(project, status);
```

### 3.3 module

```sql
CREATE TABLE module (
    id          TEXT PRIMARY KEY,
    task_id     TEXT NOT NULL REFERENCES task(id),
    name        TEXT NOT NULL,
    description TEXT DEFAULT '',
    sort_order  INTEGER DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 3.4 sub_task

```sql
CREATE TABLE sub_task (
    id                 TEXT PRIMARY KEY,
    task_id            TEXT NOT NULL REFERENCES task(id),
    module_id          TEXT REFERENCES module(id),
    name               TEXT NOT NULL,
    description        TEXT DEFAULT '',
    deliverable        TEXT DEFAULT '',
    acceptance         TEXT DEFAULT '',
    type               TEXT DEFAULT 'once',
    status             TEXT DEFAULT 'pending',
    priority           TEXT DEFAULT 'medium',     -- critical/high/medium/low
    assigned_agent     TEXT REFERENCES agent(id),
    current_session_id TEXT,
    rework_count       INTEGER DEFAULT 0,
    estimated_minutes  INTEGER DEFAULT 0,
    actual_minutes     INTEGER DEFAULT 0,         -- started_at 到 completed_at 自动结算
    recurring_config   TEXT DEFAULT '{}',          -- JSON: 循环任务配置 (兼容 Python 版)
    tags               TEXT DEFAULT '[]',
    deadline           DATETIME,
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at         DATETIME,                  -- 首次 start 时写入, 不覆盖
    completed_at       DATETIME                   -- done 时写入, 同时结算 actual_minutes
);
CREATE INDEX idx_sub_task_task ON sub_task(task_id);
CREATE INDEX idx_sub_task_status ON sub_task(status);
CREATE INDEX idx_sub_task_agent_status ON sub_task(assigned_agent, status);
```

### 3.5 event (前端增量同步 + 动画驱动)

**定位**: 前端增量同步/动画投影表。不替代 request_log/review_record 等结构化查询表。
只记录领域事件 (状态流转、审查、巡查、评分)，不记录 heartbeat 和 HTTP 请求日志。

```sql
CREATE TABLE event (
    seq         INTEGER PRIMARY KEY AUTOINCREMENT,  -- SQLite 生成, 单调递增
    event_id    TEXT UNIQUE NOT NULL,               -- 业务 UUID
    project     TEXT DEFAULT '',                    -- 多团队隔离
    type        TEXT NOT NULL,                      -- transition/review/patrol/score/system
    actor_id    TEXT,
    actor_name  TEXT,
    actor_role  TEXT,
    task_id     TEXT,                               -- 显式列, 避免 JSON 查询
    sub_task_id TEXT,
    session_id  TEXT,
    target_type TEXT,                               -- task/sub_task/agent
    target_id   TEXT,
    target_name TEXT,
    action      TEXT NOT NULL,
    from_status TEXT DEFAULT '',
    to_status   TEXT DEFAULT '',
    summary     TEXT DEFAULT '',
    payload     TEXT DEFAULT '{}',
    visual      TEXT DEFAULT '{}',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_event_type ON event(type);
CREATE INDEX idx_event_project ON event(project);
CREATE INDEX idx_event_actor ON event(actor_id);
CREATE INDEX idx_event_target ON event(target_type, target_id);
CREATE INDEX idx_event_created ON event(created_at);
```

**关键设计决策**:
- seq 由 SQLite AUTOINCREMENT 生成，不在应用层维护
- 事件写入**必须与业务写入在同一事务内**，保证一致性
- heartbeat 不写 event 表，只更新 agent 表字段
- request_log 保留独立表（高频写入 + 结构化查询）

**visual 字段** — 事件自带前端动画提示:
```json
{
  "particleColor": "#00ff88",
  "trail": "executor→reviewer",
  "intensity": 0.8,
  "sound": "submit",
  "glow": true
}
```

### 3.6 review_record

```sql
CREATE TABLE review_record (
    id              TEXT PRIMARY KEY,
    sub_task_id     TEXT NOT NULL REFERENCES sub_task(id),
    reviewer_agent  TEXT NOT NULL REFERENCES agent(id),
    round           INTEGER NOT NULL,
    result          TEXT NOT NULL,              -- approved/rejected
    score           INTEGER NOT NULL,           -- 1-5
    issues          TEXT DEFAULT '',
    comment         TEXT DEFAULT '',
    rework_agent    TEXT REFERENCES agent(id),
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_review_sub_task ON review_record(sub_task_id);
```

### 3.7 patrol_record

```sql
CREATE TABLE patrol_record (
    id           TEXT PRIMARY KEY,
    type         TEXT NOT NULL,                 -- timeout/stuck/orphan/rework_overflow/score_drop
    severity     TEXT NOT NULL,                 -- warning/critical
    sub_task_id  TEXT REFERENCES sub_task(id),
    agent_id     TEXT REFERENCES agent(id),
    description  TEXT NOT NULL,
    action_taken TEXT DEFAULT '',
    status       TEXT DEFAULT 'open',           -- open/resolved/ignored
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at  DATETIME
);
CREATE INDEX idx_patrol_status ON patrol_record(status);
```

### 3.8 rule

```sql
CREATE TABLE rule (
    id          TEXT PRIMARY KEY,
    scope       TEXT NOT NULL,                  -- global/project/task/sub_task
    project     TEXT DEFAULT '',                -- project 级别时填
    task_id     TEXT REFERENCES task(id),
    sub_task_id TEXT REFERENCES sub_task(id),   -- sub_task 级别时填
    content     TEXT NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_rule_scope ON rule(scope);
```

### 3.9 request_log (保留独立表, 不进 event)

```sql
CREATE TABLE request_log (
    id              TEXT PRIMARY KEY,
    timestamp       DATETIME DEFAULT CURRENT_TIMESTAMP,
    method          TEXT NOT NULL,
    path            TEXT NOT NULL,
    agent_id        TEXT,
    agent_name      TEXT,
    agent_role      TEXT,
    request_body    TEXT,
    response_status INTEGER
);
CREATE INDEX idx_request_log_timestamp ON request_log(timestamp);
CREATE INDEX idx_request_log_agent ON request_log(agent_id);
CREATE INDEX idx_request_log_path ON request_log(path);
```

### 3.10 activity_log (兼容 Python 版, Agent 手动写日志)

```sql
CREATE TABLE activity_log (
    id          TEXT PRIMARY KEY,
    agent_id    TEXT NOT NULL REFERENCES agent(id),
    sub_task_id TEXT REFERENCES sub_task(id),
    action      TEXT NOT NULL,
    summary     TEXT DEFAULT '',
    session_id  TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_activity_log_agent ON activity_log(agent_id);
CREATE INDEX idx_activity_log_action ON activity_log(action);
```

## 四、API 设计

### 4.1 空间层 (驱动科幻可视化)

```
GET /api/v1/space/graph?project=
  → 力导向图初始数据 (agent-centric, task 作为轨道粒子)
  {
    nodes: [{
      id, type: "agent",
      label, role, avatar_seed,
      state: "idle"|"thinking"|"working"|"reviewing"|"scanning"|"offline",
      energy: 0-100,
      stats: { completed, avgScore, reworkRate, activeMinutes }
    }],
    edges: [{
      source, target,                -- agent→agent (协作边)
      type: "assign"|"submit"|"review"|"alert",
      weight,                        -- 交互频次 → 线条粗细
      last_active                    -- 最后活跃 → 线条亮度
    }],
    latest_seq: N,                   -- 与 events 增量轮询对齐
    generated_at: "2026-03-15T..."
  }

GET /api/v1/space/pulse
  → Agent 实时心跳, 前端 3s 轮询
  {
    agents: [{
      id, state, current_action,
      sub_task_id, sub_task_name,
      last_seen, energy,
      metrics: { today_completed, today_reviewed, active_minutes }
    }],
    server_time: "...",
    offline_threshold_seconds: 300
  }

GET /api/v1/space/orbits?agent_id=
  → 围绕 Agent 的子任务轨道粒子
  [{
    agent_id,
    orbits: [{
      sub_task_id, name, status, priority,
      orbit_radius,                  -- priority → 轨道半径 (critical=近)
      pulse: true|false              -- review/blocked/rework 时闪烁
    }]
  }]
```

### 4.2 事件流 (驱动动画)

```
GET /api/v1/events?after_seq=N&limit=50
  → 增量拉取, 前端 3s 轮询 (与 pulse 合并请求)
  {
    events: [...],
    latest_seq: N,
    has_more: bool,
    next_after_seq: N
  }
```

### 4.3 统计层 (仪表盘)

```
GET /api/v1/stats/overview?project=
  → 总览卡片
  {
    total_tasks, active_tasks,
    total_sub_tasks, sub_task_by_status: {pending:N, in_progress:N, ...},
    total_agents, online_agents,
    top_score, avg_score,
    today_completed, today_created
  }

GET /api/v1/stats/timeline?project=&days=7&bucket=hour
  → 趋势图 (按小时/天聚合)
  [{
    bucket: "2026-03-15T10:00:00Z",
    created: N, completed: N, reviewed: N, rejected: N
  }]

GET /api/v1/stats/flow?project=&days=7
  → 桑基图 (状态流转统计)
  [{
    from: "pending", to: "assigned", count: N
  }]

GET /api/v1/stats/distribution?project=
  → 子任务状态分布 (饼图)
  { pending: N, assigned: N, in_progress: N, review: N, done: N, ... }

GET /api/v1/stats/agents?project=
  → Agent 效率排行
  [{
    id, name, role, total_score, energy,
    completed_count, avg_minutes, rework_rate, avg_review_score,
    rank
  }]

GET /api/v1/stats/agent-heatmap?agent_id=&days=14
  → 7x24 活跃热力图 (前端 GitHub-style)
  [[hour0_count, hour1_count, ...], ...]  -- 7 days × 24 hours
```

### 4.4 数据层 (Agent CLI 调用 + 详情面板)

```
-- Agent 注册 & 管理 --
POST   /api/v1/agents/register         Agent 自注册 (X-Registration-Token)
POST   /api/v1/agents                  管理员创建 Agent
GET    /api/v1/agents                  Agent 列表
GET    /api/v1/agents/:id              Agent 详情
PUT    /api/v1/agents/:id/status       更新 Agent 状态
POST   /api/v1/agents/:id/pulse        Agent 上报心跳 + 当前动作
GET    /api/v1/agents/:id/profile      Agent 画像 (stats + scoreHistory + recentEvents)

-- 任务 --
POST   /api/v1/tasks                   创建任务
GET    /api/v1/tasks?project=&status=  任务列表 (含子任务统计内联)
GET    /api/v1/tasks/:id               任务详情
PUT    /api/v1/tasks/:id               编辑任务
PUT    /api/v1/tasks/:id/status        更新任务状态
POST   /api/v1/tasks/:id/cancel        取消任务
POST   /api/v1/tasks/:id/modules       创建模块
GET    /api/v1/tasks/:id/modules       模块列表
GET    /api/v1/tasks/:id/board         看板视图 (按 module 分列, 子任务按状态分组)

-- 子任务 --
POST   /api/v1/sub-tasks               创建子任务
GET    /api/v1/sub-tasks?task_id=&status=  子任务列表
GET    /api/v1/sub-tasks/mine           我的子任务
GET    /api/v1/sub-tasks/available      待认领的子任务
GET    /api/v1/sub-tasks/latest?task_id= 最新子任务 (唤醒后快速定位)
GET    /api/v1/sub-tasks/:id            子任务详情
PUT    /api/v1/sub-tasks/:id            编辑子任务
POST   /api/v1/sub-tasks/:id/claim      认领 (pending → assigned)
POST   /api/v1/sub-tasks/:id/start      开始 (assigned/rework → in_progress)
POST   /api/v1/sub-tasks/:id/submit     提交 (in_progress → review)
POST   /api/v1/sub-tasks/:id/complete   通过 (review → done)
POST   /api/v1/sub-tasks/:id/rework     驳回 (review → rework)
POST   /api/v1/sub-tasks/:id/block      标记异常 (→ blocked)
POST   /api/v1/sub-tasks/:id/reassign   重新分配 (blocked → assigned)
POST   /api/v1/sub-tasks/:id/cancel     取消
POST   /api/v1/sub-tasks/:id/session    更新会话 ID

-- 审查 --
POST   /api/v1/reviews                 提交审查 (先记后改, 事务内)
GET    /api/v1/reviews?sub_task_id=    审查记录列表
GET    /api/v1/reviews/:id             审查记录详情

-- 积分 --
GET    /api/v1/scores/leaderboard      排行榜
GET    /api/v1/scores/me               我的积分概要
GET    /api/v1/scores/me/logs          我的积分明细
GET    /api/v1/scores/:agent_id        Agent 积分概要
GET    /api/v1/scores/:agent_id/logs   积分明细
POST   /api/v1/scores/adjust           手动调整积分

-- 巡查 --
POST   /api/v1/patrol/report           提交巡查记录
GET    /api/v1/patrol/active           当前未解决告警
GET    /api/v1/patrol?status=          巡查记录列表

-- 规则 --
GET    /api/v1/rules                   获取合并规则 (global + project + task)
GET    /api/v1/rules/list              规则列表 (管理端)
POST   /api/v1/rules                   创建规则
PUT    /api/v1/rules/:id               更新规则
DELETE /api/v1/rules/:id               删除规则

-- 日志 (兼容原 task-cli.py) --
POST   /api/v1/logs                    Agent 写活动日志
GET    /api/v1/logs?agent_id=&action=  活动日志列表
GET    /api/v1/logs/mine               我的活动日志

-- 管理端 --
POST   /api/v1/admin/login             管理员登录
GET    /api/v1/admin/tasks             管理端任务列表 (丰富过滤+排序)
GET    /api/v1/admin/tasks/:id         管理端任务详情
GET    /api/v1/admin/tasks/:id/sub-tasks  管理端子任务列表
GET    /api/v1/admin/tasks/:id/modules 管理端模块列表
GET    /api/v1/admin/modules/:id       管理端模块详情
GET    /api/v1/admin/modules/:id/sub-tasks  模块下子任务列表
GET    /api/v1/admin/sub-tasks         全局子任务列表
GET    /api/v1/admin/sub-tasks/:id     管理端子任务详情
GET    /api/v1/admin/agents            管理端 Agent 列表
GET    /api/v1/admin/agents/:id        管理端 Agent 详情
POST   /api/v1/admin/agents            管理端创建 Agent
PUT    /api/v1/admin/agents/:id/status 管理端更新 Agent 状态
POST   /api/v1/admin/agents/:id/reset-key  重置 API Key
GET    /api/v1/admin/agents/:id/score-logs     Agent 积分明细
GET    /api/v1/admin/agents/:id/activity-logs  Agent 活动日志
GET    /api/v1/admin/agents/:id/request-logs   Agent 请求日志

-- Feed (公开展示页, 兼容 Python 版) --
GET    /api/v1/feed/status             展示页开关状态
GET    /api/v1/feed/logs               请求日志列表 (受开关控制)
GET    /api/v1/feed/agents             Agent 列表 (受开关控制)
GET    /api/v1/feed/agent-summary      Agent 汇总面板

-- 健康检查 --
GET    /api/v1/health
GET    /api/v1/config/notification     Agent 获取通知渠道配置
```

**路由兼容**: `/api/*` 和 `/api/v1/*` 双挂载 (同一 handler), 不做 30x 重定向, 确保旧 task-cli.py 无需修改。

## 五、子任务状态机

```
pending ──→ assigned ──→ in_progress ──→ review ──→ done (终态)
  ↑            │  ↑           │             │
  │            │  └───────────┘             │
  │            ↓  (start)                   ↓
  │         pending (退回)              rework ──→ in_progress
  │                                         
  └──────── blocked (巡查标记) ←── in_progress/assigned/rework
                │
                └──→ assigned (规划师重新分配)

cancelled (终态, 任何非终态均可取消)
```

## 六、事件发布机制

所有状态变更操作在 service 层完成后，调用 `event.Publish()`:

```go
// service/event.go
func (s *EventService) Publish(ctx context.Context, e PublishParams) error {
    seq := s.nextSeq()  // atomic increment
    event := &model.Event{
        ID:         uuid.NewString(),
        Seq:        seq,
        Type:       e.Type,
        ActorID:    e.ActorID,
        ActorName:  e.ActorName,
        ActorRole:  e.ActorRole,
        TargetType: e.TargetType,
        TargetID:   e.TargetID,
        TargetName: e.TargetName,
        Action:     e.Action,
        FromStatus: e.FromStatus,
        ToStatus:   e.ToStatus,
        Summary:    e.Summary,
        Payload:    e.Payload,    // JSON string
        Visual:     e.Visual,     // JSON string, 前端动画提示
    }
    return s.store.InsertEvent(ctx, event)
}
```

**Visual 预设** (按 action 自动填充):
```go
var visualPresets = map[string]Visual{
    "claim":    {Color: "#00ff88", Trail: "task→agent", Intensity: 0.6, Sound: "claim"},
    "start":    {Color: "#00aaff", Glow: true, Intensity: 0.7},
    "submit":   {Color: "#ffaa00", Trail: "agent→reviewer", Intensity: 0.8, Sound: "submit"},
    "approve":  {Color: "#00ff88", Glow: true, Intensity: 1.0, Sound: "approve"},
    "reject":   {Color: "#ff4444", Trail: "reviewer→agent", Intensity: 0.9, Sound: "reject"},
    "block":    {Color: "#ff4444", Glow: true, Intensity: 1.0, Sound: "alert"},
    "alert":    {Color: "#ff8800", Glow: true, Intensity: 0.8, Sound: "alert"},
}
```

## 七、空间数据计算

### 7.1 Graph (初始化)

```go
// service/space.go
func (s *SpaceService) BuildGraph(ctx context.Context, project string) (*SpaceGraph, error) {
    agents := s.store.ListAgents(ctx)
    
    nodes := make([]GraphNode, 0)
    for _, a := range agents {
        nodes = append(nodes, GraphNode{
            ID:       a.ID,
            Type:     "agent",
            Label:    a.Name,
            Role:     a.Role,
            Avatar:   a.AvatarSeed,
            State:    a.Status,
            Energy:   s.calcEnergy(a),        // total_score → 0~100 映射
            Stats:    s.calcAgentStats(ctx, a.ID),
        })
    }
    
    // edges 从 event 表聚合: 最近 7 天 actor→target 的交互
    edges := s.store.AggregateInteractions(ctx, project, 7)
    
    return &SpaceGraph{Nodes: nodes, Edges: edges}, nil
}
```

### 7.2 Pulse (3s 轮询)

极轻量查询: `SELECT id, status, current_action, current_sub_task_id, last_seen_at FROM agent`

### 7.3 Orbits (按需)

```sql
SELECT id, name, status, priority
FROM sub_task
WHERE assigned_agent = ? AND status NOT IN ('done', 'cancelled')
ORDER BY
  CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END
```

## 八、Agent 心跳机制

Agent 通过 Cron 唤醒时，主动上报心跳:

```
POST /api/v1/agents/:id/pulse
{
  "state": "working",
  "action": "正在编写用户认证模块",
  "sub_task_id": "xxx",
  "session_id": "yyy"
}
```

JMOS 更新 agent 表的 status, current_action, current_sub_task_id, current_session_id, last_seen_at。

前端通过 `/space/pulse` 轮询获取, 驱动节点动画:
- last_seen > 5min → 自动标记 offline, 节点变暗
- state=working → 绿色旋转粒子
- state=reviewing → 蓝色扫描线
- state=thinking → 脉冲扩散波

## 九、依赖

```
go 1.22+

modernc.org/sqlite          纯 Go SQLite (无 CGO)
github.com/go-chi/chi/v5    HTTP 路由
github.com/google/uuid      UUID 生成
github.com/rs/zerolog        结构化日志 (与 gateway 一致)
gopkg.in/yaml.v3            配置文件解析
```

## 十、构建 & 部署

```makefile
# 静态二进制 (Linux amd64, 适配 OpenClaw 容器)
build:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
	go build -ldflags="-s -w" -o bin/jmos ./cmd/jmos

# 本地开发
dev:
	go run ./cmd/jmos --config config.yaml
```

部署到容器只需:
```go
// gateway jamoss.go 简化为:
func (c *Client) InstallJMOS(containerName string) error {
    // 1. 复制 jmos 二进制到容器
    c.rt.WriteFile(ctx, containerName, "/usr/local/bin/jmos", binary)
    c.rt.Exec(ctx, containerName, "chmod", "+x", "/usr/local/bin/jmos")
    // 2. 复制配置
    c.rt.WriteFile(ctx, containerName, "/etc/jmos/config.yaml", configYAML)
    // 3. 启动
    c.rt.Exec(ctx, containerName, "sh", "-c", "nohup jmos --config /etc/jmos/config.yaml &")
    return nil
}
```

## 十一、兼容性

### 11.1 task-cli.py 兼容

API 路径从 `/api/` 改为 `/api/v1/`, 但保留 `/api/` 作为别名重定向, 让现有 task-cli.py 无需修改即可工作。

### 11.2 webchat jamoss.ts 兼容

oc-gateway 代理路径 `/api/jamoss/*` 不变, 内部转发到容器 :6565。webchat 的 jamoss.ts 只需新增 space/stats 调用。

### 11.3 配置文件兼容

保持 config.yaml 格式与 Python 版一致, 新增字段使用合理默认值。

## 十二、实施阶段

### Phase 1: 基础骨架
- [x] go.mod + 依赖
- [x] config 加载
- [x] SQLite 连接 + schema 迁移
- [x] model 定义
- [x] HTTP server + 路由框架 + 中间件
- [x] 健康检查 /api/v1/health

### Phase 2: 核心 CRUD (对标 Python 版)
- [x] Agent 注册/认证/列表
- [x] Task CRUD + 状态
- [x] SubTask CRUD + 状态机
- [x] Module CRUD
- [x] 审查 + 积分
- [x] 规则 CRUD + 合并
- [x] 活动日志 (兼容)
- [x] 统一事件发布

### Phase 3: 空间 & 可视化 API
- [x] /space/graph
- [x] /space/pulse
- [x] /space/orbits
- [x] /events 增量轮询
- [x] /stats/* 聚合查询
- [x] Agent profile + heatmap

### Phase 4: 管理端
- [x] Admin 登录
- [x] 管理端任务/子任务/Agent 查询 (分页+过滤+排序)
- [x] Agent 管理 (创建/状态/重置 Key)

### Phase 5: 巡查
- [x] PatrolRecord CRUD
- [x] /patrol/active
