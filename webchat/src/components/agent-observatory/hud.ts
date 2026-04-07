import type { AgentSummary } from "../../lib/feed";
import type { AgentPreset, TeamsResponse, TemplateTheme } from "../../lib/teams";
import { buildTeamOptions, matchesTemplateSessionKey } from "../../lib/team-utils";
import { roleColor } from "./theme";

export function buildTeamOptionsWithFallback(
  teamsData: TeamsResponse | null,
  presets: AgentPreset[],
  activeTeamSessionKey: string,
) {
  if (!teamsData) return [];
  const options = buildTeamOptions(teamsData, presets);
  if (options.some((option) => option.sessionKey === activeTeamSessionKey)) {
    return options;
  }

  const activeTemplate = teamsData.templates.find((template) =>
    matchesTemplateSessionKey(template, activeTeamSessionKey),
  );
  const activeLabel = activeTemplate?.label || activeTeamSessionKey;

  return [
    {
      sessionKey: activeTeamSessionKey,
      label: activeLabel,
      source: "default" as const,
    },
    ...options,
  ];
}

export function buildRoleMatrix(agents: AgentSummary[], theme?: TemplateTheme) {
  const grouped = new Map<
    string,
    { role: string; label: string; color: string; count: number }
  >();

  for (const agent of agents) {
    const next = grouped.get(agent.role);
    if (next) {
      next.count += 1;
      continue;
    }
    grouped.set(agent.role, {
      role: agent.role,
      label: theme?.roles?.[agent.role]?.displayName ?? agent.role,
      color: roleColor(agent.role, theme),
      count: 1,
    });
  }

  return Array.from(grouped.values());
}
