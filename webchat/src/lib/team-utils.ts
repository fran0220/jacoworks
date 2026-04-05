import type { AgentPreset, TeamsResponse, TeamTemplate } from "./teams";
import type { AgentSummary } from "./feed";
import { DEFAULT_SESSION_KEY } from "./config";

export interface TeamOption {
  sessionKey: string;
  label: string;
  source: "preset" | "profile" | "default";
}

export interface ResolvedLeaderInfo {
  sessionKey: string;
  id: string | null;
  name: string;
  role: string;
}

export function getTemplateWorkspacePrefix(template: TeamTemplate): string {
  const prefix = template.workspaceKeyPrefix.trim();
  return prefix || `team:${template.id}`;
}

export function getTemplateSessionKey(
  template: TeamTemplate,
  fallback = DEFAULT_SESSION_KEY,
): string {
  const prefix = getTemplateWorkspacePrefix(template);
  return prefix || fallback;
}

export function matchesTemplateSessionKey(
  template: TeamTemplate,
  sessionKey: string,
): boolean {
  const prefix = getTemplateWorkspacePrefix(template);
  const normalized = sessionKey.trim();
  return normalized === prefix || normalized.startsWith(`${prefix}:`);
}

export function parseAgentIdFromSessionKey(sessionKey: string): string | null {
  const trimmed = sessionKey.trim();
  if (trimmed === "agent:default:main") return "default";
  const match = trimmed.match(/^agent:([^:]+)(?::(?:main|t-[^:]+))?$/);
  return match ? match[1] : null;
}

export function parseTeamTemplateIdFromSessionKey(
  sessionKey: string,
): string | null {
  const match = sessionKey.trim().match(/^team:([^:]+)(?::|$)/);
  return match ? match[1] : null;
}

function findTemplateForSessionKey(
  data: TeamsResponse,
  sessionKey: string,
): TeamTemplate | null {
  return (
    data.templates.find((template) =>
      matchesTemplateSessionKey(template, sessionKey),
    ) ?? null
  );
}

export function buildTeamOptions(
  data: TeamsResponse,
  presets: AgentPreset[] = [],
): TeamOption[] {
  const options: TeamOption[] = [];

  const pushOption = (option: TeamOption) => {
    if (!options.some((item) => item.sessionKey === option.sessionKey)) {
      options.push(option);
    }
  };

  for (const preset of presets) {
    pushOption({
      sessionKey: preset.workspaceKey,
      label: preset.label,
      source: preset.id === "default" ? "default" : "preset",
    });
  }

  for (const profile of data.profiles) {
    pushOption({
      sessionKey: profile.sessionKey,
      label: profile.displayName,
      source: "profile",
    });
  }

  if (!options.some((option) => option.sessionKey === DEFAULT_SESSION_KEY)) {
    pushOption({
      sessionKey: DEFAULT_SESSION_KEY,
      label: "默认助手",
      source: "default",
    });
  }

  return options;
}

export function resolveLeaderInfo(
  data: TeamsResponse,
  activeSessionKey: string,
  summaries?: AgentSummary[],
  presets: AgentPreset[] = [],
): ResolvedLeaderInfo | null {
  const template = findTemplateForSessionKey(data, activeSessionKey);
  if (template) {
    return {
      sessionKey: activeSessionKey,
      id: parseTeamTemplateIdFromSessionKey(activeSessionKey),
      name: template.label,
      role: "leader",
    };
  }

  const agentId = parseAgentIdFromSessionKey(activeSessionKey);
  const preset = presets.find((item) => item.workspaceKey === activeSessionKey);
  if (preset) {
    return {
      sessionKey: activeSessionKey,
      id: preset.id,
      name: preset.label,
      role: preset.id === "default" ? "default" : "leader",
    };
  }

  if (agentId && summaries) {
    const summary = summaries.find((item) => item.id === agentId);
    if (summary) {
      return {
        sessionKey: activeSessionKey,
        id: summary.id,
        name: summary.name,
        role: summary.role,
      };
    }
  }

  const profile = data.profiles.find(
    (item) => item.sessionKey === activeSessionKey,
  );
  if (profile) {
    return {
      sessionKey: activeSessionKey,
      id: agentId,
      name: profile.displayName,
      role: "planner",
    };
  }

  if (data.profiles.length > 0) {
    const profileFallback = data.profiles[0];
    return {
      sessionKey: activeSessionKey,
      id: parseAgentIdFromSessionKey(profileFallback.sessionKey),
      name: profileFallback.displayName,
      role: "planner",
    };
  }

  return null;
}
