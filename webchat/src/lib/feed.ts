import { AUTH_TOKEN, GATEWAY_URL } from "./config";

export interface FeedStatusResponse {
  enabled: boolean;
  message?: string;
}

export type CrewPresenceState = "active" | "idle" | "away" | "stuck";

export type CrewTaskStatus =
  | "pending"
  | "in-progress"
  | "done"
  | "blocked"
  | "assigned"
  | "running"
  | "failed"
  | "timeout";

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
  presence_state?: CrewPresenceState;
  reserved_paths?: string[];
  latest_message?: string | null;
  source?: "crew" | "legacy";
}

export interface CrewTask {
  id: string;
  name: string;
  status: CrewTaskStatus;
  dependencies: string[];
  assignee: string | null;
  wave: number | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      const rec = asRecord(item);
      return (
        asText(rec.path) ||
        asText(rec.file_path) ||
        asText(rec.filePath) ||
        asText(rec.target)
      );
    })
    .filter((item): item is string => Boolean(item));
}

function normalizeCrewRole(role: string): string {
  const normalized = role.trim().toLowerCase();
  if (normalized === "crew-planner") return "planner";
  if (normalized === "crew-worker") return "executor";
  if (normalized === "crew-reviewer") return "reviewer";
  return normalized || "member";
}

function normalizePresenceState(value: unknown): CrewPresenceState | undefined {
  const normalized = asText(value).toLowerCase();
  if (
    normalized === "active" ||
    normalized === "idle" ||
    normalized === "away" ||
    normalized === "stuck"
  ) {
    return normalized;
  }
  return undefined;
}

function parseRecentAction(value: unknown): RecentAction | null {
  const rec = asRecord(value);
  const method = asText(rec.method).toUpperCase();
  const path = asText(rec.path);
  if (!method || !path) return null;
  return {
    method,
    path,
    request_body: asText(rec.request_body) || null,
    response_status: asNullableNumber(rec.response_status),
    timestamp: asText(rec.timestamp) || null,
  };
}

function parseSubTask(value: unknown): SubTaskBrief | null {
  const rec = asRecord(value);
  const id = asText(rec.id) || asText(rec.task_id);
  const name = asText(rec.name) || asText(rec.title);
  if (!id || !name) return null;
  return {
    id,
    name,
    module_name: asText(rec.module_name) || asText(rec.moduleName) || null,
  };
}

function extractLatestMessage(rec: Record<string, unknown>): string | null {
  const direct =
    asText(rec.latest_message) ||
    asText(rec.latestMessage) ||
    asText(rec.current_message) ||
    asText(rec.currentMessage) ||
    asText(rec.message);
  if (direct) return direct;

  const nested = asRecord(rec.last_message || rec.lastMessage || rec.inbox || rec.mailbox);
  return asText(nested.content) || asText(nested.text) || asText(nested.message) || null;
}

function extractReservedPaths(rec: Record<string, unknown>): string[] {
  const direct = asStringArray(rec.reserved_paths || rec.reservedPaths || rec.file_reservations);
  if (direct.length > 0) return Array.from(new Set(direct));

  const reservations = Array.isArray(rec.reservations) ? rec.reservations : [];
  const nested = reservations
    .map((item) => {
      const reservation = asRecord(item);
      return (
        asText(reservation.path) ||
        asText(reservation.file_path) ||
        asText(reservation.filePath) ||
        asText(reservation.target)
      );
    })
    .filter((item): item is string => Boolean(item));
  return Array.from(new Set(nested));
}

function parseAgentSummary(value: unknown): AgentSummary | null {
  const rec = asRecord(value);
  const id = asText(rec.id) || asText(rec.agent_id) || asText(rec.agentId);
  const name = asText(rec.name) || asText(rec.agent_name) || asText(rec.agentName);
  if (!id || !name) return null;

  const recentActionsRaw = Array.isArray(rec.recent_actions) ? rec.recent_actions : [];
  const recent_actions = recentActionsRaw
    .map(parseRecentAction)
    .filter((item): item is RecentAction => item !== null);
  const presence_state = normalizePresenceState(rec.presence_state || rec.status);
  const reserved_paths = extractReservedPaths(rec);
  const latest_message = extractLatestMessage(rec);
  const source =
    asText(rec.source) === "legacy" ||
    (!presence_state && reserved_paths.length === 0 && !latest_message)
      ? "legacy"
      : "crew";

  return {
    id,
    name,
    role: normalizeCrewRole(asText(rec.role) || asText(rec.agent_role) || "member"),
    total_score: asNumber(rec.total_score),
    today_request_count: asNumber(rec.today_request_count),
    today_submit_count: asNumber(rec.today_submit_count),
    today_review_count: asNumber(rec.today_review_count),
    current_sub_task: parseSubTask(rec.current_sub_task),
    recent_actions,
    presence_state,
    reserved_paths,
    latest_message,
    source,
  };
}

