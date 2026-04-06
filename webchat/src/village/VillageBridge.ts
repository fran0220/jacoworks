import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentSummary, RecentAction } from "../lib/feed";
import type { TranslatedActivity } from "../lib/feed-translate";
import type { ActivityStreamEvent } from "../hooks/useActivityStream";
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
  resolveVillageZoneForPath,
  type VillageZoneId,
} from "./VillageZone";

export interface VillageZoneEffect {
  reserveCount: number;
  reservedPaths: string[];
}

export interface UseVillageBridgeResult {
  agents: VillageAgentModel[];
  activeCount: number;
  latestStory: string;
  highlightedAgentId: string | null;
  zoneEffects: Partial<Record<VillageZoneId, VillageZoneEffect>>;
}

type VillageEventKind =
  | "task_create"
  | "task_claim"
  | "task_start"
  | "task_submit"
  | "task_review"
  | "task_complete"
  | "task_rework"
  | "task_failed"
  | "task_timeout"
  | "file_reserve"
  | "message_dm"
  | "message_broadcast"
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

function parseBody(body: string | null): Record<string, unknown> {
  if (!body) return {};
  try {
    const parsed = JSON.parse(body) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function extractReservationPaths(body: Record<string, unknown>): string[] {
  const arraySource = body.reserved_paths ?? body.reservations ?? body.file_reservations;

  const values = (Array.isArray(arraySource) ? arraySource : [])
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (!item || typeof item !== "object") return "";
      const rec = item as Record<string, unknown>;
      return (
        normalizeToken(String(rec.path ?? "")) ||
        normalizeToken(String(rec.file_path ?? "")) ||
        normalizeToken(String(rec.filePath ?? ""))
      );
    })
    .filter((item): item is string => Boolean(item));

  return Array.from(new Set(values));
}

function hasReservationPayload(body: Record<string, unknown>): boolean {
  return (
    Array.isArray(body.reserved_paths) ||
    Array.isArray(body.reservations) ||
    Array.isArray(body.file_reservations)
  );
}

