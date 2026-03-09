import { AUTH_TOKEN, DEFAULT_OPENCLAW_SESSION_KEY, GATEWAY_URL } from "./config";

const TEAM_CACHE_KEY = "jacoworks.webchat.teams.v1";
const ACTIVE_TEAM_KEY = "jacoworks.webchat.active-team.v1";

interface TemplateAgentPayload {
  id?: string;
  isLeader?: boolean;
}

interface TemplatePayload {
  name?: string;
  displayName?: string;
  agents?: TemplateAgentPayload[];
}

export interface TeamOption {
  name: string;
  displayName: string;
  leaderId: string;
  sessionKey: string;
}

export const DEFAULT_TEAM: TeamOption = {
  name: "default",
  displayName: "默认助手",
  leaderId: "default",
  sessionKey: DEFAULT_OPENCLAW_SESSION_KEY,
};

export function toSessionKey(leaderId: string): string {
  return `agent:${leaderId}:main`;
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore storage failures
  }
}

function normalizeTemplate(template: TemplatePayload): TeamOption | null {
  const templateName = typeof template.name === "string" ? template.name.trim() : "";
  const displayName = typeof template.displayName === "string" ? template.displayName.trim() : "";
  const agents = Array.isArray(template.agents) ? template.agents : [];

  const leader =
    agents.find((agent) => agent && agent.isLeader === true) ??
    agents.find((agent) => agent && typeof agent.id === "string" && agent.id.trim().length > 0);

  const leaderId = typeof leader?.id === "string" ? leader.id.trim() : "";
  if (!leaderId) return null;

  return {
    name: templateName || leaderId,
    displayName: displayName || templateName || `团队 ${leaderId}`,
    leaderId,
    sessionKey: toSessionKey(leaderId),
  };
}

function mergeDefaultTeam(teams: TeamOption[]): TeamOption[] {
  const uniq = new Map<string, TeamOption>();
  uniq.set(DEFAULT_TEAM.sessionKey, DEFAULT_TEAM);
  for (const team of teams) {
    if (!team.sessionKey) continue;
    if (uniq.has(team.sessionKey)) continue;
    uniq.set(team.sessionKey, team);
  }
  return [...uniq.values()];
}

function parseCachedTeams(raw: string | null): TeamOption[] {
  if (!raw) return [DEFAULT_TEAM];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [DEFAULT_TEAM];
    const teams = parsed
      .filter((item): item is TeamOption => {
        if (!item || typeof item !== "object") return false;
        const rec = item as Record<string, unknown>;
        return (
          typeof rec.name === "string" &&
          typeof rec.displayName === "string" &&
          typeof rec.leaderId === "string" &&
          typeof rec.sessionKey === "string"
        );
      })
      .map((item) => ({
        name: item.name.trim(),
        displayName: item.displayName.trim(),
        leaderId: item.leaderId.trim(),
        sessionKey: item.sessionKey.trim(),
      }))
      .filter((item) => item.sessionKey.length > 0);

    return mergeDefaultTeam(teams);
  } catch {
    return [DEFAULT_TEAM];
  }
}

function cacheTeams(teams: TeamOption[]) {
  writeStorage(TEAM_CACHE_KEY, JSON.stringify(teams));
}

export function getCachedTeams(): TeamOption[] {
  return parseCachedTeams(readStorage(TEAM_CACHE_KEY));
}

export function getStoredTeamSessionKey(teams: TeamOption[] = getCachedTeams()): string {
  const stored = (readStorage(ACTIVE_TEAM_KEY) || "").trim();
  if (!stored) return DEFAULT_TEAM.sessionKey;
  return teams.some((team) => team.sessionKey === stored) ? stored : DEFAULT_TEAM.sessionKey;
}

export function setStoredTeamSessionKey(sessionKey: string) {
  const normalized = sessionKey.trim();
  if (!normalized) return;
  writeStorage(ACTIVE_TEAM_KEY, normalized);
}

export async function fetchInstalledTeams(): Promise<TeamOption[]> {
  try {
    const res = await fetch(`${GATEWAY_URL}/api/teams`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
      },
    });

    if (!res.ok) {
      if (res.status === 404 || res.status === 403) {
        return getCachedTeams();
      }
      throw new Error(`获取团队失败 (${res.status})`);
    }

    const payload = (await res.json()) as unknown;
    const templates = Array.isArray(payload) ? (payload as TemplatePayload[]) : [];
    const teams = mergeDefaultTeam(templates.map(normalizeTemplate).filter((team): team is TeamOption => Boolean(team)));
    cacheTeams(teams);
    return teams;
  } catch {
    return getCachedTeams();
  }
}
