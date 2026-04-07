import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentSummary } from "../lib/feed";
import type { TranslatedActivity } from "../lib/feed-translate";
import type { ActivityStreamEvent } from "../hooks/useActivityStream";
import type { DashboardStats } from "../lib/ops-types";
import type { TeamTemplate } from "../lib/teams";
import {
  buildTravelStatus,
  inferVillageFacing,
  type VillageAgentModel,
  VILLAGE_MOVE_DURATION_MS,
} from "./VillageAgent";
import {
  getVillageHomeZone,
  getVillageIdleZone,
  getVillageSlot,
  normalizeVillageRole,
  type VillageZoneId,
} from "./VillageZone";
import { activityToEvent, normalizeToken, sseEventToVillageEvent } from "./bridge/events";
import { buildIntent } from "./bridge/intent";
import { findSummaryForMember } from "./bridge/matching";
import type { UseVillageBridgeResult } from "./bridge/types";
import { buildZoneEffects } from "./bridge/zone-effects";

export type { UseVillageBridgeResult, VillageZoneEffect } from "./bridge/types";

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
  sseEvents?: ActivityStreamEvent[],
): UseVillageBridgeResult {
  const [agents, setAgents] = useState<VillageAgentModel[]>([]);
  const [readyToAnimate, setReadyToAnimate] = useState(false);
  const agentsRef = useRef<VillageAgentModel[]>([]);
  const timersRef = useRef<Record<string, number>>({});
  const zoneEffects = useMemo(() => buildZoneEffects(agentSummaries), [agentSummaries]);

  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  const eventsByAgent = useMemo(() => {
    const events = new Map<string, ReturnType<typeof sseEventToVillageEvent>>();

    if (sseEvents && sseEvents.length > 0) {
      for (const sseEvent of sseEvents) {
        const villageEvent = sseEventToVillageEvent(sseEvent);
        const idKey = normalizeToken(villageEvent.agentId);
        const nameKey = normalizeToken(villageEvent.agentName);
        if (idKey && !events.has(idKey)) events.set(idKey, villageEvent);
        if (nameKey && !events.has(nameKey)) events.set(nameKey, villageEvent);
      }
    }

    for (const activity of activities) {
      const event = activityToEvent(activity);
      if (!event) continue;
      const idKey = normalizeToken(event.agentId);
      const nameKey = normalizeToken(event.agentName);
      if (idKey && !events.has(idKey)) events.set(idKey, event);
      if (nameKey && !events.has(nameKey)) events.set(nameKey, event);
    }
    return events;
  }, [activities, sseEvents]);

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

    const currentAgents = new Map(agentsRef.current.map((agent) => [agent.id, agent]));

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
    () =>
      intents.filter(
        (intent) => intent.state !== "idle" && intent.state !== "resting",
      ).length,
    [intents],
  );

  const latestStory = useMemo(() => {
    if (sseEvents && sseEvents.length > 0) {
      const sseStory = sseEventToVillageEvent(sseEvents[0]);
      return sseStory.story;
    }
    const event = activities[0] ? activityToEvent(activities[0]) : null;
    if (event) return event.story;
    if (activeCount > 0) return `${activeCount} 名 Agent 正在村中协作`;
    return "营火区安静待命，等待下一批任务靠港。";
  }, [activities, activeCount, sseEvents]);

  const highlightedAgentId = useMemo(() => {
    if (sseEvents && sseEvents.length > 0) {
      return sseEvents[0].agentId || null;
    }
    const event = activities[0] ? activityToEvent(activities[0]) : null;
    return event?.agentId || null;
  }, [activities, sseEvents]);

  return {
    agents,
    activeCount,
    latestStory,
    highlightedAgentId,
    zoneEffects,
  };
}
