import {
  formatVillageRoleLabel,
  getVillageAgentAccent,
  mapVillageStateToExpression,
} from "../village/VillageAgent";
import { getCityZone, type CityPoint, type CityZoneId } from "./CityZone";
import type { AgentExpression } from "../types";

export type CityAgentState =
  | "idle"
  | "walking"
  | "working"
  | "thinking"
  | "reviewing"
  | "celebrating";

export type CityFacing = "down" | "up" | "right" | "left";

export interface CityAgentIntent {
  id: string;
  name: string;
  role: string;
  roleLabel: string;
  zoneId: CityZoneId;
  homeZoneId: CityZoneId;
  state: CityAgentState;
  statusText: string;
  detailText: string | null;
  slotIndex: number;
  accent: string;
  isLeader: boolean;
  spritePackId: string;
}

export interface CityAgentModel extends CityAgentIntent {
  position: CityPoint;
  targetZoneId: CityZoneId;
  facing: CityFacing;
}

export const CITY_MOVE_DURATION_MS = 2200;

export const formatCityRoleLabel = formatVillageRoleLabel;
export const getCityAgentAccent = getVillageAgentAccent;

export function inferCityFacing(from: CityPoint, to: CityPoint): CityFacing {
  const dLng = to.lng - from.lng;
  const dLat = to.lat - from.lat;
  if (Math.abs(dLng) > Math.abs(dLat)) {
    return dLng >= 0 ? "right" : "left";
  }
  return dLat >= 0 ? "up" : "down";
}

export function buildCityTravelStatus(zoneId: CityZoneId): string {
  return `前往${getCityZone(zoneId).label}`;
}

export function interpolateCityPoint(
  from: CityPoint,
  to: CityPoint,
  progress: number,
): CityPoint {
  return {
    lng: from.lng + (to.lng - from.lng) * progress,
    lat: from.lat + (to.lat - from.lat) * progress,
  };
}

export function describeCityState(state: CityAgentState, role: string): string {
  const normalizedRole = role.trim().toLowerCase();
  switch (state) {
    case "walking":
      return "沿着城市路网切换下一个节点";
    case "working":
      if (normalizedRole === "researcher") return "在通明湖整理资料脉络";
      if (normalizedRole === "writer") return "在湖畔持续打磨交付文稿";
      if (normalizedRole === "reviewer" || normalizedRole === "patrol") {
        return "在数据中枢跟进质量信号";
      }
      return "在产业节点推进执行流水线";
    case "thinking":
      return "在科创节点拆分方案与路径";
    case "reviewing":
      return "在数据中枢进行审阅复核";
    case "celebrating":
      return "返回中枢汇报最新进展";
    case "idle":
    default:
      return "在生态花园待命并同步上下文";
  }
}

export function mapCityStateToExpression(state: CityAgentState): AgentExpression {
  return mapVillageStateToExpression(state);
}
