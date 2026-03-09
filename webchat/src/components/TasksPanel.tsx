import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ListTodo,
  Loader,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Trophy,
  Users,
} from "lucide-react";
import { createCronJob, deleteCronJob, listCronJobs, type CronJob } from "../lib/cron";
import {
  fetchDashboardStats,
  fetchSubTaskDetail,
  fetchSubTasks,
  fetchTaskDetail,
  fetchTasks,
  type DashboardStats,
  type PageResponse,
  type SubTaskDetail,
  type SubTaskItem,
  type TaskDetail,
  type TaskItem,
} from "../lib/jamoss";

const TASK_PAGE_SIZE = 8;
const SUB_TASK_PAGE_SIZE = 8;

const TASK_STATUS_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "planning", label: "规划中" },
  { value: "active", label: "进行中" },
  { value: "in_progress", label: "推进中" },
  { value: "completed", label: "已完成" },
  { value: "archived", label: "已归档" },
] as const;

const SUB_TASK_STATUS_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待分配" },
  { value: "assigned", label: "已分配" },
  { value: "in_progress", label: "执行中" },
  { value: "review", label: "待审查" },
  { value: "rework", label: "返工中" },
  { value: "blocked", label: "阻塞" },
  { value: "done", label: "已完成" },
] as const;

const FREQ_PRESETS = [
  { label: "每30分钟", kind: "every", expr: "30m" },
  { label: "每小时", kind: "every", expr: "1h" },
  { label: "每天", kind: "every", expr: "24h" },
  { label: "自定义", kind: "", expr: "" },
] as const;

const CUSTOM_KINDS = [
  { value: "every", label: "间隔", placeholder: "如 5m、2h" },
  { value: "cron", label: "Cron", placeholder: "如 0 9 * * 1-5" },
  { value: "at", label: "定时", placeholder: "如 +30m、2026-03-07T10:00" },
] as const;

const EMPTY_STATS: DashboardStats = {
  totalTasks: 0,
  activeTasks: 0,
  totalAgents: 0,
  topScore: 0,
};

function createEmptyPage<T>(): PageResponse<T> {
  return {
    items: [],
    total: 0,
    page: 1,
    page_size: 0,
    total_pages: 1,
    has_more: false,
  };
}

