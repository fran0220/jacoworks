import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentSummary, RecentAction } from "../lib/feed";
import type { TranslatedActivity } from "../lib/feed-translate";
import type { DashboardStats } from "../lib/ops-types";
import type { TeamTemplate, TeamTemplateMember } from "../lib/teams";
import {
  maybeSpritePackId,
  pickSpritePackIdFromSeed,
  resolveSpritePackIdForRole,
} from "../lib/sprite-packs";
import {
  buildTravelStatus,
  describeVillageState,
  formatVillageRoleLabel,
  getVillageAgentAccent,
  inferVillageFacing,
  type VillageAgentIntent,
  type VillageAgentModel,
  type VillageAgentState,
  VILLAGE_MOVE_DURATION_MS,
} from "./VillageAgent";
import {
  getVillageHomeZone,
  getVillageIdleZone,
  getVillageSlot,
  normalizeVillageRole,
  type VillageZoneId,
} from "./VillageZone";

export interface UseVillageBridgeResult {
  agents: VillageAgentModel[];
  activeCount: number;
  latestStory: string;
  highlightedAgentId: string | null;
}

type VillageEventKind =
  | "task_create"
  | "task_claim"
  | "task_start"
  | "task_submit"
  | "task_review"
  | "task_complete"
  | "task_rework"
  | "thinking"
  | "idle";

interface VillageActivityEvent {
  kind: VillageEventKind;
  agentId: string;
  agentName: string;
  detailText: string | null;
  timestamp: string | null;
  story: string;
}

function normalizeToken(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function prettifyMemberName(name: string): string {
  return name
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (token) => token.toUpperCase());
}

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

