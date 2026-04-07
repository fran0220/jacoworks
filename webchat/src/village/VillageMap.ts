import type { DashboardStats } from "../lib/ops-types";
import type { VillageAgentModel } from "./VillageAgent";
import { VILLAGE_BASE_SIZE, VILLAGE_ZONES, type VillageZoneId } from "./VillageZone";

export type CropStage = "empty" | "seed" | "sprout" | "mature" | "dead";

export interface VillageCropPlot {
  id: string;
  label: string;
  x: number;
  y: number;
  stage: CropStage;
  taskId?: string;
}

export type TaskCropStatus = "pending" | "assigned" | "running" | "done" | "failed" | "timeout";

export interface TaskCropInput {
  taskId: string;
  status: TaskCropStatus;
  label?: string;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export const VILLAGE_MAP_ASSETS = {
  overview: `${BASE}/village/scene-overview.png`,
  buildings: `${BASE}/village/village-buildings.png`,
  buildingShadow: `${BASE}/village/village-buildings-shadow.png`,
} as const;

const CROP_PLOTS: Array<Pick<VillageCropPlot, "id" | "label" | "x" | "y">> = [
  { id: "plot-1", label: "规划播种", x: 11.8, y: 37.5 },
  { id: "plot-2", label: "执行生长", x: 16.5, y: 39.2 },
  { id: "plot-3", label: "交付成熟", x: 21.1, y: 37.7 },
];

function taskStatusToCropStage(status: TaskCropStatus): CropStage {
  switch (status) {
    case "pending":
    case "assigned":
      return "seed";
    case "running":
      return "sprout";
    case "done":
      return "mature";
    case "failed":
    case "timeout":
      return "dead";
    default:
      return "empty";
  }
}

export function buildCropPlots(
  dashboardStats: DashboardStats | null,
  activeAgents: number,
  taskInputs?: TaskCropInput[],
): VillageCropPlot[] {
  if (taskInputs && taskInputs.length > 0) {
    return CROP_PLOTS.map((plot, index) => {
      const task = taskInputs[index];
      if (!task) return { ...plot, stage: "empty" as CropStage };
      return {
        ...plot,
        label: task.label ?? plot.label,
        stage: taskStatusToCropStage(task.status),
        taskId: task.taskId,
      };
    });
  }

  const activeTasks = dashboardStats?.activeTasks ?? activeAgents;
  const topScore = dashboardStats?.topScore ?? 0;

  return CROP_PLOTS.map((plot, index) => {
    let stage: CropStage = "seed" as CropStage;
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
