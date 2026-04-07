# WebChat 从 Legacy JaMOSS 切换到 VM 真服务

## 目标
- 不再兼容 legacy JaMOSS 接口。
- 先隔离并下线旧链路（可回滚，不直接删除）。
- 以 VM 真实能力重建任务/观测数据面。

## Phase 1: 隔离下线（已完成）
- 前端默认关闭 legacy JaMOSS 请求：`window.__ENABLE_LEGACY_JAMOSS__ !== true` 时不发 `/api/jamoss/*`。
- 任务与观测页面降级为空态，不阻塞主链路（会话、团队、WS、VNC、上传、Cron）。
- 保留开关，必要时可临时打开旧链路做对比回放。

## Phase 2: VM 数据面替换（进行中）
- 在 oc-gateway 增加 VM 原生聚合 API（建议）：
  - `GET /api/vm/ops/overview`
  - `GET /api/vm/ops/tasks`
  - `GET /api/vm/ops/agents`
  - `GET /api/vm/ops/activity`
- 数据来源：
  - `pi-ws-wrapper` 事件流（chat/tool/task）
  - VM 内任务文件或状态索引（例如 `taskplane` 输出）
  - 团队配置（`/api/teams`）

## Phase 3: 前端接线
- `TasksPanel` 从 `jamoss.ts` 切到 `vm-ops.ts`。
- `ObserveView`/`AgentObservatory` 从 `feed.ts` 切到 `vm-activity.ts`。
- `OpsSidebar`/`OpsTaskSummary` 统一读取 VM ops store。

## Phase 4: 下线完成
- 关掉 oc-gateway 的 `/api/jamoss/*` 路由。
- 删除前端 legacy 开关和降级逻辑。
- 清理旧文档与旧监控告警项。

## 验收标准
- 主导航每个入口都可交互，无阻断红错。
- 网络面不再出现 `/api/jamoss/*` 请求。
- 任务/观测数据来自 VM 真服务，字段与 UI 对齐。
