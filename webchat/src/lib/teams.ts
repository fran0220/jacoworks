import { AUTH_TOKEN, DEFAULT_OPENCLAW_SESSION_KEY, GATEWAY_URL } from "./config";

export interface TeamAgent {
  id: string;
  name: string;
  role: string;
  isLeader: boolean;
}

export interface TemplateThemeRole {
  displayName: string;
  color: string;
  icon: string;
}

export interface TemplateThemeAgent {
  displayName: string;
  subtitle: string;
  color: string;
}

export interface TemplateThemeZone {
  label: string;
  icon: string;
}

export interface TemplateTheme {
  sceneKind: string;
  title: string;
  icon: string;
  palette: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
  };
  roles: Record<string, TemplateThemeRole>;
  agents: Record<string, TemplateThemeAgent>;
  zones: Record<string, TemplateThemeZone>;
}

export interface TeamTemplate {
  type: "team";
  name: string;
  displayName: string;
  description: string;
  version: string;
  agents: TeamAgent[];
  theme?: TemplateTheme;
}

export interface AgentProfile {
  type: "agent";
  name: string;
  displayName: string;
  description: string;
  icon: string;
  sessionKey: string;
}

export interface ProfileDetail {
  type: "agent";
  name: string;
  displayName: string;
  description: string;
  icon: string;
  model: string;
  skills: string[];
  workspace: string;
  files: Record<string, string>;
}

export interface TeamsResponse {
  installed: string;
  activeSessionKey: string;
  available: TeamTemplate[];
  profiles: AgentProfile[];
  theme?: TemplateTheme;
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

  const themeRaw = rec.theme;
  let theme: TemplateTheme | undefined;
  if (themeRaw && typeof themeRaw === "object") {
    theme = themeRaw as TemplateTheme;
  }

  return {
    type: "team",
    name,
    displayName: asText(rec.displayName) || name,
    description: asText(rec.description),
    version: asText(rec.version) || "unknown",
    agents,
    theme,
  };
}

function normalizeProfile(payload: unknown): AgentProfile | null {
  const rec = asRecord(payload);
  const name = asText(rec.name);
  if (!name) return null;

  return {
    type: "agent",
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

  const available = availableRaw.map(normalizeTemplate).filter((item): item is TeamTemplate => Boolean(item));
  const installed = asText(rec.installed);

  let theme: TemplateTheme | undefined;
  if (installed) {
    const tmpl = available.find((t) => t.name === installed);
    theme = tmpl?.theme;
  }

  return {
    installed,
    activeSessionKey: asText(rec.activeSessionKey) || DEFAULT_OPENCLAW_SESSION_KEY,
    available,
    profiles: profilesRaw.map(normalizeProfile).filter((item): item is AgentProfile => Boolean(item)),
    theme,
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

async function apiFetch<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
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

export async function fetchProfiles(): Promise<AgentProfile[]> {
  const payload = await apiFetch<unknown[]>("/api/profiles");
  return (Array.isArray(payload) ? payload : [])
    .map(normalizeProfile)
    .filter((p): p is AgentProfile => Boolean(p));
}

export async function fetchProfileDetail(name: string): Promise<ProfileDetail> {
  return apiFetch<ProfileDetail>(`/api/profiles/${encodeURIComponent(name)}`);
}

export async function createProfile(detail: Omit<ProfileDetail, "type">): Promise<void> {
  await apiFetch("/api/profiles", { method: "POST", body: detail });
}

export async function updateProfile(name: string, detail: Omit<ProfileDetail, "type">): Promise<void> {
  await apiFetch(`/api/profiles/${encodeURIComponent(name)}`, { method: "PUT", body: detail });
}

export async function deleteProfile(name: string): Promise<void> {
  await apiFetch(`/api/profiles/${encodeURIComponent(name)}`, { method: "DELETE" });
}
