import { AUTH_TOKEN, GATEWAY_URL } from "./config";

export interface FeedStatusResponse {
  enabled: boolean;
  message?: string;
}

export interface FeedLog {
  id: string;
  timestamp: string | null;
  method: string;
  path: string;
  agent_id: string | null;
  agent_name: string | null;
  agent_role: string | null;
  request_body: string | null;
  response_status: number | null;
}

export interface SubTaskBrief {
  id: string;
  name: string;
  module_name: string | null;
}

export interface RecentAction {
  method: string;
  path: string;
  request_body: string | null;
  response_status: number | null;
  timestamp: string | null;
}

export interface AgentSummary {
  id: string;
  name: string;
  role: string;
  total_score: number;
  today_request_count: number;
  today_submit_count: number;
  today_review_count: number;
  current_sub_task: SubTaskBrief | null;
  recent_actions: RecentAction[];
}

function buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
  const url = `${GATEWAY_URL}${path}`;
  const search = new URLSearchParams();

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      search.set(key, String(value));
    }
  }

  const queryString = search.toString();
  return queryString ? `${url}?${queryString}` : url;
}

async function fetchJson(path: string, query?: Record<string, string | number | undefined>): Promise<unknown> {
  const res = await fetch(buildUrl(path, query), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Feed request failed: ${res.status}`);
  }

  return (await res.json()) as unknown;
}

export async function fetchFeedStatus(): Promise<FeedStatusResponse> {
  const payload = (await fetchJson("/api/jamoss/feed/status")) as Partial<FeedStatusResponse>;
  return {
    enabled: payload.enabled === true,
    message: typeof payload.message === "string" ? payload.message : undefined,
  };
}

export async function fetchFeedLogs(after?: string, agentId?: string, limit = 100): Promise<FeedLog[]> {
  const payload = await fetchJson("/api/jamoss/feed/logs", {
    after: after?.trim() || undefined,
    agent_id: agentId?.trim() || undefined,
    limit,
  });
  return Array.isArray(payload) ? (payload as FeedLog[]) : [];
}

export async function fetchAgentSummary(): Promise<AgentSummary[]> {
  const payload = await fetchJson("/api/jamoss/feed/agent-summary");
  return Array.isArray(payload) ? (payload as AgentSummary[]) : [];
}
