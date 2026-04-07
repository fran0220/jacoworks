import type { AgentSummary } from "../../lib/feed";
import type { TeamTemplateMember } from "../../lib/teams";
import { normalizeVillageRole } from "../VillageZone";
import { normalizeToken } from "./events";

function matchesSummaryToMember(
  member: TeamTemplateMember,
  summary: AgentSummary,
  usedIds: Set<string>,
): number {
  if (usedIds.has(summary.id)) return -1;

  const memberName = normalizeToken(member.name);
  const memberRole = normalizeVillageRole(member.role);
  const summaryName = normalizeToken(summary.name);
  const summaryId = normalizeToken(summary.id);
  const summaryRole = normalizeVillageRole(summary.role);

  let score = 0;
  if (memberName && summaryName === memberName) score += 6;
  if (memberName && summaryId.includes(memberName)) score += 4;
  if (memberRole && summaryRole === memberRole) score += 3;
  if (memberName && summaryName.includes(memberName)) score += 2;
  return score;
}

export function findSummaryForMember(
  member: TeamTemplateMember,
  summaries: AgentSummary[],
  usedIds: Set<string>,
): AgentSummary | null {
  let best: AgentSummary | null = null;
  let bestScore = -1;

  for (const summary of summaries) {
    const score = matchesSummaryToMember(member, summary, usedIds);
    if (score > bestScore) {
      best = summary;
      bestScore = score;
    }
  }

  if (best && bestScore > 0) {
    usedIds.add(best.id);
    return best;
  }

  return null;
}
