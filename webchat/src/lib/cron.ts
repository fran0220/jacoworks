import { GATEWAY_URL, AUTH_TOKEN } from "./config";

export interface CronJob {
  id: string;
  name: string | null;
  schedule_kind: string;
  schedule_expr: string;
  prompt: string;
  session_target: string;
  enabled: boolean;
  delete_after_run: boolean;
  last_run: string | null;
  run_count: number;
  consecutive_errors: number;
  created_at: string;
  updated_at: string;
}

export interface CreateCronJobRequest {
  schedule_kind: string;
  schedule_expr: string;
  prompt: string;
  name?: string;
  session_target?: string;
  delete_after_run?: boolean;
}

async function apiFetch(
  path: string,
  options: { method?: string; body?: string } = {},
): Promise<{ status: number; body: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${AUTH_TOKEN}`,
  };
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body,
  });
  return { status: res.status, body: await res.text() };
}

export async function listCronJobs(): Promise<CronJob[]> {
  const res = await apiFetch("/api/cron/jobs");
  if (res.status !== 200) throw new Error("获取定时任务列表失败");
  return JSON.parse(res.body) ?? [];
}

export async function createCronJob(req: CreateCronJobRequest): Promise<CronJob> {
  const res = await apiFetch("/api/cron/jobs", {
    method: "POST",
    body: JSON.stringify(req),
  });
  if (res.status !== 201) throw new Error("创建定时任务失败");
  return JSON.parse(res.body);
}

export async function deleteCronJob(id: string): Promise<void> {
  const res = await apiFetch(`/api/cron/jobs/${id}`, { method: "DELETE" });
  if (res.status !== 204) throw new Error("删除定时任务失败");
}

export async function runCronJob(id: string): Promise<{ status: string; message: string }> {
  const res = await apiFetch(`/api/cron/jobs/${id}/run`, { method: "POST" });
  if (res.status !== 200) throw new Error("执行定时任务失败");
  return JSON.parse(res.body);
}
