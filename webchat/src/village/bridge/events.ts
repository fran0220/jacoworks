import type { AgentSummary, RecentAction } from "../../lib/feed";
import type { TranslatedActivity } from "../../lib/feed-translate";
import type { ActivityStreamEvent } from "../../hooks/useActivityStream";
import {
  buildTravelStatus,
  describeVillageState,
  type VillageAgentState,
} from "../VillageAgent";
import {
  resolveVillageZoneForPath,
  type VillageZoneId,
} from "../VillageZone";
import type { VillageActivityEvent, VillageEventKind } from "./types";

export function normalizeToken(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function prettifyMemberName(name: string): string {
  return name
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (token) => token.toUpperCase());
}

function parseBody(body: string | null): Record<string, unknown> {
  if (!body) return {};
  try {
    const parsed = JSON.parse(body) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function extractReservationPaths(body: Record<string, unknown>): string[] {
  const arraySource =
    body.reserved_paths ?? body.reservations ?? body.file_reservations;

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
    body.message ?? body.content ?? body.text ?? body.summary ?? body.body;
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : null;
}

function extractMessageTarget(body: Record<string, unknown>): string | null {
  const candidate = body.target ?? body.to ?? body.recipient ?? body.channel;
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : null;
}

function summarizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "文件工位";
  const parts = trimmed.split("/").filter(Boolean);
  return parts[parts.length - 1] || trimmed;
}

export function summarizeReservations(paths: string[]): string | null {
  if (paths.length === 0) return null;
  const [first, ...rest] = paths;
  return rest.length > 0
    ? `锁定 ${summarizePath(first)} +${rest.length}`
    : `锁定 ${summarizePath(first)}`;
}

export function resolveReservationZone(
  paths: string[],
  fallback: VillageZoneId,
): VillageZoneId {
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

function describeEventKind(kind: string): string {
  switch (kind) {
    case "task_create":
      return "创建了新任务";
    case "task_claim":
      return "领取了任务";
    case "task_start":
      return "开始执行";
    case "task_submit":
      return "提交了任务";
    case "task_review":
      return "提交了审查";
    case "task_complete":
      return "完成了任务";
    case "task_rework":
      return "返工中";
    case "task_failed":
      return "执行失败";
    case "task_timeout":
      return "执行超时";
    case "file_reserve":
      return "锁定了文件";
    case "message_dm":
      return "发来了一条私信";
    case "message_broadcast":
      return "向全队广播了消息";
    default:
      return kind;
  }
}

export function sseEventToVillageEvent(
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

export function activityToEvent(
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
  else if (
    /message|broadcast|inbox|dm/.test(key) ||
    (extractMessageText(body) && extractMessageTarget(body))
  ) {
    kind =
      /broadcast|channel|team|all/.test(key) ||
      /broadcast|team|all/.test(extractMessageTarget(body) ?? "")
        ? "message_broadcast"
        : "message_dm";
  } else if (/GET \/api\//.test(key)) kind = "thinking";

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

export function getPresenceState(
  summary: AgentSummary | null,
  role: string,
): VillageAgentState | null {
  if (!summary?.presence_state) return null;
  if (summary.presence_state === "stuck") return "stuck";
  if (summary.presence_state === "idle") return "resting";
  if (summary.presence_state === "away") return "idle";
  if (summary.presence_state === "active") {
    return summary.current_sub_task ? buildWorkingState(role, summary) : "working";
  }
  return null;
}

export function getCrewStatusText(
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