function extractMessageText(body: Record<string, unknown>): string | null {
  const candidate =
    body.message ??
    body.content ??
    body.text ??
    body.summary ??
    body.body;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function extractMessageTarget(body: Record<string, unknown>): string | null {
  const candidate = body.target ?? body.to ?? body.recipient ?? body.channel;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function summarizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "文件工位";
  const parts = trimmed.split("/").filter(Boolean);
  return parts[parts.length - 1] || trimmed;
}

function summarizeReservations(paths: string[]): string | null {
  if (paths.length === 0) return null;
  const [first, ...rest] = paths;
  return rest.length > 0
    ? `锁定 ${summarizePath(first)} +${rest.length}`
    : `锁定 ${summarizePath(first)}`;
}

function resolveReservationZone(paths: string[], fallback: VillageZoneId): VillageZoneId {
  if (paths.length === 0) return fallback;
  const counters = new Map<VillageZoneId, number>();
  for (const path of paths) {
    const zoneId = resolveVillageZoneForPath(path);
    counters.set(zoneId, (counters.get(zoneId) ?? 0) + 1);
  }
  let bestZone = fallback;
  let bestScore = -1;
  for (const [zoneId, score] of counters) {
    if (score > bestScore) {
      bestZone = zoneId;
      bestScore = score;
    }
  }
  return bestZone;
}

function getPresenceState(summary: AgentSummary | null, role: string): VillageAgentState | null {
  if (!summary?.presence_state) return null;
  if (summary.presence_state === "stuck") return "stuck";
  if (summary.presence_state === "idle") return "resting";
  if (summary.presence_state === "away") return "idle";
  if (summary.presence_state === "active") {
    return summary.current_sub_task ? buildWorkingState(role, summary) : "working";
  }
  return null;
}

function getCrewStatusText(
  state: VillageAgentState,
  zoneId: VillageZoneId,
  reservedPaths: string[],
): string {
  if (state === "walking") return buildTravelStatus(zoneId);
  if (state === "stuck") return "卡在当前流程，等待外援";
  if (reservedPaths.length > 0) {
    return state === "resting" ? "守着已预留的文件工位" : "围着预留文件持续推进";
  }
  return describeVillageState(state, "member");
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
  const body = parseBody(activity.rawBody);
  let kind: VillageEventKind | null = null;

  if (/POST \/api\/tasks$/.test(key)) kind = "task_create";
  else if (/POST \/api\/sub-tasks\/.*\/claim/.test(key)) kind = "task_claim";
  else if (/POST \/api\/sub-tasks\/.*\/start/.test(key)) kind = "task_start";
  else if (/POST \/api\/sub-tasks\/.*\/submit/.test(key)) kind = "task_submit";
  else if (/POST \/api\/review-records/.test(key)) kind = "task_review";
  else if (/POST \/api\/sub-tasks\/.*\/complete/.test(key)) kind = "task_complete";
  else if (/POST \/api\/sub-tasks\/.*\/rework/.test(key)) kind = "task_rework";
  else if (/reserve|lock/.test(key) || hasReservationPayload(body)) kind = "file_reserve";
  else if (/message|broadcast|inbox|dm/.test(key) || (extractMessageText(body) && extractMessageTarget(body))) {
    kind = /broadcast|channel|team|all/.test(key) || /broadcast|team|all/.test(extractMessageTarget(body) ?? "")
      ? "message_broadcast"
      : "message_dm";
  }
  else if (/GET \/api\//.test(key)) kind = "thinking";

  if (!kind) return null;

  const reservationSummary = summarizeReservations(extractReservationPaths(body));
  const messageText = extractMessageText(body);
  const detailText =
    kind === "file_reserve"
      ? reservationSummary ?? activity.objectName
      : kind === "message_dm" || kind === "message_broadcast"
        ? messageText ?? activity.objectName
        : activity.objectName;
  const story =
    kind === "file_reserve"
      ? `${activity.agentName} 锁定了文件工位`
      : kind === "message_broadcast"
        ? `${activity.agentName} 正在向全队广播`
        : kind === "message_dm"
          ? `${activity.agentName} 正在传递消息`
          : `${activity.agentName} ${activity.verb}`;

  return {
    kind,
    agentId: activity.agentId,
    agentName: activity.agentName,
    detailText,
    timestamp: activity.timestamp,
    story,
  };
}

function describeEventKind(kind: string): string {
  switch (kind) {
    case "task_create": return "创建了新任务";
    case "task_claim": return "领取了任务";
    case "task_start": return "开始执行";
    case "task_submit": return "提交了任务";
    case "task_review": return "提交了审查";
    case "task_complete": return "完成了任务";
    case "task_rework": return "返工中";
    case "task_failed": return "执行失败";
    case "task_timeout": return "执行超时";
    case "file_reserve": return "锁定了文件";
    case "message_dm": return "发来了一条私信";
    case "message_broadcast": return "向全队广播了消息";
    default: return kind;
  }
}

function sseEventToVillageEvent(
  sseEvent: ActivityStreamEvent,
): VillageActivityEvent {
  return {
    kind: sseEvent.kind as VillageEventKind,
    agentId: sseEvent.agentId,
    agentName: sseEvent.agentName,
    detailText: sseEvent.detail,
    timestamp: sseEvent.ts,
    story: `${sseEvent.agentName} ${describeEventKind(sseEvent.kind)}`,
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
  const baseName = summary?.name || prettifyMemberName(member.name);
  const reservedPaths = summary?.reserved_paths ?? [];
  const reservationZoneId = resolveReservationZone(reservedPaths, homeZoneId);
  const reservationHint = summarizeReservations(reservedPaths);
  const spritePackId =
    maybeSpritePackId(member.spritePackId) ??
    resolveSpritePackIdForRole(normalizedRole) ??
    pickSpritePackIdFromSeed(`${baseName}:${normalizedRole}`);

  let zoneId: VillageZoneId = reservedPaths.length > 0 ? reservationZoneId : getVillageIdleZone();
  let state: VillageAgentState = getPresenceState(summary, normalizedRole) ?? (reservedPaths.length > 0 ? "resting" : "idle");
  let detailText =
    event?.detailText ??
    summary?.latest_message ??
    summary?.current_sub_task?.name ??
    reservationHint ??
    member.kickoff ??
    null;

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
    zoneId = reservedPaths.length > 0 ? reservationZoneId : homeZoneId;
    state = getPresenceState(summary, normalizedRole) ?? "working";
  } else if (event?.kind === "task_rework") {
    zoneId = reservedPaths.length > 0 ? reservationZoneId : homeZoneId;
    state = "thinking";
  } else if (event?.kind === "task_failed" || event?.kind === "task_timeout") {
    zoneId = reservedPaths.length > 0 ? reservationZoneId : homeZoneId;
    state = summary?.presence_state === "stuck" ? "stuck" : "idle";
  } else if (event?.kind === "file_reserve") {
    zoneId = reservationZoneId;
    state = summary?.presence_state === "active" ? "working" : "thinking";
  } else if (event?.kind === "message_dm" || event?.kind === "message_broadcast") {
    zoneId = reservedPaths.length > 0 ? reservationZoneId : homeZoneId;
    state = summary?.presence_state === "stuck" ? "stuck" : "thinking";
  } else if (summary?.current_sub_task) {
    zoneId = reservedPaths.length > 0 ? reservationZoneId : homeZoneId;
    state = buildWorkingState(normalizedRole, summary);
  } else if (summary?.presence_state === "active") {
    zoneId = reservedPaths.length > 0 ? reservationZoneId : homeZoneId;
    state = "working";
  }

  const statusText =
    summary?.source === "crew"
      ? getCrewStatusText(state, zoneId, reservedPaths)
      : state === "walking"
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

function buildZoneEffects(
  agentSummaries: AgentSummary[],
): Partial<Record<VillageZoneId, VillageZoneEffect>> {
  return agentSummaries.reduce<Partial<Record<VillageZoneId, VillageZoneEffect>>>((acc, summary) => {
    const reservedPaths = summary.reserved_paths ?? [];
    for (const path of reservedPaths) {
      const zoneId = resolveVillageZoneForPath(path);
      const current = acc[zoneId] ?? { reserveCount: 0, reservedPaths: [] };
      acc[zoneId] = {
        reserveCount: current.reserveCount + 1,
        reservedPaths: current.reservedPaths.includes(path)
          ? current.reservedPaths
          : [...current.reservedPaths, path].slice(0, 3),
      };
    }
    return acc;
  }, {});
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
    const events = new Map<string, VillageActivityEvent>();

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
    () => intents.filter((intent) => intent.state !== "idle" && intent.state !== "resting").length,
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
