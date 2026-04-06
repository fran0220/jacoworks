import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentSummary, RecentAction } from "../lib/feed";
import type { TranslatedActivity } from "../lib/feed-translate";
import type { DashboardStats } from "../lib/ops-types";
import {
  pickSpritePackIdFromSeed,
  resolveSpritePackIdForRole,
} from "../lib/sprite-packs";
import {
  buildCityTravelStatus,
  CITY_MOVE_DURATION_MS,
  describeCityState,
  formatCityRoleLabel,
  getCityAgentAccent,
  inferCityFacing,
  interpolateCityPoint,
  type CityAgentIntent,
  type CityAgentModel,
  type CityAgentState,
} from "./CityAgent";
import {
  getCityHomeZone,
  getCityIdleZone,
  getCitySlot,
  normalizeCityRole,
  type CityPoint,
  type CityZoneId,
} from "./CityZone";

export interface UseCityBridgeResult {
  agents: CityAgentModel[];
  activeCount: number;
  latestStory: string;
  highlightedAgentId: string | null;
}

type CityEventKind =
  | "task_create"
  | "task_claim"
  | "task_start"
  | "task_submit"
  | "task_review"
  | "task_complete"
  | "task_rework"
  | "thinking"
  | "idle";

interface CityActivityEvent {
  kind: CityEventKind;
  agentId: string;
  agentName: string;
  detailText: string | null;
  timestamp: string | null;
  story: string;
}

interface CityAgentSource {
  id: string;
  name: string;
  role: string;
  currentSubTask: AgentSummary["current_sub_task"];
  recentActions: RecentAction[];
}

interface CityAnimation {
  from: CityPoint;
  to: CityPoint;
  facing: CityAgentModel["facing"];
  intent: CityAgentIntent;
  startedAt: number;
}

function normalizeToken(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function prettifyAgentName(name: string): string {
  return name
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (token) => token.toUpperCase());
}

