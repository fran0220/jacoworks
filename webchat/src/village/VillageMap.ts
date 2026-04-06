import type { DashboardStats } from "../lib/ops-types";
import type { VillageAgentModel } from "./VillageAgent";
import { VILLAGE_BASE_SIZE, VILLAGE_ZONES, type VillageZoneId } from "./VillageZone";

export type CropStage = "seed" | "sprout" | "mature";

export interface VillageCropPlot {
  id: string;
  label: string;
  x: number;
  y: number;
  stage: CropStage;
}

export const VILLAGE_MAP_ASSETS = {
  overview: "/village/scene-overview.png",
  buildings: "/village/village-buildings.png",
  buildingShadow: "/village/village-buildings-shadow.png",
} as const;

const CROP_PLOTS: Array<Pick<VillageCropPlot, "id" | "label" | "x" | "y">> = [
  { id: "plot-1", label: "规划播种", x: 11.8, y: 37.5 },
  { id: "plot-2", label: "执行生长", x: 16.5, y: 39.2 },
  { id: "plot-3", label: "交付成熟", x: 21.1, y: 37.7 },
];

export function buildCropPlots(
  dashboardStats: DashboardStats | null,
  activeAgents: number,
): VillageCropPlot[] {
  const activeTasks = dashboardStats?.activeTasks ?? activeAgents;
  const topScore = dashboardStats?.topScore ?? 0;

  return CROP_PLOTS.map((plot, index) => {
    let stage: CropStage = "seed";
    if (activeTasks > index) stage = "sprout";
    if (topScore > 0 && activeTasks > index + 1) stage = "mature";
    if (topScore >= 3 && index === 0) stage = "mature";
    return { ...plot, stage };
  });
}

export function getZonePresence(
  agents: VillageAgentModel[],
): Partial<Record<VillageZoneId, number>> {
  return agents.reduce<Partial<Record<VillageZoneId, number>>>((acc, agent) => {
    acc[agent.zoneId] = (acc[agent.zoneId] ?? 0) + 1;
    return acc;
  }, {});
}

export function listVillageZones(): Array<(typeof VILLAGE_ZONES)[VillageZoneId]> {
  return Object.values(VILLAGE_ZONES);
}

export function getVillageAspectRatio(): number {
  return VILLAGE_BASE_SIZE.aspectRatio;
}
