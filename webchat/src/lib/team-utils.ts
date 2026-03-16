import type { TeamsResponse, TeamTemplate, TeamAgent } from "./teams";
import type { AgentSummary } from "./feed";
import { DEFAULT_OPENCLAW_SESSION_KEY } from "./config";

export interface TeamOption {
  sessionKey: string;
  label: string;
  source: "profile" | "installed" | "default";
}

export interface ResolvedLeaderInfo {
  sessionKey: string;
  id: string | null;
  name: string;
  role: string;
}

export function getLeader(template: TeamTemplate): TeamAgent | null {
  return (
    template.agents.find((a) => a.isLeader) ??
    template.agents.find((a) => a.id.trim().length > 0) ??
    null
  );
}

export function getTemplateSessionKey(template: TeamTemplate, fallback = DEFAULT_OPENCLAW_SESSION_KEY): string {
  const leader = getLeader(template);
  return leader ? `agent:${leader.id}:main` : fallback;
}

export function parseAgentIdFromSessionKey(sessionKey: string): string | null {
  const match = sessionKey.match(/^agent:(.+):main$/);
  return match ? match[1] : null;
}

export function buildTeamOptions(data: TeamsResponse): TeamOption[] {
  const options: TeamOption[] = [];

  // Profiles
  for (const p of data.profiles) {
    options.push({ sessionKey: p.sessionKey, label: p.displayName, source: "profile" });
  }

  // Default fallback if no profiles
  if (data.profiles.length === 0) {
    options.push({ sessionKey: DEFAULT_OPENCLAW_SESSION_KEY, label: "默认助手", source: "default" });
  }

  // Installed team
  if (data.installed) {
    const tmpl = data.available.find((t) => t.name === data.installed);
    if (tmpl) {
      const sk = getTemplateSessionKey(tmpl);
      // Avoid duplicate if a profile already has this sessionKey
      if (!options.some((o) => o.sessionKey === sk)) {
        options.push({ sessionKey: sk, label: tmpl.displayName, source: "installed" });
      }
    }
  }

  return options;
}

export function resolveLeaderInfo(
  data: TeamsResponse,
  activeSessionKey: string,
  summaries?: AgentSummary[],
): ResolvedLeaderInfo | null {
  const agentId = parseAgentIdFromSessionKey(activeSessionKey);

  // Try installed template first
  if (data.installed) {
    const tmpl = data.available.find((t) => t.name === data.installed);
    if (tmpl) {
      const leader = getLeader(tmpl);
      if (leader && agentId && leader.id === agentId) {
        return { sessionKey: activeSessionKey, id: leader.id, name: leader.name, role: leader.role };
      }
    }
  }

  // Try matching agent summary by id
  if (agentId && summaries) {
    const summary = summaries.find((s) => s.id === agentId);
    if (summary) {
      return { sessionKey: activeSessionKey, id: summary.id, name: summary.name, role: summary.role };
    }
  }

  // Try profile metadata
  const profile = data.profiles.find((p) => p.sessionKey === activeSessionKey);
  if (profile) {
    return { sessionKey: activeSessionKey, id: agentId, name: profile.displayName, role: "planner" };
  }

  // Fallback: installed template leader
  if (data.installed) {
    const tmpl = data.available.find((t) => t.name === data.installed);
    if (tmpl) {
      const leader = getLeader(tmpl);
      if (leader) {
        return { sessionKey: activeSessionKey, id: leader.id, name: leader.name, role: leader.role };
      }
    }
  }

  // Last resort from profiles
  if (data.profiles.length > 0) {
    const p = data.profiles[0];
    return { sessionKey: activeSessionKey, id: parseAgentIdFromSessionKey(p.sessionKey), name: p.displayName, role: "planner" };
  }

  return null;
}