function activityToEvent(activity: TranslatedActivity): CityActivityEvent | null {
  const key = `${activity.rawMethod.toUpperCase()} ${activity.rawPath}`;
  let kind: CityEventKind | null = null;

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

function getActivityAgentKey(event: Pick<CityActivityEvent, "agentId" | "agentName">): string {
  return normalizeToken(event.agentId) || `agent:${normalizeToken(event.agentName)}`;
}

function isThinkingAction(action: RecentAction | undefined): boolean {
  if (!action) return false;
  const key = `${action.method.toUpperCase()} ${action.path}`;
  return /GET \/api\//.test(key) || /\/rules|\/tasks/.test(key);
}

function buildWorkingState(role: string, summary: CityAgentSource): CityAgentState {
  if (role === "reviewer" || role === "patrol") return "reviewing";
  if (isThinkingAction(summary.recentActions[0])) return "thinking";
  if (role === "planner" || role === "researcher" || role === "writer") {
    return "thinking";
  }
  return "working";
}

function buildIntent(
  agent: CityAgentSource,
  event: CityActivityEvent | null,
  slotIndex: number,
): CityAgentIntent {
  const normalizedRole = normalizeCityRole(agent.role || "member");
  const homeZoneId = getCityHomeZone(normalizedRole);
  const isLeader = normalizedRole === "planner" || agent.role === "leader";
  const detailText = agent.currentSubTask?.name ?? event?.detailText ?? null;
  const baseName = agent.name || prettifyAgentName(agent.id);
  const spritePackId =
    resolveSpritePackIdForRole(normalizedRole) ||
    pickSpritePackIdFromSeed(`${agent.id}:${normalizedRole}`);

  let zoneId: CityZoneId = getCityIdleZone();
  let state: CityAgentState = "idle";

  if (event?.kind === "task_complete") {
    zoneId = "city_hall";
    state = "celebrating";
  } else if (event?.kind === "task_submit") {
    zoneId = "logistics_port";
    state = "walking";
  } else if (event?.kind === "task_review") {
    zoneId = "data_hub";
    state = "reviewing";
  } else if (event?.kind === "task_create") {
    zoneId = "innovation_center";
    state = "thinking";
  } else if (event?.kind === "task_claim" || event?.kind === "task_start") {
    zoneId = homeZoneId;
    state = "working";
  } else if (event?.kind === "task_rework") {
    zoneId = "innovation_center";
    state = "thinking";
  } else if (agent.currentSubTask) {
    zoneId = homeZoneId;
    state = buildWorkingState(normalizedRole, agent);
  }

  const statusText =
    state === "walking"
      ? buildCityTravelStatus(zoneId)
      : describeCityState(state, normalizedRole);

  return {
    id: agent.id,
    name: baseName,
    role: normalizedRole,
    roleLabel: formatCityRoleLabel(normalizedRole),
    zoneId,
    homeZoneId,
    state,
    statusText,
    detailText,
    slotIndex,
    accent: getCityAgentAccent(normalizedRole, isLeader),
    isLeader,
    spritePackId,
  };
}

function sameSpot(a: CityPoint, b: CityPoint): boolean {
  return Math.abs(a.lng - b.lng) < 0.00001 && Math.abs(a.lat - b.lat) < 0.00001;
}

function easeInOutCubic(progress: number): number {
  if (progress < 0.5) return 4 * progress * progress * progress;
  return 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

function buildFallbackSources(
  activities: TranslatedActivity[],
  seenIds: Set<string>,
): CityAgentSource[] {
  const sources: CityAgentSource[] = [];
  for (const activity of activities) {
    const id = getActivityAgentKey({
      agentId: activity.agentId,
      agentName: activity.agentName,
    });
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    sources.push({
      id,
      name: activity.agentName || "Agent",
      role: "member",
      currentSubTask: null,
      recentActions: [],
    });
  }
  return sources;
}

function buildSettledAgent(
  intent: CityAgentIntent,
  position: CityPoint,
  facing: CityAgentModel["facing"],
  existing?: CityAgentModel,
): CityAgentModel {
  return {
    ...existing,
    ...intent,
    position,
    targetZoneId: intent.zoneId,
    facing,
  } satisfies CityAgentModel;
}

function buildWalkingAgent(
  intent: CityAgentIntent,
  position: CityPoint,
  facing: CityAgentModel["facing"],
  existing?: CityAgentModel,
): CityAgentModel {
  return {
    ...existing,
    ...intent,
    state: "walking",
    statusText: buildCityTravelStatus(intent.zoneId),
    position,
    targetZoneId: intent.zoneId,
    facing,
  } satisfies CityAgentModel;
}

export function useCityBridge(
  agentSummaries: AgentSummary[],
  activities: TranslatedActivity[],
  dashboardStats: DashboardStats | null,
): UseCityBridgeResult {
  const [agents, setAgents] = useState<CityAgentModel[]>([]);
  const agentsRef = useRef<CityAgentModel[]>([]);
  const frameRef = useRef<number | null>(null);
  const animationsRef = useRef<Record<string, CityAnimation>>({});

  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  const eventsByAgent = useMemo(() => {
    const events = new Map<string, CityActivityEvent>();
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

  const agentSources = useMemo(() => {
    const seenIds = new Set<string>();
    const primary = agentSummaries.map((summary) => {
      const id = summary.id || `agent:${normalizeToken(summary.name)}`;
      seenIds.add(id);
      return {
        id,
        name: summary.name || prettifyAgentName(id),
        role: summary.role || "member",
        currentSubTask: summary.current_sub_task,
        recentActions: summary.recent_actions,
      } satisfies CityAgentSource;
    });
    return [...primary, ...buildFallbackSources(activities, seenIds)];
  }, [activities, agentSummaries]);

  const intents = useMemo(() => {
    const zoneCounters = new Map<CityZoneId, number>();

    return agentSources.map((agent) => {
      const event =
        eventsByAgent.get(normalizeToken(agent.id)) ??
        eventsByAgent.get(normalizeToken(agent.name)) ??
        null;
      const draft = buildIntent(agent, event, 0);
      const slotIndex = zoneCounters.get(draft.zoneId) ?? 0;
      zoneCounters.set(draft.zoneId, slotIndex + 1);
      return buildIntent(agent, event, slotIndex);
    });
  }, [agentSources, eventsByAgent]);

  const advanceAnimations = useCallback((timestamp: number) => {
    setAgents((previous) => {
      let hasActiveAnimation = false;

      const next = previous.map((agent) => {
        const animation = animationsRef.current[agent.id];
        if (!animation) return agent;

        const rawProgress = (timestamp - animation.startedAt) / CITY_MOVE_DURATION_MS;
        const progress = Math.max(0, Math.min(1, rawProgress));

        if (progress >= 1) {
          delete animationsRef.current[agent.id];
          return buildSettledAgent(
            animation.intent,
            animation.to,
            animation.facing,
            agent,
          );
        }

        hasActiveAnimation = true;
        return buildWalkingAgent(
          animation.intent,
          interpolateCityPoint(
            animation.from,
            animation.to,
            easeInOutCubic(progress),
          ),
          animation.facing,
          agent,
        );
      });

      agentsRef.current = next;
      if (hasActiveAnimation) {
        frameRef.current = window.requestAnimationFrame(advanceAnimations);
      } else {
        frameRef.current = null;
      }
      return next;
    });
  }, []);

  const ensureAnimationLoop = useCallback(() => {
    if (frameRef.current !== null) return;
    if (Object.keys(animationsRef.current).length === 0) return;
    frameRef.current = window.requestAnimationFrame(advanceAnimations);
  }, [advanceAnimations]);

  useEffect(() => {
    const currentAgents = new Map(agentsRef.current.map((agent) => [agent.id, agent]));
    const seenIds = new Set<string>();
    const now = performance.now();
    const idleZoneId = getCityIdleZone();

    const nextAgents = intents.map((intent) => {
      seenIds.add(intent.id);
      const existing = currentAgents.get(intent.id);
      const targetPosition = getCitySlot(intent.zoneId, intent.slotIndex);
      const startPosition =
        existing?.position ??
        (intent.zoneId === idleZoneId
          ? targetPosition
          : getCitySlot(idleZoneId, intent.slotIndex));

      if (existing && existing.zoneId === intent.zoneId && sameSpot(existing.position, targetPosition)) {
        delete animationsRef.current[intent.id];
        return buildSettledAgent(
          intent,
          targetPosition,
          existing.facing,
          existing,
        );
      }

      if (sameSpot(startPosition, targetPosition)) {
        delete animationsRef.current[intent.id];
        return buildSettledAgent(
          intent,
          targetPosition,
          existing?.facing ?? "down",
          existing,
        );
      }

      const facing = inferCityFacing(startPosition, targetPosition);
      animationsRef.current[intent.id] = {
        from: startPosition,
        to: targetPosition,
        facing,
        intent,
        startedAt: now,
      };

      return buildWalkingAgent(intent, startPosition, facing, existing);
    });

    for (const agentId of Object.keys(animationsRef.current)) {
      if (!seenIds.has(agentId)) delete animationsRef.current[agentId];
    }

    if (Object.keys(animationsRef.current).length === 0 && frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    agentsRef.current = nextAgents;
    setAgents(nextAgents);
    ensureAnimationLoop();
  }, [ensureAnimationLoop, intents]);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
      frameRef.current = null;
      animationsRef.current = {};
    };
  }, []);

  const activeCount = useMemo(
    () => intents.filter((intent) => intent.state !== "idle").length,
    [intents],
  );

  const latestStory = useMemo(() => {
    const event = activities[0] ? activityToEvent(activities[0]) : null;
    if (event) return event.story;
    if ((dashboardStats?.activeTasks ?? 0) > 0) {
      return `${dashboardStats?.activeTasks ?? 0} 条任务正在亦庄路网中流转`;
    }
    if (activeCount > 0) return `${activeCount} 名 Agent 正在数字之城协作`;
    return "生态花园保持低频待命，城市节点暂时平稳。";
  }, [activities, activeCount, dashboardStats?.activeTasks]);

  const highlightedAgentId = useMemo(() => {
    const event = activities[0] ? activityToEvent(activities[0]) : null;
    if (!event) return null;
    const eventKey = getActivityAgentKey(event);
    const match = agents.find(
      (agent) =>
        normalizeToken(agent.id) === eventKey ||
        normalizeToken(agent.name) === normalizeToken(event.agentName),
    );
    return match?.id ?? null;
  }, [activities, agents]);

  return {
    agents,
    activeCount,
    latestStory,
    highlightedAgentId,
  };
}
