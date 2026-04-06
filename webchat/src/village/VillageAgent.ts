import { getVillageZone, type VillagePoint, type VillageZoneId } from "./VillageZone";
import type { AgentExpression } from "../types";

export type VillageAgentState =
  | "idle"
  | "walking"
  | "working"
  | "thinking"
  | "reviewing"
  | "celebrating";

export type VillageFacing = "down" | "up" | "right" | "left";

export interface VillageAgentIntent {
  id: string;
  name: string;
  role: string;
  roleLabel: string;
  zoneId: VillageZoneId;
  homeZoneId: VillageZoneId;
  state: VillageAgentState;
  statusText: string;
  detailText: string | null;
  slotIndex: number;
  accent: string;
  isLeader: boolean;
  spritePackId: string;
}

export interface VillageAgentModel extends VillageAgentIntent {
  position: VillagePoint;
  targetZoneId: VillageZoneId;
  facing: VillageFacing;
}

export const VILLAGE_MOVE_DURATION_MS = 1650;

const ROLE_LABELS: Record<string, string> = {
  planner: "规划师",
  executor: "执行者",
  reviewer: "审查员",
  patrol: "巡查员",
  researcher: "研究员",
  writer: "写作者",
  member: "成员",
  default: "默认助手",
};

const ROLE_ACCENTS: Record<string, string> = {
  planner: "#5b74ff",
  executor: "#e38a3d",
  reviewer: "#3fa873",
  patrol: "#9076ff",
  researcher: "#4f8d57",
  writer: "#bc6b4a",
  member: "#7b8496",
  default: "#5b74ff",
};

export function formatVillageRoleLabel(role: string): string {
  const normalized = role.trim().toLowerCase();
  return ROLE_LABELS[normalized] ?? (role || "成员");
}

export function getVillageAgentAccent(role: string, isLeader = false): string {
  if (isLeader) return "#6b5cff";
  const normalized = role.trim().toLowerCase();
  return ROLE_ACCENTS[normalized] ?? "#7b8496";
}

export function inferVillageFacing(
  from: VillagePoint,
  to: VillagePoint,
): VillageFacing {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx >= 0 ? "right" : "left";
  }
  return dy >= 0 ? "down" : "up";
}

export function mapVillageStateToExpression(state: VillageAgentState): AgentExpression {
  switch (state) {
    case "thinking":
    case "reviewing":
      return "thinking";
    case "working":
    case "walking":
      return "working";
    case "celebrating":
      return "happy";
    case "idle":
    default:
      return "idle";
  }
}

export function buildTravelStatus(zoneId: VillageZoneId): string {
  return `前往${getVillageZone(zoneId).label}`;
}

export function describeVillageState(
  state: VillageAgentState,
  role: string,
): string {
  const normalizedRole = role.trim().toLowerCase();
  switch (state) {
    case "walking":
      return "穿过小径赶往下一个据点";
    case "working":
      if (normalizedRole === "researcher") return "在书屋翻检资料";
      if (normalizedRole === "writer") return "在书桌整理成稿";
      if (normalizedRole === "reviewer" || normalizedRole === "patrol") {
        return "在高处盯着交付质量";
      }
      return "在集市工坊埋头执行";
    case "thinking":
      return "站在案前拆分思路";
    case "reviewing":
      return "塔楼审阅进行中";
    case "celebrating":
      return "回到广场汇报喜讯";
    case "idle":
    default:
      return "围着营火静候新任务";
  }
}
