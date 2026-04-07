import type { AgentSummary } from "../../lib/feed";
import type { TeamTemplateMember } from "../../lib/teams";
import {
  maybeSpritePackId,
  pickSpritePackIdFromSeed,
  resolveSpritePackIdForRole,
} from "../../lib/sprite-packs";
import {
  buildTravelStatus,
  describeVillageState,
  formatVillageRoleLabel,
  getVillageAgentAccent,
  type VillageAgentIntent,
  type VillageAgentState,
} from "../VillageAgent";
import {
  getVillageHomeZone,
  getVillageIdleZone,
  normalizeVillageRole,
} from "../VillageZone";
import {
  getCrewStatusText,
  getPresenceState,
  prettifyMemberName,
  resolveReservationZone,
  summarizeReservations,
} from "./events";
import type { VillageActivityEvent } from "./types";

function buildWorkingState(
  role: string,
  summary: AgentSummary,
): VillageAgentState {
  if (role === "reviewer" || role === "patrol") return "reviewing";
  const action = summary.recent_actions[0];
  if (action) {
    const key = `${action.method.toUpperCase()} ${action.path}`;
    if (/GET \/api\//.test(key) || /\/rules|\/tasks/.test(key)) return "thinking";
  }
  if (role === "planner" || role === "researcher" || role === "writer") {
    return "thinking";
  }
  return "working";
}

export function buildIntent(
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

  let zoneId = reservedPaths.length > 0 ? reservationZoneId : getVillageIdleZone();
  let state =
    getPresenceState(summary, normalizedRole) ??
    (reservedPaths.length > 0 ? "resting" : "idle");
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