function parseFeedLog(value: unknown): FeedLog | null {
  const rec = asRecord(value);
  const method = asText(rec.method).toUpperCase();
  const path = asText(rec.path);
  const id =
    asText(rec.id) ||
    asText(rec.event_id) ||
    [asText(rec.timestamp), method, path, asText(rec.agent_id || rec.agentId)].filter(Boolean).join(":");
  if (!id || !method || !path) return null;
  return {
    id,
    timestamp: asText(rec.timestamp) || null,
    method,
    path,
    agent_id: asText(rec.agent_id) || asText(rec.agentId) || null,
    agent_name: asText(rec.agent_name) || asText(rec.agentName) || null,
    agent_role: asText(rec.agent_role) || asText(rec.agentRole) || null,
    request_body: asText(rec.request_body) || asText(rec.requestBody) || null,
    response_status: asNullableNumber(rec.response_status ?? rec.responseStatus),
  };
}

function parseCrewTask(value: unknown): CrewTask | null {
  const rec = asRecord(value);
  const id = asText(rec.id) || asText(rec.task_id) || asText(rec.taskId);
  if (!id) return null;
  return {
    id,
    name: asText(rec.name) || asText(rec.title) || id,
    status: normalizeCrewTaskStatus(asText(rec.status) || "pending"),
    dependencies: asStringArray(rec.dependencies || rec.depends_on || rec.dependsOn),
    assignee: asText(rec.assignee) || asText(rec.assigned_agent) || asText(rec.agentId) || null,
    wave: typeof rec.wave === "number" && Number.isFinite(rec.wave) ? rec.wave : null,
  };
}

function normalizeCrewTaskStatus(status: string): CrewTaskStatus {
  const normalized = status.trim().toLowerCase();
  if (normalized === "running") return "running";
  if (normalized === "assigned") return "assigned";
  if (normalized === "done" || normalized === "completed" || normalized === "complete") return "done";
  if (normalized === "blocked" || normalized === "stuck") return "blocked";
  if (normalized === "failed") return "failed";
  if (normalized === "timeout") return "timeout";
  if (normalized === "in_progress" || normalized === "in-progress") return "in-progress";
  return "pending";
}

function asArrayPayload(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const rec = asRecord(value);
  if (Array.isArray(rec.items)) return rec.items;
  if (Array.isArray(rec.logs)) return rec.logs;
  if (Array.isArray(rec.events)) return rec.events;
  if (Array.isArray(rec.tasks)) return rec.tasks;
  if (Array.isArray(rec.agents)) return rec.agents;
  if (Array.isArray(rec.state)) return rec.state;
  return [];
}

async function getJSON(path: string, options?: { allow404?: boolean }): Promise<unknown | null> {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
    },
  });
  if (options?.allow404 && res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`feed request failed (${res.status})`);
  }
  if (res.status === 204) return null;
  return (await res.json()) as unknown;
}

export async function fetchFeedStatus(): Promise<FeedStatusResponse> {
  const crewState = await fetchCrewState().catch(() => []);
  return {
    enabled: true,
    message: crewState.length > 0 ? "Crew 实况" : "VM 运营数据",
  };
}

export async function fetchCrewState(): Promise<AgentSummary[]> {
  const payload = await getJSON("/api/crew/state", { allow404: true });
  if (payload === null) return [];
  return asArrayPayload(payload)
    .map(parseAgentSummary)
    .filter((item): item is AgentSummary => item !== null)
    .map((item) => ({ ...item, source: "crew" as const }));
}

export async function fetchCrewFeed(since?: string): Promise<FeedLog[]> {
  const params = new URLSearchParams();
  if (since) params.set("since", since);
  const query = params.size > 0 ? `?${params.toString()}` : "";
  const payload = await getJSON(`/api/crew/feed${query}`, { allow404: true });
  if (payload === null) return [];
  return asArrayPayload(payload)
    .map(parseFeedLog)
    .filter((item): item is FeedLog => item !== null);
}

export async function fetchCrewTasks(): Promise<CrewTask[]> {
  const payload = await getJSON("/api/crew/tasks", { allow404: true });
  if (payload === null) return [];
  return asArrayPayload(payload)
    .map(parseCrewTask)
    .filter((item): item is CrewTask => item !== null);
}

export async function fetchFeedLogs(after?: string, _agentId?: string, limit = 100): Promise<FeedLog[]> {
  const crewLogs = await fetchCrewFeed(after).catch(() => []);
  return crewLogs.slice(0, limit);
}

export async function fetchAgentSummary(): Promise<AgentSummary[]> {
  const crewSummaries = await fetchCrewState().catch(() => []);
  if (crewSummaries.length > 0) return crewSummaries;

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
        source: "legacy",
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
      source: "legacy",
    },
  ];
}
