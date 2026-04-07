import { useMemo } from "react";
import type { VillageZoneId } from "./VillageZone";

export interface VillageBuilding {
  id: string;
  /** Label shown on hover */
  label: string;
  /** Position in map-% (bottom-center of building, where the "feet" are) */
  position: { x: number; y: number };
  /** The Y-% of the building's "base" for sorting (usually near the bottom) */
  sortY: number;
  /** Zone this building belongs to */
  zoneId: VillageZoneId;
  /** Optional: building type for future sprite reference */
  type: "hq" | "tower" | "market" | "library" | "campfire" | "dock" | "farm" | "house";
}

export interface YSortedElement {
  type: "agent" | "building";
  id: string;
  yPercent: number;
  zIndex: number;
}

/**
 * Returns a z-index value for an element at a given Y-% position.
 * Higher Y = higher z-index (closer to viewer).
 *
 * Layer ranges: ground (0–999), buildings/agents (1000–1999), UI (2000–2999).
 */
export function calculateYSortIndex(yPercent: number, baseLayer = 1): number {
  return baseLayer * 1000 + Math.round(yPercent * 10);
}

/**
 * Returns a new array sorted by Y position (ascending = back to front).
 * Uses a stable sort.
 */
export function sortByDepth<T>(items: T[], getY: (item: T) => number): T[] {
  return [...items].sort((a, b) => getY(a) - getY(b));
}

export const VILLAGE_BUILDINGS: VillageBuilding[] = [
  {
    id: "hq-main",
    label: "大宅总部",
    position: { x: 66.4, y: 38.8 },
    sortY: 44.5,
    zoneId: "hq",
    type: "hq",
  },
  {
    id: "watchtower-north",
    label: "石塔哨所",
    position: { x: 80.6, y: 23.1 },
    sortY: 30.5,
    zoneId: "watchtower",
    type: "tower",
  },
  {
    id: "market-stall-1",
    label: "集市摊位·甲",
    position: { x: 70.2, y: 33.8 },
    sortY: 35.8,
    zoneId: "market",
    type: "market",
  },
  {
    id: "market-stall-2",
    label: "集市摊位·乙",
    position: { x: 74.6, y: 34.2 },
    sortY: 36.2,
    zoneId: "market",
    type: "market",
  },
  {
    id: "market-stall-3",
    label: "集市工坊",
    position: { x: 78.1, y: 33.5 },
    sortY: 35.5,
    zoneId: "market",
    type: "market",
  },
  {
    id: "library-farmhouse",
    label: "农舍书屋",
    position: { x: 22.8, y: 24.8 },
    sortY: 32.8,
    zoneId: "library",
    type: "library",
  },
  {
    id: "campfire-ring",
    label: "营火空地",
    position: { x: 58.1, y: 73.6 },
    sortY: 78.0,
    zoneId: "campfire",
    type: "campfire",
  },
  {
    id: "dock-warehouse",
    label: "码头仓库",
    position: { x: 22.3, y: 83.2 },
    sortY: 85.8,
    zoneId: "docks",
    type: "dock",
  },
  {
    id: "dock-pier",
    label: "栈桥码头",
    position: { x: 27.1, y: 84.8 },
    sortY: 86.4,
    zoneId: "docks",
    type: "dock",
  },
  {
    id: "crop-shed-1",
    label: "农具棚·西",
    position: { x: 14.8, y: 34.5 },
    sortY: 36.8,
    zoneId: "crops",
    type: "farm",
  },
  {
    id: "crop-shed-2",
    label: "农具棚·东",
    position: { x: 19.5, y: 35.8 },
    sortY: 37.6,
    zoneId: "crops",
    type: "farm",
  },
];

/**
 * Merges agents and buildings, sorts by Y, and assigns z-indices in the
 * entity layer (baseLayer = 1 → z-index 1000–1999).
 */
export function useYSortedElements(
  agents: Array<{ id: string; position: { x: number; y: number } }>,
  buildings: VillageBuilding[] = VILLAGE_BUILDINGS,
): YSortedElement[] {
  return useMemo(() => {
    const elements: YSortedElement[] = [];

    for (const agent of agents) {
      elements.push({
        type: "agent",
        id: agent.id,
        yPercent: agent.position.y,
        zIndex: calculateYSortIndex(agent.position.y),
      });
    }

    for (const building of buildings) {
      elements.push({
        type: "building",
        id: building.id,
        yPercent: building.sortY,
        zIndex: calculateYSortIndex(building.sortY),
      });
    }

    return sortByDepth(elements, (el) => el.yPercent);
  }, [agents, buildings]);
}
