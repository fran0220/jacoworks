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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function getJSON(path: string): Promise<unknown> {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
    },
  });
  if (!res.ok) {
    throw new Error(`feed request failed (${res.status})`);
  }
  return (await res.json()) as unknown;
}

export async function fetchFeedStatus(): Promise<FeedStatusResponse> {
  return {
    enabled: true,
    message: "VM 运营数据",
  };
}

export async function fetchFeedLogs(_after?: string, _agentId?: string, _limit = 100): Promise<FeedLog[]> {
  // Legacy JaMOSS event stream has been removed.
  // VM runtime event stream will be wired here.
  return [];
}

export async function fetchAgentSummary(): Promise<AgentSummary[]> {
  const payload = await getJSON("/api/teams");
  const rec = asRecord(payload);
  const profiles = Array.isArray(rec.profiles) ? rec.profiles : [];
  const templates = Array.isArray(rec.templates) ? rec.templates : [];

  const roleByName = new Map<string, string>();
  for (const templateRaw of templates) {
    const template = asRecord(templateRaw);
    const members = Array.isArray(template.members) ? template.members : [];
    for (const memberRaw of members) {
      const member = asRecord(memberRaw);
      const name = asText(member.name);
      const role = asText(member.role) || "member";
      if (name && !roleByName.has(name)) {
        roleByName.set(name, role);
      }
    }
  }

  const summaries = profiles
    .map((profileRaw) => {
      const profile = asRecord(profileRaw);
      const name = asText(profile.displayName) || asText(profile.name);
      const id = asText(profile.sessionKey) || `agent:${asText(profile.name)}`;
      if (!name || !id) return null;
      const profileName = asText(profile.name);
      const summary: AgentSummary = {
        id,
        name,
        role: roleByName.get(profileName) || (profileName === "default" ? "default" : "member"),
        total_score: 0,
        today_request_count: 0,
        today_submit_count: 0,
        today_review_count: 0,
        current_sub_task: null,
        recent_actions: [],
      };
      return summary;
    })
    .filter((item): item is AgentSummary => item !== null);

  if (summaries.length > 0) return summaries;

  return [
    {
      id: "agent:default",
      name: "默认助手",
      role: "default",
      total_score: 0,
      today_request_count: 0,
      today_submit_count: 0,
      today_review_count: 0,
      current_sub_task: null,
      recent_actions: [],
    },
  ];
}