function formatDateTime(value: string | null): string {
  if (!value) return "未记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未记录";
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatTaskStatus(value: string): string {
  return (
    {
      planning: "规划中",
      active: "进行中",
      in_progress: "推进中",
      completed: "已完成",
      archived: "已归档",
      cancelled: "已取消",
    }[value] ?? value
  );
}

function formatSubTaskStatus(value: string): string {
  return (
    {
      pending: "待分配",
      assigned: "已分配",
      in_progress: "执行中",
      review: "待审查",
      rework: "返工中",
      blocked: "阻塞",
      done: "已完成",
      cancelled: "已取消",
    }[value] ?? value
  );
}

function formatPriority(value: string): string {
  return (
    {
      high: "高优先",
      medium: "中优先",
      low: "低优先",
    }[value] ?? value
  );
}

function toBadgeClass(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

function getProgress(done: number, total: number): number {
  if (!total) return 0;
  return Math.round((done / total) * 100);
}

function formatSchedule(kind: string, expr: string): string {
  if (kind === "every") return `每 ${expr}`;
  if (kind === "cron") return `Cron: ${expr}`;
  if (kind === "at") return `定时: ${expr}`;
  return expr;
}

function formatCronTime(value: string | null): string {
  if (!value) return "从未执行";
  const date = new Date(value);
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function TasksPanel() {
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  const [taskKeyword, setTaskKeyword] = useState("");
  const [taskStatus, setTaskStatus] = useState("all");
  const [taskPage, setTaskPage] = useState(1);
  const [taskPageData, setTaskPageData] = useState<PageResponse<TaskItem>>(createEmptyPage<TaskItem>());
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState<string | null>(null);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [taskDetailLoading, setTaskDetailLoading] = useState(false);
  const [taskDetailError, setTaskDetailError] = useState<string | null>(null);

  const [subTaskStatus, setSubTaskStatus] = useState("all");
  const [subTaskPage, setSubTaskPage] = useState(1);
  const [subTaskPageData, setSubTaskPageData] = useState<PageResponse<SubTaskItem>>(createEmptyPage<SubTaskItem>());
  const [subTasksLoading, setSubTasksLoading] = useState(false);
  const [subTasksError, setSubTasksError] = useState<string | null>(null);

  const [selectedSubTaskId, setSelectedSubTaskId] = useState<string | null>(null);
  const [selectedSubTask, setSelectedSubTask] = useState<SubTaskDetail | null>(null);
  const [subTaskDetailLoading, setSubTaskDetailLoading] = useState(false);
  const [subTaskDetailError, setSubTaskDetailError] = useState<string | null>(null);

  const [cronExpanded, setCronExpanded] = useState(false);
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [cronLoading, setCronLoading] = useState(true);
  const [cronError, setCronError] = useState<string | null>(null);
  const [showCronForm, setShowCronForm] = useState(false);
  const [expandedCronId, setExpandedCronId] = useState<string | null>(null);
  const [cronPrompt, setCronPrompt] = useState("");
  const [cronJobName, setCronJobName] = useState("");
  const [selectedCronPreset, setSelectedCronPreset] = useState(0);
  const [customCronKind, setCustomCronKind] = useState("every");
  const [customCronExpr, setCustomCronExpr] = useState("");
  const [submittingCron, setSubmittingCron] = useState(false);

  const taskListRequestId = useRef(0);
  const taskDetailRequestId = useRef(0);
  const subTaskListRequestId = useRef(0);
  const subTaskDetailRequestId = useRef(0);
  const selectedTaskIdRef = useRef<string | null>(null);
  const selectedSubTaskIdRef = useRef<string | null>(null);

  const selectedTaskProgress = useMemo(() => {
    if (!taskDetail) return 0;
    return getProgress(taskDetail.done_count, taskDetail.sub_task_count);
  }, [taskDetail]);

  const loadDashboard = useCallback(async () => {
    setStatsLoading(true);
    try {
      const next = await fetchDashboardStats();
      setStats(next);
      setStatsError(null);
    } catch {
      setStatsError("统计数据加载失败");
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const loadTasks = useCallback(async () => {
    const requestId = ++taskListRequestId.current;
    setTasksLoading(true);
    try {
      const page = await fetchTasks({
        page: taskPage,
        page_size: TASK_PAGE_SIZE,
        keyword: taskKeyword.trim() || undefined,
        status: taskStatus === "all" ? undefined : taskStatus,
        sort_by: "updated_at",
        sort_order: "desc",
      });

      if (requestId !== taskListRequestId.current) return;

      setTaskPageData(page);
      setTasksError(null);

      if (!page.items.length) {
        setSelectedTaskId(null);
        setTaskDetail(null);
        setSubTaskPageData(createEmptyPage<SubTaskItem>());
        return;
      }

      setSelectedTaskId((prev) => {
        if (prev && page.items.some((item) => item.id === prev)) return prev;
        return page.items[0]?.id || null;
      });
    } catch {
      if (requestId !== taskListRequestId.current) return;
      setTaskPageData(createEmptyPage<TaskItem>());
      setTasksError("任务列表加载失败");
      setSelectedTaskId(null);
      setTaskDetail(null);
      setSubTaskPageData(createEmptyPage<SubTaskItem>());
    } finally {
      if (requestId === taskListRequestId.current) {
        setTasksLoading(false);
      }
    }
  }, [taskKeyword, taskPage, taskStatus]);

  const loadTaskDetail = useCallback(async (taskId: string) => {
    const requestId = ++taskDetailRequestId.current;
    setTaskDetailLoading(true);
    try {
      const detail = await fetchTaskDetail(taskId);
      if (requestId !== taskDetailRequestId.current || selectedTaskIdRef.current !== taskId) return;
      setTaskDetail(detail);
      setTaskDetailError(null);
    } catch {
      if (requestId !== taskDetailRequestId.current) return;
      setTaskDetailError("任务详情加载失败");
      setTaskDetail(null);
    } finally {
      if (requestId === taskDetailRequestId.current) {
        setTaskDetailLoading(false);
      }
    }
  }, []);

  const loadSubTasks = useCallback(async (taskId: string) => {
    const requestId = ++subTaskListRequestId.current;
    setSubTasksLoading(true);
    try {
      const page = await fetchSubTasks(taskId, {
        page: subTaskPage,
        page_size: SUB_TASK_PAGE_SIZE,
        status: subTaskStatus === "all" ? undefined : subTaskStatus,
        sort_by: "updated_at",
        sort_order: "desc",
      });

      if (requestId !== subTaskListRequestId.current || selectedTaskIdRef.current !== taskId) return;
      setSubTaskPageData(page);
      setSubTasksError(null);
    } catch {
      if (requestId !== subTaskListRequestId.current) return;
      setSubTaskPageData(createEmptyPage<SubTaskItem>());
      setSubTasksError("子任务加载失败");
    } finally {
      if (requestId === subTaskListRequestId.current) {
        setSubTasksLoading(false);
      }
    }
  }, [subTaskPage, subTaskStatus]);

  const loadCronJobs = useCallback(async () => {
    setCronLoading(true);
    try {
      const list = await listCronJobs();
      setCronJobs(list);
      setCronError(null);
    } catch {
      setCronError("获取定时任务失败");
    } finally {
      setCronLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    if (!selectedTaskId) return;
    void loadTaskDetail(selectedTaskId);
  }, [loadTaskDetail, selectedTaskId]);

  useEffect(() => {
    selectedTaskIdRef.current = selectedTaskId;
  }, [selectedTaskId]);

  useEffect(() => {
    if (!selectedTaskId) return;
    void loadSubTasks(selectedTaskId);
  }, [loadSubTasks, selectedTaskId]);

  useEffect(() => {
    setSubTaskPage(1);
    setSelectedSubTaskId(null);
    setSelectedSubTask(null);
    setSubTaskDetailError(null);
  }, [selectedTaskId]);

  useEffect(() => {
    selectedSubTaskIdRef.current = selectedSubTaskId;
  }, [selectedSubTaskId]);

  useEffect(() => {
    void loadCronJobs();
  }, [loadCronJobs]);

  const handleRefreshAll = useCallback(() => {
    void loadDashboard();
    void loadTasks();
  }, [loadDashboard, loadTasks]);

  const handleTaskKeywordChange = useCallback((value: string) => {
    setTaskKeyword(value);
    setTaskPage(1);
  }, []);

  const handleTaskStatusChange = useCallback((value: string) => {
    setTaskStatus(value);
    setTaskPage(1);
  }, []);

  const handleSelectTask = useCallback((taskId: string) => {
    setSelectedTaskId((prev) => (prev === taskId ? prev : taskId));
  }, []);

  const handleSelectSubTask = useCallback(async (subTaskId: string) => {
    const requestId = ++subTaskDetailRequestId.current;
    setSelectedSubTaskId(subTaskId);
    setSelectedSubTask(null);
    setSubTaskDetailLoading(true);
    setSubTaskDetailError(null);

    try {
      const detail = await fetchSubTaskDetail(subTaskId);
      if (requestId !== subTaskDetailRequestId.current || selectedSubTaskIdRef.current !== subTaskId) return;
      setSelectedSubTask(detail);
    } catch {
      if (requestId !== subTaskDetailRequestId.current) return;
      setSubTaskDetailError("子任务详情加载失败");
      setSelectedSubTask(null);
    } finally {
      if (requestId === subTaskDetailRequestId.current) {
        setSubTaskDetailLoading(false);
      }
    }
  }, []);

  const isCustomCron = selectedCronPreset === FREQ_PRESETS.length - 1;
  const hasCronSchedule = isCustomCron ? customCronExpr.trim() !== "" : true;
  const canCreateCron = cronPrompt.trim() !== "" && hasCronSchedule && !submittingCron;

  const kindInfo = CUSTOM_KINDS.find((item) => item.value === customCronKind);

  const handleCreateCron = useCallback(async () => {
    const preset = FREQ_PRESETS[selectedCronPreset];
    const kind = isCustomCron ? customCronKind : preset.kind;
    const expr = isCustomCron ? customCronExpr.trim() : preset.expr;

    setSubmittingCron(true);
    try {
      const job = await createCronJob({
        schedule_kind: kind,
        schedule_expr: expr,
        prompt: cronPrompt.trim(),
        name: cronJobName.trim() || undefined,
        delete_after_run: kind === "at",
      });
      setCronJobs((prev) => [job, ...prev]);
      setShowCronForm(false);
      setCronPrompt("");
      setCronJobName("");
      setSelectedCronPreset(0);
      setCustomCronExpr("");
      setCronError(null);
    } catch {
      setCronError("创建定时任务失败");
    } finally {
      setSubmittingCron(false);
    }
  }, [cronJobName, cronPrompt, customCronExpr, customCronKind, isCustomCron, selectedCronPreset]);

  const handleDeleteCron = useCallback(async (id: string) => {
    try {
      await deleteCronJob(id);
      setCronJobs((prev) => prev.filter((job) => job.id !== id));
      if (expandedCronId === id) {
        setExpandedCronId(null);
      }
    } catch {
      setCronError("删除定时任务失败");
    }
  }, [expandedCronId]);

  const statCards = [
    { label: "总任务", value: stats.totalTasks, icon: ListTodo },
    { label: "进行中", value: stats.activeTasks, icon: Activity },
    { label: "Agent 数", value: stats.totalAgents, icon: Users },
    { label: "最高积分", value: stats.topScore, icon: Trophy },
  ];

  return (
    <div className="panel-container tasks-panel">
      <div className="panel-header">
        <ListTodo size={16} />
        <h3>任务管理</h3>
        <button className="panel-refresh-btn" onClick={handleRefreshAll} title="刷新任务与统计">
          <RefreshCw size={14} className={statsLoading || tasksLoading ? "spin-icon" : ""} />
        </button>
      </div>

      <section className="tasks-stats-section">
        <div className="tasks-stats-grid">
          {statCards.map((card) => (
            <article key={card.label} className="tasks-stat-card">
              <div className="tasks-stat-head">
                <span>{card.label}</span>
                <card.icon size={14} />
              </div>
              <strong>{statsLoading ? "--" : card.value.toLocaleString("zh-CN")}</strong>
            </article>
          ))}
        </div>
        {statsError && <div className="panel-error">{statsError}</div>}
      </section>

      <section className="tasks-section">
        <div className="tasks-toolbar">
          <label className="tasks-search">
            <Search size={14} />
            <input
              className="tasks-search-input"
              placeholder="搜索任务名称或描述"
              value={taskKeyword}
              onChange={(event) => handleTaskKeywordChange(event.target.value)}
            />
          </label>
          <div className="tasks-status-filter">
            {TASK_STATUS_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`tasks-chip${taskStatus === option.value ? " active" : ""}`}
                onClick={() => handleTaskStatusChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {tasksError && <div className="panel-error">{tasksError}</div>}

        <div className="tasks-layout">
          <div className="tasks-list">
            {tasksLoading && taskPageData.items.length === 0 ? (
              <div className="panel-loading">
                <Loader size={20} className="spin-icon" />
                <span>加载任务列表...</span>
              </div>
            ) : taskPageData.items.length === 0 ? (
              <div className="panel-empty">
                <ListTodo size={22} />
                <span>暂无匹配任务</span>
              </div>
            ) : (
              <>
                {taskPageData.items.map((task) => {
                  const progress = getProgress(task.done_count, task.sub_task_count);
                  const active = task.id === selectedTaskId;
                  return (
                    <button
                      key={task.id}
                      type="button"
                      className={`task-item${active ? " active" : ""}`}
                      onClick={() => handleSelectTask(task.id)}
                    >
                      <div className="task-item-head">
                        <strong>{task.name || "未命名任务"}</strong>
                        <span className={`status-badge status-badge--task status-badge--${toBadgeClass(task.status)}`}>
                          {formatTaskStatus(task.status)}
                        </span>
                      </div>
                      <p>{task.description || "暂无任务描述"}</p>
                      <div className="task-item-meta">
                        <span>{task.sub_task_count} 子任务</span>
                        <span>{formatDateTime(task.updated_at)}</span>
                      </div>
                      <div className="task-progress-bar">
                        <div style={{ width: `${progress}%` }} />
                      </div>
                    </button>
                  );
                })}

                {taskPageData.total_pages > 1 && (
                  <div className="tasks-pagination">
                    <button
                      type="button"
                      disabled={taskPageData.page <= 1 || tasksLoading}
                      onClick={() => setTaskPage((prev) => Math.max(1, prev - 1))}
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <span>{taskPageData.page} / {taskPageData.total_pages}</span>
                    <button
                      type="button"
                      disabled={taskPageData.page >= taskPageData.total_pages || tasksLoading}
                      onClick={() => setTaskPage((prev) => Math.min(taskPageData.total_pages, prev + 1))}
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="task-detail">
            {!selectedTaskId ? (
              <div className="panel-empty">
                <ListTodo size={22} />
                <span>选择左侧任务查看详情</span>
              </div>
            ) : taskDetailLoading ? (
              <div className="panel-loading">
                <Loader size={20} className="spin-icon" />
                <span>加载任务详情...</span>
              </div>
            ) : taskDetailError || !taskDetail ? (
              <div className="panel-error">{taskDetailError || "任务详情加载失败"}</div>
            ) : (
              <>
                <div className="task-detail-head">
                  <div>
                    <h4>{taskDetail.name}</h4>
                    <p>{taskDetail.description || "暂无任务说明"}</p>
                  </div>
                  <span className={`status-badge status-badge--task status-badge--${toBadgeClass(taskDetail.status)}`}>
                    {formatTaskStatus(taskDetail.status)}
                  </span>
                </div>

                <div className="task-progress-summary">
                  <div className="task-progress-title">
                    <span>完成进度</span>
                    <strong>{selectedTaskProgress}%</strong>
                  </div>
                  <div className="task-progress-track">
                    <div style={{ width: `${selectedTaskProgress}%` }} />
                  </div>
                  <div className="task-count-grid">
                    <span>子任务 {taskDetail.sub_task_count}</span>
                    <span>已完成 {taskDetail.done_count}</span>
                    <span>执行中 {taskDetail.in_progress_count}</span>
                    <span>待审查 {taskDetail.review_count}</span>
                    <span>待分配 {taskDetail.pending_count}</span>
                    <span>返工 {taskDetail.rework_count}</span>
                  </div>
                </div>

                <div className="subtask-section">
                  <div className="subtask-section-head">
                    <h5>子任务列表</h5>
                    <span>{subTaskPageData.total} 项</span>
                  </div>

                  <div className="tasks-status-filter">
                    {SUB_TASK_STATUS_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`tasks-chip${subTaskStatus === option.value ? " active" : ""}`}
                        onClick={() => {
                          setSubTaskStatus(option.value);
                          setSubTaskPage(1);
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>

                  {subTasksError && <div className="panel-error">{subTasksError}</div>}

                  <div className="subtask-list">
                    {subTasksLoading && subTaskPageData.items.length === 0 ? (
                      <div className="panel-loading">
                        <Loader size={18} className="spin-icon" />
                        <span>加载子任务...</span>
                      </div>
                    ) : subTaskPageData.items.length === 0 ? (
                      <div className="panel-empty">
                        <span>暂无子任务</span>
                      </div>
                    ) : (
                      subTaskPageData.items.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`subtask-item${selectedSubTaskId === item.id ? " active" : ""}`}
                          onClick={() => void handleSelectSubTask(item.id)}
                        >
                          <div className="subtask-item-head">
                            <strong>{item.name}</strong>
                            <span className={`status-badge status-badge--subtask status-badge--${toBadgeClass(item.status)}`}>
                              {formatSubTaskStatus(item.status)}
                            </span>
                          </div>
                          <div className="subtask-item-meta">
                            <span className={`status-badge status-badge--priority status-badge--${toBadgeClass(item.priority)}`}>
                              {formatPriority(item.priority)}
                            </span>
                            <span>{item.assigned_agent_name || item.assigned_agent || "未指派"}</span>
                            <span>{formatDateTime(item.updated_at)}</span>
                          </div>
                        </button>
                      ))
                    )}
                  </div>

                  {subTaskPageData.total_pages > 1 && (
                    <div className="tasks-pagination">
                      <button
                        type="button"
                        disabled={subTaskPageData.page <= 1 || subTasksLoading}
                        onClick={() => setSubTaskPage((prev) => Math.max(1, prev - 1))}
                      >
                        <ChevronLeft size={14} />
                      </button>
                      <span>{subTaskPageData.page} / {subTaskPageData.total_pages}</span>
                      <button
                        type="button"
                        disabled={subTaskPageData.page >= subTaskPageData.total_pages || subTasksLoading}
                        onClick={() => setSubTaskPage((prev) => Math.min(subTaskPageData.total_pages, prev + 1))}
                      >
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  )}

                  {selectedSubTaskId && (
                    <div className="subtask-detail">
                      {subTaskDetailLoading ? (
                        <div className="panel-loading">
                          <Loader size={16} className="spin-icon" />
                          <span>加载子任务详情...</span>
                        </div>
                      ) : subTaskDetailError || !selectedSubTask ? (
                        <div className="panel-error">{subTaskDetailError || "子任务详情加载失败"}</div>
                      ) : (
                        <>
                          <div className="subtask-detail-row">
                            <span>交付标准</span>
                            <p>{selectedSubTask.deliverable || "未填写"}</p>
                          </div>
                          <div className="subtask-detail-row">
                            <span>验收标准</span>
                            <p>{selectedSubTask.acceptance || "未填写"}</p>
                          </div>
                          <div className="subtask-detail-meta">
                            <span>Session: {selectedSubTask.current_session_id || "-"}</span>
                            <span>返工次数: {selectedSubTask.rework_count}</span>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="tasks-cron-section">
        <button
          type="button"
          className="tasks-cron-toggle"
          onClick={() => setCronExpanded((prev) => !prev)}
        >
          <div className="tasks-cron-toggle-left">
            <ListTodo size={15} />
            <h4>定时任务</h4>
            <span>{cronJobs.length}</span>
          </div>
          {cronExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {cronExpanded && (
          <div className="tasks-cron-body">
            <div className="tasks-cron-actions">
              <button
                className="panel-add-btn"
                onClick={() => setShowCronForm((prev) => !prev)}
                title={showCronForm ? "取消" : "新建任务"}
              >
                <Plus size={14} className={showCronForm ? "icon-rotated" : ""} />
              </button>
              <button className="panel-refresh-btn" onClick={() => void loadCronJobs()} title="刷新定时任务">
                <RefreshCw size={14} className={cronLoading ? "spin-icon" : ""} />
              </button>
            </div>

            {showCronForm && (
              <div className="cron-form">
                <input
                  className="cron-form-input"
                  placeholder="任务名称 (可选)"
                  value={cronJobName}
                  onChange={(event) => setCronJobName(event.target.value)}
                />
                <textarea
                  className="cron-form-input cron-form-textarea"
                  placeholder="让 AI 做什么..."
                  value={cronPrompt}
                  onChange={(event) => setCronPrompt(event.target.value)}
                />

                <div className="cron-freq-grid">
                  {FREQ_PRESETS.map((preset, idx) => (
                    <button
                      key={preset.label}
                      type="button"
                      className={`cron-freq-btn${selectedCronPreset === idx ? " active" : ""}`}
                      onClick={() => setSelectedCronPreset(idx)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {isCustomCron && (
                  <div className="cron-custom-row">
                    <select
                      className="cron-form-input cron-custom-kind"
                      value={customCronKind}
                      onChange={(event) => setCustomCronKind(event.target.value)}
                    >
                      {CUSTOM_KINDS.map((kind) => (
                        <option key={kind.value} value={kind.value}>{kind.label}</option>
                      ))}
                    </select>
                    <input
                      className="cron-form-input cron-custom-expr"
                      placeholder={kindInfo?.placeholder}
                      value={customCronExpr}
                      onChange={(event) => setCustomCronExpr(event.target.value)}
                    />
                  </div>
                )}

                <div className="cron-form-actions">
                  <button className="cron-cancel-btn" onClick={() => setShowCronForm(false)}>取消</button>
                  <button className="cron-submit-btn" disabled={!canCreateCron} onClick={() => void handleCreateCron()}>
                    {submittingCron ? "创建中..." : "创建任务"}
                  </button>
                </div>
              </div>
            )}

            {cronLoading && cronJobs.length === 0 ? (
              <div className="panel-loading">
                <Loader size={18} className="spin-icon" />
                <span>加载定时任务...</span>
              </div>
            ) : (
              <div className="cron-list">
                {cronJobs.length === 0 && !showCronForm ? (
                  <div className="panel-empty">
                    <ListTodo size={22} />
                    <span>暂无定时任务</span>
                  </div>
                ) : (
                  cronJobs.map((job) => {
                    const expanded = expandedCronId === job.id;
                    const hasErrors = job.consecutive_errors > 0;
                    return (
                      <div key={job.id} className={`cron-item${hasErrors ? " cron-item--error" : ""}`}>
                        <div className="cron-item-header" onClick={() => setExpandedCronId(expanded ? null : job.id)}>
                          <div className="cron-item-info">
                            <span className="cron-item-name">{job.name || job.prompt.slice(0, 30)}</span>
                            <span className="cron-item-schedule">{formatSchedule(job.schedule_kind, job.schedule_expr)}</span>
                          </div>
                          <div className="cron-item-meta">
                            {hasErrors && <AlertTriangle size={12} className="cron-error-icon" />}
                            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </div>
                        </div>
                        {expanded && (
                          <div className="cron-item-detail">
                            <div className="cron-detail-row">
                              <span>任务内容</span>
                              <span className="cron-detail-prompt">{job.prompt}</span>
                            </div>
                            <div className="cron-detail-row">
                              <span>执行次数</span>
                              <span>{job.run_count}</span>
                            </div>
                            <div className="cron-detail-row">
                              <span>上次执行</span>
                              <span>{formatCronTime(job.last_run)}</span>
                            </div>
                            {hasErrors && (
                              <div className="cron-detail-row cron-detail-row--error">
                                <span>连续错误</span>
                                <span>{job.consecutive_errors}</span>
                              </div>
                            )}
                            <button className="cron-delete-btn" onClick={() => void handleDeleteCron(job.id)}>
                              <Trash2 size={12} />
                              删除任务
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}

        {cronError && <div className="panel-error">{cronError}</div>}
      </section>
    </div>
  );
}
