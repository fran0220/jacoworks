import { AUTH_TOKEN, GATEWAY_URL } from "./config";

export interface DashboardStats {
  totalTasks: number;
  activeTasks: number;
  totalAgents: number;
  topScore: number;
}

export interface PageResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  has_more: boolean;
}

export interface TaskListParams {
  page?: number;
  page_size?: number;
  status?: string;
  type?: string;
  keyword?: string;
  sort_by?: string;
  sort_order?: string;
}

export interface SubTaskListParams {
  page?: number;
  page_size?: number;
  module_id?: string;
  status?: string;
  assigned_agent?: string;
  priority?: string;
  type?: string;
  keyword?: string;
  sort_by?: string;
  sort_order?: string;
}

export interface TaskItem {
  id: string;
  name: string;
  description: string;
  type: string;
  status: string;
  module_count: number;
  sub_task_count: number;
  pending_count: number;
  assigned_count: number;
  in_progress_count: number;
  review_count: number;
  rework_count: number;
  blocked_count: number;
  done_count: number;
  cancelled_count: number;
  created_at: string | null;
  updated_at: string | null;
}

export type TaskDetail = TaskItem;

export interface SubTaskItem {
  id: string;
  task_id: string;
  task_name: string;
  module_id: string | null;
  module_name: string | null;
  name: string;
  description: string;
  type: string;
  status: string;
  priority: string;
  assigned_agent: string | null;
  assigned_agent_name: string | null;
  current_session_id: string | null;
  rework_count: number;
  created_at: string | null;
  updated_at: string | null;
  completed_at: string | null;
}

export interface SubTaskDetail extends SubTaskItem {
  deliverable: string;
  acceptance: string;
}

export interface ScoreEntry {
  agent_id?: string;
  agent_name?: string;
  total_score: number;
}

function normalizePage<T>(payload: unknown): PageResponse<T> {
  const rec = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};

  const items = Array.isArray(rec.items) ? (rec.items as T[]) : [];
  const total = typeof rec.total === "number" ? rec.total : items.length;
  const page = typeof rec.page === "number" ? rec.page : 1;
  const pageSize = typeof rec.page_size === "number" ? rec.page_size : items.length;
  const totalPages = typeof rec.total_pages === "number" ? rec.total_pages : Math.max(1, Math.ceil(total / Math.max(pageSize, 1)));
  const hasMore = typeof rec.has_more === "boolean" ? rec.has_more : page < totalPages;

  return {
    items,
    total,
    page,
    page_size: pageSize,
    total_pages: totalPages,
    has_more: hasMore,
  };
}

function withQuery(path: string, params?: Record<string, string | number | boolean | undefined>): string {
  if (!params) return path;

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }

  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

async function apiFetch<T>(
  path: string,
  options: {
    method?: string;
    params?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
  } = {},
): Promise<T> {
  const res = await fetch(`${GATEWAY_URL}${withQuery(path, options.params)}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AUTH_TOKEN}`,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!res.ok) {
    throw new Error(`请求失败 (${res.status})`);
  }

  return (await res.json()) as T;
}

export async function fetchScoreLeaderboard(): Promise<ScoreEntry[]> {
  const payload = await apiFetch<unknown>("/api/jamoss/scores/leaderboard");
  return Array.isArray(payload) ? (payload as ScoreEntry[]) : [];
}

export async function fetchTasks(params: TaskListParams = {}): Promise<PageResponse<TaskItem>> {
  const payload = await apiFetch<unknown>("/api/jamoss/admin/tasks", {
    params: params as Record<string, string | number | boolean | undefined>,
  });
  return normalizePage<TaskItem>(payload);
}

export async function fetchTaskDetail(id: string): Promise<TaskDetail> {
  return apiFetch<TaskDetail>(`/api/jamoss/admin/tasks/${encodeURIComponent(id)}`);
}

export async function fetchSubTasks(taskId: string, params: SubTaskListParams = {}): Promise<PageResponse<SubTaskItem>> {
  const payload = await apiFetch<unknown>(`/api/jamoss/admin/tasks/${encodeURIComponent(taskId)}/sub-tasks`, {
    params: params as Record<string, string | number | boolean | undefined>,
  });
  return normalizePage<SubTaskItem>(payload);
}

export async function fetchSubTaskDetail(id: string): Promise<SubTaskDetail> {
  const payload = await apiFetch<SubTaskDetail>(`/api/jamoss/admin/sub-tasks/${encodeURIComponent(id)}`);
  return {
    ...payload,
    deliverable: payload.deliverable || "",
    acceptance: payload.acceptance || "",
  };
}

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const overview = await apiFetch<{
    total_tasks: number;
    active_tasks: number;
    total_agents: number;
    top_score: number;
  }>("/api/jamoss/stats/overview");

  return {
    totalTasks: overview.total_tasks,
    activeTasks: overview.active_tasks,
    totalAgents: overview.total_agents,
    topScore: overview.top_score,
  };
}