function findSummaryForMember(
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

function activityToEvent(
  activity: TranslatedActivity,
): VillageActivityEvent | null {
  const key = `${activity.rawMethod.toUpperCase()} ${activity.rawPath}`;
  let kind: VillageEventKind | null = null;

  if (/POST \/api\/tasks$/.test(key)) kind = "task_create";
  else if (/POST \/api\/sub-tasks\/.*\/claim/.test(key)) kind = "task_claim";
  else if (/POST \/api\/sub-tasks\/.*\/start/.test(key)) kind = "task_start";
  else if (/POST \/api\/sub-tasks\/.*\/submit/.test(key)) kind = "task_submit";
  else if (/POST \/api\/review-records/.test(key)) kind = "task_review";
  else if (/POST \/api\/sub-tasks\/.*\/complete/.test(key)) kind = "task_complete";
  else if (/POST \/api\/sub-tasks\/.*\/rework/.test(key)) kind = "task_rework";
  else if (/GET \/api\//.test(key)) kind = "thinking";

  if (!kind) return null;

  return {
    kind,
    agentId: activity.agentId,
    agentName: activity.agentName,
    detailText: activity.objectName,
    timestamp: activity.timestamp,
    story: `${activity.agentName} ${activity.verb}`,
  };
}

function isThinkingAction(action: RecentAction | undefined): boolean {
  if (!action) return false;
  const key = `${action.method.toUpperCase()} ${action.path}`;
  return /GET \/api\//.test(key) || /\/rules|\/tasks/.test(key);
}

function buildWorkingState(
  role: string,
  summary: AgentSummary,
): VillageAgentState {
  if (role === "reviewer" || role === "patrol") return "reviewing";
  if (isThinkingAction(summary.recent_actions[0])) return "thinking";
  if (role === "planner" || role === "researcher" || role === "writer") {
    return "thinking";
  }
  return "working";
}

function buildIntent(
  member: TeamTemplateMember,
  summary: AgentSummary | null,
  event: VillageActivityEvent | null,
  slotIndex: number,
): VillageAgentIntent {
  const normalizedRole = normalizeVillageRole(member.role || summary?.role || "member");
  const homeZoneId = getVillageHomeZone(normalizedRole);
  const isLeader = normalizedRole === "planner" || member.role === "leader";
  const detailText =
    summary?.current_sub_task?.name ?? event?.detailText ?? member.kickoff ?? null;
  const baseName = summary?.name || prettifyMemberName(member.name);
  const spritePackId =
    maybeSpritePackId(member.spritePackId) ??
    resolveSpritePackIdForRole(normalizedRole) ??
    pickSpritePackIdFromSeed(`${baseName}:${normalizedRole}`);

  let zoneId: VillageZoneId = getVillageIdleZone();
  let state: VillageAgentState = "idle";

  if (event?.kind === "task_complete") {
    zoneId = "plaza";
    state = "celebrating";
  } else if (event?.kind === "task_submit") {
    zoneId = "plaza";
    state = "walking";
  } else if (event?.kind === "task_review") {
    zoneId = "watchtower";
    state = "reviewing";
  } else if (event?.kind === "task_create") {
    zoneId = "hq";
    state = "thinking";
  } else if (event?.kind === "task_claim" || event?.kind === "task_start") {
    zoneId = homeZoneId;
    state = "working";
  } else if (event?.kind === "task_rework") {
    zoneId = homeZoneId;
    state = "thinking";
  } else if (summary?.current_sub_task) {
    zoneId = homeZoneId;
    state = buildWorkingState(normalizedRole, summary);
  }

  const statusText =
    state === "walking"
      ? buildTravelStatus(zoneId)
      : describeVillageState(state, normalizedRole);

  return {
    id: summary?.id || `${member.name}-${member.role}`,
    name: baseName,
    role: normalizedRole,
    roleLabel: formatVillageRoleLabel(normalizedRole),
    zoneId,
    homeZoneId,
    state,
    statusText,
    detailText,
    slotIndex,
    accent: getVillageAgentAccent(normalizedRole, isLeader),
    isLeader,
    spritePackId,
  };
}

function sameSpot(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05;
}

function clearTimer(timerId: number | undefined): void {
  if (timerId !== undefined) {
    window.clearTimeout(timerId);
  }
}

export function useVillageBridge(
  template: TeamTemplate,
  agentSummaries: AgentSummary[],
  activities: TranslatedActivity[],
  _dashboardStats: DashboardStats | null,
): UseVillageBridgeResult {
  const [agents, setAgents] = useState<VillageAgentModel[]>([]);
  const [readyToAnimate, setReadyToAnimate] = useState(false);
  const agentsRef = useRef<VillageAgentModel[]>([]);
  const timersRef = useRef<Record<string, number>>({});

  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  const eventsByAgent = useMemo(() => {
    const events = new Map<string, VillageActivityEvent>();
    for (const activity of activities) {
      const event = activityToEvent(activity);
      if (!event) continue;
      const idKey = normalizeToken(event.agentId);
      const nameKey = normalizeToken(event.agentName);
      if (idKey && !events.has(idKey)) events.set(idKey, event);
      if (nameKey && !events.has(nameKey)) events.set(nameKey, event);
    }
    return events;
  }, [activities]);

  const intents = useMemo(() => {
    const usedIds = new Set<string>();
    const zoneCounters = new Map<VillageZoneId, number>();

    return template.members.map((member) => {
      const summary = findSummaryForMember(member, agentSummaries, usedIds);
      const event =
        (summary &&
          (eventsByAgent.get(normalizeToken(summary.id)) ??
            eventsByAgent.get(normalizeToken(summary.name)))) ??
        eventsByAgent.get(normalizeToken(member.name)) ??
        null;
      const probeRole = normalizeVillageRole(member.role || summary?.role || "member");
      const draft = buildIntent(member, summary, event, 0);
      const zoneId = draft.zoneId || getVillageHomeZone(probeRole);
      const slotIndex = zoneCounters.get(zoneId) ?? 0;
      zoneCounters.set(zoneId, slotIndex + 1);
      return buildIntent(member, summary, event, slotIndex);
    });
  }, [agentSummaries, eventsByAgent, template.members]);

  useEffect(() => {
    Object.values(timersRef.current).forEach((timerId) => clearTimer(timerId));
    timersRef.current = {};

    const seeded = intents.map((intent, index) => {
      const shouldStartAtCampfire = intent.zoneId !== getVillageIdleZone();
      const startZone = shouldStartAtCampfire ? getVillageIdleZone() : intent.zoneId;
      const startPosition = getVillageSlot(startZone, index);
      const targetPosition = getVillageSlot(intent.zoneId, intent.slotIndex);
      return {
        ...intent,
        position: startPosition,
        targetZoneId: startZone,
        facing: inferVillageFacing(startPosition, targetPosition),
      } satisfies VillageAgentModel;
    });

    setAgents(seeded);
    setReadyToAnimate(false);
    const rafId = window.requestAnimationFrame(() => {
      setReadyToAnimate(true);
    });

    return () => {
      window.cancelAnimationFrame(rafId);
      Object.values(timersRef.current).forEach((timerId) => clearTimer(timerId));
      timersRef.current = {};
    };
  }, [template.id, template.version]);

  useEffect(() => {
    if (!readyToAnimate) return;

    const currentAgents = new Map(
      agentsRef.current.map((agent) => [agent.id, agent]),
    );

    const nextAgents = intents.map((intent) => {
      const existing = currentAgents.get(intent.id);
      const targetPosition = getVillageSlot(intent.zoneId, intent.slotIndex);

      if (!existing) {
        return {
          ...intent,
          position: targetPosition,
          targetZoneId: intent.zoneId,
          facing: "down",
        } satisfies VillageAgentModel;
      }

      if (
        existing.state === "walking" &&
        existing.targetZoneId === intent.zoneId
      ) {
        return {
          ...existing,
          ...intent,
          position: existing.position,
        };
      }

      const needsMove =
        existing.zoneId !== intent.zoneId ||
        !sameSpot(existing.position, targetPosition);

      if (needsMove) {
        clearTimer(timersRef.current[intent.id]);
        timersRef.current[intent.id] = window.setTimeout(() => {
          setAgents((prev) =>
            prev.map((agent) => {
              if (agent.id !== intent.id) return agent;
              return {
                ...agent,
                ...intent,
                position: targetPosition,
                targetZoneId: intent.zoneId,
                statusText: intent.statusText,
              };
            }),
          );
          delete timersRef.current[intent.id];
        }, VILLAGE_MOVE_DURATION_MS);

        return {
          ...existing,
          ...intent,
          state: "walking",
          statusText: buildTravelStatus(intent.zoneId),
          position: targetPosition,
          targetZoneId: intent.zoneId,
          facing: inferVillageFacing(existing.position, targetPosition),
        } satisfies VillageAgentModel;
      }

      return {
        ...existing,
        ...intent,
        position: targetPosition,
        targetZoneId: intent.zoneId,
      } satisfies VillageAgentModel;
    });

    setAgents(nextAgents);
  }, [intents, readyToAnimate]);

  const activeCount = useMemo(
    () => intents.filter((intent) => intent.state !== "idle").length,
    [intents],
  );

  const latestStory = useMemo(() => {
    const event = activities[0] ? activityToEvent(activities[0]) : null;
    if (event) return event.story;
    if (activeCount > 0) return `${activeCount} 名 Agent 正在村中协作`;
    return "营火区安静待命，等待下一批任务靠港。";
  }, [activities, activeCount]);

  const highlightedAgentId = useMemo(() => {
    const event = activities[0] ? activityToEvent(activities[0]) : null;
    return event?.agentId || null;
  }, [activities]);

  return {
    agents,
    activeCount,
    latestStory,
    highlightedAgentId,
  };
}
