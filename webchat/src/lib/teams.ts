import { AUTH_TOKEN, DEFAULT_SESSION_KEY, GATEWAY_URL } from "./config";

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

export interface TeamTemplateMember {
  name: string;
  role: string;
  mode: string;
  workspace: string;
  model: string;
  kickoff: string;
}

export interface TeamTemplate {
  id: string;
  label: string;
  description: string;
  icon: string;
  version: string;
  workspaceKeyPrefix: string;
  leaderSystemPrompt: string;
  bootstrapCommands: string[];
  members: TeamTemplateMember[];
  theme?: TemplateTheme;
}

export interface TeamCreateResponse {
  workspaceKey: string;
  template: TeamTemplate;
}

export interface AgentPreset {
  id: string;
  label: string;
  icon: string;
  workspaceKey: string;
  systemPrompt: string | null;
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
  activeSessionKey: string;
  profiles: AgentProfile[];
  templates: TeamTemplate[];
  theme?: TemplateTheme;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTeamMember(payload: unknown): TeamTemplateMember | null {
  const rec = asRecord(payload);
  const name = asText(rec.name) || asText(rec.id);
  if (!name) return null;

  return {
    name,
    role: asText(rec.role) || (rec.isLeader === true ? "leader" : "member"),
    mode: asText(rec.mode),
    workspace: asText(rec.workspace),
    model: asText(rec.model),
    kickoff: asText(rec.kickoff),
  };
}

function normalizeTemplate(payload: unknown): TeamTemplate | null {
  const rec = asRecord(payload);
  const id = asText(rec.id) || asText(rec.name);
  if (!id) return null;

  const membersRaw = Array.isArray(rec.members)
    ? rec.members
    : Array.isArray(rec.agents)
      ? rec.agents
      : [];
  const members = membersRaw
    .map(normalizeTeamMember)
    .filter((member): member is TeamTemplateMember => Boolean(member));

  const bootstrapCommands = Array.isArray(rec.bootstrapCommands)
    ? rec.bootstrapCommands.map(asText).filter(Boolean)
    : [];

  const themeRaw = rec.theme;
  let theme: TemplateTheme | undefined;
  if (themeRaw && typeof themeRaw === "object") {
    theme = themeRaw as TemplateTheme;
  }

  return {
    id,
    label: asText(rec.label) || asText(rec.displayName) || id,
    description: asText(rec.description),
    icon: asText(rec.icon),
    version: asText(rec.version) || "1.0.0",
    workspaceKeyPrefix: asText(rec.workspaceKeyPrefix) || `team:${id}`,
    leaderSystemPrompt: asText(rec.leaderSystemPrompt),
    bootstrapCommands,
    members,
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

function normalizePreset(payload: unknown): AgentPreset | null {
  const rec = asRecord(payload);
  const id = asText(rec.id);
  const workspaceKey = asText(rec.workspaceKey);
  if (!id || !workspaceKey) return null;

  return {
    id,
    label: asText(rec.label) || id,
    icon: asText(rec.icon) || "bot",
    workspaceKey,
    systemPrompt: asText(rec.systemPrompt) || null,
  };
}

function parseTeamsResponse(payload: unknown): TeamsResponse {
  const rec = asRecord(payload);
  const templatesRaw = Array.isArray(rec.templates)
    ? rec.templates
    : Array.isArray(rec.available)
      ? rec.available
      : [];
  const profilesRaw = Array.isArray(rec.profiles) ? rec.profiles : [];

  return {
    activeSessionKey: asText(rec.activeSessionKey) || DEFAULT_SESSION_KEY,
    profiles: profilesRaw
      .map(normalizeProfile)
      .filter((item): item is AgentProfile => Boolean(item)),
    templates: templatesRaw
      .map(normalizeTemplate)
      .filter((item): item is TeamTemplate => Boolean(item)),
    theme:
      rec.theme && typeof rec.theme === "object"
        ? (rec.theme as TemplateTheme)
        : undefined,
  };
}

async function apiFetch<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
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

export async function fetchTeams(): Promise<TeamsResponse> {
  const payload = await apiFetch<unknown>("/api/teams");
  return parseTeamsResponse(payload);
}

export async function createTeamWorkspace(
  templateId: string,
): Promise<TeamCreateResponse> {
  const normalized = templateId.trim();
  if (!normalized) throw new Error("模板名称不能为空");

  const payload = await apiFetch<unknown>("/api/teams/create", {
    method: "POST",
    body: { templateId: normalized },
  });
  const rec = asRecord(payload);
  const template = normalizeTemplate(rec.template);
  const workspaceKey = asText(rec.workspaceKey);

  if (!template || !workspaceKey) {
    throw new Error("团队创建响应无效");
  }

  return { workspaceKey, template };
}

export async function fetchAgentPresets(): Promise<AgentPreset[]> {
  const payload = await apiFetch<unknown[]>("/api/agents/presets");
  return (Array.isArray(payload) ? payload : [])
    .map(normalizePreset)
    .filter((preset): preset is AgentPreset => Boolean(preset));
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

export async function createProfile(
  detail: Omit<ProfileDetail, "type">,
): Promise<void> {
  await apiFetch("/api/profiles", { method: "POST", body: detail });
}

export async function updateProfile(
  name: string,
  detail: Omit<ProfileDetail, "type">,
): Promise<void> {
  await apiFetch(`/api/profiles/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: detail,
  });
}

export async function deleteProfile(name: string): Promise<void> {
  await apiFetch(`/api/profiles/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}
