import { AUTH_TOKEN, DEFAULT_OPENCLAW_SESSION_KEY, GATEWAY_URL } from "./config";

export interface TeamAgent {
  id: string;
  name: string;
  role: string;
  isLeader: boolean;
}

export interface TeamTemplate {
  name: string;
  displayName: string;
  description: string;
  version: string;
  agents: TeamAgent[];
}

export interface AgentProfile {
  name: string;
  displayName: string;
  description: string;
  icon: string;
  sessionKey: string;
}

export interface TeamsResponse {
  installed: string;
  activeSessionKey: string;
  available: TeamTemplate[];
  profiles: AgentProfile[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAgent(payload: unknown): TeamAgent | null {
  const rec = asRecord(payload);
  const id = asText(rec.id);
  if (!id) return null;

  return {
    id,
    name: asText(rec.name) || id,
    role: asText(rec.role) || "assistant",
    isLeader: rec.isLeader === true,
  };
}

function normalizeTemplate(payload: unknown): TeamTemplate | null {
  const rec = asRecord(payload);
  const name = asText(rec.name);
  if (!name) return null;

  const agents = Array.isArray(rec.agents)
    ? rec.agents.map(normalizeAgent).filter((agent): agent is TeamAgent => Boolean(agent))
    : [];

  return {
    name,
    displayName: asText(rec.displayName) || name,
    description: asText(rec.description),
    version: asText(rec.version) || "unknown",
    agents,
  };
}

function normalizeProfile(payload: unknown): AgentProfile | null {
  const rec = asRecord(payload);
  const name = asText(rec.name);
  if (!name) return null;

  return {
    name,
    displayName: asText(rec.displayName) || name,
    description: asText(rec.description),
    icon: asText(rec.icon) || "bot",
    sessionKey: asText(rec.sessionKey) || `agent:${name}:main`,
  };
}

function parseTeamsResponse(payload: unknown): TeamsResponse {
  const rec = asRecord(payload);
  const availableRaw = Array.isArray(rec.available) ? rec.available : [];
  const profilesRaw = Array.isArray(rec.profiles) ? rec.profiles : [];

  return {
    installed: asText(rec.installed),
    activeSessionKey: asText(rec.activeSessionKey) || DEFAULT_OPENCLAW_SESSION_KEY,
    available: availableRaw.map(normalizeTemplate).filter((item): item is TeamTemplate => Boolean(item)),
    profiles: profilesRaw.map(normalizeProfile).filter((item): item is AgentProfile => Boolean(item)),
  };
}

export async function fetchTeams(): Promise<TeamsResponse> {
  const res = await fetch(`${GATEWAY_URL}/api/teams`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
    },
  });

  if (!res.ok) {
    throw new Error(`获取团队失败 (${res.status})`);
  }

  const payload = (await res.json()) as unknown;
  return parseTeamsResponse(payload);
}

export async function installTeam(template: string): Promise<void> {
  const name = template.trim();
  if (!name) throw new Error("模板名称不能为空");

  const res = await fetch(`${GATEWAY_URL}/api/teams/install`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AUTH_TOKEN}`,
    },
    body: JSON.stringify({ template: name }),
  });

  if (!res.ok) {
    throw new Error(`安装团队失败 (${res.status})`);
  }
}
